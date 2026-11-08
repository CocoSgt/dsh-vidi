import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { defaultExports, exportCues, subtitleText, type ExportFormat } from './export.ts'
import type { Glossary } from './glossary.ts'
import { Polisher } from './polish.ts'
import { fetchComments, ffmpegInput, LoginRequired, resolveSite, type CookieChoice } from './sites.ts'
import { translateBatch, type LlmHandle } from './translate.ts'
import { fetchSiteSubs, loadSiteSubs, type SiteCue, type SiteTrack } from './sitesubs.ts'
import type { Translator } from './translate.ts'
import { drawSubtitles, Restream, type BurnStyle, type RestreamStatus, type Target } from './restream.ts'
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
  /** The harness model, metered for this video (polishing). */
  llm: () => LlmHandle | undefined
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
  /** Image shown as the picture of an audio-only source (instead of the waveform alone). */
  cover?: string
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
  /** Picture height for watching, and the HLS folder that holds it. */
  height = 720
  private hlsName = 'hls'
  /** Heights the site offers. */
  heights: number[] = []
  /** Subtitles the site itself offers: shown on request, used as a reference for recognition and translation. */
  siteTracks: SiteTrack[] = []
  readonly siteCues = new Map<string, SiteCue[]>()
  /** Media time where the current subtitle run started (provider times are relative to it). */
  private runOffset = 0
  /** What the page says about the video (title, channel, tags, chapters, description, top comments). */
  brief = ''
  /** The video's language as the site states it (before any recognition). */
  siteLang?: string
  private readonly polisher: Polisher
  nextId = 1
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
    this.polisher = new Polisher({
      llm: deps.llm, glossary: deps.glossary, log: m => deps.log(`[${id}] ${m}`),
      brief: () => this.brief, siteText: (a, b) => this.siteText(a, b), targets: () => this.targets(),
      still: at => this.still(at),
      onLine: (cue, src, tr, speaker) => {
        if (!this.cues.includes(cue)) return // replaced by a later run
        this.deps.glossary.notice(src)
        cue.src = src
        if (speaker) cue.speaker = speaker
        if (Object.keys(tr).length) cue.tr = { ...cue.tr, ...tr }
        cue.polished = true
        this.emit('cue', cue)
        this.record(cue)
      },
    })
  }

  summary(): JobSummary {
    return {
      ...this.opts, id: this.id, status: this.status, message: this.message, title: this.title,
      startedAt: this.startedAt, dir: this.deps.dir, cueCount: this.cues.length,
      files: existsSync(this.deps.dir) ? readdirSync(this.deps.dir).filter(f => /\.(mp4|m4a|srt|vtt|txt|md|json|jsonl)$/.test(f)) : [],
      ingest: this.ingest, vod: this.vod, duration: this.duration, loginBrowser: this.loginBrowser, needsLogin: this.needsLogin,
      hls: this.hlsName, height: this.height, heights: this.heights, restream: this.restream,
      subs: { ...this.subs }, usage: this.deps.usage.summary(), site: this.siteTracks, spoken: this.spokenLang(),
    }
  }

  /** Start subtitles by themselves once media flows (new jobs; not ones brought back after a restart). */
  autoSubs = false

  private setStatus(status: JobStatus, message?: string): void {
    this.status = status
    this.message = message
    // Media is flowing (a push source stops "waiting"): subtitles start without being asked, once.
    if (this.autoSubs && status === 'running' && !message && this.subs.state === 'off') {
      this.autoSubs = false
      setTimeout(() => void this.startSubs(0).catch(err => this.deps.log(`[${this.id}] auto subtitles: ${(err as Error).message}`)), 0)
    }
    this.deps.log(`[${this.id}] ${status}${message ? `: ${message}` : ''}`)
    this.persist()
    this.emit('state', this.summary())
  }

  /** job.json: enough to bring the job back after a restart (finished, not recording). */
  private persist(): void {
    if (this.opts.source === 'push' && this.message) return // an idle push listener is not worth keeping
    try {
      writeFileSync(join(this.deps.dir, 'job.json'), JSON.stringify({
        id: this.id, opts: this.opts, title: this.title, vod: this.vod, duration: this.duration, siteLang: this.siteLang,
        height: this.height, hlsName: this.hlsName, heights: this.heights,
        startedAt: this.startedAt, subs: this.subs, status: this.status,
      }, null, 2))
    } catch {}
  }

  /** Bring back a job from its folder: recording finished, subtitles paused where they were. */
  static restore(dir: string, deps: JobDeps): LiveJob | undefined {
    try {
      const j = JSON.parse(readFileSync(join(dir, 'job.json'), 'utf8')) as { id: string; opts: JobOptions; title?: string; vod?: boolean; duration?: number; subs?: { state: SubsState; at: number }; status?: JobStatus }
      const job = new LiveJob(j.id, j.opts, deps)
      job.title = j.title
      job.vod = !!j.vod
      job.duration = j.duration
      job.captureDone = true
      job.status = j.status === 'error' ? 'error' : 'stopped'
      job.message = 'restored'
      const seen = new Map<number, Cue>()
      if (existsSync(join(dir, 'cues.jsonl'))) {
        for (const line of readFileSync(join(dir, 'cues.jsonl'), 'utf8').split('\n')) {
          if (!line.trim()) continue
          try { const c = JSON.parse(line) as Cue & { dropped?: boolean }; if (c.dropped) seen.delete(c.id); else seen.set(c.id, c) } catch {}
        }
      }
      job.cues.push(...[...seen.values()].sort((a, b) => a.start - b.start))
      job.nextId = Math.max(0, ...job.cues.map(c => c.id)) + 1
      if (existsSync(join(dir, 'brief.txt'))) job.brief = readFileSync(join(dir, 'brief.txt'), 'utf8')
      deps.glossary.notice([job.title ?? '', job.brief, ...job.cues.map(c => c.src)].join('\n'))
      job.siteLang = (j as { siteLang?: string }).siteLang
      const q = j as { height?: number; hlsName?: string; heights?: number[] }
      if (q.height) job.height = q.height
      if (q.hlsName) job.hlsName = q.hlsName
      if (q.heights) job.heights = q.heights
      const site = loadSiteSubs(dir)
      // Older jobs kept every "-orig" auto track (YouTube's auto-dubs): keep only the spoken language's.
      const spoken = (job.siteLang ?? job.cues.find(c => c.lang)?.lang ?? '').split('-')[0]
      const autos = site.tracks.filter(t => t.auto)
      site.tracks = site.tracks.filter(t => !t.auto || (spoken ? t.lang.split('-')[0] === spoken : autos.length === 1))
      job.siteTracks = site.tracks
      for (const [k, v] of site.cues) job.siteCues.set(k, v)
      const at = j.subs?.at ?? job.cues.at(-1)?.end ?? 0
      job.subs = { state: j.subs?.state === 'done' ? 'done' : at > 0 ? 'paused' : 'off', at }
      // A recording cut short by a restart still needs its MP4.
      if (!existsSync(join(dir, 'recording.mp4'))) void job.remux()
      return job
    } catch {
      return undefined
    }
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
    }, this.height)
    this.heights = r.heights
    this.title = r.title
    this.vod = !r.isLive
    this.siteLang = r.language
    this.setBrief(r.brief)
    void fetchComments(url, r.cookiesFrom).then(c => { if (c.length) this.setBrief(`${r.brief}\nTop comments:\n${c.map(x => `- ${x}`).join('\n')}`) })
    // The site's own subtitles, in the background (no tokens).
    if (r.siteTracks.length) {
      void fetchSiteSubs(url, this.deps.dir, r.siteTracks, r.cookiesFrom).then(got => {
        const loaded = loadSiteSubs(this.deps.dir)
        this.siteTracks = got
        for (const [k, v] of loaded.cues) this.siteCues.set(k, v)
        if (got.length) this.deps.log(`[${this.id}] site subtitles: ${got.map(g => g.lang + (g.auto ? ' (auto)' : '')).join(', ')}`)
        this.emit('state', this.summary())
      }).catch(err => this.deps.log(`[${this.id}] site subtitles: ${(err as Error).message}`))
    }
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
    const cover = audioOnly && r.cover ? await this.saveCover(r.cover) : undefined
    return { args, audio: '0:a:0', video: audioOnly ? undefined : '0:v:0?', vcodec: audioOnly ? undefined : only.vcodec, cover }
  }

  /** Keep a podcast's cover next to the recording (the picture while it plays). */
  private async saveCover(url: string): Promise<string | undefined> {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      if (!r.ok) return undefined
      const file = join(this.deps.dir, `cover${/\.png(\?|$)/i.test(url) ? '.png' : '.jpg'}`)
      writeFileSync(file, Buffer.from(await r.arrayBuffer()))
      return file
    } catch { return undefined }
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
    const hls = join(this.deps.dir, this.hlsName)
    mkdirSync(hls, { recursive: true })
    // Audio-only sources get a generated picture (waveform) so they play and export as video.
    // H.264 copies straight into HLS; other codecs (AV1, VP9, HEVC) are re-encoded so every browser can play them.
    const h264 = !input.vcodec || /^(h264|avc)/i.test(input.vcodec)
    // A podcast cover: centred on the dark background with a slim waveform under it.
    const coverIn = input.args.filter(a => a === '-i').length
    const picture = input.video
      ? ['-map', input.video, ...(h264 ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-vf', 'scale=-2:min(720\\,ih)', '-g', '50'])]
      : input.cover ? ['-loop', '1', '-framerate', '25', '-i', input.cover, '-filter_complex', [
          'color=c=0x0f1420:s=1280x720:r=25[bg]',
          `[${coverIn}:v]scale=-2:460,format=rgba[c]`,
          `[${input.audio}]aformat=channel_layouts=mono,showwaves=s=1280x120:mode=cline:rate=25:colors=white:scale=cbrt:draw=full,format=rgba,colorchannelmixer=rr=0.56:gg=0.71:bb=1:aa=0.7[w]`,
          '[bg][c]overlay=(W-w)/2:70[b1]',
          '[b1][w]overlay=0:570:shortest=1,format=yuv420p[wv]',
        ].join(';'),
         '-map', '[wv]', '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-g', '50']
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
    // A push source is "waiting" until its first segment lands (the status is set right after this call).
    if (this.opts.source === 'push') {
      const wait = setInterval(() => {
        if (this.ffmpeg !== ff) { clearInterval(wait); return }
        if (this.segments().length) { clearInterval(wait); this.setStatus('running') }
      }, 400)
    }
    ff.stderr!.on('data', (d: Buffer) => appendFileSync(join(this.deps.dir, 'ffmpeg.log'), d))
    ff.on('exit', code => {
      // Replaced (quality switch) or stopped on purpose: the caller handles what comes next.
      if (this.ffmpeg !== ff) return
      this.ffmpeg = undefined
      if (this.status !== 'running') return
      void this.finishCapture(code === 0 ? 'ended' : this.ffmpegError(code), code === 0 || this.segments().length > 0)
    })
  }

  private get m3u8(): string {
    return join(this.deps.dir, this.hlsName, 'index.m3u8')
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
    if (finished) input = this.seekable(at)
    else {
      const i = Math.max(0, segs.findLastIndex(sg => sg.start <= at))
      at = segs[i]!.start
      input = ['-live_start_index', String(i), '-max_reload', '100000', '-i', this.m3u8]
    }
    let provider: SpeechProvider
    try { provider = this.deps.makeProvider() } catch (err) {
      // No key / nothing installed: leave subtitles off and say why.
      this.setStatus(this.status, (err as Error).message)
      return
    }
    this.provider = provider
    // Starting again over lines already there (say, from the beginning): this run writes them anew.
    this.dropFrom(at)
    this.runOffset = at
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

  /**
   * Change which languages subtitles have. Lines from now on use them; lines
   * already there get the new languages filled in, in batches (tokens only for what is missing).
   */
  async setTargets(tgtLangs: string[]): Promise<void> {
    this.opts.tgtLangs = tgtLangs
    this.deps.glossary.setTargets(tgtLangs)
    this.persist()
    this.emit('state', this.summary())
    if (this.filling) return
    this.filling = true
    try {
      for (;;) {
        const targets = this.targets()
        const handle = this.deps.llm()
        if (!handle || !targets.length) break
        const todo = this.cues.filter(c => c.final && c.src && targets.some(t => !c.tr?.[t])).slice(0, 15)
        if (!todo.length) break
        const missing = targets.filter(t => todo.some(c => !c.tr?.[t]))
        const got = await translateBatch(handle, missing, todo.map(c => ({ id: c.id, src: c.src })), this.deps.glossary.forPrompt())
        if (!got.size) break
        for (const c of todo) {
          const tr = got.get(c.id)
          if (!tr) continue
          c.tr = { ...c.tr, ...tr }
          this.emit('cue', c)
          this.record(c)
        }
      }
    } catch (err) {
      this.deps.log(`[${this.id}] fill translations: ${(err as Error).message}`)
    } finally {
      this.filling = false
      this.save()
    }
  }
  private filling = false

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
    await this.polisher.flush()
    this.subs = { state, at: this.subs.at }
    this.save()
    this.persist()
    this.emit('state', this.summary())
  }

  /** Is recognition or translation too far behind the media read so far? (`slack` < 1 waits until it is well caught up.) */
  private behind(slack = 1): boolean {
    const asr = this.provider?.backlog?.() ?? 0
    return asr > AHEAD_MAX_SEC * slack || this.pendingTranslations > AHEAD_MAX_LINES * slack || this.polisher.backlog > 3 * AHEAD_MAX_LINES * slack
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
      this.deps.glossary.notice(cue.src)
      // Real-time: a quick per-line translation now, polished a few lines later.
      // Polished mode: no quick pass; the polishing batch fixes and translates.
      if (this.opts.mode === 'realtime' && !this.provider?.translates && cue.tr === undefined && this.targets().length) this.translate(cue)
      else { this.record(cue); this.polisher.add(cue) }
    }
  }

  private translate(cue: Cue): void {
    const context = this.cues.filter(c => c.final && c.id < cue.id).slice(-6)
    // Keep order but let a slow model fall behind gracefully: chain, never block capture.
    this.pendingTranslations++
    this.translating = this.translating.then(async () => {
      try {
        const ref = this.siteText(cue.start, cue.end).map(x => `[${x.lang}${x.auto ? ', auto' : ''}] ${x.text}`).join('\n')
        const tr = await this.deps.translator.translate(this.targets(), cue.src, context, this.deps.glossary.forPrompt(), undefined, ref)
        if (tr) {
          cue.tr = { ...cue.tr, ...tr }
          this.emit('cue', cue)
        }
      } catch (err) {
        this.deps.log(`[${this.id}] translate: ${(err as Error).message}`)
      }
      this.pendingTranslations--
      this.record(cue)
      this.polisher.add(cue)
    })
  }

  /** Forget the lines from media time `at` on (a new run covers them again). */
  private dropFrom(at: number): void {
    const gone = this.cues.filter(c => c.start >= at - 0.05)
    if (!gone.length) return
    const ids = new Set(gone.map(c => c.id))
    this.cues.splice(0, this.cues.length, ...this.cues.filter(c => !ids.has(c.id)))
    this.drafts.clear()
    appendFileSync(join(this.deps.dir, 'cues.jsonl'), gone.map(c => JSON.stringify({ id: c.id, dropped: true })).join('\n') + '\n')
    this.emit('cues', this.cues)
  }

  /** Append a finished cue (with its translation, if any) to cues.jsonl. */
  private record(cue: Cue): void {
    appendFileSync(join(this.deps.dir, 'cues.jsonl'), JSON.stringify(cue) + '\n')
  }

  /**
   * Watch at another picture height: fetch the source again into its own HLS
   * folder (kept, so switching back is instant). Timeline and subtitles stay.
   */
  async setQuality(height: number): Promise<void> {
    if (this.opts.source !== 'url' || height === this.height) return
    this.height = height
    this.hlsName = height === 720 ? 'hls' : `hls-${height}`
    const done = existsSync(this.m3u8) && readFileSync(this.m3u8, 'utf8').includes('#EXT-X-ENDLIST')
    if (done) { this.persist(); this.emit('state', this.summary()); return }
    rmSync(join(this.deps.dir, this.hlsName), { recursive: true, force: true })
    const old = this.ffmpeg
    this.ffmpeg = undefined
    old?.kill('SIGKILL')
    this.captureDone = false
    this.setStatus('resolving')
    try {
      const input = await this.resolve()
      this.spawnFfmpeg(input)
      this.setStatus('running')
    } catch (err) {
      this.setStatus('error', (err as Error).message)
    }
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
    await this.restreamer?.stop()
    await this.stop(reason)
    await this.pauseSubs()
  }

  // ── Restreaming ──

  private restreamer?: Restream

  get restream(): RestreamStatus | undefined { return this.restreamer?.summary }

  /** Push this video (from media time `from`, subtitles drawn in) to the chosen destinations. */
  async startRestream(targets: Target[], opts: { from: number; burn: boolean; style: BurnStyle; height: 720 | 1080 }): Promise<void> {
    if (this.restreamer?.summary.running) { for (const t of targets) this.restreamer.add(t); return }
    if (!this.segments().length) throw new Error('nothing recorded yet')
    // Watched to the end of a video: stream it from the beginning rather than end at once.
    if (this.vod && this.duration && opts.from >= this.duration - 1.5) opts = { ...opts, from: 0 }
    const r = new Restream({
      input: from => this.restreamInput(from),
      rowsAt: t => this.rowsAt(t, opts.style),
    }, { ...opts, bitrateK: opts.height === 1080 ? 4500 : 2500 }, targets, m => this.deps.log(`[${this.id}] ${m}`))
    this.restreamer = r
    r.on('status', () => this.emit('state', this.summary()))
    await r.start()
  }

  async stopRestream(targetId?: string): Promise<void> {
    if (!this.restreamer) return
    if (targetId && !this.restreamer.drop(targetId)) return
    await this.restreamer.stop()
  }

  /**
   * Input arguments for a finished recording from media time `from`. Seeking
   * an HLS playlist to 0 skips its whole first segment when the stream's
   * timestamps don't start at 0, so: no seek from the start, and the single
   * recording file (exact seeking) once it exists.
   */
  private seekable(from: number): string[] {
    const file = this.captureDone && existsSync(join(this.deps.dir, 'recording.mp4')) ? join(this.deps.dir, 'recording.mp4') : this.m3u8
    return from > 0.05 ? ['-ss', String(from), '-i', file] : ['-i', file]
  }

  /** The recording from `from` on, for an ffmpeg that reads it in real time. */
  private restreamInput(from: number): { args: string[]; at: number } {
    const segs = this.segments()
    const finished = readFileSync(this.m3u8, 'utf8').includes('#EXT-X-ENDLIST')
    if (finished) return { args: this.seekable(from), at: Math.max(0, from) }
    const i = Math.max(0, segs.findLastIndex(sg => sg.start <= from))
    return { args: ['-live_start_index', String(i), '-max_reload', '100000', '-i', this.m3u8], at: segs[i]?.start ?? 0 }
  }

  /** What the player would show at media time t, line by line (the same rules: no repeats, line-end marks dropped). */
  rowsAt(t: number, style: BurnStyle): { text: string; size: number; main: boolean }[] {
    const cue = this.cues.find(c => c.final && c.start <= t && t < Math.max(c.end, c.start + 1.2))
    const text = (key: string): string | undefined => {
      if (key.startsWith('site:')) return this.siteCues.get(key)?.find(c => c.start <= t && t < c.end)?.text
      if (!cue) return undefined
      if (key === 'src') return cue.src
      const tr = cue.tr?.[key]
      return tr && tr.trim() !== cue.src.trim() ? tr : (cue.lang?.split('-')[0] === key.split('-')[0] ? cue.src : undefined)
    }
    const seen = new Set<string>()
    const rows: { text: string; size: number; main: boolean }[] = []
    for (const l of style.lines) {
      const x = l.show ? text(l.key)?.trim() : undefined
      if (!x || seen.has(x)) continue
      seen.add(x)
      rows.push({ text: subtitleText(x), size: l.size, main: rows.length === 0 })
    }
    return rows
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

  // ── Media helpers for tools and extensions ──

  /** Best available picture source for time range [from, to]: original download, finished recording, or recorded segments. */
  private mediaFor(from: number, to: number): { args: string[]; offset: number } {
    const original = readdirSync(this.deps.dir).find(n => /^original\.(mp4|mkv|webm)$/.test(n))
    if (original) return { args: ['-ss', String(from), '-i', join(this.deps.dir, original)], offset: 0 }
    if (this.captureDone && existsSync(join(this.deps.dir, 'recording.mp4'))) return { args: ['-ss', String(from), '-i', join(this.deps.dir, 'recording.mp4')], offset: 0 }
    // Still recording: splice the segments that cover the range.
    const segs = this.segments()
    const files = readFileSync(this.m3u8, 'utf8').split('\n').filter(l => l && !l.startsWith('#'))
    const first = Math.max(0, segs.findLastIndex(sg => sg.start <= from))
    let last = segs.findIndex(sg => sg.start + sg.dur >= to)
    if (last < 0) last = segs.length - 1
    if (!segs.length || first > last) throw new Error('that part has not been recorded yet')
    const list = files.slice(first, last + 1).map(f => join(this.deps.dir, this.hlsName, f)).join('|')
    return { args: ['-ss', String(from - segs[first]!.start), '-i', `concat:${list}`], offset: 0 }
  }

  /** One small JPEG of the picture at media time `at`, for the model to look at (undefined for audio-only or on failure). */
  async still(at: number): Promise<Buffer | undefined> {
    try {
      const { args } = this.mediaFor(at, at + 1)
      const { stdout } = await run('ffmpeg', ['-v', 'error', ...args, '-frames:v', '1', '-vf', 'scale=768:-2', '-q:v', '5', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'],
        { timeout: 30_000, encoding: 'buffer', maxBuffer: 8 << 20 })
      return stdout.length > 1000 ? stdout : undefined
    } catch { return undefined }
  }

  /** Save one frame at media time `at` (seconds) as JPEG; returns the file path. */
  async frame(at: number): Promise<string> {
    const dir = join(this.deps.dir, 'frames')
    mkdirSync(dir, { recursive: true })
    const out = join(dir, `frame_${at.toFixed(1).replace('.', '_')}.jpg`)
    const { args } = this.mediaFor(at, at + 1)
    await run('ffmpeg', ['-v', 'error', '-y', ...args, '-frames:v', '1', '-q:v', '2', out], { timeout: 60_000 })
    return out
  }

  /**
   * Cut [from, to] into an MP4 (re-encoded for an exact cut). With `langs`,
   * subtitle tracks for those lines are added (combined track first when more than one).
   */
  async clip(from: number, to: number, langs?: string[]): Promise<string> {
    if (!(to > from)) throw new Error('end must be after start')
    const dir = join(this.deps.dir, 'clips')
    mkdirSync(dir, { recursive: true })
    const name = `clip_${from.toFixed(1)}-${to.toFixed(1)}`.replace(/\./g, '_')
    const out = join(dir, `${name}.mp4`)
    const { args } = this.mediaFor(from, to)
    const subArgs: string[] = []
    const maps: string[] = []
    if (langs?.length) {
      const inRange = this.cues.filter(c => c.final && c.end > from && c.start < to).map(c => ({ ...c, start: Math.max(0, c.start - from), end: Math.min(to, c.end) - from }))
      const tracks = langs.length > 1 ? [langs, ...langs.map(l => [l])] : [langs]
      tracks.forEach((ls, i) => {
        const f = join(dir, `.${name}.${i}.srt`)
        writeFileSync(f, exportCues(inRange, ls, 'srt'))
        subArgs.push('-i', f)
        maps.push('-map', `${i + 1}:0`)
      })
    }
    await run('ffmpeg', ['-v', 'error', '-y', ...args, ...subArgs, '-t', String(to - from), '-map', '0:v?', '-map', '0:a?', ...maps,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', ...(maps.length ? ['-c:s', 'mov_text'] : []),
      '-movflags', '+faststart', out], { timeout: 600_000 })
    for (const f of readdirSync(dir)) if (f.startsWith(`.${name}.`)) rmSync(join(dir, f), { force: true })
    return out
  }

  /**
   * Cut [from, to] into an MP4 with the subtitles drawn into the picture,
   * looking exactly like the player (and the restream): each change of the
   * lines on screen becomes one transparent picture, shown for its stretch.
   */
  async burnClip(from: number, to: number, style: BurnStyle, opts: { height?: 720 | 1080; out?: string } = {}): Promise<string> {
    if (!(to > from)) throw new Error('end must be after start')
    const h = opts.height ?? 1080, w = Math.round(h * 16 / 9)
    const dir = join(this.deps.dir, 'clips')
    mkdirSync(dir, { recursive: true })
    const name = `clip_${from.toFixed(1)}-${to.toFixed(1)}_subs`.replace(/\./g, '_')
    const out = opts.out ?? join(dir, `${name}.mp4`)
    const tmp = join(dir, `.${name}`)
    mkdirSync(tmp, { recursive: true })
    // Stretches with the same lines on screen, sampled every 0.1 s.
    const spans: { start: number; end: number; key: string; rows: ReturnType<LiveJob['rowsAt']> }[] = []
    for (let t = from; t < to; t += 0.1) {
      const rows = this.rowsAt(t, style)
      const key = JSON.stringify(rows)
      const last = spans.at(-1)
      if (last && last.key === key) last.end = Math.min(to, t + 0.1)
      else spans.push({ start: t, end: Math.min(to, t + 0.1), key, rows })
    }
    const pictures = new Map<string, string>()
    const lines = ['ffconcat version 1.0']
    for (const s of spans) {
      let file = pictures.get(s.key)
      if (!file) {
        file = join(tmp, `${pictures.size}.png`)
        const png = await drawSubtitles(s.rows, style, w, h)
        if (!png) throw new Error('subtitles could not be drawn on this computer')
        writeFileSync(file, png)
        pictures.set(s.key, file)
      }
      lines.push(`file '${file.replace(/'/g, "'\\''")}'`, `duration ${(s.end - s.start).toFixed(3)}`)
    }
    lines.push(`file '${pictures.get(spans.at(-1)!.key)!.replace(/'/g, "'\\''")}'`)
    const list = join(tmp, 'subs.ffconcat')
    writeFileSync(list, lines.join('\n') + '\n')
    const { args } = this.mediaFor(from, to)
    try {
      await run('ffmpeg', ['-v', 'error', '-y', ...args, '-f', 'concat', '-safe', '0', '-i', list, '-t', String(to - from),
        '-filter_complex', `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS[v];[1:v]format=rgba,setpts=PTS-STARTPTS[s];[v][s]overlay=0:0:eof_action=repeat,format=yuv420p[o]`,
        '-map', '[o]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out], { timeout: 900_000 })
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
    return out
  }

  /** Language actually spoken (setting, or what recognition detected). */
  private spokenLang(): string | undefined {
    if (this.opts.srcLang !== 'auto') return this.opts.srcLang
    return this.cues.findLast(c => c.lang)?.lang ?? this.siteLang
  }

  /** Translation targets, minus the language already spoken (a Chinese video needs no Chinese translation). */
  targets(): string[] {
    const spoken = this.spokenLang()
    return this.opts.tgtLangs.filter(t => t !== spoken)
  }

  private setBrief(text: string): void {
    this.brief = text.slice(0, 4000)
    try { writeFileSync(join(this.deps.dir, 'brief.txt'), this.brief) } catch {}
    this.deps.glossary.notice(`${this.title ?? ''}\n${this.brief}`)
  }

  /** The site's subtitle text around [from, to] (media seconds), per track — a reference, not ground truth. */
  siteText(from: number, to: number): { lang: string; auto: boolean; text: string }[] {
    return this.siteTracks.map(tr => ({
      lang: tr.lang, auto: tr.auto,
      text: (this.siteCues.get(tr.key) ?? []).filter(c => c.end > from - 1 && c.start < to + 1).map(c => c.text).join(' '),
    })).filter(x => x.text)
  }

  /** Recognition hint for a chunk of the current run (times relative to the run): glossary + site subtitles there. */
  asrHint(start: number, end: number, terms: string): string {
    const site = this.siteText(this.runOffset + start, this.runOffset + end).find(x => !x.auto) ?? this.siteText(this.runOffset + start, this.runOffset + end)[0]
    return [terms && `Glossary: ${terms}.`, site?.text].filter(Boolean).join(' ')
  }

  /** Finished lines in [from, to], optionally filtered by text. */
  lines(from = 0, to = Infinity, query?: string): Cue[] {
    const q = query?.toLowerCase()
    return this.cues.filter(c => c.final && c.end >= from && c.start <= to
      && (!q || c.src.toLowerCase().includes(q) || Object.values(c.tr ?? {}).some(v => v.toLowerCase().includes(q))))
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
