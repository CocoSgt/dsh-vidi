import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { frameStore, onOpenRequest } from './bus.ts'
import { ChatPanel, type SessionFaceLike } from './ChatPanel.tsx'
import { Icon } from './icons.tsx'
import { langLabel } from './langs.ts'
import { LineChips } from './LineChips.tsx'
import { SubtitleMenu } from './SubtitleMenu.tsx'
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
  site?: { key: string; lang: string; name?: string; auto: boolean }[]
  spoken?: string
}
interface Usage {
  models: { provider: string; model: string; input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; calls: number }[]
  audio: Record<string, number>
  total: number
}
interface Task { id: string; url?: string; kind: 'original' | 'subtitled' | 'video'; saveAs?: string; stage?: 'download' | 'mux'; dirId: string; title?: string; status: 'running' | 'done' | 'error'; pct: number; file?: string; error?: string; needsLogin?: NeedsLogin }
interface Term { src: string; tr: Record<string, string>; origin: 'auto' | 'user' }
interface Dep { name: string; ok: boolean; hint?: string }
interface Armed { jobId: string; rtmp?: string; key?: string }
type Tab = 'chat' | 'transcript' | 'glossary'

export interface LiveViewInjected {
  sessionId: string
  t: (key: LiveKey) => string
  /** Page mode (video page): the session's chat lives in the side panel. */
  chatFace?: SessionFaceLike
  /** Page mode: leave the video page. */
  onClose?: () => void
  /** A link to open right away (sidebar, paste prompt). */
  pending?: string
  onPendingDone?: () => void
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

/** A value to copy: plain text (not an input look-alike) and a text button. */
function CopyRow({ label, value, copy, copied }: { label: string; value: string; copy: string; copied: string }) {
  const [done, setDone] = useState(false)
  return (
    <>
      <dt>{label}</dt>
      <dd>
        <span className="val">{value}</span>
        <button className="dshl-link" onClick={() => { void navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500) }}>{done ? copied : copy}</button>
      </dd>
    </>
  )
}

/** The viewer's language (browser), as a subtitle language code. */
export function browserLang(): string {
  const l = (typeof navigator !== 'undefined' ? navigator.language : 'en') || 'en'
  if (/^zh-(hant|tw|hk|mo)/i.test(l)) return 'zh-Hant'
  return l.split('-')[0]!.toLowerCase()
}

/** Translation lines (not the original, not the site's own tracks). */
const translationsOf = (lines: string[]) => lines.filter(l => l !== 'src' && !l.startsWith('site:'))
const siteName = (url: string) => /youtu\.?be/.test(url) ? 'YouTube' : /bilibili|b23\.tv/.test(url) ? 'B站' : /twitch/.test(url) ? 'Twitch' : ''

const media = (dirId: string, file: string) => `/live/media/${encodeURIComponent(dirId)}/${encodeURIComponent(file)}`

export function LiveView(props: LiveViewInjected) {
  const { sessionId, t, chatFace, onClose, pending, onPendingDone } = props
  const pageMode = !!onClose
  // What to watch and how
  const [input, setInput] = useState('')
  // Default: the viewer's language + the original.
  const [lines, setLinesRaw] = useState<string[]>(() => store.get('lines', [browserLang(), 'src']))
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
  const [jobsDir, setJobsDir] = useState<string>()
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
  const [tab, setTab] = useState<Tab>(onClose ? 'chat' : 'transcript')
  const [query, setQuery] = useState('')
  const [trMode, setTrMode] = useState<'lines' | 'read'>('lines')
  const [readLang, setReadLang] = useState<'src' | 'tr' | 'both'>('both')
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
  const options = () => ({ mode, srcLang: spoken, tgtLangs: translationsOf(lines), provider: engine || 'local', conversationId: sessionId })

  // ── Load environment and any job of this conversation ──
  useEffect(() => {
    fetch('/live/api/deps').then(r => r.json()).then(d => {
      setDeps(d.deps ?? []); setLangs(d.langs ?? {}); setHasTranslator(!!d.translator)
      if (d.dataDir) setJobsDir(`${d.dataDir}/jobs`)
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

  // ── Videos opened for this conversation elsewhere (DeepSeek's live_open, /video) ──
  useEffect(() => onOpenRequest(r => {
    if (r.sessionId !== sessionId || !r.jobId) return
    fetch(`/live/api/job?jobId=${encodeURIComponent(r.jobId)}`).then(x => x.json()).then(j => {
      if (j) { setJob(j); setCues(j.cues ?? []); setTerms(j.terms ?? []); setArmed(null) }
    }).catch(() => {})
  }), [sessionId])

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
  // Tasks already finished when the view opened (their failures don't prompt again).
  const seenTasks = useRef<Set<string> | null>(null)
  const refreshTasks = useCallback(() => {
    fetch(`/live/api/downloads?conversationId=${encodeURIComponent(sessionId)}`).then(r => r.json()).then((list: Task[]) => {
      if (seenTasks.current === null) seenTasks.current = new Set(list.filter(x => x.status !== 'running').map(x => x.id))
      setTasks(list)
    }).catch(() => {})
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
  useEffect(() => {
    if (!pending) return
    setInput(pending)
    void start(pending)
    onPendingDone?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])
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
    const before = translationsOf(lines).join(','), after = translationsOf(next).join(',')
    setLines(next)
    if (job && subs.state === 'running' && before !== after) {
      await pauseSubs()
      try { setJob(await post('subs', { ...options(), tgtLangs: translationsOf(next), jobId: job.id, action: 'start' })) } catch {}
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
  // Only failures that happen while this view is open ask for a login (not old ones on reopen).
  const failedTask = tasks.find(x => x.status === 'error' && x.needsLogin && !seenTasks.current?.has(x.id))
  useEffect(() => {
    if (!failedTask?.needsLogin) return
    const url = failedTask.url
    if (url) setLoginFor({ need: failedTask.needsLogin, retry: () => void post('download', { conversationId: sessionId, url, jobId: failedTask.dirId }).then(refreshTasks) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failedTask?.id])

  // ── The site's own subtitle tracks that are switched on ──
  const [siteCues, setSiteCues] = useState<Record<string, { start: number; end: number; text: string }[]>>({})
  const siteKeys = lines.filter(l => l.startsWith('site:') && job?.site?.some(s => s.key === l))
  useEffect(() => {
    if (!job) return
    for (const k of siteKeys) {
      if (siteCues[k]) continue
      fetch(`/live/api/site?jobId=${encodeURIComponent(job.id)}&key=${encodeURIComponent(k)}`).then(r => r.json())
        .then(list => setSiteCues(prev => ({ ...prev, [k]: Array.isArray(list) ? list : [] }))).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, siteKeys.join(',')])
  const shownSite = Object.fromEntries(siteKeys.map(k => [k, siteCues[k] ?? []]))
  const siteChips = (job?.site ?? []).map(s => {
    const name = siteName(job?.url ?? '') || t('dl.siteSubs')
    return { key: s.key, label: `${t(s.auto ? 'sub.siteAuto' : 'sub.site').replace('{site}', name)} · ${langLabel(s.lang.replace(/-orig$/, '').split('-')[0]!, ui, s.name ?? s.lang)}` }
  })

  const saveSnapshot = async (png: Blob, at: number) => {
    const r = await fetch(`/live/api/snapshot?jobId=${encodeURIComponent(job!.id)}&at=${at}`, { method: 'POST', body: png })
    const j = await r.json()
    if (!r.ok) throw new Error(j.error ?? 'snapshot failed')
    return j
  }
  const rememberFrame = useCallback((dataUrl: string) => {
    if (job) frameStore.set({ dataUrl, jobId: job.id, conversationId: sessionId, title: job.title })
  }, [job?.id, job?.title, sessionId])
  const makeClip = (from: number, to: number) => post('clip', { jobId: job!.id, from, to, langs: ['src', ...translationsOf(lines)].filter(l => lines.includes(l)) })

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
  const lineText = (c: CueLike, k: string) => (k === 'src' ? c.src : k.startsWith('site:') ? undefined : c.tr?.[k] && c.tr[k]!.trim() !== c.src.trim() ? c.tr[k] : undefined)
  const copyAll = () => void navigator.clipboard.writeText(shown.map(c => `[${CLOCK(c.start)}] ${shownLines.map(k => lineText(c, k)).filter(Boolean).join('\n')}`).join('\n\n'))

  // Reading view: consecutive lines of one speaker become a paragraph (new paragraph on a long pause or when it gets long).
  const firstTr = translationsOf(lines)[0]
  const joinText = (parts: string[]) => parts.reduce((acc, p) => (!acc ? p : /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]$/.test(acc) && /^[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(p) ? acc + p : `${acc} ${p}`), '')
  const paragraphs = useMemo(() => {
    const out: { speaker?: string; start: number; cues: CueLike[]; src: string; tr?: string }[] = []
    let cur: CueLike[] = []
    const flush = () => {
      if (!cur.length) return
      const tr = firstTr ? cur.map(c => c.tr?.[firstTr]).filter((x): x is string => !!x) : []
      const src = joinText(cur.map(c => c.src))
      const trText = joinText(tr)
      out.push({ speaker: cur[0]!.speaker, start: cur[0]!.start, cues: cur, src, tr: trText && trText !== src ? trText : undefined })
      cur = []
    }
    for (const c of cues.filter(x => x.final && x.src)) {
      const prev = cur.at(-1)
      if (prev && (c.speaker !== prev.speaker || c.start - prev.end > 2.5 || cur.reduce((n, x) => n + x.src.length, 0) > 320)) flush()
      cur.push(c)
    }
    flush()
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cues, firstTr])
  const downloadMd = () => {
    const md = [`# ${job?.title ?? 'Transcript'}`, '', ...paragraphs.flatMap(p => [
      `**${p.speaker ? `${p.speaker} · ` : ''}${CLOCK(p.start)}**`, '',
      ...(readLang !== 'tr' ? [p.src, ''] : []),
      ...(readLang !== 'src' && p.tr ? [readLang === 'both' ? `> ${p.tr}` : p.tr, ''] : []),
    ])].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }))
    a.download = `${(job?.title ?? 'transcript').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80)}.md`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }

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

  const hasMain = !!job && !(job.status === 'error' && !job.files.length)
  const emptyBox = (
    <div className="dshl-drop">
            <h2>{t('empty.title')}</h2>
            <p>{t('empty.body')}</p>
            {armed?.rtmp && (
              <div className="dshl-pushinfo">
                <div className="title"><Icon.push /> {t('push.title')} <span>{t('push.hint')}</span></div>
                <dl>
                  <CopyRow label={t('push.server')} value={armed.rtmp} copy={t('push.copy')} copied={t('push.copied')} />
                  {armed.key && <CopyRow label={t('push.key')} value={armed.key} copy={t('push.copy')} copied={t('push.copied')} />}
                </dl>
              </div>
            )}
          </div>
  )

  return (
    <div className={`dshl ${theater ? 'theater' : ''} ${pageMode ? 'page' : ''}`} data-dsh-own-drop="dsh-live"
      // Files dropped here belong to this view: keep them away from the chat composer's page-wide drop handler.
      onDragEnter={e => { if (e.dataTransfer.types.includes('Files')) e.stopPropagation() }}
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.stopPropagation(); e.preventDefault(); if (!active) setDragging(true) } }}
      onDragLeave={e => { e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false) }}
      onDrop={e => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); e.stopPropagation(); setDragging(false); const f = e.dataTransfer.files[0]; if (f && !active) void onFile(f) }}>

      <header className="dshl-top">
        <div className="dshl-bar">
          {onClose && <button className="dshl-btn icon back" onClick={onClose} title={t('page.back')}><Icon.arrow /></button>}
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

      {!hasMain && !pageMode ? (
        <section className="dshl-empty">
          <div className="dshl-drop">
            <h2>{t('empty.title')}</h2>
            <p>{t('empty.body')}</p>
            {armed?.rtmp && (
              <div className="dshl-pushinfo">
                <div className="title"><Icon.push /> {t('push.title')} <span>{t('push.hint')}</span></div>
                <dl>
                  <CopyRow label={t('push.server')} value={armed.rtmp} copy={t('push.copy')} copied={t('push.copied')} />
                  {armed.key && <CopyRow label={t('push.key')} value={armed.key} copy={t('push.copy')} copied={t('push.copied')} />}
                </dl>
              </div>
            )}
          </div>
        </section>
      ) : (
        <main className="dshl-main">
          <div className="dshl-col">
            {!hasMain || !job ? emptyBox : <>
            <Player ref={player}
              src={job.status === 'resolving' || job.status === 'error' ? null : `/live/media/${encodeURIComponent(job.id)}/hls/index.m3u8`}
              live={job.status === 'running'} vod={job.vod} duration={job.duration} subsAt={subs.state === 'off' ? undefined : subs.at}
              waitingText={job.status === 'resolving' ? statusText : t('player.waiting')}
              cues={cues} siteCues={shownSite} style={subStyle} delay={job.mode === 'polished' && !job.vod ? Math.max(delay, 75) : delay} onDelay={setDelay} showDelay={job.status === 'running' && !job.vod}
              onSnapshot={saveSnapshot} onClip={makeClip} onThumb={rememberFrame}
              theater={theater} onTheater={() => setTheater(v => !v)} onTime={setNow} t={t}
              action={subs.state === 'off'
                ? <SubsStarter lines={lines} onLines={l => void changeLines(l)} spoken={job.spoken} langName={langName} options={langOptions} siteChips={siteChips}
                    onStart={() => startSubs(now)} t={t} />
                : <SubsButton state={subs.state} at={subs.at} duration={job.vod ? job.duration : undefined} onStart={() => startSubs(now)} onPause={pauseSubs} onResume={() => startSubs()} t={t} />}
              menus={[
                {
                  id: 'cc', icon: <Icon.cc />, title: t('menu.cc'),
                  label: `${t('player.cc')} · ${lines.filter(l => !l.startsWith('site:') || siteChips.some(c => c.key === l)).map(k => siteChips.find(c => c.key === k)?.label ?? langName(k)).join(' · ')}`,
                  content: (
                    <>
                      <SubtitleMenu lines={lines} onLines={l => void changeLines(l)} options={langOptions} site={siteChips} name={langName}
                        style={subStyle} onStyle={setSubStyle} t={t} />
                    </>
                  ),
                },
                {
                  id: 'download', icon: <Icon.download />, title: t('menu.download'), content: (
                    <DownloadPanel job={job} lines={shownLines} tasks={tasks.filter(x => x.dirId === job.id)} sessionId={sessionId}
                      onTask={refreshTasks} langName={langName} siteChips={siteChips} t={t} />
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
            </>}
          </div>

          <aside className="dshl-side">
            <div className="dshl-sidetabs" role="tablist">
              {((pageMode ? ['chat', 'transcript', 'glossary'] : ['transcript', 'glossary']) as Tab[]).map(k => (
                <button key={k} role="tab" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t(`tab.${k}` as LiveKey)}</button>
              ))}
            </div>

            {tab !== 'chat' && !job && <div className="dshl-panel dshl-muted">{t('tr.empty')}</div>}

            {tab === 'transcript' && job && (
              <div className="dshl-panel">
                <div className="dshl-tools">
                  <div className="dshl-seg">
                    <button className={trMode === 'lines' ? 'on' : ''} onClick={() => setTrMode('lines')}>{t('tr.mode.lines')}</button>
                    <button className={trMode === 'read' ? 'on' : ''} onClick={() => setTrMode('read')}>{t('tr.mode.read')}</button>
                  </div>
                  {trMode === 'lines' ? (
                    <>
                      <label className="dshl-field small"><Icon.search /><input type="text" value={query} placeholder={t('tr.search')} onChange={e => setQuery(e.target.value)} /></label>
                      <button className="ghost" title={t('tr.copy')} onClick={copyAll}><Icon.copy /></button>
                    </>
                  ) : (
                    <>
                      {translationsOf(lines).length > 0 && (
                        <div className="dshl-seg">
                          {(['src', 'tr', 'both'] as const).map(k => <button key={k} className={readLang === k ? 'on' : ''} onClick={() => setReadLang(k)}>{t(`tr.lang.${k}` as LiveKey)}</button>)}
                        </div>
                      )}
                      <span className="grow" />
                      <button className="dshl-btn small" onClick={() => downloadMd()}><Icon.download /> {t('tr.md')}</button>
                    </>
                  )}
                </div>
                {trMode === 'lines' ? (
                  <div className="dshl-lines" ref={linesBox} onWheel={() => { userScrolled.current = Date.now() }} onTouchMove={() => { userScrolled.current = Date.now() }}>
                    {shown.length === 0 && <div className="dshl-muted pad">{t('tr.empty')}</div>}
                    {shown.map(c => (
                      <button className={`dshl-line ${c.id === activeId ? 'active' : ''} ${c.polished ? '' : 'raw'}`} key={c.id} onClick={() => player.current?.seek(c.start)}>
                        <span className="ts">{CLOCK(c.start)}</span>
                        <span className="txt">
                          {shownLines.map((k, i) => { const v = lineText(c, k); return v ? <span className={i === 0 ? 'main' : 'sub'} key={k}>{v}</span> : null })}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="dshl-read">
                    {paragraphs.length === 0 && <div className="dshl-muted pad">{t('tr.empty')}</div>}
                    {paragraphs.some(p => p.speaker) && <p className="dshl-muted small">{t('tr.speakers.tip')}</p>}
                    {paragraphs.map((p, i) => (
                      <section key={i} className={p.cues.some(c => c.id === activeId) ? 'active' : ''}>
                        <header>
                          {p.speaker && <b>{p.speaker}</b>}
                          <button className="ts" onClick={() => player.current?.seek(p.start)}>{CLOCK(p.start)}</button>
                        </header>
                        {readLang !== 'tr' && <p className={readLang === 'both' && p.tr ? 'src' : ''}>{p.src}</p>}
                        {readLang !== 'src' && p.tr && <p className="tr">{p.tr}</p>}
                      </section>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'chat' && <ChatPanel face={chatFace} now={now} lines={shownLines.map(langName)} hasVideo={!!job} jobsDir={jobsDir} t={t} />}

            {tab === 'glossary' && job && <GlossaryPanel jobId={job.id} terms={terms} targets={job.tgtLangs} langName={langName} t={t} onTerms={setTerms} />}
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

function SubsButton(props: { state: 'off' | 'running' | 'paused' | 'done'; at: number; duration?: number; onStart: () => void; onPause: () => void; onResume: () => void; t: (k: LiveKey) => string }) {
  const { state, at, duration, onStart, onPause, onResume, t } = props
  const pct = duration ? Math.min(100, Math.round((at / duration) * 100)) : undefined
  // Done: nothing to show here; the subtitle button next to it names the languages.
  if (state === 'done') return null
  // Running: progress fills the pill; on hover it says what a click does.
  if (state === 'running') return (
    <button className="dshl-subsbtn running" onClick={onPause} title={t('subs.pause.tip').replace('{t}', CLOCK(at))}
      style={{ ['--p' as string]: `${pct ?? 0}%` }}>
      <i className="dot" />
      <span className="now">{pct !== undefined ? t('subs.progress').replace('{p}', String(pct)) : t('subs.progressLive').replace('{t}', CLOCK(at))}</span>
      <span className="act">{t('subs.pause')}</span>
    </button>
  )
  if (state === 'paused') return (
    <button className="dshl-subsbtn" onClick={onResume} title={t('subs.resume.tip').replace('{t}', CLOCK(at))}>
      {t('subs.resume')}{pct !== undefined ? ` · ${pct}%` : ''}
    </button>
  )
  return <button className="dshl-subsbtn" onClick={onStart} title={t('subs.start.tip')}>{t('subs.start')}</button>
}

/** "Generate subtitles": first choose which (single, bilingual, original only, more), then start. */
function SubsStarter(props: {
  lines: string[]; onLines: (l: string[]) => void; spoken?: string; langName: (k: string) => string
  options: [string, string][]; siteChips: { key: string; label: string }[]; onStart: () => void; t: (k: LiveKey) => string
}) {
  const { lines, onLines, spoken, langName, options, siteChips, onStart, t } = props
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const me = browserLang()
  const same = !!spoken && spoken === me
  const own = lines.filter(l => !l.startsWith('site:'))
  const presets: string[][] = same ? [['src']] : [[me, 'src'], [me], ['src']]
  const eq = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
  const isPreset = presets.some(p => eq(own, p))
  return (
    <span className="dshl-starter" ref={box}>
      <button className="dshl-subsbtn" onClick={() => setOpen(v => !v)} title={t('subs.start.tip')}>{t('subs.start')}</button>
      {open && (
        <div className="dshl-startpop" onClick={e => e.stopPropagation()}>
          <div className="head">{t('subs.pick')}</div>
          {same && <p className="note">{t('subs.same').replace('{l}', langName(me))}</p>}
          <div className="opts">
            {presets.map(p => (
              <button key={p.join('+')} className={`opt ${eq(own, p) ? 'on' : ''}`} onClick={() => onLines(p)}>
                <b>{p.map(langName).join(' + ')}</b><span>{p.length > 1 ? t('subs.bilingual') : t('subs.single')}</span>
              </button>
            ))}
          </div>
          <details className="dshl-more" open={!isPreset}>
            <summary>{t('subs.other')}</summary>
            <LineChips lines={lines} onChange={onLines} options={options} site={siteChips} name={langName} t={t} />
          </details>
          <button className="dshl-btn primary go" onClick={() => { setOpen(false); onStart() }}>{t('subs.go')}</button>
        </div>
      )}
    </span>
  )
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

/** Download: choose what (video or subtitles), then one button that says exactly what you get. */
function DownloadPanel(props: {
  job: Summary; lines: string[]; tasks: Task[]; sessionId: string; onTask: () => void
  langName: (k: string) => string; siteChips: { key: string; label: string }[]; t: (k: LiveKey) => string
}) {
  const { job, lines, tasks, sessionId, onTask, langName, siteChips, t } = props
  const [tab, setTab] = useState<'video' | 'subs'>('video')
  const fileSource = job.source === 'file'
  const hasOriginal = job.files.some(f => /^original\./.test(f))
  const hasRecording = job.files.includes('recording.mp4')
  const [quality, setQuality] = useState<'original' | 'recording'>('original')
  const ownLines = lines.filter(l => !l.startsWith('site:'))
  const [withSubs, setWithSubs] = useState(job.subs?.state !== 'off' && ownLines.length > 0)
  const [subLines, setSubLines] = useState<string[]>(lines)
  const [fmt, setFmt] = useState<'srt' | 'vtt' | 'txt' | 'md'>('srt')
  const title = (job.title ?? 'video').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80)
  const subsLabel = ownLines.map(langName).join(' + ')
  const qLabel = fileSource ? t('dl.q.file') : t(quality === 'original' ? 'dl.q.original' : 'dl.q.recording')
  const what = [qLabel, withSubs ? `${subsLabel}` : '', 'MP4'].filter(Boolean).join(' · ')
  const saveAs = `${title}（${[qLabel, withSubs ? subsLabel : ''].filter(Boolean).join('，')}）.mp4`
  // The task for exactly this choice (latest first).
  const task = tasks.find(x => x.kind === 'video' && x.saveAs === saveAs)
  const go = () => post('video', { conversationId: sessionId, jobId: job.id, quality: fileSource ? 'original' : quality, langs: withSubs ? ownLines : [], saveAs }).then(onTask).catch(() => onTask())

  const card = (on: boolean, title: string, desc: string, pick: () => void, disabled = false) => (
    <button className={`dshl-card-opt ${on ? 'on' : ''}`} disabled={disabled} onClick={pick}>
      <b>{title}</b><span>{desc}</span>
    </button>
  )
  const ownSubLines = subLines.filter(l => !l.startsWith('site:'))
  const siteSubLines = subLines.filter(l => l.startsWith('site:'))
  return (
    <div className="dshl-dl">
      <div className="dshl-seg wide">
        <button className={tab === 'video' ? 'on' : ''} onClick={() => setTab('video')}>{t('dl.tab.video')}</button>
        <button className={tab === 'subs' ? 'on' : ''} onClick={() => setTab('subs')}>{t('dl.tab.subs')}</button>
      </div>
      {tab === 'video' ? (
        <>
          <div className="grp">
            <span className="cap">{t('dl.quality')}</span>
            <div className="cards">
              {fileSource
                ? card(true, t('dl.q.file'), t('dl.q.file.d'), () => {})
                : <>
                    {card(quality === 'original', t('dl.q.original'), hasOriginal ? t('dl.q.original.have') : t('dl.q.original.d'), () => setQuality('original'))}
                    {card(quality === 'recording', t('dl.q.recording'), hasRecording ? t('dl.q.recording.d') : t('dl.q.recording.wait'), () => setQuality('recording'), !hasRecording)}
                  </>}
            </div>
          </div>
          <div className="grp">
            <span className="cap">{t('dl.withSubs')}</span>
            <div className="cards">
              {card(!withSubs, t('dl.subs.none'), t('dl.subs.none.d'), () => setWithSubs(false))}
              {card(withSubs, t('dl.subs.tracks'), t('dl.subs.tracks.d').replace('{l}', subsLabel || '—'), () => setWithSubs(true), !ownLines.length || job.subs?.state === 'off')}
            </div>
          </div>
          {task?.status === 'running' ? (
            <div className="dshl-btn block progress" style={{ ['--p' as string]: `${task.pct}%` }}>
              {task.stage === 'mux' ? t('dl.stage.mux') : t('dl.stage.download').replace('{p}', String(task.pct))}
            </div>
          ) : task?.status === 'done' && task.file ? (
            <a className="dshl-btn block primary" href={media(task.dirId, task.file)} download={saveAs}><Icon.download /> {t('dl.save')}</a>
          ) : (
            <button className="dshl-btn block primary" onClick={() => void go()}><Icon.download /> {t('dl.go').replace('{what}', what)}</button>
          )}
          {task?.status === 'error' && <p className="err">{task.error}</p>}
        </>
      ) : (
        <>
          <div className="grp">
            <span className="cap">{t('dl.content')}</span>
            <LineChips lines={subLines} onChange={setSubLines} options={[]} site={siteChips} name={langName} t={t} />
          </div>
          <div className="grp">
            <span className="cap">{t('dl.format')}</span>
            <div className="dshl-seg wide">
              {(['srt', 'vtt', 'txt', 'md'] as const).map(f => <button key={f} className={fmt === f ? 'on' : ''} onClick={() => setFmt(f)}>{t(`dl.fmt.${f}` as LiveKey)}</button>)}
            </div>
          </div>
          {ownSubLines.length > 0 && (
            <a className="dshl-btn block primary" download={`${title}（${ownSubLines.map(langName).join('+')}）.${fmt}`}
              href={`/live/api/export?jobId=${encodeURIComponent(job.id)}&langs=${ownSubLines.join(',')}&format=${fmt}`}>
              <Icon.download /> {t('dl.go').replace('{what}', `${ownSubLines.map(langName).join(' + ')} · ${t(`dl.fmt.${fmt}` as LiveKey)}`)}
            </a>
          )}
          {siteSubLines.map(k => (
            <a key={k} className="dshl-btn block" download={`${title}（${siteChips.find(x => x.key === k)?.label ?? k}）.${fmt}`}
              href={`/live/api/site?jobId=${encodeURIComponent(job.id)}&key=${encodeURIComponent(k)}&format=${fmt}`}>
              <Icon.download /> {t('dl.go').replace('{what}', `${siteChips.find(x => x.key === k)?.label ?? k} · ${t(`dl.fmt.${fmt}` as LiveKey)}`)}
            </a>
          ))}
        </>
      )}
    </div>
  )
}

interface TermFull extends Term { aliases?: string[]; note?: string }

/** Glossary: maintained by the model while polishing; read-only list, hover to correct or remove. */
function GlossaryPanel(props: { jobId: string; terms: Term[]; targets: string[]; langName: (k: string) => string; t: (k: LiveKey) => string; onTerms: (t: Term[]) => void }) {
  const { jobId, terms, targets, langName, t, onTerms } = props
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ src: string; tr: Record<string, string>; aliases: string }>({ src: '', tr: {}, aliases: '' })
  const save = async (was: string) => {
    onTerms(await post('glossary', { jobId, op: 'upsert', was, src: draft.src, tr: draft.tr, aliases: draft.aliases.split(/[,，、]/).map(x => x.trim()).filter(Boolean) }))
    setEditing(null)
  }
  const remove = async (s: string) => onTerms(await post('glossary', { jobId, op: 'remove', src: s }))
  const list = terms.slice().reverse() as TermFull[]
  return (
    <div className="dshl-panel dshl-gl2">
      {list.length === 0 && <div className="dshl-muted pad">{t('gl.empty2')}</div>}
      {list.map(term => editing === term.src ? (
        <div className="term edit" key={term.src}>
          <input value={draft.src} onChange={e => setDraft({ ...draft, src: e.target.value })} />
          {targets.map(l => <input key={l} placeholder={langName(l)} value={draft.tr[l] ?? ''} onChange={e => setDraft({ ...draft, tr: { ...draft.tr, [l]: e.target.value } })} />)}
          <input placeholder={t('gl.alias')} value={draft.aliases} onChange={e => setDraft({ ...draft, aliases: e.target.value })} />
          <div className="acts">
            <button className="dshl-link" onClick={() => setEditing(null)}>{t('player.cancel')}</button>
            <button className="dshl-btn small primary" onClick={() => void save(term.src)}>{t('gl.save')}</button>
          </div>
        </div>
      ) : (
        <div className="term" key={term.src}>
          <div className="line">
            <b>{term.src}</b>
            {targets.map(l => term.tr[l] && term.tr[l] !== term.src ? <span key={l} className="tr">{term.tr[l]}</span> : null)}
            {term.origin === 'user' && <span className="tag">{t('gl.pinned')}</span>}
            <span className="grow" />
            <button className="ghost" title={t('gl.edit')} onClick={() => { setEditing(term.src); setDraft({ src: term.src, tr: { ...term.tr }, aliases: (term.aliases ?? []).join(', ') }) }}>✎</button>
            <button className="ghost" title={t('in.remove')} onClick={() => void remove(term.src)}><Icon.close /></button>
          </div>
          {(term.aliases?.length || term.note) && (
            <div className="meta">
              {term.aliases?.length ? <span>{t('gl.alias')} {term.aliases.join('、')}</span> : null}
              {term.note ? <span>{term.note}</span> : null}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
