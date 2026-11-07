/**
 * dsh-live host half: live stream jobs, local/online speech providers,
 * subtitle translation through the harness model, and the HTTP surface the
 * browser half talks to (/live/api/*, /live/media/*).
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { extname, join, normalize, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { checkDeps } from './deps.ts'
import { LiveJob } from './job.ts'
import { LocalProvider } from './providers/local.ts'
import { LANGS, Translator, type LlmHandle } from './translate.ts'
import type { JobOptions, SpeechProvider } from './types.ts'
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
}

export const Config: z<Config> = z.object({
  dataDir: z.string().default(join(homedir(), '.dsh', 'live')).description('Where recordings and subtitles are saved.'),
  whisperModel: z.string().default(join(homedir(), '.dsh', 'live', 'models', 'ggml-large-v3-turbo-q5_0.bin')).description('whisper.cpp model for local subtitles.'),
  defaultTargetLang: z.string().default('zh').description('Default subtitle translation language.'),
  minChunkSec: z.number().default(1.6).description('Local provider: shortest chunk (s).'),
  maxChunkSec: z.number().default(5).description('Local provider: longest chunk before a forced cut (s).'),
  glossary: z.string().role('textarea').default('').description('Terms to keep consistent, one per line (e.g. "Dots = Dots").'),
}) as never

const MIME: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.mp4': 'video/mp4', '.m4s': 'video/iso.segment',
  '.vtt': 'text/vtt; charset=utf-8', '.srt': 'text/plain; charset=utf-8', '.jsonl': 'text/plain; charset=utf-8',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png',
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
  const log = (msg: string): void => { if (logger?.info) logger.info(msg); else console.log(`[dsh-live] ${msg}`) }
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

  function makeProvider(opts: JobOptions): SpeechProvider {
    switch (opts.provider) {
      case 'local':
      default:
        return new LocalProvider({ whisper, lang: opts.srcLang === 'auto' ? 'auto' : opts.srcLang, minSec: config.minChunkSec, maxSec: config.maxChunkSec })
    }
  }

  async function startJob(opts: JobOptions): Promise<LiveJob> {
    const prev = byConversation.get(opts.conversationId)
    if (prev) await jobs.get(prev)?.stop('replaced by a new stream')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const id = `${stamp}-${Math.random().toString(36).slice(2, 6)}`
    const job = new LiveJob(id, opts, {
      dir: join(config.dataDir, 'jobs', id),
      provider: makeProvider(opts),
      translator,
      glossary: () => config.glossary,
      log,
    })
    jobs.set(id, job)
    byConversation.set(opts.conversationId, id)
    void job.start()
    return job
  }

  const api = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!trusted(req)) return send(res, 403, { error: 'forbidden host' })
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const route = url.pathname.replace(/^\/live\/api\/?/, '')
    try {
      if (route === 'deps') {
        return send(res, 200, { deps: await checkDeps(config.whisperModel), translator: translator.available, langs: LANGS, defaultTargetLang: config.defaultTargetLang })
      }
      if (route === 'start' && req.method === 'POST') {
        const b = await readJson(req)
        if (typeof b.url !== 'string' || !b.url.trim()) return send(res, 400, { error: 'url required' })
        const job = await startJob({
          url: b.url.trim(),
          mode: b.mode === 'polished' ? 'polished' : 'realtime',
          srcLang: typeof b.srcLang === 'string' ? b.srcLang : 'auto',
          tgtLang: typeof b.tgtLang === 'string' ? b.tgtLang : config.defaultTargetLang,
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
      if (route === 'job') {
        const id = url.searchParams.get('jobId') ?? byConversation.get(url.searchParams.get('conversationId') ?? '')
        const job = id ? jobs.get(id) : undefined
        return send(res, 200, job ? { ...job.summary(), cues: job.cues } : null)
      }
      if (route === 'events') {
        const job = jobs.get(url.searchParams.get('jobId') ?? '')
        if (!job) return send(res, 404, { error: 'no such job' })
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
        const write = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        write('state', job.summary())
        write('cues', job.cues)
        const onState = (s: unknown) => write('state', s)
        const onCue = (c: unknown) => write('cue', c)
        job.on('state', onState)
        job.on('cue', onCue)
        const ping = setInterval(() => res.write(': ping\n\n'), 15_000)
        req.on('close', () => { clearInterval(ping); job.off('state', onState); job.off('cue', onCue) })
        return
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

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/live/api', handler: api }), 'dsh-live: api route')
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/live/media', handler: media }), 'dsh-live: media route')
  ctx.effect(() => () => {
    for (const job of jobs.values()) void job.stop('plugin unloaded')
    whisper.stop()
  }, 'dsh-live: shutdown')
}
