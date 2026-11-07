import type { Context } from '@deepseek-ai/cordis'
import type { LiveJob } from './job.ts'
import type { Cue, JobOptions } from './types.ts'

/** What the tools need from the plugin. */
export interface ToolHost {
  /** The video open in a session (conversation), if any. */
  jobFor(sessionId: string): LiveJob | undefined
  /** Open a link or file for a session (no subtitles yet). */
  open(sessionId: string, target: { source: JobOptions['source']; url: string }): Promise<LiveJob>
  /** Ask the browser to show the video page / player for this session. */
  show(sessionId: string, jobId: string): void
  /** Start downloading the original of the session's video. */
  downloadOriginal(sessionId: string, job: LiveJob): { status: string; file?: string }
  /** Default subtitle options for new runs. */
  subsDefaults(): Pick<JobOptions, 'tgtLangs' | 'srcLang' | 'provider' | 'mode'>
  dataDir: string
}

type Json = Record<string, unknown>

const CLOCK = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = Math.floor(s % 60)
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(ss).padStart(2, '0')}`
}

/** Text rendering of a canonical value: the model reads JSON. */
const asText = (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 1) }]

function define(def: {
  name: string
  description: string
  params: Record<string, { type: string; description: string; enum?: string[]; items?: Json }>
  required?: string[]
  title: (args: Json) => string
  kind?: 'read' | 'edit' | 'execute' | 'fetch'
  execute: (args: Json, sessionId: string) => Promise<Json>
}) {
  return {
    name: def.name,
    description: def.description,
    parameters: { type: 'object', properties: def.params, required: def.required ?? [], additionalProperties: false },
    output: { schema: { type: 'object' }, render: asText },
    async execute(args: unknown, exec: { agent?: { id: string } }) {
      const sessionId = exec.agent?.id
      if (!sessionId) throw new Error(`${def.name} needs a conversation`)
      return def.execute((args ?? {}) as Json, String(sessionId))
    },
    presentCall(args: unknown) {
      return { card: 'generic', title: def.title((args ?? {}) as Json), kind: def.kind ?? 'read' }
    },
  }
}

const cueText = (c: Cue, langs: string[]) =>
  `[${CLOCK(c.start)}] ${langs.map(l => (l === 'src' ? c.src : c.tr?.[l])).filter(Boolean).join(' / ')}`

/**
 * Model-facing tools: the conversation beside the player can open videos,
 * read subtitles, start/pause subtitle generation, take screenshots, cut
 * clips and download originals. Files land in the video's own folder; the
 * folder path is in every result so other tools (shell, files) can take over.
 */
export function registerTools(ctx: Context, host: ToolHost): void {
  const need = (sessionId: string): LiveJob => {
    const job = host.jobFor(sessionId)
    if (!job) throw new Error('no video is open in this conversation; call live_open first')
    return job
  }
  const brief = (job: LiveJob) => {
    const s = job.summary()
    return {
      jobId: s.id, title: s.title, url: s.url, status: s.status, live: !s.vod, duration: s.duration,
      folder: s.dir, files: s.files, subtitles: s.subs, lines: s.tgtLangs.length ? [...s.tgtLangs, 'src'] : ['src'],
      tokens: s.usage?.total ?? 0,
    }
  }

  const tools = [
    define({
      name: 'live_open',
      description: 'Open a video or live stream in the video player beside this conversation (YouTube, Bilibili, any page yt-dlp supports, rtmp/srt/m3u8 URLs, or an absolute local file path). Opening only plays and records; it costs no tokens. Subtitles start separately with live_subtitles.',
      params: { target: { type: 'string', description: 'Page URL, stream URL, or absolute file path' } },
      required: ['target'],
      title: a => `Open ${String(a.target ?? '')}`,
      kind: 'fetch',
      async execute(a, sid) {
        const target = String(a.target ?? '').trim()
        const file = /^(\/|~\/)/.test(target)
        const job = await host.open(sid, { source: file ? 'file' : 'url', url: /^[a-z][a-z0-9+.-]*:\/\//i.test(target) || file ? target : `https://${target}` })
        host.show(sid, job.id)
        for (let i = 0; i < 60 && job.status === 'resolving'; i++) await new Promise(r => setTimeout(r, 500))
        return brief(job)
      },
    }),
    define({
      name: 'live_status',
      description: 'What is open in the video player of this conversation: title, live or video, length, folder and files on disk, subtitle progress, token usage.',
      params: {},
      title: () => 'Video status',
      async execute(_a, sid) { return brief(need(sid)) },
    }),
    define({
      name: 'live_transcript',
      description: 'Read finished subtitle lines of the open video, with timestamps. Filter by time range (seconds) and/or text. Lines are "src" (original) or language codes such as "zh".',
      params: {
        from: { type: 'number', description: 'Start time in seconds (default 0)' },
        to: { type: 'number', description: 'End time in seconds (default end)' },
        query: { type: 'string', description: 'Only lines containing this text (any language)' },
        lines: { type: 'array', items: { type: 'string' }, description: 'Which lines to include, e.g. ["zh","src"] (default: all)' },
        limit: { type: 'number', description: 'Max lines (default 400)' },
      },
      title: a => `Read subtitles${a.query ? ` “${String(a.query)}”` : ''}`,
      async execute(a, sid) {
        const job = need(sid)
        const langs = Array.isArray(a.lines) && a.lines.length ? (a.lines as string[]) : [...job.opts.tgtLangs, 'src']
        const rows = job.lines(Number(a.from ?? 0), a.to === undefined ? Infinity : Number(a.to), a.query ? String(a.query) : undefined)
        const limit = Math.max(1, Math.min(2000, Number(a.limit ?? 400)))
        return {
          count: rows.length, truncated: rows.length > limit, subtitlesUpTo: job.subs.at,
          text: rows.slice(0, limit).map(c => cueText(c, langs)).join('\n'),
        }
      },
    }),
    define({
      name: 'live_subtitles',
      description: 'Start, resume or pause subtitle generation for the open video. Generating uses tokens (speech recognition + translation), so only start when the user wants subtitles. "start" begins at `from` seconds (default: where it last stopped). `lines` sets which lines to produce, e.g. ["zh","src"] for Chinese + original, ["src"] for original only.',
      params: {
        action: { type: 'string', enum: ['start', 'pause'], description: 'start (or resume) / pause' },
        from: { type: 'number', description: 'Start time in seconds (start only)' },
        lines: { type: 'array', items: { type: 'string' }, description: 'Lines to produce: "src" and/or language codes' },
      },
      required: ['action'],
      title: a => (a.action === 'pause' ? 'Pause subtitles' : 'Generate subtitles'),
      kind: 'execute',
      async execute(a, sid) {
        const job = need(sid)
        if (a.action === 'pause') await job.pauseSubs()
        else {
          const d = host.subsDefaults()
          const lines = Array.isArray(a.lines) ? (a.lines as string[]) : undefined
          void job.startSubs(a.from === undefined ? undefined : Number(a.from), { ...d, ...(lines ? { tgtLangs: lines.filter(l => l !== 'src') } : { tgtLangs: job.opts.tgtLangs }) })
          await new Promise(r => setTimeout(r, 300))
        }
        return brief(job)
      },
    }),
    define({
      name: 'live_frame',
      description: 'Save a still frame of the open video at a time (seconds) as JPEG in the video folder; returns its path. Use the image-reading tool on the path to look at it.',
      params: { at: { type: 'number', description: 'Time in seconds' } },
      required: ['at'],
      title: a => `Screenshot at ${CLOCK(Number(a.at ?? 0))}`,
      kind: 'edit',
      async execute(a, sid) {
        const path = await need(sid).frame(Number(a.at ?? 0))
        return { path }
      },
    }),
    define({
      name: 'live_clip',
      description: 'Cut a clip [from, to] (seconds) of the open video into an MP4 in the video folder; returns its path. With `subtitles`, adds switchable subtitle tracks for those lines (e.g. ["zh","src"]). Uses the downloaded original when present (best quality).',
      params: {
        from: { type: 'number', description: 'Start (seconds)' },
        to: { type: 'number', description: 'End (seconds)' },
        subtitles: { type: 'array', items: { type: 'string' }, description: 'Subtitle lines to include as tracks' },
      },
      required: ['from', 'to'],
      title: a => `Clip ${CLOCK(Number(a.from ?? 0))}–${CLOCK(Number(a.to ?? 0))}`,
      kind: 'edit',
      async execute(a, sid) {
        const path = await need(sid).clip(Number(a.from), Number(a.to), Array.isArray(a.subtitles) ? (a.subtitles as string[]) : undefined)
        return { path }
      },
    }),
    define({
      name: 'live_download',
      description: 'Download the original (best quality) of the open video into its folder. Runs in the background; check live_status for the file.',
      params: {},
      title: () => 'Download original',
      kind: 'fetch',
      async execute(_a, sid) {
        const job = need(sid)
        return { ...host.downloadOriginal(sid, job), folder: job.summary().dir }
      },
    }),
  ]

  ctx.inject(['tools'], (c: any) => {
    for (const tool of tools) c.effect(() => c.tools.register(tool), `dsh-live: tool ${tool.name}`)
  })

  // Each conversation knows what is open in its player (empty when nothing is).
  ctx.inject(['systemPrompt'], (c: any) => {
    c.effect(() => c.systemPrompt.context({
      name: 'live:player',
      order: 160,
      text: (context: { agent?: { id: string } }) => {
        const id = context.agent?.id
        const job = id ? host.jobFor(String(id)) : undefined
        if (!job) return ''
        const s = job.summary()
        return [
          `Video player beside this conversation: "${s.title ?? s.url}" (${s.vod ? 'video' : 'live stream'}${s.duration ? `, ${CLOCK(s.duration)}` : ''}, ${s.status}).`,
          `Folder: ${s.dir} — recording (hls/, recording.mp4 when done), original.* when downloaded, cues.jsonl, subtitles.*.srt, transcript.*, frames/, clips/.`,
          `Subtitles: ${s.subs?.state ?? 'off'}${s.subs?.at ? ` up to ${CLOCK(s.subs.at)}` : ''}; lines ${[...s.tgtLangs, 'src'].join(', ')}.`,
          'Use the live_* tools for this video (transcript, subtitles, frame, clip, download). Put new work in the folder above, under ext/<name>/ for your own files.',
        ].join('\n')
      },
    }), 'dsh-live: player context')
  })

  // /video <link or path> in any conversation.
  ctx.inject(['commands'], (c: any) => {
    c.effect(() => c.commands.register({
      name: 'video',
      description: 'Open a video or live stream in the player',
      input: { hint: '<link or file path>' },
      async handler({ agent, rawInput }: { agent: { id: string }; rawInput: string }) {
        const target = rawInput.trim()
        if (!target) { host.show(String(agent.id), ''); return { kind: 'success', text: 'Video page opened.' } }
        try {
          const file = /^(\/|~\/)/.test(target)
          const job = await host.open(String(agent.id), { source: file ? 'file' : 'url', url: /^[a-z][a-z0-9+.-]*:\/\//i.test(target) || file ? target : `https://${target}` })
          host.show(String(agent.id), job.id)
          return { kind: 'success', text: `Opening ${target}` }
        } catch (err) {
          return { kind: 'error', text: (err as Error).message }
        }
      },
    }), 'dsh-live: /video command')
  })
}
