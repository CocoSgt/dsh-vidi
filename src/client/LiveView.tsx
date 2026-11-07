import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icons.tsx'
import { langLabel } from './langs.ts'
import type { LiveKey } from './locales.ts'
import { Player, type CueLike, type PlayerHandle } from './Player.tsx'
import { defaultStyle, loadStyle, preset, reconcile, saveStyle, SubtitleSettings, type PresetName, type SubStyle } from './subStyle.tsx'

type Source = 'url' | 'push' | 'file'
interface Summary {
  id: string; status: 'resolving' | 'running' | 'stopping' | 'stopped' | 'error'; message?: string; title?: string
  source: Source; url: string; mode: string; srcLang: string; tgtLangs: string[]; provider: string; files: string[]
  startedAt: number; ingest?: { rtmp?: string; srt?: string; key?: string }
}
interface Term { src: string; tr: Record<string, string>; origin: 'auto' | 'user' }
interface Dep { name: string; ok: boolean; hint?: string }
type Tab = 'transcript' | 'glossary' | 'style' | 'export'

export interface LiveViewInjected {
  sessionId: string
  t: (key: LiveKey) => string
}

const CLOCK = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = Math.floor(s % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`
}
const RECENT = 'dsh-live.recent'
const loadRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT) ?? '[]') } catch { return [] } }
const pushRecent = (u: string) => { try { localStorage.setItem(RECENT, JSON.stringify([u, ...loadRecent().filter(x => x !== u)].slice(0, 8))) } catch {} }

async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(`/live/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json()
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
    <span className="dshl-copyable">
      <code>{value}</code>
      <button className="ghost" onClick={() => { void navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200) }}>
        {done ? '✓' : <Icon.copy />}
      </button>
    </span>
  )
}

export function LiveView(props: LiveViewInjected) {
  const { sessionId, t } = props
  // Form
  const [source, setSource] = useState<Source>('url')
  const [url, setUrl] = useState('')
  const [pushProto, setPushProto] = useState<'rtmp' | 'srt'>('rtmp')
  const [filePath, setFilePath] = useState('')
  const [mode, setMode] = useState<'realtime' | 'polished'>('realtime')
  const [srcLang, setSrcLang] = useState('auto')
  const [tgtLangs, setTgtLangs] = useState<string[]>(['zh'])
  const [provider, setProvider] = useState('local')
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [uploading, setUploading] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  // Environment
  const [langs, setLangs] = useState<Record<string, string>>({})
  const [deps, setDeps] = useState<Dep[]>([])
  const [hasTranslator, setHasTranslator] = useState(true)
  // Job
  const [job, setJob] = useState<Summary | null>(null)
  const [cues, setCues] = useState<CueLike[]>([])
  const [terms, setTerms] = useState<Term[]>([])
  const [error, setError] = useState('')
  // View
  const [subStyle, setSubStyle] = useState<SubStyle>(() => loadStyle(['zh']))
  const [delay, setDelay] = useState(8)
  const [theater, setTheater] = useState(false)
  const [tab, setTab] = useState<Tab>('transcript')
  const [follow, setFollow] = useState(true)
  const [query, setQuery] = useState('')
  const [now, setNow] = useState(0)
  const [tick, setTick] = useState(Date.now())
  const player = useRef<PlayerHandle>(null)
  const linesBox = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/live/api/deps').then(r => r.json()).then(d => {
      setDeps(d.deps ?? []); setLangs(d.langs ?? {}); setHasTranslator(!!d.translator)
      if (d.defaultTargetLang) setTgtLangs(prev => (prev.length === 1 && prev[0] === 'zh' ? [d.defaultTargetLang] : prev))
    }).catch(() => {})
    fetch(`/live/api/job?conversationId=${encodeURIComponent(sessionId)}`).then(r => r.json()).then(j => {
      if (!j) return
      setJob(j); setCues(j.cues ?? []); setTerms(j.terms ?? []); setSource(j.source ?? 'url'); setMode(j.mode); setSrcLang(j.srcLang); setTgtLangs(j.tgtLangs)
      if (j.source === 'file') setFilePath(j.url); else if (j.source === 'url') setUrl(j.url)
    }).catch(() => {})
  }, [sessionId])

  useEffect(() => { setSubStyle(s => reconcile(s, tgtLangs)) }, [tgtLangs.join(',')])
  useEffect(() => { saveStyle(subStyle) }, [subStyle])
  useEffect(() => { const id = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(id) }, [])

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

  const start = async (override?: { source: Source; url: string }) => {
    setError('')
    const src = override?.source ?? source
    const target = override?.url ?? (src === 'push' ? pushProto : src === 'file' ? filePath.trim() : url.trim())
    if (!target) return
    try {
      const j = await post('start', { source: src, url: target, mode, srcLang, tgtLangs, provider, conversationId: sessionId })
      if (src === 'url') { pushRecent(target); setRecent(loadRecent()) }
      setCues([]); setTerms([]); setJob(j)
    } catch (e) { setError((e as Error).message) }
  }
  const stop = async () => { if (job) await post('stop', { jobId: job.id }).catch(() => {}) }

  const onFile = async (file: File) => {
    setError(''); setUploading(0)
    try {
      const path = await upload(file, setUploading)
      setSource('file'); setFilePath(path)
      await start({ source: 'file', url: path })
    } catch (e) { setError((e as Error).message) } finally { setUploading(null) }
  }

  const running = !!job && (job.status === 'resolving' || job.status === 'running')
  const missing = deps.filter(d => !d.ok && d.name !== 'mediamtx').map(d => `${d.name} (${d.hint})`)
  const ui: 'en' | 'zh' = t('view.live') === 'Live' ? 'en' : 'zh'
  const langOptions = Object.entries(langs).filter(([k]) => k !== 'auto').map(([k, v]) => [k, langLabel(k, ui, v)] as [string, string])
  const langName = useCallback((k: string) => (k === 'src' ? t('sub.source') : langLabel(k, ui, langs[k])), [langs, t, ui])

  // Transcript list: search + follow the playhead.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = cues.filter(c => c.src && c.final)
    return q ? rows.filter(c => c.src.toLowerCase().includes(q) || Object.values(c.tr ?? {}).some(v => v.toLowerCase().includes(q))) : rows
  }, [cues, query])
  const activeId = useMemo(() => cues.filter(c => c.start <= now + 0.2).at(-1)?.id, [cues, now])
  useEffect(() => {
    if (!follow || query || tab !== 'transcript') return
    linesBox.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' })
  }, [activeId, follow, query, tab])

  const copyAll = () => {
    const text = shown.map(c => `[${CLOCK(c.start)}] ${[...tgtLangs.map(l => c.tr?.[l]).filter(Boolean), c.src].join('\n')}`).join('\n\n')
    void navigator.clipboard.writeText(text)
  }

  // Export
  const [exLines, setExLines] = useState<string[]>(['zh', 'src'])
  const [exFormat, setExFormat] = useState<'srt' | 'vtt' | 'txt' | 'md'>('srt')
  useEffect(() => { setExLines(prev => { const keep = prev.filter(k => k === 'src' || tgtLangs.includes(k)); return keep.length ? keep : [...tgtLangs, 'src'] }) }, [tgtLangs.join(',')])

  const elapsed = job ? CLOCK(Math.max(0, (tick - job.startedAt) / 1000)) : ''
  const sourceLabel = job?.title || job?.url

  return (
    <div className={`dshl ${theater ? 'theater' : ''}`} data-dsh-own-drop="dsh-live"
      // Files dropped here belong to the live view: keep them away from the chat composer's page-wide drop handler.
      onDragEnter={e => { if (e.dataTransfer.types.includes('Files')) e.stopPropagation() }}
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.stopPropagation(); e.preventDefault(); if (!running) setDragging(true) } }}
      onDragLeave={e => { e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false) }}
      onDrop={e => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); e.stopPropagation(); setDragging(false); const f = e.dataTransfer.files[0]; if (f && !running) void onFile(f) }}>

      {/* ── Source & settings bar ── */}
      <header className="dshl-top">
        <div className="dshl-tabs" role="tablist">
          {(['url', 'push', 'file'] as Source[]).map(s => (
            <button key={s} role="tab" className={source === s ? 'on' : ''} disabled={running} onClick={() => setSource(s)}>{t(`src.${s}` as LiveKey)}</button>
          ))}
        </div>
        <div className="dshl-input">
          {source === 'url' && (
            <label className="field grow">
              <Icon.link />
              <input type="text" list="dshl-recent" value={url} placeholder={t('form.url')} onChange={e => setUrl(e.target.value)} disabled={running}
                onKeyDown={e => { if (e.key === 'Enter' && !running) void start() }} />
              <datalist id="dshl-recent">{recent.map(r => <option key={r} value={r} />)}</datalist>
            </label>
          )}
          {source === 'push' && (
            <div className="dshl-seg">
              <button className={pushProto === 'rtmp' ? 'on' : ''} disabled={running} onClick={() => setPushProto('rtmp')}>{t('src.pushRtmp')}</button>
              <button className={pushProto === 'srt' ? 'on' : ''} disabled={running} onClick={() => setPushProto('srt')}>{t('src.pushSrt')}</button>
            </div>
          )}
          {source === 'file' && (
            <>
              <label className="field grow">
                <Icon.file />
                <input type="text" value={filePath} placeholder={t('src.filePath')} onChange={e => setFilePath(e.target.value)} disabled={running}
                  onKeyDown={e => { if (e.key === 'Enter' && !running) void start() }} />
              </label>
              <label className="dshl-btn">
                {uploading !== null ? t('src.uploading').replace('{p}', String(uploading)) : t('src.choose')}
                <input type="file" accept="video/*,audio/*,.mkv,.ts,.flv" hidden disabled={running || uploading !== null}
                  onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = '' }} />
              </label>
            </>
          )}
          {running
            ? <button className="dshl-btn stop" onClick={stop}>{t('form.stop')}</button>
            : <button className="dshl-btn primary" onClick={() => start()} disabled={(source === 'url' && !url.trim()) || (source === 'file' && !filePath.trim())}>{t('form.start')} <Icon.arrow /></button>}
        </div>
        <div className="dshl-opts">
          <div className="dshl-seg" title={t('form.mode')}>
            <button className={mode === 'realtime' ? 'on' : ''} disabled={running} onClick={() => setMode('realtime')}>{t('mode.realtime')}</button>
            <button className={mode === 'polished' ? 'on' : ''} disabled={running} onClick={() => setMode('polished')}>{t('mode.polished')}</button>
          </div>
          <select value={srcLang} onChange={e => setSrcLang(e.target.value)} disabled={running} title={t('form.source')}>
            <option value="auto">{t('lang.auto')}</option>
            {langOptions.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <span className="dshl-muted">→</span>
          {tgtLangs.map((code, i) => (
            <span className="dshl-chip" key={code} title={t('form.target')}>
              {langName(code)}
              {tgtLangs.length > 1 && !running && <button title={t('form.removeLang')} onClick={() => setTgtLangs(tgtLangs.filter((_, j) => j !== i))}>×</button>}
            </span>
          ))}
          {!running && tgtLangs.length < 4 && (
            <select className="add" value="" onChange={e => { if (e.target.value) setTgtLangs([...tgtLangs, e.target.value]) }} title={t('form.target')}>
              <option value="">{t('form.addLang')}</option>
              {langOptions.filter(([k]) => !tgtLangs.includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}
          <select value={provider} onChange={e => setProvider(e.target.value)} disabled={running} title={t('form.provider')}>
            <option value="local">{t('provider.local')}</option>
          </select>
          <span className="dshl-hint">{t(mode === 'realtime' ? 'mode.realtime.hint' : 'mode.polished.hint')}</span>
        </div>
      </header>

      {missing.length > 0 && <div className="dshl-note warn">{t('deps.missing')} {missing.join(' · ')}</div>}
      {!hasTranslator && <div className="dshl-note">{t('translator.none')}</div>}
      {(error || job?.status === 'error') && (
        <div className="dshl-note warn">{error || job?.message} <button className="dshl-btn small" onClick={() => start()}>{t('err.retry')}</button></div>
      )}

      {!job ? (
        <section className="dshl-empty">
          <div className="dshl-drop">
            <h2>{t('empty.title')}</h2>
            <p>{t('empty.body')}</p>
            <p className="dshl-muted">{t('src.drop')}</p>
            <p className="dshl-kbd">{t('shortcuts')}</p>
          </div>
        </section>
      ) : (
        <main className="dshl-main">
          <div className="dshl-col">
            <Player ref={player}
              src={job.status === 'resolving' || job.status === 'error' ? null : `/live/media/${encodeURIComponent(job.id)}/hls/index.m3u8`}
              live={running}
              waitingText={job.status === 'resolving' ? t('status.resolving') : job.source === 'push' && job.message ? t('push.waiting') : t('player.waiting')}
              cues={cues} style={subStyle} delay={delay} onDelay={setDelay} showDelay={mode === 'realtime' && running}
              theater={theater} onTheater={() => setTheater(v => !v)} onOpenSettings={() => setTab('style')} onTime={setNow} t={t} />
            <div className="dshl-status">
              <span className={`dshl-pill ${job.status === 'running' ? 'live' : job.status === 'error' ? 'err' : ''}`}>
                {job.status === 'running' && <i className="dot" />}{t(`status.${job.status}` as LiveKey)}
              </span>
              {running && <span className="dshl-muted">{t('status.elapsed').replace('{t}', elapsed)}</span>}
              {sourceLabel && <span className="dshl-title" title={sourceLabel}>{sourceLabel}</span>}
            </div>
            {job.source === 'push' && job.ingest && (
              <div className="dshl-card push">
                <h3>{t('push.title')}</h3>
                {job.ingest.rtmp && <div className="kv"><span>{t('push.server')}</span><Copyable value={job.ingest.rtmp} /></div>}
                {job.ingest.rtmp && job.ingest.key && <div className="kv"><span>{t('push.key')}</span><Copyable value={job.ingest.key} /></div>}
                {job.ingest.srt && <div className="kv"><span>{t('push.srt')}</span><Copyable value={job.ingest.srt} /></div>}
                <p className="dshl-muted">{t('push.hint')}</p>
              </div>
            )}
          </div>

          <aside className="dshl-side">
            <div className="dshl-sidetabs" role="tablist">
              {(['transcript', 'glossary', 'style', 'export'] as Tab[]).map(k => (
                <button key={k} role="tab" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                  {t(`tab.${k}` as LiveKey)}{k === 'glossary' && terms.length ? <em>{terms.length}</em> : null}
                </button>
              ))}
            </div>

            {tab === 'transcript' && (
              <div className="dshl-panel">
                <div className="dshl-tools">
                  <label className="field grow small"><Icon.search /><input type="text" value={query} placeholder={t('tr.search')} onChange={e => setQuery(e.target.value)} /></label>
                  <label className="dshl-check"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} />{t('tr.follow')}</label>
                  <button className="ghost" title={t('tr.copy')} onClick={copyAll}><Icon.copy /></button>
                </div>
                <div className="dshl-lines" ref={linesBox}>
                  {shown.length === 0 && <div className="dshl-muted pad">{t('side.empty')}</div>}
                  {shown.map(c => (
                    <button className={`dshl-line ${c.id === activeId ? 'active' : ''}`} key={c.id} onClick={() => player.current?.seek(c.start)}>
                      <span className="ts">{CLOCK(c.start)}</span>
                      <span className="txt">
                        {tgtLangs.map(l => c.tr?.[l] && <span className="tgt" key={l}>{c.tr[l]}</span>)}
                        <span className="src">{c.src}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {tab === 'glossary' && (
              <GlossaryPanel jobId={job.id} terms={terms} targets={tgtLangs} langName={langName} t={t} onTerms={setTerms} />
            )}

            {tab === 'style' && (
              <div className="dshl-panel">
                <div className="dshl-presets">
                  <span className="dshl-muted">{t('preset.title')}</span>
                  {(['everyday', 'present', 'single'] as PresetName[]).map(p => (
                    <button key={p} className="dshl-btn small" onClick={() => setSubStyle(preset(p, tgtLangs))}>{t(`preset.${p}` as LiveKey)}</button>
                  ))}
                </div>
                <SubtitleSettings style={subStyle} onChange={setSubStyle} t={t} onReset={() => setSubStyle(defaultStyle(tgtLangs))} langName={langName} />
              </div>
            )}

            {tab === 'export' && (
              <div className="dshl-panel">
                <h3>{t('ex.lines')}</h3>
                <div className="dshl-checks">
                  {[...tgtLangs, 'src'].map(k => (
                    <label key={k} className="dshl-check">
                      <input type="checkbox" checked={exLines.includes(k)}
                        onChange={e => setExLines(prev => e.target.checked ? [...tgtLangs, 'src'].filter(x => x === k || prev.includes(x)) : prev.filter(x => x !== k))} />
                      {langName(k)}
                    </label>
                  ))}
                </div>
                <h3>{t('ex.format')}</h3>
                <div className="dshl-checks">
                  {(['srt', 'vtt', 'txt', 'md'] as const).map(f => (
                    <label key={f} className="dshl-check"><input type="radio" name="dshl-fmt" checked={exFormat === f} onChange={() => setExFormat(f)} />{t(`ex.fmt.${f}` as LiveKey)}</label>
                  ))}
                </div>
                <a className={`dshl-btn primary block ${exLines.length ? '' : 'disabled'}`}
                  href={`/live/api/export?jobId=${encodeURIComponent(job.id)}&langs=${exLines.join(',')}&format=${exFormat}`}>{t('ex.download')}</a>
                <h3>{t('ex.files')}</h3>
                {job.files.length === 0 && <div className="dshl-muted">{t('ex.recording')}</div>}
                {job.files.map(f => (
                  <a className="dshl-file" key={f} href={`/live/media/${encodeURIComponent(job.id)}/${encodeURIComponent(f)}`} target="_blank" rel="noreferrer"><Icon.file /> {f}</a>
                ))}
              </div>
            )}
          </aside>
        </main>
      )}

      {dragging && <div className="dshl-dropzone"><div>{t('src.drop')}</div></div>}
    </div>
  )
}

function GlossaryPanel(props: { jobId: string; terms: Term[]; targets: string[]; langName: (k: string) => string; t: (k: LiveKey) => string; onTerms: (t: Term[]) => void }) {
  const { jobId, terms, targets, langName, t, onTerms } = props
  const [src, setSrc] = useState('')
  const [tr, setTr] = useState<Record<string, string>>({})
  const save = async (term: { src: string; tr: Record<string, string> }) => onTerms(await post('glossary', { jobId, op: 'upsert', ...term }))
  const remove = async (s: string) => onTerms(await post('glossary', { jobId, op: 'remove', src: s }))
  return (
    <div className="dshl-panel">
      <p className="dshl-muted">{t('gl.hint')}</p>
      <div className="dshl-gl-add">
        <input type="text" placeholder={t('gl.term')} value={src} onChange={e => setSrc(e.target.value)} />
        {targets.map(l => <input key={l} type="text" placeholder={langName(l)} value={tr[l] ?? ''} onChange={e => setTr({ ...tr, [l]: e.target.value })} />)}
        <button className="dshl-btn small" disabled={!src.trim()} onClick={async () => { await save({ src, tr }); setSrc(''); setTr({}) }}>{t('gl.add')}</button>
      </div>
      {terms.length === 0 && <div className="dshl-muted pad">{t('gl.empty')}</div>}
      <div className="dshl-gl">
        {terms.slice().reverse().map(term => (
          <div className="row" key={term.src}>
            <div className="term"><b>{term.src}</b><span className={`tag ${term.origin}`}>{t(term.origin === 'auto' ? 'gl.auto' : 'gl.user')}</span></div>
            {targets.map(l => (
              <input key={l} type="text" defaultValue={term.tr[l] ?? ''} placeholder={langName(l)}
                onBlur={e => { if (e.target.value !== (term.tr[l] ?? '')) void save({ src: term.src, tr: { ...term.tr, [l]: e.target.value } }) }} />
            ))}
            <button className="ghost" title={t('form.removeLang')} onClick={() => remove(term.src)}>×</button>
          </div>
        ))}
      </div>
    </div>
  )
}
