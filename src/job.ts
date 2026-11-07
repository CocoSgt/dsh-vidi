import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { defaultExports, exportCues, type ExportFormat } from './export.ts'
import type { Glossary } from './glossary.ts'
import { ffmpegInput, LoginRequired, resolveSite, type CookieChoice } from './sites.ts'
import type { Translator } from './translate.ts'
import type { Cue, JobOptions, JobStatus, JobSummary, ProviderCue, SpeechProvider, SubsState } from './types.ts'
import type { UsageMeter } from './usage.ts'

const run = promisify(execFile)

/** URLs ffmpeg can open directly (no yt-dlp resolution). */
const DIRECT = /^(rtmps?|srt|rtsp|udp):\/\/|\.(m3u8|mpd|mp4|m4v|mov|mkv|webm|mp3|m4a|aac|wav|flac|ogg)(\?|$)/i
/** Direct URLs that are files (videos) rather than live streams. */
const FILE_LIKE = /\.(mp4|m4v|mov|mkv|webm|mp3|m4a|aac|wav|flac|ogg)(\?|$)/i

/** Pace for subtitles: stop reading ahead once recognition or translation is this far behind (seconds / lines). */
const AHEAD_MAX_SEC = 30
const AHEAD_MAX_LINES = 10

export interface JobDeps {
  dir: string
  /** A fresh speech provider for each subtitle run (uses the job's current options). */
  makeProvider: () => SpeechProvider
  translator: Translator
  usage: UsageMeter
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
 * One video or live stream, in two independent parts:
 *
 * - Opening (free): one ffmpeg turns the source into a browser-playable HLS
 *   recording on disk. Videos are fetched as fast as the network allows.
 * - Subtitles (costs tokens, only when asked): a second ffmpeg reads audio
 *   from that recording from a given point, feeds the speech provider, and
 *   finished lines get translated. Pause kills the reader; resume starts a new
 *   one where the last stopped. Because it reads the recording, a live
 *   stream loses nothing while subtitles are paused.
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
  private reader?: ChildProcess
  private provider?: SpeechProvider
  /** Subtitles: off until asked; `at` = media time processed so far. */
  subs: { state: SubsState; at: number } = { state: 'off', at: 0 }
  private captureDone = false
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
      subs: { ...this.subs }, usage: this.deps.usage.summary(),
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

  /** Open the source: resolve it and start recording/playback. No subtitles yet. */
  async start(): Promise<void> {
    try {
      this.emit('state', this.summary())
      const input = await this.resolve()
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
    ]
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    this.ffmpeg = ff
    // A push source is "waiting" until its first segment lands.
    if (this.message) {
      const wait = setInterval(() => {
        if (this.ffmpeg !== ff) { clearInterval(wait); return }
        if (this.segments().length) { clearInterval(wait); this.setStatus('running') }
      }, 400)
    }
    ff.stderr!.on('data', (d: Buffer) => appendFileSync(join(this.deps.dir, 'ffmpeg.log'), d))
    ff.on('exit', code => {
      this.ffmpeg = undefined
      if (this.status !== 'running') return
      void this.finishCapture(code === 0 ? 'ended' : this.ffmpegError(code), code === 0 || this.segments().length > 0)
    })
  }

  private get m3u8(): string {
    return join(this.deps.dir, 'hls', 'index.m3u8')
  }

  /** Recorded segments so far: start time on the playback timeline and duration. */
  private segments(): { start: number; dur: number }[] {
    if (!existsSync(this.m3u8)) return []
    const out: { start: number; dur: number }[] = []
    let t = 0
    for (const m of readFileSync(this.m3u8, 'utf8').matchAll(/#EXTINF:([\d.]+)/g)) { const d = Number(m[1]); out.push({ start: t, dur: d }); t += d }
    return out
  }

  /** The recording is complete (video fetched, or live stream ended/stopped): close it and make the MP4. */
  private async finishCapture(reason: string, ok: boolean): Promise<void> {
    this.captureDone = true
    await this.remux()
    if (!this.vod || !this.duration) { const segs = this.segments(); const last = segs.at(-1); if (last) this.duration = last.start + last.dur }
    this.setStatus(ok ? 'stopped' : 'error', reason)
  }

  // ── Subtitles ──

  /**
   * Start (or resume) subtitles from media time `from` (default: where the
   * last run stopped). Options (lines, engine…) may have changed since opening.
   */
  async startSubs(from?: number, opts?: Partial<Pick<JobOptions, 'srcLang' | 'tgtLangs' | 'provider' | 'mode'>>): Promise<void> {
    if (this.subs.state === 'running' || this.status === 'error') return
    if (opts) Object.assign(this.opts, opts)
    this.deps.glossary.setTargets(this.opts.tgtLangs)
    // Wait for the first recorded segment.
    for (let i = 0; i < 240 && !this.segments().length && (this.status as JobStatus) !== 'error'; i++) await new Promise(r => setTimeout(r, 500))
    const segs = this.segments()
    if (!segs.length) return
    let at = Math.max(0, from ?? this.subs.at)
    const finished = readFileSync(this.m3u8, 'utf8').includes('#EXT-X-ENDLIST')
    // A growing playlist can't be seeked; start at the segment that contains `at` instead.
    let input: string[]
    if (finished) input = ['-ss', String(at), '-i', this.m3u8]
    else {
      const i = Math.max(0, segs.findLastIndex(sg => sg.start <= at))
      at = segs[i]!.start
      input = ['-live_start_index', String(i), '-max_reload', '100000', '-i', this.m3u8]
    }
    const provider = this.deps.makeProvider()
    this.provider = provider
    this.subs = { state: 'running', at }
    this.emit('state', this.summary())
    try {
      await provider.start(c => this.onProviderCue(c, at), err => this.deps.log(`[${this.id}] provider: ${err.message}`))
    } catch (err) {
      this.subs = { state: 'paused', at }
      this.setStatus(this.status, (err as Error).message)
      return
    }
    const rd = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...input, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] })
    this.reader = rd
    const offset = at
    let bytes = 0
    const tick = setInterval(() => this.emit('state', this.summary()), 1000)
    rd.stdout!.on('data', (pcm: Buffer) => {
      provider.push(pcm)
      bytes += pcm.length
      const sec = pcm.length / 32000
      this.deps.usage.addAudio(provider.name, sec)
      this.subs.at = offset + bytes / 32000
      // Recognition or translation behind: wait (the recording keeps everything).
      if (!rd.stdout!.isPaused() && this.behind()) {
        rd.stdout!.pause()
        const resume = setInterval(() => {
          if (this.reader !== rd) { clearInterval(resume); return }
          if (!this.behind(0.5)) { clearInterval(resume); rd.stdout!.resume() }
        }, 300)
      }
    })
    rd.stderr!.on('data', (d: Buffer) => appendFileSync(join(this.deps.dir, 'ffmpeg.log'), d))
    rd.on('exit', () => {
      clearInterval(tick)
      if (this.reader !== rd) return
      this.reader = undefined
      // Read to the end of a finished recording: subtitles are done.
      void this.endRun(this.captureDone ? 'done' : 'paused')
    })
  }

  /** Pause subtitles; the next start resumes from here. */
  async pauseSubs(): Promise<void> {
    const rd = this.reader
    if (!rd) return
    this.reader = undefined
    rd.kill('SIGKILL')
    await this.endRun('paused')
  }

  private async endRun(state: SubsState): Promise<void> {
    const p = this.provider
    this.provider = undefined
    await p?.stop().catch(() => {})
    await this.translating
    this.subs = { state, at: this.subs.at }
    this.save()
    this.emit('state', this.summary())
  }

  /** Is recognition or translation too far behind the media read so far? (`slack` < 1 waits until it is well caught up.) */
  private behind(slack = 1): boolean {
    const asr = this.provider?.backlog?.() ?? 0
    return asr > AHEAD_MAX_SEC * slack || this.pendingTranslations > AHEAD_MAX_LINES * slack
  }

  /** Provider cues: drafts are revised in place by key; finals get translated. */
  private onProviderCue(pc: ProviderCue, offset = 0): void {
    const { key, ...raw } = pc
    const rest = { ...raw, start: raw.start + offset, end: raw.end + offset }
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
      if (!this.provider?.translates && cue.tr === undefined && this.opts.tgtLangs.length) this.translate(cue)
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

  /** Stop recording (live) or fetching (video). Subtitles already running finish what was recorded. */
  async stop(reason = 'stopped by user'): Promise<void> {
    if (this.status !== 'running' && this.status !== 'resolving') return
    this.setStatus('stopping', reason)
    const ff = this.ffmpeg
    if (ff) {
      this.ffmpeg = undefined
      // Let ffmpeg finish the current segment and the playlist; force only if it hangs.
      const exited = new Promise(r => ff.once('exit', r))
      ff.kill('SIGINT')
      await Promise.race([exited, new Promise(r => setTimeout(r, 5000))])
      ff.kill('SIGKILL')
    }
    this.status = 'running' // finishCapture sets the final state
    await this.finishCapture(reason, true)
  }

  /** Stop everything (closing the job): recording and subtitles. */
  async close(reason = 'closed'): Promise<void> {
    await this.stop(reason)
    await this.pauseSubs()
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
    const m3u8 = this.m3u8
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
