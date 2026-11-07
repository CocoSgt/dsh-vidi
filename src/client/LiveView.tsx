import Hls from 'hls.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LiveKey } from './locales.ts'

interface Cue { id: number; start: number; end: number; src: string; tgt?: string; final: boolean }
interface Summary {
  id: string; status: 'resolving' | 'running' | 'stopping' | 'stopped' | 'error'; message?: string; title?: string
  url: string; mode: string; srcLang: string; tgtLang: string; provider: string; files: string[]
}
interface Dep { name: string; ok: boolean; hint?: string }

export interface LiveViewInjected {
  sessionId: string
  t: (key: LiveKey) => string
}

const TIME = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(`/live/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? res.statusText)
  return json
}

export function LiveView(props: LiveViewInjected) {
  const { sessionId, t } = props
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState<'realtime' | 'polished'>('realtime')
  const [srcLang, setSrcLang] = useState('auto')
  const [tgtLang, setTgtLang] = useState('zh')
  const [provider, setProvider] = useState('local')
  const [langs, setLangs] = useState<Record<string, string>>({})
  const [deps, setDeps] = useState<Dep[]>([])
  const [hasTranslator, setHasTranslator] = useState(true)
  const [job, setJob] = useState<Summary | null>(null)
  const [cues, setCues] = useState<Cue[]>([])
  const [delay, setDelay] = useState(8)
  const [now, setNow] = useState(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  const hls = useRef<Hls | null>(null)

  // Environment: dependencies, languages, translator availability; and any job already running here.
  useEffect(() => {
    fetch('/live/api/deps').then(r => r.json()).then(d => {
      setDeps(d.deps ?? []); setLangs(d.langs ?? {}); setHasTranslator(!!d.translator)
      if (d.defaultTargetLang) setTgtLang(d.defaultTargetLang)
    }).catch(() => {})
    fetch(`/live/api/job?conversationId=${encodeURIComponent(sessionId)}`).then(r => r.json()).then(j => {
      if (j) { setJob(j); setCues(j.cues ?? []); setUrl(j.url); setMode(j.mode); setSrcLang(j.srcLang); setTgtLang(j.tgtLang) }
    }).catch(() => {})
  }, [sessionId])

  // Live updates over SSE.
  useEffect(() => {
    if (!job?.id) return
    const es = new EventSource(`/live/api/events?jobId=${encodeURIComponent(job.id)}`)
    es.addEventListener('state', e => setJob(JSON.parse((e as MessageEvent).data)))
    es.addEventListener('cues', e => setCues(JSON.parse((e as MessageEvent).data)))
    es.addEventListener('cue', e => {
      const cue: Cue = JSON.parse((e as MessageEvent).data)
      setCues(prev => {
        const i = prev.findIndex(c => c.id === cue.id)
        if (i < 0) return [...prev, cue]
        const next = prev.slice(); next[i] = cue; return next
      })
    })
    return () => es.close()
  }, [job?.id])

  // Player: attach once the first HLS segments exist.
  useEffect(() => {
    const el = video.current
    if (!job?.id || !el || job.status === 'resolving' || job.status === 'error') return
    const src = `/live/media/${encodeURIComponent(job.id)}/hls/index.m3u8`
    let cancelled = false
    const attach = async () => {
      for (let i = 0; i < 60 && !cancelled; i++) {
        const r = await fetch(src, { cache: 'no-store' }).catch(() => null)
        if (r?.ok && (await r.text()).includes('.ts')) break
        await new Promise(res => setTimeout(res, 1000))
      }
      if (cancelled) return
      if (Hls.isSupported()) {
        const h = new Hls({ liveSyncDuration: delay, liveMaxLatencyDuration: delay + 30, lowLatencyMode: false, backBufferLength: 600 })
        hls.current = h
        h.loadSource(src)
        h.attachMedia(el)
        h.on(Hls.Events.MANIFEST_PARSED, () => { setReady(true); el.play().catch(() => {}) })
      } else {
        el.src = src
        el.addEventListener('loadedmetadata', () => { setReady(true); el.play().catch(() => {}) }, { once: true })
      }
    }
    void attach()
    return () => { cancelled = true; hls.current?.destroy(); hls.current = null; setReady(false) }
    // delay is applied live below; re-attaching only when the job changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status === 'resolving'])

  // Clock for the subtitle overlay.
  useEffect(() => {
    const id = setInterval(() => setNow(video.current?.currentTime ?? 0), 100)
    return () => clearInterval(id)
  }, [])

  const applyDelay = useCallback((v: number) => {
    setDelay(v)
    const h = hls.current, el = video.current
    if (h && el) {
      h.config.liveSyncDuration = v
      h.config.liveMaxLatencyDuration = v + 30
      const pos = h.liveSyncPosition
      if (pos != null) el.currentTime = pos
    }
  }, [])

  const current = useMemo(() => {
    const hit = cues.filter(c => c.start - 0.2 <= now && now <= c.end + 1.2)
    return hit.at(-1)
  }, [cues, now])

  const start = async () => {
    setError('')
    try {
      const j = await post('start', { url, mode, srcLang, tgtLang, provider, conversationId: sessionId })
      setCues([]); setJob(j)
    } catch (e) { setError((e as Error).message) }
  }
  const stop = async () => { if (job) await post('stop', { jobId: job.id }).catch(() => {}) }

  const running = job && (job.status === 'resolving' || job.status === 'running')
  const missing = deps.filter(d => !d.ok && (d.name !== 'mediamtx')).map(d => `${d.name} (${d.hint})`)
  const langOptions = Object.entries(langs).filter(([k]) => k !== 'auto')
  const recent = cues.filter(c => c.src).slice(-200).reverse()

  return (
    <div className="dshl">
      <div className="dshl-form">
        <input type="text" value={url} placeholder={t('form.url')} onChange={e => setUrl(e.target.value)} disabled={!!running}
          onKeyDown={e => { if (e.key === 'Enter' && !running && url.trim()) void start() }} />
        <span className="dshl-seg" title={t('form.mode')}>
          <button className={mode === 'realtime' ? 'on' : ''} disabled={!!running} onClick={() => setMode('realtime')}>{t('mode.realtime')}</button>
          <button className={mode === 'polished' ? 'on' : ''} disabled={!!running} onClick={() => setMode('polished')}>{t('mode.polished')}</button>
        </span>
        <select value={srcLang} onChange={e => setSrcLang(e.target.value)} disabled={!!running} title={t('form.source')}>
          <option value="auto">{t('lang.auto')}</option>
          {langOptions.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span>→</span>
        <select value={tgtLang} onChange={e => setTgtLang(e.target.value)} disabled={!!running} title={t('form.target')}>
          {langOptions.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={provider} onChange={e => setProvider(e.target.value)} disabled={!!running} title={t('form.provider')}>
          <option value="local">{t('provider.local')}</option>
        </select>
        {running
          ? <button className="dshl-btn stop" onClick={stop}>{t('form.stop')}</button>
          : <button className="dshl-btn primary" disabled={!url.trim()} onClick={start}>{t('form.start')}</button>}
        <div className="dshl-hint">{t(mode === 'realtime' ? 'mode.realtime.hint' : 'mode.polished.hint')}</div>
      </div>

      {missing.length > 0 && <div className="dshl-warn">{t('deps.missing')} {missing.join(' · ')}</div>}
      {!hasTranslator && <div className="dshl-warn">{t('translator.none')}</div>}
      {(error || job?.status === 'error') && <div className="dshl-warn">{error || job?.message}</div>}

      {!job ? (
        <div className="dshl-empty"><h2>{t('empty.title')}</h2><div>{t('empty.body')}</div></div>
      ) : (
        <div className="dshl-body">
          <div>
            <div className="dshl-stage">
              <video ref={video} controls playsInline muted={false} />
              {!ready && <div className="dshl-overlay">{job.status === 'resolving' ? t('status.resolving') : t('player.waiting')}</div>}
              {current && (
                <div className="dshl-sub">
                  {current.tgt && <div><span className="tgt">{current.tgt}</span></div>}
                  <div><span className={`src ${current.final ? '' : 'draft'}`}>{current.src}</span></div>
                </div>
              )}
            </div>
            <div className="dshl-bar">
              <span className={`dshl-pill ${job.status === 'running' ? 'live' : ''}`}>{job.status === 'running' ? '● ' : ''}{t(`status.${job.status}` as LiveKey)}</span>
              {job.title && <span>{job.title}</span>}
              {mode === 'realtime' && (
                <label title={t('player.delay.hint')}>
                  {t('player.delay')} {delay}s{' '}
                  <input type="range" min={2} max={30} step={1} value={delay} onChange={e => applyDelay(Number(e.target.value))} />
                </label>
              )}
            </div>
          </div>
          <div className="dshl-side">
            <div className="dshl-card">
              <h3>{t('side.transcript')}</h3>
              <div className="dshl-lines">
                {recent.length === 0 && <div style={{ color: 'var(--muted)' }}>{t('side.empty')}</div>}
                {recent.map(c => (
                  <div className="dshl-line" key={c.id}>
                    <span className="t">{TIME(c.start)}</span>
                    {c.tgt && <div className="tgt">{c.tgt}</div>}
                    <div className="src">{c.src}</div>
                  </div>
                ))}
              </div>
            </div>
            {job.files.length > 0 && (
              <div className="dshl-card dshl-files">
                <h3>{t('side.files')}</h3>
                {job.files.map(f => <a key={f} href={`/live/media/${encodeURIComponent(job.id)}/${encodeURIComponent(f)}`} target="_blank" rel="noreferrer">{f}</a>)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
