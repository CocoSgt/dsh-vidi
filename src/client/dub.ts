import { useEffect, useRef } from 'react'

export interface DubClip { id: number; at: number; dur: number; v: string }
export interface DubView { on: boolean; lang: string; voice: string; original: 'duck' | 'off'; clips: DubClip[]; error?: string }

/** How loud the original stays while a voice speaks (with the original kept). */
const DUCK = 0.16
/** A voice that came in this late (a live stream) still plays, shifted (s). */
const LATE_MAX = 4

/**
 * Plays the voiceover with the video: each line's voice starts when the
 * picture reaches it, follows pause, seek and speed, and the original sound
 * is turned down under it (or off). The video's sound goes through Web Audio
 * from the first time the voiceover is switched on (a click, so the browser
 * lets it play); from then on it is mixed here.
 */
export function useVoiceover(video: () => HTMLVideoElement | null, jobId: string | undefined, view: DubView | null) {
  const ctx = useRef<AudioContext | null>(null)
  const graph = useRef<{ el: HTMLMediaElement; orig: GainNode; voice: GainNode } | null>(null)
  const buffers = useRef(new Map<string, AudioBuffer | 'loading' | 'failed'>())
  const playing = useRef(new Map<number, { src: AudioBufferSourceNode; at: number }>())
  /** Clips already played (or skipped) in this stretch of playback: a late one plays once. */
  const done = useRef(new Set<number>())
  const last = useRef({ t: 0, wall: 0 })
  /** Media time where this stretch of continuous playback began (a seek or a pause starts a new one). */
  const stretch = useRef(0)
  const viewRef = useRef(view)
  viewRef.current = view

  /** Route the video's sound through Web Audio (once per element). */
  const ensureGraph = (): boolean => {
    const el = video()
    if (!el) return false
    if (graph.current?.el === el) return true
    try {
      ctx.current ??= new AudioContext({ latencyHint: 'interactive' })
      const c = ctx.current
      const src = c.createMediaElementSource(el)
      const orig = c.createGain(), voice = c.createGain()
      src.connect(orig).connect(c.destination)
      voice.connect(c.destination)
      graph.current = { el, orig, voice }
      return true
    } catch { return false }
  }

  const stopAll = () => {
    for (const p of playing.current.values()) { try { p.src.stop() } catch {} }
    playing.current.clear()
  }

  const load = (clip: DubClip) => {
    const key = `${clip.id}.${clip.v}`
    if (buffers.current.has(key) || !jobId || !ctx.current) return
    buffers.current.set(key, 'loading')
    const c = ctx.current
    fetch(`/live/api/dub/clip?jobId=${encodeURIComponent(jobId)}&id=${clip.id}&v=${clip.v}`)
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then(b => c.decodeAudioData(b))
      .then(buf => { buffers.current.set(key, buf) })
      .catch(() => { buffers.current.set(key, 'failed'); window.setTimeout(() => buffers.current.delete(key), 5000) })
  }

  // Switched on (by a click): set up the sound path and let the browser play it.
  useEffect(() => {
    if (!view?.on) return
    if (ensureGraph()) void ctx.current?.resume()
  }, [view?.on])

  useEffect(() => {
    const tick = () => {
      const el = video()
      const v = viewRef.current
      const g = graph.current
      if (!g || !ctx.current || g.el !== el) { stopAll(); return }
      const c = ctx.current
      const on = !!v?.on
      const now = el.currentTime
      // A jump (seek) or a stop: start this stretch afresh.
      const expected = last.current.t + (el.paused ? 0 : ((performance.now() - last.current.wall) / 1000) * el.playbackRate)
      if (Math.abs(now - expected) > 0.6) { stopAll(); done.current.clear(); stretch.current = now }
      last.current = { t: now, wall: performance.now() }
      if (!on || el.paused || el.ended || el.seeking || el.readyState < 3) {
        // Paused mid-sentence: that voice picks up where the picture is when playback goes on.
        for (const id of playing.current.keys()) done.current.delete(id)
        stretch.current = now
        stopAll()
        g.orig.gain.setTargetAtTime(on && v?.original === 'off' ? 0 : 1, c.currentTime, 0.05)
        return
      }
      if (c.state === 'suspended') void c.resume()
      const clips = v!.clips
      // Voices follow the player's own volume and mute.
      g.voice.gain.setTargetAtTime(el.muted ? 0 : el.volume, c.currentTime, 0.03)
      for (const clip of clips) {
        if (clip.at > now + 8) break
        if (clip.at + clip.dur > now - 1) load(clip)
      }
      for (const clip of clips) {
        if (clip.at > now + 0.05) break
        if (playing.current.has(clip.id) || done.current.has(clip.id)) continue
        const offset = now - clip.at
        if (offset >= clip.dur) continue
        const buf = buffers.current.get(`${clip.id}.${clip.v}`)
        if (!buf || buf === 'loading' || buf === 'failed') {
          // Not here yet: a live voice that is late plays from its start once it comes; a video's waits for its moment.
          if (offset > LATE_MAX) done.current.add(clip.id)
          continue
        }
        const src = c.createBufferSource()
        src.buffer = buf
        src.playbackRate.value = el.playbackRate
        src.connect(g.voice)
        // Its moment passed during this stretch while it was still being made (live): from its beginning.
        // A seek into the middle of it: from where the picture is.
        const late = offset > 0.35 && clip.at >= stretch.current + 0.1
        src.start(0, late ? 0 : Math.max(0, offset))
        playing.current.set(clip.id, { src, at: clip.at })
        done.current.add(clip.id)
        src.onended = () => { if (playing.current.get(clip.id)?.src === src) playing.current.delete(clip.id) }
      }
      for (const p of playing.current.values()) p.src.playbackRate.value = el.playbackRate
      // The original under the voice: turned down while one speaks, or off altogether.
      const target = v!.original === 'off' ? 0 : playing.current.size ? DUCK : 1
      g.orig.gain.setTargetAtTime(target, c.currentTime, playing.current.size ? 0.04 : 0.25)
    }
    const timer = window.setInterval(tick, 50)
    return () => window.clearInterval(timer)
  }, [jobId])

  // A different video: forget its voices.
  useEffect(() => () => { stopAll(); buffers.current.clear(); done.current.clear() }, [jobId])
}
