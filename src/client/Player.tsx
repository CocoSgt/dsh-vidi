import Hls from 'hls.js'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { Icon } from './icons.tsx'
import type { LiveKey } from './locales.ts'
import { drawSubtitles, SubtitleOverlay, type LineTexts, type SubStyle } from './subStyle.tsx'

export interface CueLike { id: number; start: number; end: number; src: string; tr?: Record<string, string>; final: boolean; polished?: boolean; speaker?: string }

export interface PlayerHandle {
  seek(t: number): void
}

/** A control-bar menu: an icon button that opens a panel above the bar. */
export interface PlayerMenu { id: string; icon: ReactNode; title: string; content: ReactNode; on?: boolean }

interface Props {
  src: string | null
  /** A live stream still being recorded (live badge, delay, follow the edge). */
  live: boolean
  /** A video: plays from the start, length known. */
  vod?: boolean
  duration?: number
  /** Media time up to which subtitles exist (marked on the progress bar). */
  subsAt?: number
  waitingText: string
  cues: CueLike[]
  /** The site's own subtitle tracks that are switched on (key 'site:<lang>'). */
  siteCues?: Record<string, { start: number; end: number; text: string }[]>
  style: SubStyle
  delay: number
  onDelay: (v: number) => void
  showDelay: boolean
  theater: boolean
  onTheater: () => void
  onTime: (t: number) => void
  /** Inline action in the control bar (the subtitle start/pause button). */
  action?: ReactNode
  menus?: PlayerMenu[]
  /** Save a screenshot (PNG of picture + subtitles as shown). */
  onSnapshot?: (png: Blob, at: number) => Promise<{ url?: string; path?: string }>
  /** Cut [from, to] into a clip. */
  onClip?: (from: number, to: number) => Promise<{ url?: string; path?: string }>
  t: (k: LiveKey) => string
}

interface Toast { text: string; href?: string; busy?: boolean }

const fmt = (s: number) => {
  if (!isFinite(s)) return '0:00'
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = Math.floor(s % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`
}

/**
 * Video stage with its own controls; subtitle and download actions live in the
 * control bar so the page around stays quiet. Fullscreen targets the whole
 * stage, so subtitles (sized in container units) and menus come along.
 */
export const Player = forwardRef<PlayerHandle, Props>(function Player(props, ref) {
  const { src, live, vod, duration, subsAt, waitingText, cues, siteCues, style, delay, onDelay, showDelay, theater, onTheater, onTime, action, menus = [], onSnapshot, onClip, t } = props
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
  const [menu, setMenu] = useState<string | null>(null)
  const [speed, setSpeed] = useState(1)
  const [toast, setToastRaw] = useState<Toast | null>(null)
  const toastTimer = useRef<number>()
  const setToast = (x: Toast | null, ms = 4500) => {
    setToastRaw(x)
    window.clearTimeout(toastTimer.current)
    if (x && !x.busy) toastTimer.current = window.setTimeout(() => setToastRaw(null), ms)
  }
  /** Clip start while the user picks the end. */
  const [clipIn, setClipIn] = useState<number | null>(null)
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
        // Videos start at 0 and never jump ahead; live streams sit `delay` seconds behind the edge.
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

  // Clock: current time, recorded edge, play state.
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

  // Close a menu when clicking elsewhere.
  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest?.('.dshl-menu, .dshl-menubtn')) setMenu(null) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

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

  // Keyboard shortcuts while the page has no editable focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return
      if (!stage.current?.isConnected || e.metaKey || e.ctrlKey || e.altKey) return
      const el = video.current
      switch (e.key) {
        case ' ': case 'k': e.preventDefault(); togglePlay(); break
        case 'f': case 'F': toggleFull(); break
        case 'Escape': if (clipIn !== null) { setClipIn(null); setToast(null) } else if (menu) setMenu(null); else if (pageFull) setPageFull(false); else return; break
        case 'm': case 'M': toggleMute(); break
        case 'c': case 'C': setCcOn(v => !v); break
        case 't': case 'T': onTheater(); break
        case 'l': case 'L': if (live && !vod) goLive(); break
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
  const current = cues.filter(c => c.start - 0.2 <= now && now <= c.end + 1.2).at(-1)
  // What each line shows now; a translation identical to the original is not repeated.
  const texts: LineTexts = {}
  if (ccOn) {
    if (current) {
      texts.src = current.src
      for (const [k, v] of Object.entries(current.tr ?? {})) if (v && v.trim() !== current.src.trim()) texts[k] = v
    }
    for (const [k, list] of Object.entries(siteCues ?? {})) texts[k] = list.find(c => c.start - 0.2 <= now && now <= c.end + 0.3)?.text
  }

  const snapshot = async () => {
    const v = video.current
    if (!v || !v.videoWidth || !onSnapshot) return
    const W = v.videoWidth, H = v.videoHeight
    const canvas = document.createElement('canvas')
    canvas.width = W; canvas.height = H
    const g = canvas.getContext('2d')!
    g.drawImage(v, 0, 0, W, H)
    drawSubtitles(g, W, H, texts, style)
    const blob = new Promise<Blob>((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('snapshot failed'))), 'image/png'))
    // Copy to the clipboard right away (inside the click), then save into the video folder.
    let copied = false
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); copied = true } catch {}
    try {
      const r = await onSnapshot(await blob, now)
      setToast({ text: copied ? t('player.shot.copied') : t('player.shot.saved'), href: r.url })
    } catch (err) { setToast({ text: (err as Error).message }) }
  }
  const clip = async () => {
    if (!onClip) return
    if (clipIn === null) { setClipIn(now); setToast({ text: t('player.clip.in').replace('{t}', fmt(now)), busy: true }); return }
    const from = Math.min(clipIn, now), to = Math.max(clipIn, now)
    setClipIn(null)
    if (to - from < 0.5) { setToast(null); return }
    setToast({ text: t('player.clip.making').replace('{a}', fmt(from)).replace('{b}', fmt(to)), busy: true })
    try {
      const r = await onClip(from, to)
      setToast({ text: t('player.clip.done').replace('{a}', fmt(from)).replace('{b}', fmt(to)), href: r.url }, 8000)
    } catch (err) { setToast({ text: (err as Error).message }) }
  }
  const applySpeed = (v: number) => { setSpeed(v); if (video.current) video.current.playbackRate = v }
  const playMenu: PlayerMenu = {
    id: 'play', icon: <Icon.speed />, title: t('player.settings'), on: speed !== 1, content: (
      <>
        <div className="opt"><span>{t('player.speed')}</span>
          <span className="dshl-seg">{[0.5, 0.75, 1, 1.25, 1.5, 2].map(v => <button key={v} className={speed === v ? 'on' : ''} onClick={() => applySpeed(v)}>{v}×</button>)}</span>
        </div>
        {showDelay && !vod && (
          <label className="opt" title={t('player.delay.tip')}>
            <span>{t('player.delay')} {delay}s</span>
            <input type="range" min={2} max={120} step={1} value={delay} onChange={e => applyDelay(Number(e.target.value))} />
          </label>
        )}
      </>
    ),
  }
  const allMenus = [...menus.filter(m => m.id === 'cc'), playMenu, ...menus.filter(m => m.id !== 'cc')]
  // Controls stay up while a menu is open.
  const controlsHidden = idle && playing && !menu
  const pct = (v: number) => `${total ? (Math.min(v, total) / total) * 100 : 0}%`
  const openMenu = allMenus.find(m => m.id === menu)

  return (
    <div ref={stage} className={`dshl-stage ${full ? 'full' : ''} ${pageFull ? 'pagefull' : ''} ${controlsHidden ? 'idle' : ''}`} tabIndex={0}
      onMouseMove={poke} onMouseLeave={() => setIdle(true)} onDoubleClick={e => { if (!(e.target as HTMLElement).closest('.dshl-controls, .dshl-menu')) toggleFull() }}>
      <video ref={video} playsInline onClick={togglePlay} />
      {!ready && <div className="dshl-overlay"><div className="dshl-spinner" />{waitingText}</div>}
      <SubtitleOverlay texts={texts} style={style} draft={current ? !current.final : false} />
      {toast && (
        <div className="dshl-toast">
          {toast.busy && <i className="dshl-spinner sm" />}<span>{toast.text}</span>
          {toast.href && <a href={toast.href} target="_blank" rel="noreferrer">{t('player.open')}</a>}
          {clipIn !== null && <button className="dshl-link" onClick={() => { setClipIn(null); setToast(null) }}>{t('player.cancel')}</button>}
        </div>
      )}
      {ready && live && !vod && (
        <button className={`dshl-livebadge ${atLive ? 'on' : ''}`} onClick={goLive} title={t('player.goLive')}>
          <Icon.live /> {atLive ? t('player.live') : t('player.behind').replace('{s}', fmt(behind))}
        </button>
      )}
      {openMenu && (
        <div className="dshl-menu" role="dialog" aria-label={openMenu.title}>
          <div className="head">
            <span>{openMenu.title}</span>
            {openMenu.id === 'cc' && (
              <button className={`dshl-switch ${ccOn ? 'on' : ''}`} role="switch" aria-checked={ccOn} title={`${t('player.cc')} (C)`} onClick={() => setCcOn(v => !v)}><i /></button>
            )}
            <span className="grow" />
            <button className="ghost" onClick={() => setMenu(null)}><Icon.close /></button>
          </div>
          <div className="body">{openMenu.content}</div>
        </div>
      )}
      <div className="dshl-controls" onClick={e => e.stopPropagation()}>
        <div className="dshl-progress" style={{ ['--pos' as string]: pct(now), ['--done' as string]: vod ? pct(edge) : '100%', ['--subs' as string]: subsAt !== undefined ? pct(subsAt) : '0%' }}>
          {subsAt !== undefined && subsAt > 0 && <i className="subs" title={t('player.subsAt').replace('{t}', fmt(subsAt))} />}
          {clipIn !== null && <i className="clip" style={{ left: pct(Math.min(clipIn, now)), width: `calc(${pct(Math.max(clipIn, now))} - ${pct(Math.min(clipIn, now))})` }} />}
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
          {action}
          {onSnapshot && <button className="ic" onClick={() => void snapshot()} title={t('player.shot')}><Icon.camera /></button>}
          {onClip && <button className={`ic ${clipIn !== null ? 'on rec' : ''}`} onClick={() => void clip()} title={clipIn === null ? t('player.clip') : t('player.clip.end')}><Icon.scissors /></button>}
          {allMenus.map(m => (
            <button key={m.id} className={`ic dshl-menubtn ${menu === m.id || m.on ? 'on' : ''}`} title={m.title} onClick={() => setMenu(v => (v === m.id ? null : m.id))}>{m.icon}</button>
          ))}
          {!full && !pageFull && <button className={`ic ${theater ? 'on' : ''}`} onClick={onTheater} title={`${t('player.theater')} (T)`}><Icon.theater /></button>}
          <button className="ic" onClick={toggleFull} title={`${t('player.fullscreen')} (F)`}>{full || pageFull ? <Icon.exitFull /> : <Icon.full />}</button>
        </div>
      </div>
    </div>
  )
})
