/**
 * dsh-vidi host half: live stream jobs, local/online speech providers,
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
import { exportCues, type ExportFormat } from './export.ts'
import { Glossary } from './glossary.ts'
import { LiveJob } from './job.ts'
import { Downloads } from './downloads.ts'
import { Targets } from './restream.ts'
import { KeyStore, type Credentials, type DshProvider } from './keys.ts'
import { installedBrowsers, type CookieChoice } from './sites.ts'
import { LocalProvider } from './providers/local.ts'
import { OpenAIProvider } from './providers/openai.ts'
import { dashscopeEngine, deepgramEngine, elevenLabsEngine, geminiEngine, SERVICES, service, speechServiceOf, verifyKey, volcEngine, whisperApiEngine } from './providers/cloud.ts'
import { OpenAITranslateProvider, TRANSLATE_TARGETS } from './providers/openai-translate.ts'
import { startOverlay } from './overlay.ts'
import { LANGS, Translator, type LlmHandle } from './translate.ts'
import type { JobOptions, Mode, SourceKind, SpeechProvider } from './types.ts'
import type { JobDeps } from './job.ts'
import { registerTools } from './tools.ts'
import { metered, UsageMeter } from './usage.ts'
import { listDevices } from './devices.ts'
import { accessStatus, askAccess, openPrivacySettings, type AccessKind } from './access.ts'
import { updateChecker } from './updates.ts'
import { EventEmitter } from 'node:events'
import { WhisperServer } from './whisper.ts'

export const name = 'dsh-vidi'

/** What companion plugins get from `ctx.vidi`. */
export interface VidiService {
  version: 1
  /** Where recordings, subtitles, frames and clips are kept. */
  dataDir: string
  /** The video open in a conversation (brought back from disk when needed). */
  job(conversationId: string): LiveJob | undefined
  jobById(id: string): LiveJob | undefined
  jobs(): LiveJob[]
  /** A new video was opened. Returns a function that stops listening. */
  onJob(fn: (job: LiveJob) => void): () => void
  /** The subtitle model (translation, polishing), when one is set up. */
  llm(): LlmHandle | undefined
}

export type { LiveJob } from './job.ts'
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
  overlayPort: number
  openaiApiKey: string
  openaiModel: string
  geminiModel: string
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
  overlayPort: z.number().default(19380).description('Local port of the subtitle overlay page for OBS (http://127.0.0.1:<port>/overlay).'),
  openaiApiKey: z.string().role('secret').default('').description('OpenAI API key for online subtitles. Usually not needed here: keys saved in DSH (Models page) or on the video page are used.'),
  openaiModel: z.string().default('gpt-live-transcribe').description('OpenAI realtime transcription model.'),
  geminiModel: z.string().default('auto').description('Gemini model for online subtitles ("auto" picks the newest Flash model your key can use).'),
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
  const logger = (ctx as any).logger?.('dsh-vidi')
  mkdirSync(config.dataDir, { recursive: true })
  const logFile = join(config.dataDir, 'dsh-live.log')
  const log = (msg: string): void => {
    if (logger?.info) logger.info(msg); else console.log(`[dsh-vidi] ${msg}`)
    try { appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`) } catch {}
  }
  // Encoder window: the longest chunk plus 5 s of room, in 64-frame steps (50 frames = 1 s).
  const whisper = new WhisperServer(config.whisperModel, log, Math.min(1500, Math.max(256, Math.ceil(((config.maxChunkSec + 5) * 50) / 64) * 64)))
  const jobs = new Map<string, LiveJob>()
  const byConversation = new Map<string, string>()

  // The model is optional: subtitles still work (source only) without one.
  let llm: LlmHandle | undefined
  /** DSH's model service, for listing models in the subtitle-model picker. */
  let llmService: any
  /** The default subtitle model: DeepSeek (Flash) when DSH has it, else DSH's own default model. */
  let deepseekDefault: { provider: string; model: string } | undefined
  /** Whether a model reads images (asked once per model). */
  const seesCache = new Map<string, Promise<boolean>>()
  // Images for the model go through DSH's attachment store (the way the chat sends pictures).
  let attachments: any
  ctx.inject(['attachments'], (c: any) => { c.effect(() => { attachments = c.attachments; return () => { attachments = undefined } }, 'dsh-vidi: frames for the subtitle model') })
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
        selection: () => {
          const p = prefs().subsModel
          return p?.provider && p?.model ? p : (deepseekDefault ?? c.agentDefaultModel.currentSelection())
        },
        async image(jpeg: Buffer) {
          const { provider, model } = llm!.selection()
          const k = `${provider}/${model}`
          if (!seesCache.has(k)) {
            seesCache.set(k, Promise.resolve(c.llm.listModels?.(provider)).then((ms: any[] | undefined) =>
              !!ms?.find(m => m.id === model)?.inputModalities?.includes('image'), () => false))
          }
          if (!await seesCache.get(k)) { log(`frames: ${k} reads text only`); return undefined }
          if (!attachments) { log('frames: DSH attachment store unavailable, polishing from text only'); return undefined }
          const [ref] = await attachments.saveImages([{ data: new Uint8Array(jpeg), mediaType: 'image/jpeg', name: 'frame.jpg' }])
          if (ref) log(`frames: ${model} sees a ${ref.width}×${ref.height} frame`)
          return ref ? { type: 'image', attachment: ref } : undefined
        },
      }
      llmService = c.llm
      void (async () => {
        const ds = (c.llm.listProviders?.() ?? []).find((p: { id: string }) => /deepseek/i.test(p.id))
        if (!ds) return
        const models: { id: string }[] = await Promise.resolve(c.llm.listModels(ds.id)).catch(() => [])
        const m = models.find(x => /flash/i.test(x.id)) ?? models[0]
        if (m) deepseekDefault = { provider: ds.id, model: m.id }
      })()
      return () => { llm = undefined; llmService = undefined }
    }, 'dsh-vidi: translator model')
  })
  const translator = new Translator(() => llm)

  // Online speech keys come from DSH's own key store (shared with the Models page) when the host has one.
  const restreamTargets = new Targets(join(config.dataDir, 'restream.json'))
  const keys = new KeyStore(join(config.dataDir, 'keys.json'), () => ({ openai: config.openaiApiKey }))
  // Model providers set up in DSH (Models page): the ones that also do speech recognition lend their key and address.
  keys.discover = () => {
    const loader = (ctx as any).get?.('loader') ?? (ctx as any).loader
    if (!loader?.entries) return []
    const val = (x: any) => (x && typeof x.get === 'function' ? x.get() : x)
    const out: DshProvider[] = []
    for (const row of loader.entries()) {
      if (!/llm-pi-ai$/.test(String(row.options?.name ?? ''))) continue
      const cfg = row.fiber?.effectiveConfig ?? row.options?.config ?? {}
      const providers = val(cfg.providers) ?? {}
      for (const [id, raw] of Object.entries(providers as Record<string, any>)) {
        const p = val(raw) ?? {}
        const base = typeof val(p.baseURL) === 'string' ? String(val(p.baseURL)).replace(/\/+$/, '') : undefined
        const service = speechServiceOf(id, base)
        if (service) out.push({ service, ref: val(p.apiKeyEnv), base: service === 'gemini' || service === 'openai' ? undefined : base, name: String(val(p.displayName) ?? id) })
      }
    }
    return out
  }
  void keys.refresh()
  ctx.inject(['credentials'], (c: any) => {
    c.effect(() => {
      keys.creds = c.credentials as Credentials
      void keys.refresh()
      const off = c.on?.('credentials/updated', () => void keys.refresh())
      return () => { off?.(); keys.creds = undefined; void keys.refresh() }
    }, 'dsh-vidi: speech keys')
  })
  /** Whether whisper.cpp and its model are installed (checked at start and on each deps request). */
  let localReady = false
  void checkDeps(config.whisperModel).then(d => { localReady = d.filter(x => ['ffmpeg', 'whisper-server', 'whisper model'].includes(x.name)).every(x => x.ok) })
  /** Recognition to use when nothing was chosen: this computer if it can, else the first online service with a key. */
  const defaultEngine = (): string => localReady ? 'local' : (SERVICES.find(s => keys.get(s.key))?.id ?? 'local')

  // Page-level preferences (which browser login to use for video sites).
  const settingsFile = join(config.dataDir, 'settings.json')
  type Prefs = {
    cookies: CookieChoice
    last?: Pick<JobOptions, 'tgtLangs' | 'srcLang' | 'provider' | 'mode'>
    /** Subtitle model (translation, polishing, glossary); unset = DeepSeek, else DSH's default. */
    subsModel?: { provider: string; model: string }
    /** Stream key for pushes from OBS (rtmp://<this computer>:<port>/live/<key>). */
    pushKey?: string
  }
  const prefs = (): Prefs => {
    try { return { cookies: 'auto', ...JSON.parse(readFileSync(settingsFile, 'utf8')) } } catch { return { cookies: 'auto' } }
  }
  const savePrefs = (patch: Partial<Prefs>) => { try { writeFileSync(settingsFile, JSON.stringify({ ...prefs(), ...patch }, null, 2)) } catch {} }
  /** Subtitle options last used on the page: tools and commands reuse them. */
  const lastOptions = (): NonNullable<Prefs['last']> => prefs().last ?? { tgtLangs: [config.defaultTargetLang], srcLang: 'auto', provider: defaultEngine(), mode: 'polished' }

  /** Browser notifications: "show this video" for a session (tools, /video). */
  const bus = new EventEmitter()
  bus.setMaxListeners(100)
  const downloads = new Downloads(join(config.dataDir, 'jobs'), () => prefs().cookies, log)

  function makeProvider(opts: JobOptions, glossary: Glossary, usage: UsageMeter, job?: LiveJob): SpeechProvider {
    const svc = service(opts.provider)
    if (svc) {
      if (!keys.get(svc.key)) throw new Error(`no ${svc.label} key yet: add one in the video page settings or on the DSH Models page`)
      // In step with the picture: OpenAI's live interpretation, when the subtitle language is one it speaks.
      const target = opts.tgtLangs.find(l => l !== opts.srcLang)
      if (svc.kind === 'realtime' && opts.mode === 'realtime' && target && TRANSLATE_TARGETS.includes(target)) {
        const tr = service('openai-translate')!
        log(`subtitles in step: ${tr.model} into ${target}`)
        return new OpenAITranslateProvider({ apiKey: keys.get('openai')!, model: tr.model, target, log })
      }
      if (svc.kind === 'realtime') {
        return new OpenAIProvider({
          apiKey: keys.get('openai')!, model: config.openaiModel, lang: opts.srcLang,
          delay: opts.mode === 'polished' ? 'high' : 'low',
          minSec: Math.max(config.minChunkSec, 2), maxSec: Math.max(config.maxChunkSec, 8),
          keywords: () => glossary.terms.map(t => t.src), log,
          onUsage: u => usage.add('openai', config.openaiModel, u),
        })
      }
      if (svc.kind === 'translate') {
        // Speech straight to the first translation line on screen (and the source text with it).
        const target = opts.tgtLangs[0]
        if (!target) throw new Error('OpenAI live translation needs a subtitle language to translate into')
        return new OpenAITranslateProvider({ apiKey: keys.get('openai')!, model: svc.model, target, log })
      }
      // Chunk by chunk over the network: longer chunks mean fewer requests (free tiers count them).
      const key = () => keys.get(svc.key)
      const base = keys.bases.get(svc.key) ?? svc.base
      const engine = svc.kind === 'gemini' ? geminiEngine(config.geminiModel, key, (model, u) => usage.add('gemini', model, u), log)
        : svc.kind === 'deepgram' ? deepgramEngine(svc.model, key)
          : svc.kind === 'elevenlabs' ? elevenLabsEngine(svc.model, key)
            : svc.kind === 'dashscope' ? dashscopeEngine(base!, svc.model, key)
              : svc.kind === 'volc' ? volcEngine(svc.model, key)
                : whisperApiEngine({ ...svc, base }, svc.model, key)
      return new LocalProvider({
        engine, lang: opts.srcLang === 'auto' ? 'auto' : opts.srcLang, minSec: 3, maxSec: 10,
        prompt: (start, end) => job ? job.asrHint(start, end, glossary.forAsr()) : (glossary.forAsr() ? `Glossary: ${glossary.forAsr()}.` : ''),
      })
    }
    return new LocalProvider({
      engine: { name: 'local', acquire: () => whisper.acquire(), release: () => whisper.release(), transcribe: (wav, lang, prompt) => whisper.transcribe(wav, lang, prompt) },
      lang: opts.srcLang === 'auto' ? 'auto' : opts.srcLang,
      minSec: config.minChunkSec, maxSec: config.maxChunkSec, prompt: (start, end) => job ? job.asrHint(start, end, glossary.forAsr()) : (glossary.forAsr() ? `Glossary: ${glossary.forAsr()}.` : ''),
    })
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
  // The push stream key: chosen by the user; a fresh install gets a random one, an existing one keeps the
  // old "dsh" so OBS setups made before keep working.
  const hadSettings = existsSync(settingsFile)
  const pushKey = (): string => {
    const saved = prefs().pushKey
    if (saved) return saved
    const key = hadSettings ? 'dsh' : Math.random().toString(36).slice(2, 10)
    savePrefs({ pushKey: key })
    return key
  }

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
      ingest: { host: lanAddress(), rtmpPort: config.rtmpPort, srtPort: config.srtPort, key: waiting ? pushKey() : undefined },
      cookies: () => prefs().cookies,
    }
  }

  /** The conversation's video: in memory, or the latest one on disk (after a restart). */
  function jobForConversation(conversationId: string): LiveJob | undefined {
    const id = byConversation.get(conversationId)
    if (id === '') return undefined // closed on the page
    if (id && jobs.has(id)) return jobs.get(id)
    const root = join(config.dataDir, 'jobs')
    if (!existsSync(root)) return undefined
    const dirs = readdirSync(root).filter(n => /^[\w-]+$/.test(n)).sort().reverse()
    for (const name of dirs) {
      const file = join(root, name, 'job.json')
      if (!existsSync(file) || existsSync(join(root, name, 'closed'))) continue
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

  // ('site' was the old name of 'live'.)
  const modeOf = (m: unknown): Mode => (m === 'polished' ? 'polished' : m === 'live' || m === 'site' ? 'live' : 'realtime')

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
    job.autoSubs = true
    bus.emit('job', job)
    void job.start()
    return job
  }

  const api = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!trusted(req)) return send(res, 403, { error: 'forbidden host' })
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const route = url.pathname.replace(/^\/live\/api\/?/, '')
    try {
      if (route === 'overlay') return send(res, 200, { url: `http://127.0.0.1:${config.overlayPort}/overlay`, screen: `http://127.0.0.1:${config.overlayPort}/screen`, screenLan: `http://${lanAddress()}:${config.overlayPort}/screen` })
      if (route === 'deps') {
        const [deps] = await Promise.all([checkDeps(config.whisperModel), keys.refresh()])
        localReady = deps.filter(d => ['ffmpeg', 'whisper-server', 'whisper model'].includes(d.name)).every(d => d.ok)
        return send(res, 200, {
          deps, translator: translator.available, langs: LANGS, defaultTargetLang: config.defaultTargetLang, dataDir: config.dataDir,
          providers: [
            { id: 'local', vendor: 'local', model: 'whisper-large-v3-turbo', online: false, ready: localReady },
            ...SERVICES.map(s => ({ id: s.id, vendor: s.key, model: s.modelLabel ?? s.model, label: s.label, online: true, region: s.region, ready: keys.info(s.key).set, key: keys.info(s.key), keyUrl: s.keyUrl })),
          ],
          defaultEngine: defaultEngine(),
          keysShared: !!keys.creds,
        })
      }
      if (route === 'keys' && req.method === 'POST') {
        // { name: 'gemini', key: '...' } saves (empty key removes); { name, test: true } checks the stored key.
        const b = await readJson(req)
        const svc = service(String(b.name))
        if (!svc) return send(res, 400, { error: 'unknown service' })
        if (typeof b.key === 'string') {
          const key = b.key.trim()
          if (key) {
            const check = await verifyKey(svc, key)
            if (!check.ok) return send(res, 400, { error: check.message ?? 'key rejected' })
          }
          await keys.save(svc.key, key)
          return send(res, 200, { key: keys.info(svc.key) })
        }
        const key = keys.get(svc.key)
        if (!key) return send(res, 400, { error: 'no key' })
        const check = await verifyKey(svc, key)
        return send(res, check.ok ? 200 : 400, check.ok ? { ok: true } : { error: check.message })
      }
      if (route === 'start' && req.method === 'POST') {
        const b = await readJson(req)
        if (typeof b.url !== 'string' || !b.url.trim()) return send(res, 400, { error: 'url required' })
        if (Array.isArray(b.tgtLangs)) savePrefs({ last: { tgtLangs: (b.tgtLangs as unknown[]).map(String).slice(0, 4), srcLang: typeof b.srcLang === 'string' ? b.srcLang : 'auto', provider: typeof b.provider === 'string' ? b.provider : 'local', mode: modeOf(b.mode) } })
        const source: SourceKind = b.source === 'push' || b.source === 'file' || b.source === 'device' ? b.source : 'url'
        await disarm()
        const raw = b.url.trim()
        const job = await startJob({
          source,
          url: source === 'file' && raw.startsWith('~') ? join(homedir(), raw.slice(1)) : raw,
          mode: modeOf(b.mode),
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
      if (route === 'close' && req.method === 'POST') {
        // Leave the video: stop everything for it; its files stay, and it no longer reopens with the conversation.
        const b = await readJson(req)
        const job = jobs.get(String(b.jobId))
        if (!job) return send(res, 404, { error: 'no such job' })
        await job.close('closed')
        const conv = job.summary().conversationId
        if (byConversation.get(conv) === job.id) byConversation.set(conv, '')
        try { writeFileSync(join(job.summary().dir, 'closed'), new Date().toISOString()) } catch {}
        return send(res, 200, { ok: true })
      }
      if (route === 'stop' && req.method === 'POST') {
        const b = await readJson(req)
        const job = jobs.get(String(b.jobId))
        if (!job) return send(res, 404, { error: 'no such job' })
        void job.stop()
        return send(res, 200, job.summary())
      }
      if (route === 'targets' && req.method === 'POST') {
        // { jobId, tgtLangs }: change subtitle languages; existing lines get the new ones filled in.
        const b = await readJson(req)
        const job = jobs.get(String(b.jobId))
        if (!job) return send(res, 404, { error: 'no such job' })
        const langs = Array.isArray(b.tgtLangs) ? (b.tgtLangs as unknown[]).map(String).filter(l => l in LANGS).slice(0, 4) : []
        void job.setTargets(langs)
        savePrefs({ last: { ...lastOptions(), tgtLangs: langs } })
        return send(res, 200, job.summary())
      }
      if (route === 'quality' && req.method === 'POST') {
        const b = await readJson(req)
        const job = jobs.get(String(b.jobId))
        if (!job) return send(res, 404, { error: 'no such job' })
        const h = Number(b.height)
        if (![360, 480, 720, 1080, 1440, 2160].includes(h)) return send(res, 400, { error: 'bad height' })
        void job.setQuality(h)
        return send(res, 200, job.summary())
      }
      if (route === 'activity') {
        // What is still working (for the sidebar entry): recordings, fetches, subtitle runs, downloads.
        const items = [...jobs.values()].map(j => j.summary()).filter(s => (s.status === 'running' && !s.message) || s.status === 'resolving' || s.subs?.state === 'running')
          .map(s => ({
            jobId: s.id, conversationId: s.conversationId, title: s.title,
            recording: s.status === 'running' && !s.vod, loading: (s.status === 'running' || s.status === 'resolving') && !!s.vod,
            subs: s.subs?.state, at: s.subs?.at ?? 0, duration: s.duration,
          }))
        return send(res, 200, { items, downloads: downloads.running() })
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
          if (typeof b.mode === 'string') opts.mode = modeOf(b.mode)
          const svc = opts.provider ? service(opts.provider) : undefined
          if (svc) { await keys.refresh(); if (!keys.get(svc.key)) return send(res, 400, { error: `no ${svc.label} key` }) }
          savePrefs({ last: { ...lastOptions(), ...opts } as NonNullable<Prefs['last']> })
          void job.startSubs(typeof b.from === 'number' ? b.from : undefined, opts)
        }
        return send(res, 200, job.summary())
      }
      if (route === 'version') {
        // Newer Vidi on npm? GET answers from the last check (re-checking once a day); POST checks now.
        return send(res, 200, req.method === 'POST' ? await updates.check() : updates.state())
      }
      if (route === 'update' && req.method === 'POST') {
        // Install the newer version through DSH's plugin manager (desktop: takes effect after a restart).
        return send(res, 200, await updates.install())
      }
      if (route === 'access') {
        // Camera / microphone permission of this app: read it, ask for it (system dialog), or open the settings page.
        if (req.method !== 'POST') return send(res, 200, await accessStatus())
        const b = await readJson(req)
        const kind = String(b.kind) as AccessKind
        if (b.action === 'settings') return send(res, 200, { opened: openPrivacySettings(kind) })
        if (kind !== 'camera' && kind !== 'microphone') return send(res, 400, { error: 'camera or microphone' })
        return send(res, 200, { state: await askAccess(kind) })
      }
      if (route === 'devices') {
        // Cameras, screens and microphones on this computer (for "use my camera").
        const devices = await listDevices()
        log(`devices: ${devices.filter(d => d.kind !== 'mic').length} picture, ${devices.filter(d => d.kind === 'mic').length} microphone`)
        return send(res, 200, { devices, platform: process.platform })
      }
      if (route === 'pushkey' && req.method === 'POST') {
        // { key } sets it, { random: true } makes a new one; the waiting listener restarts with it.
        if ([...jobs.values()].some(j => j.opts.source === 'push' && j.status === 'running' && !j.message)) return send(res, 409, { error: 'a stream is coming in; change the key after it ends' })
        const b = await readJson(req)
        const key = b.random ? Math.random().toString(36).slice(2, 10) : String(b.key ?? '').trim()
        if (!/^[A-Za-z0-9_-]{3,40}$/.test(key)) return send(res, 400, { error: 'use 3–40 letters, digits, - or _' })
        savePrefs({ pushKey: key })
        await disarm()
        return send(res, 200, { key })
      }
      if (route === 'arm' && req.method === 'POST') {
        const b = await readJson(req)
        return send(res, 200, await arm({
          source: 'push', url: 'rtmp', mode: modeOf(b.mode),
          srcLang: typeof b.srcLang === 'string' ? b.srcLang : 'auto',
          tgtLangs: Array.isArray(b.tgtLangs) ? (b.tgtLangs as unknown[]).map(String).slice(0, 4) : [config.defaultTargetLang],
          provider: typeof b.provider === 'string' ? b.provider : 'local', conversationId: String(b.conversationId ?? 'default'),
        }))
      }
      if (route === 'restream/targets') {
        // GET: saved destinations (keys masked). POST { target } adds/changes one, { remove: id } deletes one.
        if (req.method === 'POST') {
          const b = await readJson(req)
          try {
            if (typeof b.remove === 'string') return send(res, 200, { targets: restreamTargets.remove(b.remove) })
            return send(res, 200, { targets: restreamTargets.save((b.target ?? {}) as Record<string, string>) })
          } catch (err) { return send(res, 400, { error: (err as Error).message }) }
        }
        return send(res, 200, { targets: restreamTargets.view() })
      }
      if (route === 'restream' && req.method === 'POST') {
        // { jobId, action: 'start', targets: [ids], from, burn, style, height } | { jobId, action: 'stop', targetId? }
        const b = await readJson(req)
        const job = jobs.get(String(b.jobId))
        if (!job) return send(res, 404, { error: 'no such job' })
        if (b.action === 'stop') { await job.stopRestream(typeof b.targetId === 'string' ? b.targetId : undefined); return send(res, 200, job.summary()) }
        const ids = Array.isArray(b.targets) ? (b.targets as unknown[]).map(String) : []
        const chosen = restreamTargets.list().filter(t => ids.includes(t.id))
        if (!chosen.length) return send(res, 400, { error: 'choose where to stream first' })
        try {
          await job.startRestream(chosen, {
            from: typeof b.from === 'number' ? b.from : 0,
            burn: b.burn !== false,
            style: b.style as never,
            height: b.height === 1080 ? 1080 : 720,
          })
        } catch (err) { return send(res, 400, { error: (err as Error).message }) }
        return send(res, 200, job.summary())
      }
      if (route === 'models') {
        // The models DSH has, for the subtitle-model picker; image = it can look at frames.
        const out: { provider: string; providerName: string; model: string; name: string; image: boolean }[] = []
        for (const p of (llmService?.listProviders?.() ?? []) as { id: string; name?: string }[]) {
          const ms = await Promise.race([
            Promise.resolve(llmService.listModels(p.id)).catch(() => []),
            new Promise<never[]>(r => setTimeout(() => r([]), 4000)),
          ]) as { id: string; name?: string; inputModalities?: string[] }[]
          for (const m of ms) out.push({ provider: p.id, providerName: p.name ?? p.id, model: m.id, name: m.name ?? m.id, image: !!m.inputModalities?.includes('image') })
        }
        return send(res, 200, { models: out, current: llm?.selection(), chosen: prefs().subsModel ?? null, fallback: deepseekDefault ?? null })
      }
      if (route === 'settings') {
        if (req.method === 'POST') {
          const b = await readJson(req)
          if (b.subsModel === null) savePrefs({ subsModel: undefined })
          else if (b.subsModel && typeof b.subsModel === 'object') {
            const m = b.subsModel as { provider?: unknown; model?: unknown }
            if (typeof m.provider === 'string' && typeof m.model === 'string') savePrefs({ subsModel: { provider: m.provider, model: m.model } })
          }
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
        const list = job.siteCues.get(url.searchParams.get('key') ?? '') ?? []
        const fmt = url.searchParams.get('format')
        if (fmt === 'srt' || fmt === 'vtt' || fmt === 'txt' || fmt === 'md') {
          const text = exportCues(list.map((c, i) => ({ id: i + 1, start: c.start, end: c.end, src: c.text, final: true })), ['src'], fmt, job.summary().title)
          res.writeHead(200, { 'content-type': MIME[`.${fmt}`] ?? 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="site.${fmt}"`, 'cache-control': 'no-store' })
          res.end(text)
          return
        }
        return send(res, 200, list)
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
      if (route === 'audio' && req.method === 'POST') {
        const b = await readJson(req)
        const job = jobs.get(String(b.jobId))
        if (!job) return send(res, 404, { error: 'no such job' })
        const s = job.summary()
        return send(res, 200, downloads.audio({
          conversationId: String(b.conversationId ?? s.conversationId), dirId: s.id, title: s.title, url: s.source === 'url' ? s.url : undefined,
          browser: s.loginBrowser, localFile: s.source === 'file' ? s.url : undefined,
          saveAs: typeof b.saveAs === 'string' ? b.saveAs.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 150) : 'audio',
        }))
      }
      if (route === 'preview') {
        // The real-time picture of an own source, as a multipart JPEG stream an <img> plays directly.
        const job = jobs.get(url.searchParams.get('jobId') ?? '')
        if (!job) return send(res, 404, { error: 'no such job' })
        res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=vidiframe', 'cache-control': 'no-store', connection: 'keep-alive' })
        const write = (f: Buffer) => {
          if (res.writableLength > 2_000_000) return // a slow viewer skips frames instead of falling behind
          res.write(`--vidiframe\r\nContent-Type: image/jpeg\r\nContent-Length: ${f.length}\r\n\r\n`)
          res.write(f)
          res.write('\r\n')
        }
        if (job.lastFrame) write(job.lastFrame)
        job.on('frame', write)
        req.on('close', () => job.off('frame', write))
        return
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
        const onCues = (c: unknown) => write('cues', c)
        job.on('state', onState)
        job.on('cues', onCues)
        job.on('cue', onCue)
        job.on('glossary', onTerms)
        const ping = setInterval(() => res.write(': ping\n\n'), 15_000)
        req.on('close', () => { clearInterval(ping); job.off('state', onState); job.off('cue', onCue); job.off('glossary', onTerms); job.off('cues', onCues) })
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

  /**
   * For companion plugins (a Studio edition and the like): the jobs with their
   * tools — frames, clips with subtitles drawn in, cues and events — and the
   * subtitle model, so a companion adds its own workflow without a copy of any
   * of this. Inject 'vidi' to use it.
   */
  const vidiService: VidiService = {
    version: 1,
    dataDir: config.dataDir,
    job: conversationId => jobForConversation(conversationId),
    jobById: id => jobs.get(id),
    jobs: () => [...jobs.values()],
    onJob: fn => { bus.on('job', fn); return () => { bus.off('job', fn) } },
    llm: () => llm,
  }
  ctx.effect(() => (ctx as any).provide('vidi', vidiService), 'dsh-vidi: companion service')

  ctx.effect(() => (ctx as any).webServer.register({ kind: 'prefix', path: '/live/api', handler: api }), 'dsh-vidi: api route')
  ctx.effect(() => (ctx as any).webServer.register({ kind: 'prefix', path: '/live/media', handler: media }), 'dsh-vidi: media route')
  // Checked at start and once a day.
  let updates!: ReturnType<typeof updateChecker>
  ctx.effect(() => { updates = updateChecker(log, () => { try { return (ctx as any).get?.('pluginManager') } catch { return undefined } }); return () => updates.stop() }, 'dsh-vidi: update check')
  // Subtitles as a page for OBS's Browser Source: the newest running video's lines.
  ctx.effect(() => startOverlay(config.overlayPort, () => [...jobs.values()].filter(j => j.summary().status === 'running').at(-1) ?? [...jobs.values()].at(-1), fn => { bus.on('job', fn); return () => { bus.off('job', fn) } }, log), 'dsh-vidi: subtitle overlay')
  ctx.effect(() => () => {
    for (const job of jobs.values()) void job.close('plugin unloaded')
    whisper.stop()
  }, 'dsh-vidi: shutdown')
}
