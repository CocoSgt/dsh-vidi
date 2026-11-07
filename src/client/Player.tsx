import Hls from 'hls.js'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Icon } from './icons.tsx'
import type { LiveKey } from './locales.ts'
import { SubtitleOverlay, type SubStyle } from './subStyle.tsx'

export interface CueLike { id: number; start: number; end: number; src: string; tr?: Record<string, string>; final: boolean }

export interface PlayerHandle {
  seek(t: number): void
}

interface Props {
  src: string | null
  /** A live stream that is still running (live badge, delay, follow the edge). */
  live: boolean
  /** A video: plays from the start, length known. */
  vod?: boolean
  duration?: number
  waitingText: string
  cues: CueLike[]
  style: SubStyle
  delay: number
  onDelay: (v: number) => void
  showDelay: boolean
  theater: boolean
  onTheater: () => void
  onOpenSettings: () => void
  onTime: (t: number) => void
  t: (k: LiveKey) => string
}

const fmt = (s: number) => {
  if (!isFinite(s)) return '0:00'
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = Math.floor(s % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`
}

/**
 * Video stage with custom controls. Fullscreen targets the whole stage so the
 * subtitle overlay (sized in container units) stays on screen and scales.
 */
export const Player = forwardRef<PlayerHandle, Props>(function Player(props, ref) {
  const { src, live, vod, duration, waitingText, cues, style, delay, onDelay, showDelay, theater, onTheater, onOpenSettings, onTime, t } = props
  const stage = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const hls = useRef<Hls | null>(null)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [now, setNow] = useState(0)
  const [edge, setEdge] = useState(0)
  const [ccOn, setCcOn] = useState(true)
  const [full, setFull] = useState(false)
  /** Window-filling fallback when the Fullscreen API is refused (embedded views, automation). */
  const [pageFull, setPageFull] = useState(false)
  const [idle, setIdle] = useState(false)
  const idleTimer = useRef<number>()

  useImperativeHandle(ref, () => ({ seek: (time: number) => { if (video.current) video.current.currentTime = Math.max(0, time) } }), [])

  // Attach HLS once the first segments exist.
  useEffect(() => {
    const el = video.current
    if (!src || !el) return
    let cancelled = false
    const attach = async () => {
      for (let i = 0; i < 90 && !cancelled; i++) {
        const r = await fetch(src, { cache: 'no-store' }).catch(() => null)
        if (r?.ok && (await r.text()).includes('.ts')) break
        await new Promise(res => setTimeout(res, 1000))
      }
      if (cancelled) return
      if (Hls.isSupported()) {
        // Videos start at 0 and never jump to the newest part; live streams sit `delay` seconds behind the edge.
        const h = new Hls(vod ? { startPosition: 0, backBufferLength: Infinity } : { liveSyncDuration: delay, liveMaxLatencyDuration: delay + 60, backBufferLength: 1800 })
        hls.current = h
        h.loadSource(src)
        h.attachMedia(el)
        h.on(Hls.Events.MANIFEST_PARSED, () => { setReady(true); el.play().catch(() => { el.muted = true; setMuted(true); el.play().catch(() => {}) }) })
      } else {
        el.src = src
        el.addEventListener('loadedmetadata', () => { setReady(true); el.play().catch(() => {}) }, { once: true })
      }
    }
    void attach()
    return () => { cancelled = true; hls.current?.destroy(); hls.current = null; setReady(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  // Clock: current time, live edge, play state.
  useEffect(() => {
    const id = window.setInterval(() => {
      const el = video.current
      if (!el) return
      setNow(el.currentTime)
      setPlaying(!el.paused)
      const end = el.seekable.length ? el.seekable.end(el.seekable.length - 1) : el.duration
      setEdge(isFinite(end) ? end : 0)
      onTime(el.currentTime)
    }, 150)
    return () => window.clearInterval(id)
  }, [onTime])

  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === stage.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) { void document.exitFullscreen(); return }
    if (pageFull) { setPageFull(false); return }
    const req = stage.current?.requestFullscreen?.()
    if (!req) { setPageFull(true); return }
    req.catch(() => setPageFull(true))
  }, [pageFull])
  const togglePlay = useCallback(() => {
    const el = video.current
    if (!el) return
    if (el.paused) void el.play(); else el.pause()
  }, [])
  const toggleMute = useCallback(() => {
    const el = video.current
    if (!el) return
    el.muted = !el.muted
    setMuted(el.muted)
  }, [])
  const goLive = useCallback(() => {
    const el = video.current, h = hls.current
    if (!el) return
    const pos = h?.liveSyncPosition ?? (edge - delay)
    if (pos != null && isFinite(pos)) el.currentTime = pos
    void el.play()
  }, [edge, delay])
  const applyDelay = useCallback((v: number) => {
    onDelay(v)
    const h = hls.current, el = video.current
    if (h && el) {
      h.config.liveSyncDuration = v
      h.config.liveMaxLatencyDuration = v + 60
      const pos = h.liveSyncPosition
      if (pos != null) el.currentTime = pos
    }
  }, [onDelay])

  // Keyboard shortcuts while the stage (or the page, when nothing editable is focused) is active.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return
      if (!stage.current?.isConnected || e.metaKey || e.ctrlKey || e.altKey) return
      const el = video.current
      switch (e.key) {
        case ' ': case 'k': e.preventDefault(); togglePlay(); break
        case 'f': case 'F': toggleFull(); break
        case 'Escape': if (pageFull) setPageFull(false); else return; break
        case 'm': case 'M': toggleMute(); break
        case 'c': case 'C': setCcOn(v => !v); break
        case 't': case 'T': onTheater(); break
        case 'l': case 'L': if (live) goLive(); break
        case 'ArrowLeft': if (el) el.currentTime = Math.max(0, el.currentTime - 5); break
        case 'ArrowRight': if (el) el.currentTime = Math.min(edge, el.currentTime + 5); break
        default: return
      }
      poke()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const poke = () => {
    setIdle(false)
    window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => setIdle(true), 2600)
  }

  const total = vod ? Math.max(duration ?? 0, edge) : edge
  const behind = Math.max(0, edge - now)
  const atLive = behind < delay + 10
  const current = ccOn ? cues.filter(c => c.start - 0.2 <= now && now <= c.end + 1.2).at(-1) : undefined
  const controlsHidden = idle && playing

  return (
    <div ref={stage} className={`dshl-stage ${full ? 'full' : ''} ${pageFull ? 'pagefull' : ''} ${controlsHidden ? 'idle' : ''}`} tabIndex={0}
      onMouseMove={poke} onMouseLeave={() => setIdle(true)} onDoubleClick={toggleFull}>
      <video ref={video} playsInline onClick={togglePlay} />
      {!ready && <div className="dshl-overlay"><div className="dshl-spinner" />{waitingText}</div>}
      {current && <SubtitleOverlay cue={current} style={style} />}
      {ready && live && !vod && (
        <button className={`dshl-livebadge ${atLive ? 'on' : ''}`} onClick={goLive} title={t('player.goLive')}>
          <Icon.live /> {atLive ? t('player.live') : t('player.behind').replace('{s}', fmt(behind))}
        </button>
      )}
      <div className="dshl-controls" onClick={e => e.stopPropagation()}>
        <div className="dshl-progress" style={{ ['--done' as string]: `${total ? (edge / total) * 100 : 100}%`, ['--pos' as string]: `${total ? (Math.min(now, total) / total) * 100 : 0}%` }}>
          <input type="range" min={0} max={Math.max(total, 1)} step={0.1} value={Math.min(now, total)}
            onChange={e => { if (video.current) video.current.currentTime = Math.min(Number(e.target.value), edge) }} aria-label="seek" />
        </div>
        <div className="dshl-ctrlrow">
          <button className="ic" onClick={togglePlay} title={`${playing ? t('player.pause') : t('player.play')} (Space)`}>{playing ? <Icon.pause /> : <Icon.play />}</button>
          <button className="ic" onClick={toggleMute} title={`${t('player.mute')} (M)`}>{muted || volume === 0 ? <Icon.mute /> : <Icon.volume />}</button>
          <input className="vol" type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume}
            onChange={e => { const v = Number(e.target.value); setVolume(v); if (video.current) { video.current.volume = v; video.current.muted = v === 0; setMuted(v === 0) } }} aria-label="volume" />
          <span className="time">{fmt(now)}{live && !vod ? '' : ` / ${fmt(total)}`}</span>
          <span className="grow" />
          {showDelay && !vod && (
            <label className="delay" title={t('player.delay.tip')}>
              {t('player.delay')} {delay}s
              <input type="range" min={2} max={30} step={1} value={delay} onChange={e => applyDelay(Number(e.target.value))} />
            </label>
          )}
          <button className={`ic ${ccOn ? 'on' : ''}`} onClick={() => setCcOn(v => !v)} title={`${t('player.cc')} (C)`}><Icon.cc /></button>
          <button className="ic" onClick={onOpenSettings} title={t('sub.settings')}><Icon.gear /></button>
          {!full && !pageFull && <button className={`ic ${theater ? 'on' : ''}`} onClick={onTheater} title={`${t('player.theater')} (T)`}><Icon.theater /></button>}
          <button className="ic" onClick={toggleFull} title={`${t('player.fullscreen')} (F)`}>{full || pageFull ? <Icon.exitFull /> : <Icon.full />}</button>
        </div>
      </div>
    </div>
  )
})
