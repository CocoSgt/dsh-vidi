import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Translator } from './translate.ts'
import type { Cue, JobOptions, JobStatus, JobSummary, ProviderCue, SpeechProvider } from './types.ts'

const run = promisify(execFile)

/** URLs ffmpeg can open directly (no yt-dlp resolution). */
const DIRECT = /^(rtmps?|srt|rtsp|udp):\/\/|\.m3u8(\?|$)|\.mpd(\?|$)/i

export interface JobDeps {
  dir: string
  provider: SpeechProvider
  translator: Translator
  glossary: () => string
  log: (msg: string) => void
}

/**
 * One live session: resolve the stream, run a single ffmpeg that writes a
 * browser-playable HLS recording and a 16 kHz PCM tap from the same input
 * (so subtitles and picture share one media clock), feed the tap to the
 * speech provider, translate final lines, and save everything on stop.
 *
 * Events: 'state' (JobSummary), 'cue' (Cue — new or revised).
 */
export class LiveJob extends EventEmitter {
  readonly id: string
  status: JobStatus = 'resolving'
  message?: string
  title?: string
  readonly startedAt = Date.now()
  readonly cues: Cue[] = []
  private ffmpeg?: ChildProcess
  private nextId = 1
  private drafts = new Map<string, number>()
  private translating: Promise<void> = Promise.resolve()

  constructor(id: string, readonly opts: JobOptions, private readonly deps: JobDeps) {
    super()
    this.id = id
    mkdirSync(join(deps.dir, 'hls'), { recursive: true })
  }

  summary(): JobSummary {
    return {
      ...this.opts, id: this.id, status: this.status, message: this.message, title: this.title,
      startedAt: this.startedAt, dir: this.deps.dir, cueCount: this.cues.length,
      files: existsSync(this.deps.dir) ? readdirSync(this.deps.dir).filter(f => /\.(mp4|srt|vtt|jsonl)$/.test(f)) : [],
    }
  }

  private setStatus(status: JobStatus, message?: string): void {
    this.status = status
    this.message = message
    this.deps.log(`[${this.id}] ${status}${message ? `: ${message}` : ''}`)
    this.emit('state', this.summary())
  }

  /** Resolve the page URL to one or two media URLs (muxed, or video + audio). */
  private async resolve(): Promise<string[]> {
    const { url } = this.opts
    if (DIRECT.test(url)) return [url]
    try {
      const { stdout } = await run('yt-dlp', ['--no-warnings', '--print', '%(title)s', '--skip-download', '--no-playlist', url], { timeout: 60_000 })
      this.title = stdout.trim().split('\n')[0]
    } catch {}
    const { stdout } = await run('yt-dlp', ['--no-warnings', '--no-playlist', '-f', 'b[height<=720]/bv*[height<=720]+ba/b', '-g', url], { timeout: 90_000 })
    const urls = stdout.trim().split('\n').filter(Boolean)
    if (!urls.length) throw new Error('yt-dlp returned no stream URL (is the stream live?)')
    return urls.slice(0, 2)
  }

  async start(): Promise<void> {
    try {
      this.emit('state', this.summary())
      const urls = await this.resolve()
      await this.deps.provider.start(c => this.onProviderCue(c), err => this.deps.log(`[${this.id}] provider: ${err.message}`))
      this.spawnFfmpeg(urls)
      this.setStatus('running')
    } catch (err) {
      this.setStatus('error', (err as Error).message)
    }
  }

  private spawnFfmpeg(urls: string[]): void {
    const net = ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-thread_queue_size', '4096']
    const inputs = urls.flatMap(u => [...(/^https?:/.test(u) ? net : ['-thread_queue_size', '4096']), '-i', u])
    const v = '0:v:0'
    const a = urls.length > 1 ? '1:a:0' : '0:a:0'
    const hls = join(this.deps.dir, 'hls')
    const args = [
      '-hide_banner', '-loglevel', 'warning', '-nostdin', ...inputs,
      // Browser playback + recording: copy video, normalise audio to AAC.
      '-map', v, '-map', a, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
      '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0', '-hls_playlist_type', 'event', '-hls_flags', 'independent_segments',
      '-hls_segment_filename', join(hls, 'seg_%05d.ts'), join(hls, 'index.m3u8'),
      // Subtitle tap: 16 kHz mono PCM on stdout, same clock as the HLS output.
      '-map', a, '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1',
    ]
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    this.ffmpeg = ff
    ff.stdout!.on('data', (pcm: Buffer) => this.deps.provider.push(pcm))
    ff.stderr!.on('data', (d: Buffer) => appendFileSync(join(this.deps.dir, 'ffmpeg.log'), d))
    ff.on('exit', code => {
      this.ffmpeg = undefined
      if (this.status === 'running') void this.stop(code === 0 ? 'stream ended' : `ffmpeg exited (${code})`)
    })
  }

  /** Provider cues: drafts are revised in place by key; finals get translated. */
  private onProviderCue(pc: ProviderCue): void {
    const { key, ...rest } = pc
    let cue: Cue
    const existing = key !== undefined ? this.drafts.get(key) : undefined
    if (existing !== undefined) {
      cue = this.cues[existing]!
      Object.assign(cue, rest)
    } else {
      cue = { id: this.nextId++, ...rest }
      this.cues.push(cue)
      if (key !== undefined) this.drafts.set(key, this.cues.length - 1)
    }
    if (cue.final && key !== undefined) this.drafts.delete(key)
    this.emit('cue', cue)
    if (cue.final) {
      if (!this.deps.provider.translates && cue.tgt === undefined) this.translate(cue)
      else this.record(cue)
    }
  }

  private translate(cue: Cue): void {
    const context = this.cues.filter(c => c.final && c.id < cue.id).slice(-6)
    // Keep order but let a slow model fall behind gracefully: chain, never block capture.
    this.translating = this.translating.then(async () => {
      try {
        const tgt = await this.deps.translator.translate(this.opts.tgtLang, cue.src, context, this.deps.glossary())
        if (tgt) {
          cue.tgt = tgt
          this.emit('cue', cue)
        }
      } catch (err) {
        this.deps.log(`[${this.id}] translate: ${(err as Error).message}`)
      }
      this.record(cue)
    })
  }

  /** Append a finished cue (with its translation, if any) to cues.jsonl. */
  private record(cue: Cue): void {
    appendFileSync(join(this.deps.dir, 'cues.jsonl'), JSON.stringify(cue) + '\n')
  }

  async stop(reason = 'stopped by user'): Promise<void> {
    if (this.status === 'stopping' || this.status === 'stopped') return
    this.setStatus('stopping', reason)
    const ff = this.ffmpeg
    if (ff) {
      // Let ffmpeg finish the current segment and the playlist; force only if it hangs.
      const exited = new Promise(r => ff.once('exit', r))
      ff.kill('SIGINT')
      await Promise.race([exited, new Promise(r => setTimeout(r, 5000))])
      if (this.ffmpeg) ff.kill('SIGKILL')
    }
    await this.deps.provider.stop().catch(() => {})
    await this.translating
    this.save()
    await this.remux()
    this.setStatus('stopped', reason)
  }

  /** Write source / target / bilingual subtitles as SRT and VTT. */
  private save(): void {
    const cues = this.cues.filter(c => c.final && c.src)
    const ts = (s: number, sep: string) => {
      const ms = Math.max(0, Math.round(s * 1000))
      const p = (n: number, w = 2) => String(n).padStart(w, '0')
      return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`
    }
    const variants: Record<string, (c: Cue) => string> = {
      source: c => c.src,
      target: c => c.tgt ?? '',
      bilingual: c => (c.tgt ? `${c.tgt}\n${c.src}` : c.src),
    }
    for (const [name, text] of Object.entries(variants)) {
      const rows = cues.filter(c => text(c))
      const srt = rows.map((c, i) => `${i + 1}\n${ts(c.start, ',')} --> ${ts(c.end, ',')}\n${text(c)}\n`).join('\n')
      const vtt = 'WEBVTT\n\n' + rows.map(c => `${ts(c.start, '.')} --> ${ts(c.end, '.')}\n${text(c)}\n`).join('\n')
      writeFileSync(join(this.deps.dir, `subtitles.${name}.srt`), srt)
      writeFileSync(join(this.deps.dir, `subtitles.${name}.vtt`), vtt)
    }
  }

  /** Turn the HLS recording into one MP4. */
  private async remux(): Promise<void> {
    const m3u8 = join(this.deps.dir, 'hls', 'index.m3u8')
    if (!existsSync(m3u8)) return
    // An event playlist without ENDLIST makes ffmpeg wait for more segments forever.
    const text = readFileSync(m3u8, 'utf8')
    if (!text.includes('#EXT-X-ENDLIST')) writeFileSync(m3u8, text.trimEnd() + '\n#EXT-X-ENDLIST\n')
    try {
      await run('ffmpeg', ['-v', 'error', '-y', '-i', m3u8, '-c', 'copy', '-movflags', '+faststart', join(this.deps.dir, 'recording.mp4')], { timeout: 600_000 })
    } catch (err) {
      this.deps.log(`[${this.id}] remux: ${(err as Error).message}`)
    }
  }
}
