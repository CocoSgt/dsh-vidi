import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { defaultExports, exportCues, type ExportFormat } from './export.ts'
import type { Glossary } from './glossary.ts'
import { ffmpegInput, LoginRequired, resolveSite, type CookieChoice } from './sites.ts'
import type { Translator } from './translate.ts'
import type { Cue, JobOptions, JobStatus, JobSummary, ProviderCue, SpeechProvider } from './types.ts'

const run = promisify(execFile)

/** URLs ffmpeg can open directly (no yt-dlp resolution). */
const DIRECT = /^(rtmps?|srt|rtsp|udp):\/\/|\.(m3u8|mpd|mp4|m4v|mov|mkv|webm|mp3|m4a|aac|wav|flac|ogg)(\?|$)/i
/** Direct URLs that are files (videos) rather than live streams. */
const FILE_LIKE = /\.(mp4|m4v|mov|mkv|webm|mp3|m4a|aac|wav|flac|ogg)(\?|$)/i

/** Pace for videos: stop reading ahead once recognition or translation is this far behind (seconds / lines). */
const AHEAD_MAX_SEC = 30
const AHEAD_MAX_LINES = 10

export interface JobDeps {
  dir: string
  provider: SpeechProvider
  translator: Translator
  glossary: Glossary
  log: (msg: string) => void
  /** Listening addresses for push sources. */
  ingest: { host: string; rtmpPort: number; srtPort: number; key?: string }
  /** Whose browser login to use for sites that need one. */
  cookies: () => CookieChoice
}

interface Input {
  /** ffmpeg input arguments (one or two inputs). */
  args: string[]
  /** Map spec for the audio stream. */
  audio: string
  /** Map spec for the video stream, or undefined for audio-only sources. */
  video?: string
  /** Video codec, when known; anything but H.264 is re-encoded for the browser. */
  vcodec?: string
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
  private pendingTranslations = 0
  vod = false
  duration?: number
  private loginBrowser?: string
  private needsLogin?: JobSummary['needsLogin']

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
      ingest: this.ingest, vod: this.vod, duration: this.duration, loginBrowser: this.loginBrowser, needsLogin: this.needsLogin,
    }
  }

  private setStatus(status: JobStatus, message?: string): void {
    this.status = status
    this.message = message
    this.deps.log(`[${this.id}] ${status}${message ? `: ${message}` : ''}`)
    this.emit('state', this.summary())
  }

  /** Video codec and duration of a file or URL (no video → vcodec undefined). */
  private async probe(input: string): Promise<{ vcodec?: string; duration?: number; ok: boolean }> {
    try {
      const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name:format=duration', '-of', 'json', input], { timeout: 30_000 })
      const j = JSON.parse(stdout) as { streams?: { codec_type: string; codec_name: string }[]; format?: { duration?: string } }
      const v = j.streams?.find(s => s.codec_type === 'video' && !/^(mjpeg|png)$/.test(s.codec_name))
      const d = Number(j.format?.duration)
      return { vcodec: v?.codec_name, duration: isFinite(d) && d > 0 ? d : undefined, ok: true }
    } catch {
      return { ok: false }
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
      // A file is a video: read it as fast as recognition keeps up (paced in spawnFfmpeg), play from the start.
      const p = await this.probe(url)
      this.vod = true
      this.duration = p.duration
      return { args: [...q, '-i', url], audio: '0:a:0', video: p.vcodec ? '0:v:0' : undefined, vcodec: p.vcodec }
    }
    if (source === 'push') {
      const key = this.deps.ingest.key ?? this.id.slice(-4)
      const { host, rtmpPort, srtPort } = this.deps.ingest
      if (url === 'srt') {
        this.ingest = { srt: `srt://${host}:${srtPort}?streamid=${key}`, key }
        return { args: [...q, '-i', `srt://0.0.0.0:${srtPort}?mode=listener&latency=200000`], audio: '0:a:0', video: '0:v:0?' }
      }
      this.ingest = { rtmp: `rtmp://${host}:${rtmpPort}/live`, key }
      return { args: [...q, '-listen', '1', '-i', `rtmp://0.0.0.0:${rtmpPort}/live/${key}`], audio: '0:a:0', video: '0:v:0?' }
    }
    if (DIRECT.test(url)) {
      const p = await this.probe(url)
      this.vod = FILE_LIKE.test(url)
      if (this.vod) this.duration = p.duration
      return { args: [...(/^https?:/.test(url) ? net : []), ...q, '-i', url], audio: '0:a:0', video: p.ok && !p.vcodec ? undefined : '0:v:0?', vcodec: p.vcodec }
    }
    // Any yt-dlp site (YouTube, Bilibili, …): one call gives title, live/video, length, stream URLs and the headers they need.
    const r = await resolveSite(url, this.deps.cookies(), this.deps.log, browser => {
      this.loginBrowser = browser
      this.emit('state', this.summary())
    })
    this.title = r.title
    this.vod = !r.isLive
    this.duration = r.duration
    this.loginBrowser = r.cookiesFrom
    const args = r.inputs.flatMap(ffmpegInput)
    if (r.inputs.length >= 2) {
      const vi = r.inputs.findIndex(i => i.vcodec && i.vcodec !== 'none')
      const v = vi < 0 ? 0 : vi
      return { args, video: `${v}:v:0`, audio: `${v === 0 ? 1 : 0}:a:0`, vcodec: r.inputs[v]!.vcodec }
    }
    const only = r.inputs[0]!
    const audioOnly = only.vcodec === 'none'
    return { args, audio: '0:a:0', video: audioOnly ? undefined : '0:v:0?', vcodec: audioOnly ? undefined : only.vcodec }
  }

  async start(): Promise<void> {
    try {
      this.emit('state', this.summary())
      const input = await this.resolve()
      await this.deps.provider.start(c => this.onProviderCue(c), err => this.deps.log(`[${this.id}] provider: ${err.message}`))
      this.spawnFfmpeg(input)
      this.setStatus('running', this.opts.source === 'push' ? 'waiting for the incoming stream' : undefined)
    } catch (err) {
      if (err instanceof LoginRequired) this.needsLogin = { site: err.site, browser: err.triedBrowser, detail: err.message.replace(/^login required:\s*/, '') }
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
    // H.264 copies straight into HLS; other codecs (AV1, VP9, HEVC) are re-encoded so every browser can play them.
    const h264 = !input.vcodec || /^(h264|avc)/i.test(input.vcodec)
    const picture = input.video
      ? ['-map', input.video, ...(h264 ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-vf', 'scale=-2:min(720\\,ih)', '-g', '50'])]
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
      // Videos are read faster than real time; pause reading (ffmpeg then waits too) while recognition or translation catches up.
      if (this.vod && !ff.stdout!.isPaused() && this.behind()) {
        ff.stdout!.pause()
        const resume = setInterval(() => {
          if (this.ffmpeg !== ff) { clearInterval(resume); return }
          if (!this.behind(0.5)) { clearInterval(resume); ff.stdout!.resume() }
        }, 300)
      }
    })
    ff.stderr!.on('data', (d: Buffer) => appendFileSync(join(this.deps.dir, 'ffmpeg.log'), d))
    ff.on('exit', code => {
      this.ffmpeg = undefined
      if (this.status === 'running') void this.stop(code === 0 ? 'stream ended' : this.ffmpegError(code))
    })
  }

  /** Is recognition or translation too far behind the media read so far? (`slack` < 1 waits until it is well caught up.) */
  private behind(slack = 1): boolean {
    const asr = this.deps.provider.backlog?.() ?? 0
    return asr > AHEAD_MAX_SEC * slack || this.pendingTranslations > AHEAD_MAX_LINES * slack
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
    this.pendingTranslations++
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
      this.pendingTranslations--
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
