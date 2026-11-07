/**
 * dsh-live host half: live stream jobs, local/online speech providers,
 * subtitle translation through the harness model, and the HTTP surface the
 * browser half talks to (/live/api/*, /live/media/*).
 */
import { appendFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir, networkInterfaces } from 'node:os'
import { extname, join, normalize, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { checkDeps } from './deps.ts'
import type { ExportFormat } from './export.ts'
import { Glossary } from './glossary.ts'
import { LiveJob } from './job.ts'
import { Downloads } from './downloads.ts'
import { KeyStore } from './keys.ts'
import { installedBrowsers, type CookieChoice } from './sites.ts'
import { LocalProvider } from './providers/local.ts'
import { OpenAIProvider, verifyOpenAIKey } from './providers/openai.ts'
import { LANGS, Translator, type LlmHandle } from './translate.ts'
import type { JobOptions, SourceKind, SpeechProvider } from './types.ts'
import { WhisperServer } from './whisper.ts'

export const name = 'dsh-live'
export const inject = ['webServer']

export interface Config {
  dataDir: string
  whisperModel: string
  defaultTargetLang: string
  minChunkSec: number
  maxChunkSec: number
  glossary: string
  rtmpPort: number
  srtPort: number
  openaiApiKey: string
  openaiModel: string
}

export const Config: z<Config> = z.object({
  dataDir: z.string().default(join(homedir(), '.dsh', 'live')).description('Where recordings and subtitles are saved.'),
  whisperModel: z.string().default(join(homedir(), '.dsh', 'live', 'models', 'ggml-large-v3-turbo-q5_0.bin')).description('whisper.cpp model for local subtitles.'),
  defaultTargetLang: z.string().default('zh').description('Default subtitle translation language.'),
  minChunkSec: z.number().default(1.6).description('Local provider: shortest chunk (s).'),
  maxChunkSec: z.number().default(5).description('Local provider: longest chunk before a forced cut (s).'),
  glossary: z.string().role('textarea').default('').description('Terms to keep consistent, one per line (e.g. "Dots = Dots"). Each stream also builds its own glossary automatically.'),
  rtmpPort: z.number().default(1935).description('Port for incoming RTMP pushes (OBS → rtmp://<this machine>/live).'),
  srtPort: z.number().default(9000).description('Port for incoming SRT pushes.'),
  openaiApiKey: z.string().role('secret').default('').description('OpenAI API key for online subtitles (can also be entered on the Live page, or set OPENAI_API_KEY).'),
  openaiModel: z.string().default('gpt-live-transcribe').description('OpenAI realtime transcription model.'),
}) as never

const MIME: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.mp4': 'video/mp4', '.m4s': 'video/iso.segment',
  '.vtt': 'text/vtt; charset=utf-8', '.srt': 'text/plain; charset=utf-8', '.jsonl': 'text/plain; charset=utf-8',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.m4a': 'audio/mp4', '.jpg': 'image/jpeg', '.png': 'image/png',
}

/** Only answer loopback hosts: these routes have no auth of their own. */
function trusted(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '')
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]'
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

export function apply(ctx: Context, config: Config): void {
  const logger = (ctx as any).logger?.('dsh-live')
  mkdirSync(config.dataDir, { recursive: true })
  const logFile = join(config.dataDir, 'dsh-live.log')
  const log = (msg: string): void => {
    if (logger?.info) logger.info(msg); else console.log(`[dsh-live] ${msg}`)
    try { appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`) } catch {}
  }
  const whisper = new WhisperServer(config.whisperModel, log)
  const jobs = new Map<string, LiveJob>()
  const byConversation = new Map<string, string>()

  // The model is optional: subtitles still work (source only) without one.
  let llm: LlmHandle | undefined
  ctx.inject(['llm', 'agentDefaultModel'], (c: any) => {
    c.effect(() => {
      llm = {
        stream: opts => c.llm.stream(opts),
        selection: () => c.agentDefaultModel.currentSelection(),
      }
      return () => { llm = undefined }
    }, 'dsh-live: translator model')
  })
  const translator = new Translator(() => llm)

  const keys = new KeyStore(join(config.dataDir, 'keys.json'), () => ({ openai: config.openaiApiKey }))

  // Page-level preferences (which browser login to use for video sites).
  const settingsFile = join(config.dataDir, 'settings.json')
  const prefs = (): { cookies: CookieChoice } => {
    try { return { cookies: 'auto', ...JSON.parse(readFileSync(settingsFile, 'utf8')) } } catch { return { cookies: 'auto' } }
  }
  const downloads = new Downloads(join(config.dataDir, 'jobs'), () => prefs().cookies, log)

  function makeProvider(opts: JobOptions, glossary: Glossary): SpeechProvider {
    switch (opts.provider) {
      case 'openai': {
        const apiKey = keys.get('openai')
        if (!apiKey) throw new Error('no OpenAI API key yet: add one under “Services & keys”')
        return new OpenAIProvider({
          apiKey, model: config.openaiModel, lang: opts.srcLang,
          delay: opts.mode === 'polished' ? 'high' : 'low',
          minSec: Math.max(config.minChunkSec, 2), maxSec: Math.max(config.maxChunkSec, 8),
          keywords: () => glossary.terms.map(t => t.src), log,
        })
      }
      case 'local':
      default:
        return new LocalProvider({
          whisper, lang: opts.srcLang === 'auto' ? 'auto' : opts.srcLang,
          minSec: config.minChunkSec, maxSec: config.maxChunkSec, prompt: () => glossary.forAsr(),
        })
    }
  }

  /** First non-internal IPv4 address, for push instructions shown to the user. */
  function lanAddress(): string {
    for (const list of Object.values(networkInterfaces())) {
      for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address
    }
    return '127.0.0.1'
  }

  /**
   * The push listener that waits while a Live page is idle. It is a push job
   * that is not yet the conversation's job: it becomes it the moment a stream
   * arrives. Only one can hold the RTMP port, so the most recently opened idle
   * page owns it.
   */
  let armed: { conversationId: string; key: string; job: LiveJob } | undefined
  const PUSH_KEY = 'dsh'

  async function disarm(): Promise<void> {
    const a = armed
    armed = undefined
    if (!a) return
    await a.job.stop('not needed')
    jobs.delete(a.job.id)
    if (a.job.cues.length === 0) rmSync(a.job.summary().dir, { recursive: true, force: true })
  }

  async function arm(opts: JobOptions): Promise<{ jobId: string; rtmp?: string; key?: string } | { busy: true }> {
    const streaming = (j: LiveJob) => j.opts.source === 'push' && j.status === 'running' && !j.message
    if ([...jobs.values()].some(streaming)) return { busy: true }
    const sig = JSON.stringify({ ...opts, source: 'push' })
    if (armed && armed.conversationId === opts.conversationId && armed.key === sig && armed.job.status === 'running') {
      return { jobId: armed.job.id, ...armed.job.ingest }
    }
    await disarm()
    const job = await startJob({ ...opts, source: 'push', url: 'rtmp' }, true)
    armed = { conversationId: opts.conversationId, key: sig, job }
    job.on('state', (st: { status: string; message?: string }) => {
      // The stream arrived: from now on this is the conversation's job.
      if (st.status === 'running' && !st.message && armed?.job === job) {
        armed = undefined
        const prev = byConversation.get(opts.conversationId)
        if (prev && prev !== job.id) void jobs.get(prev)?.stop('replaced by a new stream')
        byConversation.set(opts.conversationId, job.id)
      }
    })
    // Wait for the listening address.
    for (let i = 0; i < 20 && !job.ingest; i++) await new Promise(r => setTimeout(r, 50))
    return { jobId: job.id, ...job.ingest }
  }

  async function startJob(opts: JobOptions, waiting = false): Promise<LiveJob> {
    const prev = waiting ? undefined : byConversation.get(opts.conversationId)
    if (prev) await jobs.get(prev)?.stop('replaced by a new stream')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const id = `${stamp}-${Math.random().toString(36).slice(2, 6)}`
    const dir = join(config.dataDir, 'jobs', id)
    mkdirSync(dir, { recursive: true })
    let job: LiveJob | undefined
    const glossary = new Glossary(join(dir, 'glossary.json'), opts.tgtLangs, () => llm, terms => job?.emit('glossary', terms), log, config.glossary, join(config.dataDir, 'glossary.json'))
    job = new LiveJob(id, opts, {
      dir,
      provider: makeProvider(opts, glossary),
      translator,
      glossary,
      log,
      ingest: { host: lanAddress(), rtmpPort: config.rtmpPort, srtPort: config.srtPort, key: waiting ? PUSH_KEY : undefined },
      cookies: () => prefs().cookies,
    })
    jobs.set(id, job)
    if (!waiting) byConversation.set(opts.conversationId, id)
    void job.start()
    return job
  }

  const api = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!trusted(req)) return send(res, 403, { error: 'forbidden host' })
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const route = url.pathname.replace(/^\/live\/api\/?/, '')
    try {
      if (route === 'deps') {
        const deps = await checkDeps(config.whisperModel)
        const localReady = deps.filter(d => ['ffmpeg', 'whisper-server', 'whisper model'].includes(d.name)).every(d => d.ok)
        return send(res, 200, {
          deps, translator: translator.available, langs: LANGS, defaultTargetLang: config.defaultTargetLang,
          providers: [
            { id: 'openai', online: true, ready: keys.info('openai').set },
            { id: 'local', online: false, ready: localReady },
          ],
          keys: { openai: keys.info('openai') },
        })
      }
      if (route === 'keys' && req.method === 'POST') {
        // { name: 'openai', key: '...' } saves (empty key removes); { name, test: true } checks the stored key.
        const b = await readJson(req)
        if (b.name !== 'openai') return send(res, 400, { error: 'unknown service' })
        if (typeof b.key === 'string') {
          const key = b.key.trim()
          if (key) {
            const check = await verifyOpenAIKey(key)
            if (!check.ok) return send(res, 400, { error: check.message ?? 'key rejected' })
          }
          keys.save('openai', key)
          return send(res, 200, { openai: keys.info('openai') })
        }
        const key = keys.get('openai')
        if (!key) return send(res, 400, { error: 'no key' })
        const check = await verifyOpenAIKey(key)
        return send(res, check.ok ? 200 : 400, check.ok ? { ok: true } : { error: check.message })
      }
      if (route === 'start' && req.method === 'POST') {
        const b = await readJson(req)
        if (typeof b.url !== 'string' || !b.url.trim()) return send(res, 400, { error: 'url required' })
        const source: SourceKind = b.source === 'push' || b.source === 'file' ? b.source : 'url'
        await disarm()
        const raw = b.url.trim()
        const job = await startJob({
          source,
          url: source === 'file' && raw.startsWith('~') ? join(homedir(), raw.slice(1)) : raw,
          mode: b.mode === 'polished' ? 'polished' : 'realtime',
          srcLang: typeof b.srcLang === 'string' ? b.srcLang : 'auto',
          // Empty = original only (no translation).
          tgtLangs: Array.isArray(b.tgtLangs)
            ? (b.tgtLangs as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 4)
            : [config.defaultTargetLang],
          provider: typeof b.provider === 'string' ? b.provider : 'local',
          conversationId: String(b.conversationId ?? 'default'),
        })
        return send(res, 200, job.summary())
      }
      if (route === 'stop' && req.method === 'POST') {
        const b = await readJson(req)
        const job = jobs.get(String(b.jobId))
        if (!job) return send(res, 404, { error: 'no such job' })
        void job.stop()
        return send(res, 200, job.summary())
      }
      if (route === 'arm' && req.method === 'POST') {
        const b = await readJson(req)
        return send(res, 200, await arm({
          source: 'push', url: 'rtmp', mode: b.mode === 'polished' ? 'polished' : 'realtime',
          srcLang: typeof b.srcLang === 'string' ? b.srcLang : 'auto',
          tgtLangs: Array.isArray(b.tgtLangs) ? (b.tgtLangs as unknown[]).map(String).slice(0, 4) : [config.defaultTargetLang],
          provider: typeof b.provider === 'string' ? b.provider : 'local', conversationId: String(b.conversationId ?? 'default'),
        }))
      }
      if (route === 'settings') {
        if (req.method === 'POST') {
          const b = await readJson(req)
          const ok = ['auto', 'none', ...installedBrowsers().map(x => x.id)]
          if (typeof b.cookies === 'string' && ok.includes(b.cookies)) writeFileSync(settingsFile, JSON.stringify({ ...prefs(), cookies: b.cookies }, null, 2))
        }
        return send(res, 200, { ...prefs(), browsers: installedBrowsers() })
      }
      if (route === 'downloads') {
        return send(res, 200, downloads.list(url.searchParams.get('conversationId') ?? ''))
      }
      if (route === 'download' && req.method === 'POST') {
        // { conversationId, url } downloads a link on its own; { jobId } downloads the original of that job's link.
        const b = await readJson(req)
        const conversationId = String(b.conversationId ?? 'default')
        const job = typeof b.jobId === 'string' ? jobs.get(b.jobId) : undefined
        if (job) {
          const s = job.summary()
          if (s.source !== 'url') return send(res, 400, { error: 'only links can be downloaded; this source is already on this computer' })
          return send(res, 200, downloads.original({ conversationId, url: s.url, dirId: s.id, title: s.title, browser: s.loginBrowser }))
        }
        if (typeof b.url !== 'string' || !/^https?:\/\//.test(b.url.trim())) return send(res, 400, { error: 'url required' })
        return send(res, 200, downloads.original({ conversationId, url: b.url.trim() }))
      }
      if (route === 'subtitled' && req.method === 'POST') {
        const b = await readJson(req)
        const job = jobs.get(String(b.jobId))
        if (!job) return send(res, 404, { error: 'no such job' })
        const s = job.summary()
        const langs = Array.isArray(b.langs) && b.langs.length ? (b.langs as unknown[]).map(String) : [...s.tgtLangs, 'src']
        return send(res, 200, downloads.subtitled({
          conversationId: String(b.conversationId ?? s.conversationId), dirId: s.id, title: s.title,
          cues: job.cues.filter(c => c.final), langs, fallbackVideo: s.source === 'file' ? s.url : undefined,
        }))
      }
      if (route === 'job') {
        const id = url.searchParams.get('jobId') ?? byConversation.get(url.searchParams.get('conversationId') ?? '')
        const job = id ? jobs.get(id) : undefined
        return send(res, 200, job ? { ...job.summary(), cues: job.cues, terms: job.terms } : null)
      }
      if (route === 'events') {
        const job = jobs.get(url.searchParams.get('jobId') ?? '')
        if (!job) return send(res, 404, { error: 'no such job' })
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
        const write = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        write('state', job.summary())
        write('cues', job.cues)
        write('glossary', job.terms)
        const onState = (s: unknown) => write('state', s)
        const onCue = (c: unknown) => write('cue', c)
        const onTerms = (t: unknown) => write('glossary', t)
        job.on('state', onState)
        job.on('cue', onCue)
        job.on('glossary', onTerms)
        const ping = setInterval(() => res.write(': ping\n\n'), 15_000)
        req.on('close', () => { clearInterval(ping); job.off('state', onState); job.off('cue', onCue); job.off('glossary', onTerms) })
        return
      }
      if (route === 'upload' && req.method === 'POST') {
        // Raw body upload (drag-and-drop): stream to disk, return the absolute path to start a 'file' job with.
        const name = (url.searchParams.get('name') ?? 'upload').replace(/[^\w.\-\u4e00-\u9fff ]+/g, '_').slice(-120)
        const dir = join(config.dataDir, 'uploads')
        mkdirSync(dir, { recursive: true })
        const path = join(dir, `${Date.now()}-${name}`)
        await new Promise<void>((ok, fail) => { const w = createWriteStream(path); req.pipe(w); w.on('finish', ok); w.on('error', fail); req.on('error', fail) })
        return send(res, 200, { path, bytes: statSync(path).size })
      }
      if (route === 'export') {
        const job = jobs.get(url.searchParams.get('jobId') ?? '')
        if (!job) return send(res, 404, { error: 'no such job' })
        const langs = (url.searchParams.get('langs') ?? 'src').split(',').filter(Boolean)
        const format = (['srt', 'vtt', 'txt', 'md'].includes(url.searchParams.get('format') ?? '') ? url.searchParams.get('format') : 'srt') as ExportFormat
        const body = job.exportText(langs, format)
        const fname = `${job.id}.${langs.join('+')}.${format}`
        res.writeHead(200, { 'content-type': `${MIME['.' + format] ?? 'text/plain; charset=utf-8'}`, 'content-disposition': `attachment; filename="${fname}"`, 'cache-control': 'no-store' })
        res.end(body)
        return
      }
      if (route === 'glossary' && req.method === 'POST') {
        const b = await readJson(req)
        const job = jobs.get(String(b.jobId))
        if (!job || typeof b.src !== 'string') return send(res, 400, { error: 'jobId and src required' })
        const g = (job as unknown as { deps: { glossary: Glossary } }).deps.glossary
        if (b.op === 'remove') g.remove(b.src); else g.upsert({ src: b.src, tr: (b.tr ?? {}) as Record<string, string> })
        return send(res, 200, job.terms)
      }
      return send(res, 404, { error: 'unknown route' })
    } catch (err) {
      return send(res, 500, { error: (err as Error).message })
    }
  }

  /** /live/media/<jobId>/<file…> → files under that job's directory (HLS, recordings, subtitles). */
  const media = (req: IncomingMessage, res: ServerResponse): void => {
    if (!trusted(req)) { res.writeHead(403); res.end(); return }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const [, , , jobId, ...rest] = url.pathname.split('/')
    // Folder names are generated ids: refuse anything else (no "..", no hidden files such as keys).
    if (!/^[\w-]+$/.test(decodeURIComponent(jobId ?? '')) || rest.some(p => decodeURIComponent(p).startsWith('.'))) { res.writeHead(404); res.end(); return }
    const job = jobs.get(decodeURIComponent(jobId ?? ''))
    const root = job ? resolve(job.summary().dir) : join(config.dataDir, 'jobs', decodeURIComponent(jobId ?? ''))
    const file = normalize(join(root, ...rest.map(decodeURIComponent)))
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end(); return }
    const type = MIME[extname(file)] ?? 'application/octet-stream'
    const size = statSync(file).size
    const headers: Record<string, string | number> = { 'content-type': type, 'accept-ranges': 'bytes' }
    if (file.endsWith('.m3u8')) headers['cache-control'] = 'no-store'
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
    if (range) {
      const start = range[1] ? Number(range[1]) : 0
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 })
      createReadStream(file, { start, end }).pipe(res)
    } else {
      res.writeHead(200, { ...headers, 'content-length': size })
      if (file.endsWith('.m3u8')) res.end(readFileSync(file)); else createReadStream(file).pipe(res)
    }
  }

  ctx.effect(() => (ctx as any).webServer.register({ kind: 'prefix', path: '/live/api', handler: api }), 'dsh-live: api route')
  ctx.effect(() => (ctx as any).webServer.register({ kind: 'prefix', path: '/live/media', handler: media }), 'dsh-live: media route')
  ctx.effect(() => () => {
    for (const job of jobs.values()) void job.stop('plugin unloaded')
    whisper.stop()
  }, 'dsh-live: shutdown')
}
