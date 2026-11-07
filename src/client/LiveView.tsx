import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icons.tsx'
import { langLabel } from './langs.ts'
import { LineList } from './LinePicker.tsx'
import type { LiveKey } from './locales.ts'
import { LoginDialog } from './LoginDialog.tsx'
import { Player, type CueLike, type PlayerHandle, type PlayerMenu } from './Player.tsx'
import { Settings, type Browser, type KeyInfo } from './Settings.tsx'
import { defaultStyle, loadStyle, preset, reconcile, saveStyle, SubtitleSettings, type PresetName, type SubStyle } from './subStyle.tsx'

type Source = 'url' | 'push' | 'file'
interface NeedsLogin { site: string; browser?: string; detail: string }
interface Summary {
  id: string; status: 'resolving' | 'running' | 'stopping' | 'stopped' | 'error'; message?: string; title?: string
  source: Source; url: string; mode: string; srcLang: string; tgtLangs: string[]; provider: string; files: string[]
  startedAt: number; ingest?: { rtmp?: string; srt?: string; key?: string }
  vod?: boolean; duration?: number; loginBrowser?: string; needsLogin?: NeedsLogin
  subs?: { state: 'off' | 'running' | 'paused' | 'done'; at: number }
  usage?: Usage
}
interface Usage {
  models: { provider: string; model: string; input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; calls: number }[]
  audio: Record<string, number>
  total: number
}
interface Task { id: string; url?: string; kind: 'original' | 'subtitled'; dirId: string; title?: string; status: 'running' | 'done' | 'error'; pct: number; file?: string; error?: string; needsLogin?: NeedsLogin }
interface Term { src: string; tr: Record<string, string>; origin: 'auto' | 'user' }
interface Dep { name: string; ok: boolean; hint?: string }
interface Armed { jobId: string; rtmp?: string; key?: string }
type Tab = 'transcript' | 'glossary'

export interface LiveViewInjected {
  sessionId: string
  t: (key: LiveKey) => string
}

const CLOCK = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = Math.floor(s % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`
}
const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(`dsh-live.${k}`); return v ? JSON.parse(v) as T : d } catch { return d } },
  set(k: string, v: unknown) { try { localStorage.setItem(`dsh-live.${k}`, JSON.stringify(v)) } catch {} },
}

/** One box takes everything: page links, stream addresses, file paths. */
function classify(raw: string): { source: Source; url: string } | null {
  const v = raw.trim()
  if (!v) return null
  if (/^(\/|~\/|file:\/\/)/.test(v)) return { source: 'file', url: decodeURI(v.replace(/^file:\/\//, '')) }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return { source: 'url', url: v }
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(v)) return { source: 'url', url: `https://${v}` }
  return null
}

async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(`/live/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? res.statusText)
  return json
}

/** Upload with progress (XHR gives upload progress events; fetch does not). */
function upload(file: File, onProgress: (p: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/live/api/upload?name=${encodeURIComponent(file.name)}`)
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)) }
    xhr.onload = () => (xhr.status < 300 ? resolve(JSON.parse(xhr.responseText).path) : reject(new Error(xhr.responseText)))
    xhr.onerror = () => reject(new Error('upload failed'))
    xhr.send(file)
  })
}

function Copyable({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  return (
    <button className="dshl-copy" onClick={() => { void navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200) }}>
      <code>{value}</code>{done ? '✓' : <Icon.copy />}
    </button>
  )
}

const media = (dirId: string, file: string) => `/live/media/${encodeURIComponent(dirId)}/${encodeURIComponent(file)}`

export function LiveView(props: LiveViewInjected) {
  const { sessionId, t } = props
  // What to watch and how
  const [input, setInput] = useState('')
  const [lines, setLinesRaw] = useState<string[]>(() => store.get('lines', ['zh', 'src']))
  const setLines = (l: string[]) => { setLinesRaw(l); store.set('lines', l) }
  const [mode, setModeRaw] = useState<'realtime' | 'polished'>(() => store.get('mode', 'realtime'))
  const setMode = (m: 'realtime' | 'polished') => { setModeRaw(m); store.set('mode', m) }
  const [engine, setEngineRaw] = useState<string>(() => store.get('engine', ''))
  const setEngine = (e: string) => { setEngineRaw(e); store.set('engine', e) }
  const [spoken, setSpoken] = useState('auto')
  const [login, setLoginRaw] = useState('auto')
  const [browsers, setBrowsers] = useState<Browser[]>([])
  const [openaiKey, setOpenaiKey] = useState<KeyInfo>({ set: false })
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Environment
  const [langs, setLangs] = useState<Record<string, string>>({})
  const [deps, setDeps] = useState<Dep[]>([])
  const [hasTranslator, setHasTranslator] = useState(true)
  // Job
  const [job, setJob] = useState<Summary | null>(null)
  const [cues, setCues] = useState<CueLike[]>([])
  const [terms, setTerms] = useState<Term[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [armed, setArmed] = useState<Armed | null>(null)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [loginFor, setLoginFor] = useState<{ need: NeedsLogin; retry: () => void } | null>(null)
  // View
  const [subStyle, setSubStyle] = useState<SubStyle>(() => loadStyle(lines))
  const [delay, setDelay] = useState(8)
  const [theater, setTheater] = useState(false)
  const [tab, setTab] = useState<Tab>('transcript')
  const [query, setQuery] = useState('')
  const [now, setNow] = useState(0)
  const [tick, setTick] = useState(Date.now())
  const player = useRef<PlayerHandle>(null)
  const linesBox = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const active = !!job && (job.status === 'resolving' || job.status === 'running' || job.status === 'stopping')
  const ui: 'en' | 'zh' = t('view.live') === 'Video' ? 'en' : 'zh'
  const langOptions = useMemo(() => Object.entries(langs).filter(([k]) => k !== 'auto').map(([k, v]) => [k, langLabel(k, ui, v)] as [string, string]), [langs, ui])
  const langName = useCallback((k: string) => (k === 'src' ? t('sub.source') : langLabel(k, ui, langs[k])), [langs, t, ui])
  // Lines on screen: the job's own lines while one is shown, else the picker.
  const shownLines = lines
  const options = () => ({ mode, srcLang: spoken, tgtLangs: lines.filter(l => l !== 'src'), provider: engine || 'local', conversationId: sessionId })

  // ── Load environment and any job of this conversation ──
  useEffect(() => {
    fetch('/live/api/deps').then(r => r.json()).then(d => {
      setDeps(d.deps ?? []); setLangs(d.langs ?? {}); setHasTranslator(!!d.translator)
      if (d.keys?.openai) setOpenaiKey(d.keys.openai)
      // OpenAI when it has a key, else this Mac — unless the user already chose.
      setEngineRaw(prev => prev || (d.keys?.openai?.set ? 'openai' : 'local'))
    }).catch(() => {})
    fetch('/live/api/settings').then(r => r.json()).then(s => { setLoginRaw(s.cookies ?? 'auto'); setBrowsers(s.browsers ?? []) }).catch(() => {})
    fetch(`/live/api/job?conversationId=${encodeURIComponent(sessionId)}`).then(r => r.json()).then(j => {
      if (!j) return
      setJob(j); setCues(j.cues ?? []); setTerms(j.terms ?? [])
    }).catch(() => {})
  }, [sessionId])

  useEffect(() => { setSubStyle(s => reconcile(s, shownLines)) }, [shownLines.join(',')])
  useEffect(() => { saveStyle(subStyle) }, [subStyle])
  useEffect(() => { const id = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(id) }, [])

  // ── Live updates for the shown job ──
  useEffect(() => {
    if (!job?.id) return
    const es = new EventSource(`/live/api/events?jobId=${encodeURIComponent(job.id)}`)
    es.addEventListener('state', e => setJob(JSON.parse((e as MessageEvent).data)))
    es.addEventListener('cues', e => setCues(JSON.parse((e as MessageEvent).data)))
    es.addEventListener('glossary', e => setTerms(JSON.parse((e as MessageEvent).data)))
    es.addEventListener('cue', e => {
      const cue: CueLike = JSON.parse((e as MessageEvent).data)
      setCues(prev => {
        const i = prev.findIndex(c => c.id === cue.id)
        if (i < 0) return [...prev, cue]
        const next = prev.slice(); next[i] = cue; return next
      })
    })
    return () => es.close()
  }, [job?.id])

  // ── Always ready for a push: while nothing runs, listen for OBS; the stream starts the moment it arrives ──
  useEffect(() => {
    if (active) return
    const timer = setTimeout(() => {
      post('arm', options()).then((a: Armed & { busy?: boolean }) => setArmed(a.busy ? null : a)).catch(() => setArmed(null))
    }, 500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, lines.join(','), mode, engine, spoken, sessionId])
  useEffect(() => {
    if (!armed || active) return
    const es = new EventSource(`/live/api/events?jobId=${encodeURIComponent(armed.jobId)}`)
    es.addEventListener('state', e => {
      const s: Summary = JSON.parse((e as MessageEvent).data)
      if (s.status === 'running' && !s.message) { setCues([]); setTerms([]); setJob(s); setArmed(null) }
    })
    return () => es.close()
  }, [armed?.jobId, active])

  // ── Downloads: poll while any is running ──
  const refreshTasks = useCallback(() => {
    fetch(`/live/api/downloads?conversationId=${encodeURIComponent(sessionId)}`).then(r => r.json()).then(setTasks).catch(() => {})
  }, [sessionId])
  useEffect(() => { refreshTasks() }, [refreshTasks])
  useEffect(() => {
    if (!tasks.some(x => x.status === 'running')) return
    const id = setInterval(refreshTasks, 1000)
    return () => clearInterval(id)
  }, [tasks, refreshTasks])

  // ── Login prompts ──
  useEffect(() => {
    if (job?.status === 'error' && job.needsLogin) setLoginFor({ need: job.needsLogin, retry: () => void start(job.url, job.source) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status, job?.needsLogin?.site])
  const loginBrowser = login !== 'auto' && login !== 'none' ? login : browsers[0]?.id ?? 'chrome'
  const chooseLogin = (id: string) => { setLoginRaw(id); void post('settings', { cookies: id }).catch(() => {}) }

  // ── Actions ──
  /** Open a source: play and record only. Subtitles (which cost tokens) start from the player. */
  const start = async (target = input, forced?: Source) => {
    setError('')
    const c = forced ? { source: forced, url: target } : classify(target)
    if (!c) return
    try {
      const j = await post('start', { ...options(), source: c.source, url: c.url })
      setCues([]); setTerms([]); setJob(j); setArmed(null)
    } catch (e) { setError((e as Error).message) }
  }
  const subs = job?.subs ?? { state: 'off' as const, at: 0 }
  const startSubs = async (from?: number) => {
    if (!job) return
    setError('')
    if ((engine || 'local') === 'openai' && !openaiKey.set) { setSettingsOpen(true); setError(t('set.key.needed')); return }
    try { setJob(await post('subs', { ...options(), jobId: job.id, action: 'start', from })) } catch (e) { setError((e as Error).message) }
  }
  const pauseSubs = async () => { if (job) setJob(await post('subs', { jobId: job.id, action: 'pause' }).catch(() => job)) }
  // Picking a new translation language while subtitles run: pause and resume with it.
  const changeLines = async (next: string[]) => {
    const before = lines.filter(l => l !== 'src').join(','), after = next.filter(l => l !== 'src').join(',')
    setLines(next)
    if (job && subs.state === 'running' && before !== after) {
      await pauseSubs()
      try { setJob(await post('subs', { ...options(), tgtLangs: next.filter(l => l !== 'src'), jobId: job.id, action: 'start' })) } catch {}
    }
  }
  const stop = async () => { if (job) await post('stop', { jobId: job.id }).catch(() => {}) }
  const downloadOnly = async () => {
    const c = classify(input)
    if (c?.source !== 'url') return
    try { await post('download', { conversationId: sessionId, url: c.url }); refreshTasks() } catch (e) { setError((e as Error).message) }
  }
  const onFile = async (file: File) => {
    setError(''); setUploading(0)
    try {
      const path = await upload(file, setUploading)
      setInput(path)
      await start(path, 'file')
    } catch (e) { setError((e as Error).message) } finally { setUploading(null) }
  }
  const failedTask = tasks.find(x => x.status === 'error' && x.needsLogin)
  useEffect(() => {
    if (!failedTask?.needsLogin) return
    const url = failedTask.url
    if (url) setLoginFor({ need: failedTask.needsLogin, retry: () => void post('download', { conversationId: sessionId, url, jobId: failedTask.dirId }).then(refreshTasks) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failedTask?.id])

  // ── Transcript ──
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = cues.filter(c => c.src && c.final)
    return q ? rows.filter(c => c.src.toLowerCase().includes(q) || Object.values(c.tr ?? {}).some(v => v.toLowerCase().includes(q))) : rows
  }, [cues, query])
  const activeId = useMemo(() => cues.filter(c => c.start <= now + 0.2).at(-1)?.id, [cues, now])
  // Follow the playing line inside the list only (scrollIntoView would also scroll the whole page),
  // and leave the list alone for a few seconds after the user scrolls it.
  const userScrolled = useRef(0)
  useEffect(() => {
    const box = linesBox.current
    if (!box || query || tab !== 'transcript' || Date.now() - userScrolled.current < 5000) return
    const el = box.querySelector<HTMLElement>('.active')
    if (!el) return
    const top = el.offsetTop - box.offsetTop, bottom = top + el.offsetHeight
    if (top < box.scrollTop || bottom > box.scrollTop + box.clientHeight) box.scrollTo({ top: Math.max(0, top - box.clientHeight / 3), behavior: 'smooth' })
  }, [activeId, query, tab])
  const lineText = (c: CueLike, k: string) => (k === 'src' ? c.src : c.tr?.[k])
  const copyAll = () => void navigator.clipboard.writeText(shown.map(c => `[${CLOCK(c.start)}] ${shownLines.map(k => lineText(c, k)).filter(Boolean).join('\n')}`).join('\n\n'))

  // ── Status line ──
  const subsAt = cues.filter(c => c.final).at(-1)?.end ?? 0
  const statusText = !job ? '' :
    job.status === 'resolving' ? (job.loginBrowser ? t('st.login').replace('{b}', browsers.find(b => b.id === job.loginBrowser)?.label ?? job.loginBrowser) : t('st.resolving')) :
    job.status === 'running' ? (job.message ? t('st.waitPush') : job.vod ? t('st.loading') : t('st.live')) :
    job.status === 'stopped' && job.vod ? t('st.ready') :
    t(`st.${job.status}` as LiveKey)
  const statusDetail = job?.status === 'running' && !job.message && !job.vod ? CLOCK(Math.max(0, (tick - job.startedAt) / 1000)) : ''

  const missing = deps.filter(d => !d.ok && (d.name === 'ffmpeg' || (d.name === 'yt-dlp') || ((engine || 'local') === 'local' && d.name.startsWith('whisper'))))
  const needsModel = !hasTranslator && shownLines.some(l => l !== 'src')
  const canDownloadLink = classify(input)?.source === 'url' && !/^(rtmps?|srt|rtsp|udp):/i.test(classify(input)!.url)

  return (
    <div className={`dshl ${theater ? 'theater' : ''}`} data-dsh-own-drop="dsh-live"
      // Files dropped here belong to this view: keep them away from the chat composer's page-wide drop handler.
      onDragEnter={e => { if (e.dataTransfer.types.includes('Files')) e.stopPropagation() }}
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.stopPropagation(); e.preventDefault(); if (!active) setDragging(true) } }}
      onDragLeave={e => { e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false) }}
      onDrop={e => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); e.stopPropagation(); setDragging(false); const f = e.dataTransfer.files[0]; if (f && !active) void onFile(f) }}>

      <header className="dshl-top">
        <div className="dshl-bar">
          <label className="dshl-field">
            <Icon.link />
            <input type="text" value={input} placeholder={t('in.placeholder')} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void start() }} />
            <button className="ghost" title={t('in.file.tip')} onClick={() => fileInput.current?.click()}>
              {uploading !== null ? <span className="pct">{t('in.uploading').replace('{p}', String(uploading))}</span> : <Icon.folder />}
            </button>
            <input ref={fileInput} type="file" accept="video/*,audio/*,.mkv,.ts,.flv" hidden
              onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = '' }} />
          </label>
          {canDownloadLink && <button className="dshl-btn icon" onClick={downloadOnly} title={t('in.download.tip')}><Icon.download /></button>}
          <button className="dshl-btn primary" onClick={() => start()} disabled={!classify(input)}>{t('in.open')}</button>
          <Settings engine={engine || 'local'} onEngine={setEngine} mode={mode} onMode={setMode} spoken={spoken} onSpoken={setSpoken} langOptions={langOptions}
            login={login} onLogin={chooseLogin} browsers={browsers} openai={openaiKey}
            onOpenai={k => { setOpenaiKey(k); if (k.set) { setEngine('openai'); setError('') } }}
            open={settingsOpen} onOpen={setSettingsOpen} t={t} />
        </div>
      </header>

      {missing.length > 0 && <div className="dshl-note warn">{t('note.install')} {missing.map(d => <code key={d.name}>{d.hint}</code>)}</div>}
      {needsModel && <div className="dshl-note">{t('note.noModel')}</div>}
      {(error || job?.status === 'error') && (
        <div className="dshl-note warn"><span>{error || job?.message}</span>{job && !active && <button className="dshl-link" onClick={() => start(job.url, job.source)}>{t('st.retry')}</button>}</div>
      )}
      {tasks.length > 0 && (
        <div className="dshl-tasks">
          {tasks.filter(x => x.kind === 'original').slice(0, 3).map(x => <TaskRow key={x.id} task={x} t={t} />)}
        </div>
      )}

      {!job || (job.status === 'error' && !job.files.length) ? (
        <section className="dshl-empty">
          <div className="dshl-drop">
            <h2>{t('empty.title')}</h2>
            <p>{t('empty.body')}</p>
            {armed?.rtmp && (
              <div className="dshl-pushinfo" title={t('in.push.tip')}>
                <Icon.push />
                <span>{t('push.title')}</span>
                <span className="kv"><em>{t('push.server')}</em><Copyable value={armed.rtmp} /></span>
                {armed.key && <span className="kv"><em>{t('push.key')}</em><Copyable value={armed.key} /></span>}
              </div>
            )}
          </div>
        </section>
      ) : (
        <main className="dshl-main">
          <div className="dshl-col">
            <Player ref={player}
              src={job.status === 'resolving' || job.status === 'error' ? null : `/live/media/${encodeURIComponent(job.id)}/hls/index.m3u8`}
              live={job.status === 'running'} vod={job.vod} duration={job.duration} subsAt={subs.state === 'off' ? undefined : subs.at}
              waitingText={job.status === 'resolving' ? statusText : t('player.waiting')}
              cues={cues} style={subStyle} delay={delay} onDelay={setDelay} showDelay={mode === 'realtime' && job.status === 'running'}
              theater={theater} onTheater={() => setTheater(v => !v)} onTime={setNow} t={t}
              action={<SubsButton state={subs.state} at={subs.at} onStart={() => startSubs(now)} onPause={pauseSubs} onResume={() => startSubs()} t={t} />}
              menus={[
                {
                  id: 'cc', icon: <Icon.cc />, title: t('menu.cc'), content: (
                    <>
                      <LineList lines={lines} onChange={l => void changeLines(l)} options={langOptions} name={langName} t={t} />
                      <div className="dshl-seg wide">
                        {(['everyday', 'present', 'single'] as PresetName[]).map(p => (
                          <button key={p} onClick={() => setSubStyle(preset(p, shownLines))}>{t(`preset.${p}` as LiveKey)}</button>
                        ))}
                      </div>
                      <SubtitleSettings style={subStyle} onChange={setSubStyle} t={t} onReset={() => setSubStyle(defaultStyle(shownLines))} langName={langName} />
                    </>
                  ),
                },
                {
                  id: 'download', icon: <Icon.download />, title: t('menu.download'), content: (
                    <DownloadPanel job={job} active={active} lines={shownLines} tasks={tasks.filter(x => x.dirId === job.id)} sessionId={sessionId}
                      onTask={refreshTasks} langName={langName} t={t} />
                  ),
                },
              ]} />
            <div className="dshl-done">
              <span className={`dshl-pill ${job.status === 'running' && !job.message && !job.vod ? 'live' : ''}`}>
                {job.status === 'running' && !job.message && !job.vod && <i className="dot" />}{statusText}
              </span>
              {statusDetail && <span className="dshl-time">{statusDetail}</span>}
              <span className="dshl-title" title={job.title || job.url}>{job.title || (job.source === 'push' ? '' : job.url)}</span>
              <UsagePill usage={job.usage} t={t} ui={ui} />
              {job.status === 'running' && !job.vod && <button className="dshl-btn small" onClick={stop}>{t('in.stop')}</button>}
            </div>
          </div>

          <aside className="dshl-side">
            <div className="dshl-sidetabs" role="tablist">
              {(['transcript', 'glossary'] as Tab[]).map(k => (
                <button key={k} role="tab" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t(`tab.${k}` as LiveKey)}</button>
              ))}
            </div>

            {tab === 'transcript' && (
              <div className="dshl-panel">
                <div className="dshl-tools">
                  <label className="dshl-field small"><Icon.search /><input type="text" value={query} placeholder={t('tr.search')} onChange={e => setQuery(e.target.value)} /></label>
                  <button className="ghost" title={t('tr.copy')} onClick={copyAll}><Icon.copy /></button>
                </div>
                <div className="dshl-lines" ref={linesBox} onWheel={() => { userScrolled.current = Date.now() }} onTouchMove={() => { userScrolled.current = Date.now() }}>
                  {shown.length === 0 && <div className="dshl-muted pad">{t('tr.empty')}</div>}
                  {shown.map(c => (
                    <button className={`dshl-line ${c.id === activeId ? 'active' : ''}`} key={c.id} onClick={() => player.current?.seek(c.start)}>
                      <span className="ts">{CLOCK(c.start)}</span>
                      <span className="txt">
                        {shownLines.map((k, i) => { const v = lineText(c, k); return v ? <span className={i === 0 ? 'main' : 'sub'} key={k}>{v}</span> : null })}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {tab === 'glossary' && <GlossaryPanel jobId={job.id} terms={terms} targets={job.tgtLangs} langName={langName} t={t} onTerms={setTerms} />}
          </aside>
        </main>
      )}

      {dragging && <div className="dshl-dropzone"><div>{t('in.drop')}</div></div>}
      {loginFor && (
        <LoginDialog site={loginFor.need.site} browser={loginBrowser} browsers={browsers} onBrowser={chooseLogin} t={t}
          onClose={() => setLoginFor(null)} onRetry={() => { const r = loginFor.retry; setLoginFor(null); r() }} />
      )}
    </div>
  )
}

function SubsButton(props: { state: 'off' | 'running' | 'paused' | 'done'; at: number; onStart: () => void; onPause: () => void; onResume: () => void; t: (k: LiveKey) => string }) {
  const { state, at, onStart, onPause, onResume, t } = props
  if (state === 'done') return <span className="dshl-subsbtn done" title={t('subs.done')}><Icon.cc /> ✓</span>
  if (state === 'running') return <button className="dshl-subsbtn running" onClick={onPause} title={t('subs.pause.tip')}><i className="dot" />{CLOCK(at)} · {t('subs.pause')}</button>
  if (state === 'paused') return <button className="dshl-subsbtn" onClick={onResume} title={t('subs.resume.tip').replace('{t}', CLOCK(at))}>{t('subs.resume')} {CLOCK(at)}</button>
  return <button className="dshl-subsbtn" onClick={onStart} title={t('subs.start.tip')}>{t('subs.start')}</button>
}

const fmtTokens = (n: number, ui: 'en' | 'zh') =>
  ui === 'zh' && n >= 10000 ? `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万` : n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n)

/** Total tokens for this video; hover or click for per-model input / output / cache. */
function UsagePill({ usage, t, ui }: { usage?: Usage; t: (k: LiveKey) => string; ui: 'en' | 'zh' }) {
  const [open, setOpen] = useState(false)
  const total = usage?.total ?? 0
  const audio = Object.entries(usage?.audio ?? {}).filter(([, v]) => v > 1)
  if (!total && !audio.length) return null
  const n = (v: number) => fmtTokens(v, ui)
  return (
    <span className="dshl-usage" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button className="dshl-pill" onClick={() => setOpen(v => !v)}>{t('usage.tokens').replace('{n}', n(total))}</button>
      {open && (
        <div className="dshl-pop right up usage">
          <h3>{t('usage.title')}</h3>
          {usage?.models.length ? (
            <table>
              <thead><tr><th>{t('usage.model')}</th><th>{t('usage.input')}</th><th>{t('usage.output')}</th><th>{t('usage.cache')}</th><th>{t('usage.calls')}</th></tr></thead>
              <tbody>
                {usage.models.map(m => (
                  <tr key={`${m.provider}/${m.model}`}>
                    <td title={m.provider}>{m.model}</td>
                    <td>{n(m.input)}</td>
                    <td title={m.reasoning ? t('usage.reasoning').replace('{n}', n(m.reasoning)) : undefined}>{n(m.output)}</td>
                    <td>{n(m.cacheRead + m.cacheWrite)}</td>
                    <td>{m.calls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="dshl-muted">{t('usage.none')}</p>}
          {audio.map(([k, v]) => <p key={k} className="dshl-muted small">{t(k === 'openai' ? 'usage.audio.openai' : 'usage.audio.local').replace('{t}', CLOCK(v))}</p>)}
        </div>
      )}
    </span>
  )
}

function TaskRow({ task, t }: { task: Task; t: (k: LiveKey) => string }) {
  return (
    <div className={`dshl-task ${task.status}`}>
      <Icon.download />
      <span className="name">{task.title ?? task.file}</span>
      {task.status === 'running' && <span className="bar"><i style={{ width: `${task.pct}%` }} /></span>}
      {task.status === 'running' && <span className="pct">{t('dl.pct').replace('{p}', String(task.pct))}</span>}
      {task.status === 'done' && task.file && <a href={media(task.dirId, task.file)} download>{task.file}</a>}
      {task.status === 'error' && <span className="bad" title={task.error}>{t('dl.failed')}</span>}
    </div>
  )
}

function DownloadPanel(props: {
  job: Summary; active: boolean; lines: string[]; tasks: Task[]; sessionId: string; onTask: () => void
  langName: (k: string) => string; t: (k: LiveKey) => string
}) {
  const { job, active, lines, tasks, sessionId, onTask, langName, t } = props
  const [fmt, setFmt] = useState<'srt' | 'vtt' | 'txt' | 'md'>('srt')
  const latest = (kind: Task['kind']) => tasks.find(x => x.kind === kind)
  const original = latest('original')
  const subtitled = latest('subtitled')
  const hasOriginal = job.files.some(f => /^original\./.test(f)) || original?.status === 'done'
  const hasRecording = job.files.includes('recording.mp4')
  // A subtitled video needs a finished picture: the original, the finished recording, or the source file itself.
  const videoReady = hasOriginal || job.source === 'file' || (!active && hasRecording)
  const run = (path: string, body: unknown) => post(path, { conversationId: sessionId, jobId: job.id, ...body as object }).then(onTask).catch(() => onTask())

  const item = (label: string, tip: string, task: Task | undefined, ready: boolean, go: () => void, fileHint?: string) => (
    <div className="dl-row" title={tip}>
      <span className="label">{label}</span>
      {task?.status === 'running'
        ? <span className="bar"><i style={{ width: `${task.pct}%` }} /></span>
        : task?.status === 'done' && task.file
          ? <a className="dshl-btn small" href={media(task.dirId, task.file)} download><Icon.download /> {task.file}</a>
          : fileHint
            ? <a className="dshl-btn small" href={media(job.id, fileHint)} download><Icon.download /> {fileHint}</a>
            : ready
              ? <button className="dshl-btn small" onClick={go}>{task?.status === 'error' ? t('st.retry') : t('dl.get')}</button>
              : <span className="dshl-muted small">{t('dl.later')}</span>}
    </div>
  )

  return (
    <div className="dshl-panel dshl-dl">
      <h3>{t('dl.video')}</h3>
      {job.source === 'url' && item(t('dl.original'), t('dl.original.tip'), original, true, () => run('download', {}),
        !original && hasOriginal ? job.files.find(f => /^original\./.test(f)) : undefined)}
      {item(t('dl.subtitled'), `${t('dl.subtitled.tip')} · ${lines.map(langName).join(' · ')}`, subtitled, videoReady, () => run('subtitled', { langs: lines }))}
      {job.source !== 'file' && hasRecording && !hasOriginal && item(t('dl.recording'), '', undefined, true, () => {}, 'recording.mp4')}

      <h3>{t('dl.subs')} <span className="dshl-muted small">{lines.map(langName).join(' · ')}</span></h3>
      <div className="dl-row">
        <span className="dshl-seg">
          {(['srt', 'vtt', 'txt', 'md'] as const).map(f => <button key={f} className={fmt === f ? 'on' : ''} onClick={() => setFmt(f)}>{t(`dl.fmt.${f}` as LiveKey)}</button>)}
        </span>
        <a className="dshl-btn small primary" href={`/live/api/export?jobId=${encodeURIComponent(job.id)}&langs=${lines.join(',')}&format=${fmt}`}><Icon.download /> {t('dl.get')}</a>
      </div>
    </div>
  )
}

function GlossaryPanel(props: { jobId: string; terms: Term[]; targets: string[]; langName: (k: string) => string; t: (k: LiveKey) => string; onTerms: (t: Term[]) => void }) {
  const { jobId, terms, targets, langName, t, onTerms } = props
  const [src, setSrc] = useState('')
  const save = async (term: { src: string; tr: Record<string, string> }) => onTerms(await post('glossary', { jobId, op: 'upsert', ...term }))
  const remove = async (s: string) => onTerms(await post('glossary', { jobId, op: 'remove', src: s }))
  return (
    <div className="dshl-panel" title={t('gl.tip')}>
      <div className="dshl-tools">
        <label className="dshl-field small"><Icon.plus /><input type="text" placeholder={t('gl.new')} value={src} onChange={e => setSrc(e.target.value)}
          onKeyDown={async e => { if (e.key === 'Enter' && src.trim()) { await save({ src: src.trim(), tr: {} }); setSrc('') } }} /></label>
      </div>
      {terms.length === 0 && <div className="dshl-muted pad">{t('gl.empty')}</div>}
      <div className="dshl-gl">
        {terms.slice().reverse().map(term => (
          <div className="row" key={term.src}>
            <div className="term"><b>{term.src}</b>{term.origin === 'auto' && <span className="tag">{t('gl.auto')}</span>}
              <button className="ghost" title={t('in.remove')} onClick={() => remove(term.src)}><Icon.close /></button></div>
            {targets.map(l => (
              <input key={l} type="text" defaultValue={term.tr[l] ?? ''} placeholder={langName(l)}
                onBlur={e => { if (e.target.value !== (term.tr[l] ?? '')) void save({ src: term.src, tr: { ...term.tr, [l]: e.target.value } }) }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
