import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { Readable, Writable } from 'node:stream'
import { wrapBalanced } from './wrap.ts'

// ── Destinations (saved per computer; stream keys never go back to the browser) ──

/** Platforms people push to; only a label on our side — the address and key come from the platform's own streaming tool. */
export const PLATFORMS = ['bilibili', 'douyin', 'kuaishou', 'wechat', 'douyu', 'huya', 'yy', 'cc', 'youtube', 'twitch', 'custom'] as const
export type Platform = typeof PLATFORMS[number]

/**
 * What a destination receives: the picture with subtitles drawn in, the
 * picture alone, or the subtitles alone on a green screen (to key over a
 * camera in OBS or a broadcast console).
 */
export type Content = 'burn' | 'clean' | 'subs'
export const CONTENTS: readonly Content[] = ['burn', 'clean', 'subs']

export interface Target {
  id: string
  platform: Platform
  /** What it receives (default: the picture with subtitles). */
  content?: Content
  /** Server address, e.g. rtmp://live-push.bilivideo.com/live-bvc/ */
  server: string
  /** Stream key (secret). */
  key: string
}

export interface TargetView { id: string; platform: Platform; server: string; key: string; content: Content }

const mask = (k: string) => (!k ? '' : k.length > 10 ? `${k.slice(0, 3)}…${k.slice(-4)}` : '••••')

/** The full push address: the server plus the key, unless the server already ends with it. */
export function pushUrl(t: Pick<Target, 'server' | 'key'>): string {
  const server = t.server.trim()
  const key = t.key.trim()
  if (!key || server.endsWith(key)) return server
  return server.endsWith('/') ? server + key : `${server}/${key}`
}

export class Targets {
  constructor(private readonly file: string) {}

  list(): Target[] {
    if (!existsSync(this.file)) return []
    try { return (JSON.parse(readFileSync(this.file, 'utf8')) as Target[]).filter(t => t && t.id && t.server) } catch { return [] }
  }

  view(): TargetView[] {
    return this.list().map(t => ({ id: t.id, platform: t.platform, server: t.server, key: mask(t.key), content: t.content ?? 'burn' }))
  }

  /** Add or change one (an empty key keeps the saved one); returns the saved list. */
  save(input: { id?: string; platform?: string; server?: string; key?: string; content?: string }): TargetView[] {
    const all = this.list()
    const platform = (PLATFORMS as readonly string[]).includes(String(input.platform)) ? input.platform as Platform : 'custom'
    const server = String(input.server ?? '').trim()
    if (!/^(rtmps?|srt):\/\//i.test(server)) throw new Error('the server address should start with rtmp://, rtmps:// or srt://')
    const old = input.id ? all.find(t => t.id === input.id) : undefined
    const key = String(input.key ?? '').trim() || old?.key || ''
    const content = (CONTENTS as readonly string[]).includes(String(input.content)) ? input.content as Content : old?.content ?? 'burn'
    const next: Target = { id: old?.id ?? Math.random().toString(36).slice(2, 10), platform, server, key, content }
    this.write(old ? all.map(t => (t.id === old.id ? next : t)) : [...all, next])
    return this.view()
  }

  remove(id: string): TargetView[] {
    this.write(this.list().filter(t => t.id !== id))
    return this.view()
  }

  private write(list: Target[]): void {
    writeFileSync(this.file, JSON.stringify(list, null, 2), { mode: 0o600 })
    try { chmodSync(this.file, 0o600) } catch {}
  }
}

// ── Subtitles drawn into the picture ──

/** Same shape as the player's subtitle style. */
export interface BurnStyle {
  lines: { key: string; show: boolean; size: number }[]
  position: 'bottom' | 'top'
  offset: number
  bg: number
}

type Canvas = { getContext(k: '2d'): any; toBuffer(t: 'image/png'): Buffer }
let canvasLib: Promise<{ createCanvas(w: number, h: number): Canvas } | undefined> | undefined
/** The canvas library is loaded on first use (it is a native module; restreaming still works without subtitles if it fails). */
const loadCanvas = () => (canvasLib ??= import('@napi-rs/canvas').then(m => m as never, () => undefined))

const FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "Helvetica Neue", Arial, sans-serif'

/**
 * Draws the subtitle lines for one moment as a transparent PNG the size of
 * the output picture, matching the player: the main line large and bold,
 * the rest smaller, each on a rounded dark box, wrapped to 92% of the width.
 */
export async function drawSubtitles(rows: { text: string; size: number; main: boolean }[], style: BurnStyle, w: number, h: number): Promise<Buffer | undefined> {
  const lib = await loadCanvas()
  if (!lib) return undefined
  const c = lib.createCanvas(w, h)
  const g = c.getContext('2d')
  const maxW = w * 0.92
  // Lay out every row into wrapped lines first, then stack them from the chosen edge.
  const blocks = rows.map(r => {
    const px = Math.round((r.size / 100) * w)
    g.font = `${r.main ? 600 : 500} ${px}px ${FONT}`
    const lines = wrapBalanced(r.text, maxW - px * 0.9, t => g.measureText(t).width)
    return { px, main: r.main, lines }
  })
  const lineH = (px: number) => px * 1.55
  const gap = (px: number) => px * 0.18
  const total = blocks.reduce((n, b) => n + b.lines.length * lineH(b.px) + gap(b.px), 0)
  let y = style.position === 'top' ? (style.offset / 100) * h : h - (style.offset / 100) * h - total
  for (const b of blocks) {
    g.font = `${b.main ? 600 : 500} ${b.px}px ${FONT}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    for (const line of b.lines) {
      const tw = g.measureText(line).width
      const padX = b.px * 0.45, boxH = b.px * 1.4
      const cy = y + lineH(b.px) / 2
      if (style.bg > 0.02) {
        g.fillStyle = `rgba(0,0,0,${style.bg})`
        roundRect(g, w / 2 - tw / 2 - padX, cy - boxH / 2, tw + padX * 2, boxH, b.px * 0.22)
        g.fill()
      } else {
        g.shadowColor = 'rgba(0,0,0,.85)'; g.shadowBlur = b.px * 0.18; g.shadowOffsetY = b.px * 0.04
      }
      g.fillStyle = b.main ? '#ffffff' : '#e8e8e8'
      g.fillText(line, w / 2, cy)
      g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0
      y += lineH(b.px)
    }
    y += gap(b.px)
  }
  return c.toBuffer('image/png')
}

function roundRect(g: any, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

// ── One restream: encode once, push to every chosen platform ──

export type PushState = 'connecting' | 'live' | 'retrying' | 'error' | 'stopped'

export interface PushStatus { id: string; platform: Platform; server: string; content: Content; state: PushState; message?: string; since: number }

export interface RestreamStatus {
  running: boolean
  /** Media time being sent now (seconds on the job's timeline). */
  at: number
  startedAt: number
  burn: boolean
  height: number
  targets: PushStatus[]
  message?: string
}

export interface RestreamSource {
  /** ffmpeg input arguments for media time `from` (paced in real time by the caller's -re). */
  input(from: number): { args: string[]; at: number }
  /** Rows to draw at media time t (empty: nothing on screen). */
  rowsAt(t: number): { text: string; size: number; main: boolean }[]
}

const FPS_SUBS = 5
const RETRY_MS = [2000, 5000, 10000, 20000, 30000]

/**
 * Restreaming: one ffmpeg reads the recording in real time from `from`,
 * overlays the subtitle pictures (drawn here, a few per second, for the
 * exact media time of each one) and encodes once to MPEG-TS; every
 * destination gets its own small ffmpeg that copies that stream to the
 * platform as FLV. A platform that drops or refuses only retries itself.
 */
export class Restream extends EventEmitter {
  private encoder?: ChildProcess
  private pushes = new Map<string, { target: Target; proc?: ChildProcess; status: PushStatus; tries: number; timer?: ReturnType<typeof setTimeout> }>()
  private status: RestreamStatus
  private stopped = false
  private sentFrames = 0
  private outTime = 0
  private subsTimer?: ReturnType<typeof setInterval>
  private lastKey = ''
  private lastPng?: Buffer
  private blank?: Buffer
  private startAt = 0
  private spawnedAt = 0
  private watchdog?: ReturnType<typeof setInterval>
  private lastOut = 0
  private stuckSince = Date.now()
  /** The encoder's outputs, in order (first on stdout, the next on pipes 4 and 5). */
  private outs: Content[] = []

  constructor(private readonly source: RestreamSource, private readonly opts: { from: number; burn: boolean; style: BurnStyle; height: 720 | 1080; bitrateK: number }, targets: Target[], private readonly log: (m: string) => void) {
    super()
    this.status = { running: true, at: opts.from, startedAt: Date.now(), burn: opts.burn, height: opts.height, targets: [] }
    for (const t of targets) this.pushes.set(t.id, { target: t, tries: 0, status: { id: t.id, platform: t.platform, server: t.server, content: this.contentOf(t), state: 'connecting', since: Date.now() } })
    this.outs = CONTENTS.filter(c => targets.some(t => this.contentOf(t) === c))
  }

  private contentOf(t: Target): Content { return t.content ?? (this.opts.burn ? 'burn' : 'clean') }

  get summary(): RestreamStatus {
    return { ...this.status, targets: [...this.pushes.values()].map(p => ({ ...p.status })) }
  }

  private changed(): void { this.emit('status', this.summary) }

  async start(): Promise<void> {
    const h = this.opts.height, w = Math.round(h * 16 / 9)
    const { args: input, at } = this.source.input(this.opts.from)
    this.startAt = at
    this.status.at = at
    // Subtitle pictures are needed for drawn-in and subtitle-only outputs; without the canvas library
    // the picture still goes out, the subtitle-only one cannot.
    const canDraw = !!(await loadCanvas())
    if (!canDraw && this.outs.some(o => o !== 'clean')) {
      this.status.message = 'no-burn'
      this.outs = [...new Set(this.outs.map(o => (o === 'burn' ? 'clean' : o)).filter(o => o !== 'subs'))] as Content[]
      for (const p of this.pushes.values()) if (this.contentOf(p.target) === 'burn') p.target = { ...p.target, content: 'clean' }
    }
    const subs = this.outs.some(o => o !== 'clean')
    this.status.burn = this.outs.includes('burn')
    if (subs) this.blank = await drawSubtitles([], this.opts.style, w, h)
    // One decode, split into the outputs asked for.
    const vids = this.outs.filter(o => o !== 'subs'), subUses = this.outs.filter(o => o !== 'clean')
    const parts = [`[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=25,setpts=PTS-STARTPTS${vids.length > 1 ? `,split=${vids.length}${vids.map(o => `[v_${o}]`).join('')}` : vids.length ? `[v_${vids[0]}]` : ''}`]
    if (!vids.length) parts[0] = `[0:v]nullsink`
    if (subUses.length) parts.push(`[1:v]format=rgba,setpts=PTS-STARTPTS${subUses.length > 1 ? `,split=${subUses.length}${subUses.map(o => `[s_${o}]`).join('')}` : `[s_${subUses[0]}]`}`)
    if (this.outs.includes('burn')) parts.push(`[v_burn][s_burn]overlay=0:0:eof_action=repeat:shortest=1,format=yuv420p[o_burn]`)
    if (this.outs.includes('clean')) parts.push(`[v_clean]format=yuv420p[o_clean]`)
    // Green screen (#00FF00): key it out over a camera.
    if (this.outs.includes('subs')) parts.push(`color=c=0x00FF00:s=${w}x${h}:r=25[g];[g][s_subs]overlay=0:0:eof_action=repeat:shortest=1,format=yuv420p[o_subs]`)
    const b = this.opts.bitrateK
    const video = ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-profile:v', 'high',
      '-b:v', `${b}k`, '-maxrate', `${b}k`, '-bufsize', `${b * 2}k`, '-g', '50', '-keyint_min', '50', '-sc_threshold', '0']
    const audio = ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2']
    const fd = (i: number) => (i === 0 ? 1 : i + 3)
    const args = [
      '-hide_banner', '-loglevel', 'error', '-re', ...input,
      ...(subs ? ['-probesize', '65536', '-analyzeduration', '0', '-f', 'image2pipe', '-framerate', String(FPS_SUBS), '-c:v', 'png', '-i', 'pipe:0'] : []),
      '-filter_complex', parts.join(';'), '-progress', 'pipe:3',
      // The subtitle-only picture carries no sound (the camera's own goes with it in OBS).
      ...this.outs.flatMap((o, i) => ['-map', `[o_${o}]`, ...video, ...(o === 'subs' ? ['-an'] : audio), '-f', 'mpegts', `pipe:${fd(i)}`]),
    ]
    const enc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe'] })
    this.encoder = enc
    this.spawnedAt = Date.now()
    // If DSH itself goes away, take the ffmpeg processes with it (they would keep pushing on their own).
    process.once('exit', this.killAll)
    let errTail = ''
    enc.stderr!.on('data', (d: Buffer) => { errTail = (errTail + d.toString()).slice(-600) })
    ;(enc.stdio[3] as Readable).on('data', (d: Buffer) => {
      const m = /out_time_us=(\d+)/g
      let last: RegExpExecArray | null, hit: RegExpExecArray | null = null
      while ((last = m.exec(d.toString()))) hit = last
      if (hit) { this.outTime = Number(hit[1]) / 1e6; this.status.at = this.startAt + this.outTime }
    })
    enc.stdin!.on('error', () => {})
    // Fan each encoded stream out to the destinations that asked for it.
    this.outs.forEach((o, i) => {
      const out = (i === 0 ? enc.stdout : enc.stdio[i + 3]) as Readable
      out.on('data', (chunk: Buffer) => {
        for (const p of this.pushes.values()) {
          if (this.contentOf(p.target) !== o) continue
          const sin = p.proc?.stdin as Writable | undefined
          if (sin && !sin.destroyed && sin.writableLength < 8 << 20) sin.write(chunk)
        }
      })
    })
    enc.on('exit', code => {
      if (this.stopped) return
      const reason = code === 0 ? 'ended' : (errTail.trim().split('\n').pop() || `encoder exited (${code})`)
      this.log(`restream: ${reason}`)
      void this.stop(reason)
    })
    if (subs) this.feedSubtitles(w, h)
    for (const p of this.pushes.values()) this.connect(p.target.id)
    // Nothing coming out of the encoder after a while (no picture to read): say so instead of "connecting" forever.
    this.watchdog = setInterval(() => {
      if (this.stopped) return
      if (this.outTime > this.lastOut) { this.lastOut = this.outTime; this.stuckSince = Date.now(); return }
      if (Date.now() - this.stuckSince > 25_000) { this.log('restream: the encoder stopped producing'); void this.stop('stalled') }
    }, 5000)
    this.changed()
  }

  /** Subtitle pictures for media times from the start on, kept about a second ahead of the encoder. */
  private feedSubtitles(w: number, h: number): void {
    const sin = this.encoder!.stdin!
    const tick = async () => {
      if (this.stopped) return
      // ffmpeg reads the recording in real time (-re), several seconds ahead of what it has sent:
      // keep the pictures a little ahead of that reading position (wall clock since start), never far
      // ahead (lines for a live stream may still be on their way).
      const ahead = Math.max(4, (Date.now() - this.spawnedAt) / 1000 + 2.5)
      while (!this.stopped && this.sentFrames / FPS_SUBS <= ahead && sin.writableLength < 4 << 20) {
        const t = this.startAt + this.sentFrames / FPS_SUBS
        const rows = this.source.rowsAt(t)
        const key = JSON.stringify(rows)
        if (key !== this.lastKey) {
          this.lastKey = key
          try {
            this.lastPng = rows.length ? (await drawSubtitles(rows, this.opts.style, w, h)) ?? this.blank : this.blank
          } catch (err) {
            // A line that can't be drawn must not stall the picture: show nothing for it.
            this.log(`restream: subtitle drawing failed (${(err as Error).message})`)
            this.lastPng = this.blank
          }
        }
        if (this.lastPng) sin.write(this.lastPng)
        this.sentFrames++
      }
    }
    let busy = false
    this.subsTimer = setInterval(() => {
      if (busy) return
      busy = true
      void tick().catch(err => this.log(`restream: subtitles: ${(err as Error).message}`)).finally(() => { busy = false })
    }, 100)
  }

  /** Start (or restart) one destination. */
  private connect(id: string): void {
    const p = this.pushes.get(id)
    if (!p || this.stopped) return
    const url = pushUrl(p.target)
    // Info level: "Output #0" appears once the platform accepted the connection.
    const proc = spawn('ffmpeg', ['-hide_banner', '-nostats', '-loglevel', 'info', '-f', 'mpegts', '-i', 'pipe:0', '-c', 'copy', '-f', 'flv', '-flvflags', 'no_duration_filesize', url], { stdio: ['pipe', 'ignore', 'pipe'] })
    p.proc = proc
    p.status = { ...p.status, state: p.tries ? 'retrying' : 'connecting', since: Date.now(), message: undefined }
    let errTail = ''
    let opened = false
    proc.stderr!.on('data', (d: Buffer) => {
      const text = d.toString()
      errTail = (errTail + text).slice(-600)
      if (!opened && /Output #0/.test(errTail) && p.proc === proc) {
        opened = true
        p.tries = 0
        p.status = { ...p.status, state: 'live', message: undefined, since: Date.now() }
        this.changed()
      }
    })
    proc.stdin!.on('error', () => {})
    proc.on('exit', () => {
      if (p.proc !== proc || this.stopped) return
      p.proc = undefined
      const lines = errTail.split('\n').map(l => l.replace(/^\[[^\]]*\]\s*/, '').trim()).filter(Boolean)
      const reason = lines.reverse().find(l => /error|fail|refused|denied|invalid|timed out|not found|unauthor|forbidden|reset|broken/i.test(l)) || 'the platform closed the connection'
      if (p.tries >= RETRY_MS.length) { p.status = { ...p.status, state: 'error', message: reason, since: Date.now() }; this.changed(); return }
      p.status = { ...p.status, state: 'retrying', message: reason, since: Date.now() }
      p.timer = setTimeout(() => this.connect(id), RETRY_MS[p.tries++])
      this.changed()
    })
    this.changed()
  }

  /** Add a destination while running (no interruption for the others); false when it needs an output this run does not make. */
  add(t: Target): boolean {
    if (this.pushes.has(t.id) || this.stopped) return true
    if (!this.outs.includes(this.contentOf(t))) return false
    this.pushes.set(t.id, { target: t, tries: 0, status: { id: t.id, platform: t.platform, server: t.server, content: this.contentOf(t), state: 'connecting', since: Date.now() } })
    this.connect(t.id)
    return true
  }

  /** The destinations this run sends to. */
  get targets(): Target[] { return [...this.pushes.values()].map(p => p.target) }

  /** Stop one destination; the rest keep going. Returns true when none are left. */
  drop(id: string): boolean {
    const p = this.pushes.get(id)
    if (p) {
      clearTimeout(p.timer)
      const proc = p.proc
      p.proc = undefined
      proc?.stdin?.end()
      proc?.kill('SIGTERM')
      this.pushes.delete(id)
      this.changed()
    }
    return this.pushes.size === 0
  }

  private readonly killAll = (): void => {
    this.encoder?.kill('SIGKILL')
    for (const p of this.pushes.values()) p.proc?.kill('SIGKILL')
  }

  async stop(message?: string): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    clearInterval(this.watchdog)
    process.off('exit', this.killAll)
    clearInterval(this.subsTimer)
    for (const p of this.pushes.values()) {
      clearTimeout(p.timer)
      // Let each push send what it has and close the stream properly; force it after a few seconds.
      const proc = p.proc
      proc?.stdin?.end()
      if (proc) setTimeout(() => { if (proc.exitCode === null) proc.kill('SIGTERM') }, 3000)
      p.status = { ...p.status, state: 'stopped', since: Date.now() }
    }
    this.encoder?.kill('SIGTERM')
    this.status = { ...this.status, running: false, message: message ?? this.status.message }
    this.changed()
  }
}
