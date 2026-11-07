import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { defaultExports, exportCues, type ExportFormat } from './export.ts'
import type { Glossary } from './glossary.ts'
import type { Translator } from './translate.ts'
import type { Cue, JobOptions, JobStatus, JobSummary, ProviderCue, SpeechProvider } from './types.ts'

const run = promisify(execFile)

/** URLs ffmpeg can open directly (no yt-dlp resolution). */
const DIRECT = /^(rtmps?|srt|rtsp|udp):\/\/|\.m3u8(\?|$)|\.mpd(\?|$)/i

export interface JobDeps {
  dir: string
  provider: SpeechProvider
  translator: Translator
  glossary: Glossary
  log: (msg: string) => void
  /** Listening addresses for push sources. */
  ingest: { host: string; rtmpPort: number; srtPort: number }
}

interface Input {
  /** ffmpeg input arguments (one or two inputs). */
  args: string[]
  /** Map spec for the audio stream. */
  audio: string
  /** Map spec for the video stream, or undefined for audio-only sources. */
  video?: string
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
  ingest?: { rtmp?: string; srt?: string; key?: string }
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
      files: existsSync(this.deps.dir) ? readdirSync(this.deps.dir).filter(f => /\.(mp4|m4a|srt|vtt|txt|md|json|jsonl)$/.test(f)) : [],
      ingest: this.ingest,
    }
  }

  private setStatus(status: JobStatus, message?: string): void {
    this.status = status
    this.message = message
    this.deps.log(`[${this.id}] ${status}${message ? `: ${message}` : ''}`)
    this.emit('state', this.summary())
  }

  /** Does this input have a video stream? (Audio files and some URLs do not.) */
  private async hasVideo(input: string): Promise<boolean> {
    try {
      const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', input], { timeout: 30_000 })
      return stdout.includes('video')
    } catch {
      return true
    }
  }

  /** Turn the job's source into ffmpeg inputs. */
  private async resolve(): Promise<Input> {
    const { url, source } = this.opts
    const net = ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5']
    const q = ['-thread_queue_size', '4096']
    if (source === 'file') {
      if (!existsSync(url)) throw new Error(`file not found: ${url}`)
      // Uploads are stored as "<timestamp>-<name>"; show the original name.
      this.title = basename(url).replace(/^\d{10,}-/, '')
      // -re: play the file at its natural pace so it behaves like a live stream.
      return { args: [...q, '-re', '-i', url], audio: '0:a:0', video: (await this.hasVideo(url)) ? '0:v:0' : undefined }
    }
    if (source === 'push') {
      const key = this.id.slice(-4)
      const { host, rtmpPort, srtPort } = this.deps.ingest
      if (url === 'srt') {
        this.ingest = { srt: `srt://${host}:${srtPort}?streamid=${key}`, key }
        return { args: [...q, '-i', `srt://0.0.0.0:${srtPort}?mode=listener&latency=200000`], audio: '0:a:0', video: '0:v:0?' }
      }
      this.ingest = { rtmp: `rtmp://${host}:${rtmpPort}/live`, key }
      return { args: [...q, '-listen', '1', '-i', `rtmp://0.0.0.0:${rtmpPort}/live/${key}`], audio: '0:a:0', video: '0:v:0?' }
    }
    if (DIRECT.test(url)) {
      return { args: [...(/^https?:/.test(url) ? net : []), ...q, '-i', url], audio: '0:a:0', video: (await this.hasVideo(url)) ? '0:v:0' : undefined }
    }
    try {
      const { stdout } = await run('yt-dlp', ['--no-warnings', '--print', '%(title)s', '--skip-download', '--no-playlist', url], { timeout: 60_000 })
      this.title = stdout.trim().split('\n')[0]
    } catch {}
    const { stdout } = await run('yt-dlp', ['--no-warnings', '--no-playlist', '-f', 'b[height<=720]/bv*[height<=720]+ba/b/ba', '-g', url], { timeout: 90_000 })
    const urls = stdout.trim().split('\n').filter(Boolean).slice(0, 2)
    if (!urls.length) throw new Error('yt-dlp returned no stream URL (is the stream live?)')
    const args = urls.flatMap(u => [...(/^https?:/.test(u) ? net : []), ...q, '-i', u])
    if (urls.length === 2) return { args, video: '0:v:0', audio: '1:a:0' }
    return { args, audio: '0:a:0', video: (await this.hasVideo(urls[0]!)) ? '0:v:0' : undefined }
  }

  async start(): Promise<void> {
    try {
      this.emit('state', this.summary())
      const input = await this.resolve()
      await this.deps.provider.start(c => this.onProviderCue(c), err => this.deps.log(`[${this.id}] provider: ${err.message}`))
      this.spawnFfmpeg(input)
      this.setStatus('running', this.opts.source === 'push' ? 'waiting for the incoming stream' : undefined)
    } catch (err) {
      this.setStatus('error', (err as Error).message)
    }
  }

  /** Last meaningful ffmpeg error line, so the user sees why the source failed. */
  private ffmpegError(code: number | null): string {
    try {
      const lines = readFileSync(join(this.deps.dir, 'ffmpeg.log'), 'utf8').split('\n').map(l => l.replace(/^\[[^\]]*\]\s*/, '').trim()).filter(Boolean)
      const last = lines.reverse().find(l => /error|invalid|refused|not found|denied|timed out/i.test(l))
      if (last) return last.replace(/^Error opening input files?:\s*/i, '')
    } catch {}
    return `ffmpeg exited (${code})`
  }

  private spawnFfmpeg(input: Input): void {
    const hls = join(this.deps.dir, 'hls')
    // Audio-only sources get a generated picture (waveform) so they play and export as video.
    const picture = input.video
      ? ['-map', input.video, '-c:v', 'copy']
      : ['-filter_complex', [
          'color=c=0x0f1420:s=1280x720:r=25[bg]',
          // showwaves ignores hex colours in some builds, so draw white and tint it.
          `[${input.audio}]aformat=channel_layouts=mono,showwaves=s=1280x420:mode=cline:rate=25:colors=white:scale=cbrt:draw=full,format=rgba,colorchannelmixer=rr=0.56:gg=0.71:bb=1:aa=0.85[w]`,
          '[bg][w]overlay=0:150:shortest=1,format=yuv420p[wv]',
        ].join(';'),
         '-map', '[wv]', '-c:v', 'libx264', '-preset', 'veryfast', '-g', '50']
    const args = [
      '-hide_banner', '-loglevel', 'warning', '-nostdin', ...input.args,
      // Playback + recording.
      ...picture, '-map', input.audio, '-c:a', 'aac', '-b:a', '128k',
      '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0', '-hls_playlist_type', 'event', '-hls_flags', 'independent_segments',
      '-hls_segment_filename', join(hls, 'seg_%05d.ts'), join(hls, 'index.m3u8'),
      // Subtitle tap: 16 kHz mono PCM on stdout, same clock as the HLS output.
      '-map', input.audio, '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1',
    ]
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    this.ffmpeg = ff
    let first = true
    ff.stdout!.on('data', (pcm: Buffer) => {
      if (first) { first = false; if (this.message) this.setStatus('running') }
      this.deps.provider.push(pcm)
    })
    ff.stderr!.on('data', (d: Buffer) => appendFileSync(join(this.deps.dir, 'ffmpeg.log'), d))
    ff.on('exit', code => {
      this.ffmpeg = undefined
      if (this.status === 'running') void this.stop(code === 0 ? 'stream ended' : this.ffmpegError(code))
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
      if (!this.deps.provider.translates && cue.tr === undefined) this.translate(cue)
      else this.record(cue)
    }
  }

  private translate(cue: Cue): void {
    const context = this.cues.filter(c => c.final && c.id < cue.id).slice(-6)
    // Keep order but let a slow model fall behind gracefully: chain, never block capture.
    this.translating = this.translating.then(async () => {
      try {
        const tr = await this.deps.translator.translate(this.opts.tgtLangs, cue.src, context, this.deps.glossary.forPrompt())
        if (tr) {
          cue.tr = { ...cue.tr, ...tr }
          this.emit('cue', cue)
        }
      } catch (err) {
        this.deps.log(`[${this.id}] translate: ${(err as Error).message}`)
      }
      this.record(cue)
      this.deps.glossary.noteFinished(this.cues.filter(c => c.final))
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

  /** Write the default subtitle and transcript set (source, each target, multilingual). */
  private save(): void {
    for (const { name, langs, formats } of defaultExports(this.opts.tgtLangs)) {
      for (const f of formats) {
        const text = exportCues(this.cues, langs, f, this.title)
        if (text.trim() && text.trim() !== 'WEBVTT') writeFileSync(join(this.deps.dir, `${f === 'txt' || f === 'md' ? 'transcript' : 'subtitles'}.${name}.${f}`), text)
      }
    }
  }

  get terms() {
    return this.deps.glossary.terms
  }

  /** On-demand export for the UI (any line selection and format). */
  exportText(langs: string[], format: ExportFormat): string {
    return exportCues(this.cues, langs, format, this.title)
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
