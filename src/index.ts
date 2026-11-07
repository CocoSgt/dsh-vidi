/**
 * dsh-live host half: live stream jobs, local/online speech providers,
 * subtitle translation through the harness model, and the HTTP surface the
 * browser half talks to (/live/api/*, /live/media/*).
 */
import { appendFileSync, createReadStream, readdirSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
import type { JobDeps } from './job.ts'
import { registerTools } from './tools.ts'
import { metered, UsageMeter } from './usage.ts'
import { EventEmitter } from 'node:events'
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
      // Subtitle work is short and literal: switch the model's thinking off where the model allows it
      // (checked once per model; models without that option are called as they are).
      const offOk = new Map<string, Promise<boolean>>()
      const canTurnOff = (provider: string, model: string): Promise<boolean> => {
        const k = `${provider}/${model}`
        if (!offOk.has(k)) {
          offOk.set(k, Promise.resolve(typeof c.llm.resolveCallConfig === 'function'
            ? c.llm.resolveCallConfig({ provider, model, reasoningEffort: 'off' }).then(() => true, () => false)
            : false))
        }
        return offOk.get(k)!
      }
      llm = {
        async *stream(opts: Record<string, unknown>) {
          const off = await canTurnOff(String(opts.provider), String(opts.model))
          yield* c.llm.stream(off ? { ...opts, reasoningEffort: 'off' } : opts)
        },
        selection: () => c.agentDefaultModel.currentSelection(),
      }
      return () => { llm = undefined }
    }, 'dsh-live: translator model')
  })
  const translator = new Translator(() => llm)

  const keys = new KeyStore(join(config.dataDir, 'keys.json'), () => ({ openai: config.openaiApiKey }))

  // Page-level preferences (which browser login to use for video sites).
  const settingsFile = join(config.dataDir, 'settings.json')
  type Prefs = { cookies: CookieChoice; last?: Pick<JobOptions, 'tgtLangs' | 'srcLang' | 'provider' | 'mode'> }
  const prefs = (): Prefs => {
    try { return { cookies: 'auto', ...JSON.parse(readFileSync(settingsFile, 'utf8')) } } catch { return { cookies: 'auto' } }
  }
  const savePrefs = (patch: Partial<Prefs>) => { try { writeFileSync(settingsFile, JSON.stringify({ ...prefs(), ...patch }, null, 2)) } catch {} }
  /** Subtitle options last used on the page: tools and commands reuse them. */
  const lastOptions = (): NonNullable<Prefs['last']> => prefs().last ?? { tgtLangs: [config.defaultTargetLang], srcLang: 'auto', provider: keys.get('openai') ? 'openai' : 'local', mode: 'realtime' }

  /** Browser notifications: "show this video" for a session (tools, /video). */
  const bus = new EventEmitter()
  bus.setMaxListeners(100)
  const downloads = new Downloads(join(config.dataDir, 'jobs'), () => prefs().cookies, log)

  function makeProvider(opts: JobOptions, glossary: Glossary, usage: UsageMeter, job?: LiveJob): SpeechProvider {
    switch (opts.provider) {
      case 'openai': {
        const apiKey = keys.get('openai')
        if (!apiKey) throw new Error('no OpenAI API key yet: add one under “Services & keys”')
        return new OpenAIProvider({
          apiKey, model: config.openaiModel, lang: opts.srcLang,
          delay: opts.mode === 'polished' ? 'high' : 'low',
          minSec: Math.max(config.minChunkSec, 2), maxSec: Math.max(config.maxChunkSec, 8),
          keywords: () => glossary.terms.map(t => t.src), log,
          onUsage: u => usage.add('openai', config.openaiModel, u),
        })
      }
      case 'local':
      default:
        return new LocalProvider({
          whisper, lang: opts.srcLang === 'auto' ? 'auto' : opts.srcLang,
          minSec: config.minChunkSec, maxSec: config.maxChunkSec, prompt: (start, end) => job ? job.asrHint(start, end, glossary.forAsr()) : (glossary.forAsr() ? `Glossary: ${glossary.forAsr()}.` : ''),
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
    await a.job.close('not needed')
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
        if (prev && prev !== job.id) void jobs.get(prev)?.close('replaced')
        byConversation.set(opts.conversationId, job.id)
      }
    })
    // Wait for the listening address.
    for (let i = 0; i < 20 && !job.ingest; i++) await new Promise(r => setTimeout(r, 50))
    return { jobId: job.id, ...job.ingest }
  }

  /** Per-job services (usage meter, translator, glossary): shared by new and restored jobs. */
  function jobDeps(dir: string, opts: JobOptions, getJob: () => LiveJob | undefined, waiting = false): JobDeps {
    let usageTimer: ReturnType<typeof setTimeout> | undefined
    const usage = new UsageMeter(() => { usageTimer ??= setTimeout(() => { usageTimer = undefined; const j = getJob(); j?.emit('state', j.summary()) }, 800) })
    const jobLlm = () => (llm ? metered(llm, usage) : undefined)
    const glossary = new Glossary(join(dir, 'glossary.json'), opts.tgtLangs, terms => getJob()?.emit('glossary', terms), log, config.glossary, join(config.dataDir, 'glossary.json'))
    return {
      dir,
      makeProvider: () => makeProvider(getJob()!.opts, glossary, usage, getJob()),
      translator: new Translator(jobLlm),
      llm: jobLlm,
      usage,
      glossary,
      log,
      ingest: { host: lanAddress(), rtmpPort: config.rtmpPort, srtPort: config.srtPort, key: waiting ? PUSH_KEY : undefined },
      cookies: () => prefs().cookies,
    }
  }

  /** The conversation's video: in memory, or the latest one on disk (after a restart). */
  function jobForConversation(conversationId: string): LiveJob | undefined {
    const id = byConversation.get(conversationId)
    if (id && jobs.has(id)) return jobs.get(id)
    const root = join(config.dataDir, 'jobs')
    if (!existsSync(root)) return undefined
    const dirs = readdirSync(root).filter(n => /^[\w-]+$/.test(n)).sort().reverse()
    for (const name of dirs) {
      const file = join(root, name, 'job.json')
      if (!existsSync(file)) continue
      try {
        const j = JSON.parse(readFileSync(file, 'utf8')) as { opts?: { conversationId?: string } }
        if (j.opts?.conversationId !== conversationId) continue
      } catch { continue }
      let job: LiveJob | undefined
      const raw = JSON.parse(readFileSync(file, 'utf8'))
      job = LiveJob.restore(join(root, name), jobDeps(join(root, name), raw.opts, () => job))
      if (!job) return undefined
      jobs.set(job.id, job)
      byConversation.set(conversationId, job.id)
      return job
    }
    return undefined
  }

  async function startJob(opts: JobOptions, waiting = false): Promise<LiveJob> {
    const prev = waiting ? undefined : byConversation.get(opts.conversationId)
    if (prev) await jobs.get(prev)?.close('replaced')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const id = `${stamp}-${Math.random().toString(36).slice(2, 6)}`
    const dir = join(config.dataDir, 'jobs', id)
    mkdirSync(dir, { recursive: true })
    let job: LiveJob | undefined
    job = new LiveJob(id, opts, jobDeps(dir, opts, () => job, waiting))
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
          deps, translator: translator.available, langs: LANGS, defaultTargetLang: config.defaultTargetLang, dataDir: config.dataDir,
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
        if (Array.isArray(b.tgtLangs)) savePrefs({ last: { tgtLangs: (b.tgtLangs as unknown[]).map(String).slice(0, 4), srcLang: typeof b.srcLang === 'string' ? b.srcLang : 'auto', provider: typeof b.provider === 'string' ? b.provider : 'local', mode: b.mode === 'polished' ? 'polished' : 'realtime' } })
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
      if (route === 'bus') {
        // One stream per browser tab: "open this video" requests from tools and commands.
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
        res.write(': ok\n\n')
        const onOpen = (m: unknown) => res.write(`event: show\ndata: ${JSON.stringify(m)}\n\n`)
        bus.on('open', onOpen)
        const ping = setInterval(() => res.write(': ping\n\n'), 25_000)
        req.on('close', () => { bus.off('open', onOpen); clearInterval(ping) })
        return
      }
      if (route === 'subs' && req.method === 'POST') {
        // { jobId, action: 'start' | 'pause', from?, srcLang?, tgtLangs?, provider?, mode? }
        const b = await readJson(req)
        const job = jobs.get(String(b.jobId))
        if (!job) return send(res, 404, { error: 'no such job' })
        if (b.action === 'pause') await job.pauseSubs()
        else {
          const opts: Partial<JobOptions> = {}
          if (Array.isArray(b.tgtLangs)) opts.tgtLangs = (b.tgtLangs as unknown[]).map(String).slice(0, 4)
          if (typeof b.srcLang === 'string') opts.srcLang = b.srcLang
          if (typeof b.provider === 'string') opts.provider = b.provider
          if (b.mode === 'realtime' || b.mode === 'polished') opts.mode = b.mode
          if (opts.provider === 'openai' && !keys.get('openai')) return send(res, 400, { error: 'no OpenAI key' })
          savePrefs({ last: { ...lastOptions(), ...opts } as NonNullable<Prefs['last']> })
          void job.startSubs(typeof b.from === 'number' ? b.from : undefined, opts)
        }
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
      if (route === 'site') {
        // The site's own subtitle track: [{start,end,text}].
        const job = jobs.get(url.searchParams.get('jobId') ?? '')
        if (!job) return send(res, 404, { error: 'no such job' })
        return send(res, 200, job.siteCues.get(url.searchParams.get('key') ?? '') ?? [])
      }
      if (route === 'snapshot' && req.method === 'POST') {
        // Raw PNG of what the player shows (picture + subtitles), saved into the video folder.
        const job = jobs.get(url.searchParams.get('jobId') ?? '')
        if (!job) return send(res, 404, { error: 'no such job' })
        const at = Number(url.searchParams.get('at') ?? 0)
        const dir = join(job.summary().dir, 'frames')
        mkdirSync(dir, { recursive: true })
        const name = `shot_${Math.floor(at / 60)}m${String(Math.floor(at % 60)).padStart(2, '0')}s_${Date.now().toString(36).slice(-4)}.png`
        const chunks: Buffer[] = []
        let size = 0
        for await (const c of req) { size += (c as Buffer).length; if (size > 30 * 1024 * 1024) return send(res, 413, { error: 'too large' }); chunks.push(c as Buffer) }
        writeFileSync(join(dir, name), Buffer.concat(chunks))
        return send(res, 200, { path: join(dir, name), url: `/live/media/${encodeURIComponent(job.id)}/frames/${encodeURIComponent(name)}` })
      }
      if (route === 'clip' && req.method === 'POST') {
        // { jobId, from, to, langs? } → MP4 in clips/ (exact cut, optional subtitle tracks).
        const b = await readJson(req)
        const job = jobs.get(String(b.jobId))
        if (!job) return send(res, 404, { error: 'no such job' })
        const from = Number(b.from), to = Number(b.to)
        if (!(to > from)) return send(res, 400, { error: 'end must be after start' })
        try {
          const path = await job.clip(from, to, Array.isArray(b.langs) ? (b.langs as unknown[]).map(String) : undefined)
          const rel = path.slice(job.summary().dir.length + 1)
          return send(res, 200, { path, url: `/live/media/${encodeURIComponent(job.id)}/${rel.split('/').map(encodeURIComponent).join('/')}` })
        } catch (err) {
          return send(res, 500, { error: String((err as { stderr?: string }).stderr || (err as Error).message).slice(-300) })
        }
      }
      if (route === 'video' && req.method === 'POST') {
        // { jobId, quality: 'original'|'recording', langs: [] (no subtitles) | ['zh','src',…], saveAs }
        const b = await readJson(req)
        const job = jobs.get(String(b.jobId))
        if (!job) return send(res, 404, { error: 'no such job' })
        const s = job.summary()
        const langs = Array.isArray(b.langs) ? (b.langs as unknown[]).map(String).filter(l => l === 'src' || s.tgtLangs.includes(l)) : []
        return send(res, 200, downloads.video({
          conversationId: String(b.conversationId ?? s.conversationId), dirId: s.id, title: s.title, url: s.source === 'url' ? s.url : undefined,
          browser: s.loginBrowser, quality: b.quality === 'recording' ? 'recording' : 'original', langs,
          cues: job.cues.filter(c => c.final), localFile: s.source === 'file' ? s.url : undefined,
          saveAs: typeof b.saveAs === 'string' ? b.saveAs.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 150) : 'video.mp4',
        }))
      }
      if (route === 'job') {
        const jid = url.searchParams.get('jobId')
        const job = jid ? jobs.get(jid) : jobForConversation(url.searchParams.get('conversationId') ?? '')
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
        if (b.op === 'remove') g.remove(String(b.src))
        else g.upsert({
          src: String(b.src), tr: (b.tr ?? {}) as Record<string, string>,
          was: typeof b.was === 'string' ? b.was : undefined,
          aliases: Array.isArray(b.aliases) ? (b.aliases as unknown[]).map(String) : undefined,
          note: typeof b.note === 'string' ? b.note : undefined,
        })
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

  registerTools(ctx, {
    dataDir: config.dataDir,
    jobFor: sid => jobForConversation(sid),
    open: async (sid, target) => {
      await disarm()
      return startJob({ ...lastOptions(), source: target.source, url: target.source === 'file' && target.url.startsWith('~') ? join(homedir(), target.url.slice(1)) : target.url, conversationId: sid })
    },
    show: (sid, jobId) => bus.emit('open', { sessionId: sid, jobId }),
    downloadOriginal: (sid, job) => {
      const s = job.summary()
      if (s.source !== 'url') return { status: 'this video is already a local file', file: s.url }
      const have = s.files.find(f => /^original\./.test(f))
      if (have) return { status: 'done', file: join(s.dir, have) }
      const task = downloads.original({ conversationId: sid, url: s.url, dirId: s.id, title: s.title, browser: s.loginBrowser })
      return { status: task.status }
    },
    subsDefaults: lastOptions,
  })

  ctx.effect(() => (ctx as any).webServer.register({ kind: 'prefix', path: '/live/api', handler: api }), 'dsh-live: api route')
  ctx.effect(() => (ctx as any).webServer.register({ kind: 'prefix', path: '/live/media', handler: media }), 'dsh-live: media route')
  ctx.effect(() => () => {
    for (const job of jobs.values()) void job.close('plugin unloaded')
    whisper.stop()
  }, 'dsh-live: shutdown')
}
