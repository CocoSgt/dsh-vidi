import type { ProviderCue, SpeechProvider } from '../types.ts'
import { pcmToWav } from '../whisper.ts'
import { PauseChunker, type Chunk } from './chunker.ts'

/** What turns one chunk of speech into text: the local whisper server or an online service. */
export interface ChunkEngine {
  /** Engine id, used for usage and logs ('local', 'gemini', 'groq'…). */
  name: string
  acquire?(): Promise<unknown>
  release?(): void
  transcribe(wav: Buffer, lang: string, prompt: string): Promise<{
    text: string
    lang?: string
    langProb?: number
    logprob?: number
    /** Timed pieces within the chunk (seconds from its start), when the service gives them. */
    segments?: { start: number; end: number; text: string }[]
  }>
}

export interface LocalOptions {
  engine: ChunkEngine
  /** Source language code or 'auto'. */
  lang: string
  /** Shortest chunk worth sending (seconds). */
  minSec: number
  /** Longest chunk before a forced cut (seconds). */
  maxSec: number
  /** Recogniser hint for a chunk (glossary terms, the site's own subtitles there); times are seconds within this run. */
  prompt?: (start: number, end: number) => string
}

/** Drop empty lines, bracketed noise tags ([Music], (applause)) and punctuation-only lines. */
export function meaningful(text: string): boolean {
  return !!text && !/^\[.*\]$|^\(.*\)$|^[♪♫\s]+$/.test(text) && /[\p{L}\p{N}]/u.test(text)
}

/** Lines speech models invent over music or silence (they come from subtitle credits in their training data). */
const HALLUCINATION = new RegExp([
  '^(музыка|рисунок|аплодисменты|смех)[.!]?$', 'продолжение следует', 'субтитры (сделал|создавал|подогнал)', 'редактор субтитров',
  '^(thank you|thanks) for watching', 'subtitles by', 'amara\\.org', '^you$', '^bye\\.?$',
  '字幕由.{0,20}提供', '^字幕(制作|翻译)[:：]', '请不吝点赞', '订阅.*(转发|打赏)', '明镜与点点', 'ご視聴ありがとうございました', 'チャンネル登録', '시청해 주셔서',
].join('|'), 'i')

/**
 * Split a long chunk's text into subtitle-sized lines at sentence ends,
 * sharing the time by length (services that give no timings).
 */
export function splitTimed(text: string, start: number, end: number): { start: number; end: number; text: string }[] {
  if (end - start < 7) return [{ start, end, text }]
  const parts = text.match(/[^.!?。！？]+[.!?。！？]+["'”’」』)）]*\s*|[^.!?。！？]+$/g)?.map(p => p.trim()).filter(Boolean) ?? [text]
  if (parts.length < 2) return [{ start, end, text }]
  const total = parts.reduce((n, p) => n + p.length, 0)
  let t = start
  return parts.map(p => {
    const d = (end - start) * p.length / total
    const piece = { start: t, end: t + d, text: p }
    t += d
    return piece
  })
}

/**
 * Chunked recognition: cuts the audio at short pauses and transcribes each
 * chunk with the engine (the resident whisper-server, or an online service),
 * strictly in order; the previous text and the glossary ride along as prompt
 * for continuity.
 */
export class LocalProvider implements SpeechProvider {
  get name(): string { return this.opts.engine.name }
  readonly translates = false
  private readonly chunker: PauseChunker
  private queue: Promise<void> = Promise.resolve()
  private lastText = ''
  private emit?: (cue: ProviderCue) => void
  private onError?: (err: Error) => void
  private stopped = false
  /** Seconds of audio cut into chunks but not transcribed yet. */
  private queuedSec = 0
  /** In auto mode, the language once speech has been recognised confidently (music can fool detection). */
  private locked?: string
  private lastShort = ''

  constructor(private readonly opts: LocalOptions) {
    this.chunker = new PauseChunker(opts.minSec, opts.maxSec, c => this.transcribe(c))
  }

  async start(emit: (cue: ProviderCue) => void, onError: (err: Error) => void): Promise<void> {
    this.emit = emit
    this.onError = onError
    await this.opts.engine.acquire?.()
  }

  push(pcm: Buffer): void {
    if (!this.stopped) this.chunker.push(pcm)
  }

  backlog(): number {
    return this.queuedSec + (this.chunker.now - this.chunker.openStart)
  }

  private transcribe({ start, end, pcm, level }: Chunk): void {
    // Skip near-silent chunks: whisper hallucinates on them ("Thank you.").
    if (level < 0.006) return
    const wav = pcmToWav(pcm)
    const sec = end - start
    this.queuedSec += sec
    this.queue = this.queue.then(async () => {
      if (this.stopped) return
      try {
        const hint = (this.opts.prompt?.(start, end) ?? '').slice(-400)
        const prompt = [hint, this.lastText.slice(-160)].filter(Boolean).join(' ')
        const lang0 = this.opts.lang === 'auto' ? (this.locked ?? 'auto') : this.opts.lang
        const { text, lang, langProb, logprob, segments } = await this.opts.engine.transcribe(wav, lang0, prompt)
        if (!meaningful(text) || HALLUCINATION.test(text.trim())) return
        // Low confidence: usually music or noise turned into words.
        if (logprob !== undefined && logprob < -1.1) return
        // Until the language is known, only accept confident detections (music scores around 0.6).
        if (lang0 === 'auto' && langProb !== undefined && langProb < 0.8) return
        // The same short line again and again is a loop, not speech.
        if (text.length < 24 && text === this.lastShort) return
        this.lastShort = text.length < 24 ? text : ''
        if (lang0 === 'auto' && lang && (langProb ?? 0) >= 0.8 && text.replace(/\s/g, '').length >= 12) this.locked = lang
        this.lastText = text
        const pieces = segments && segments.length > 1
          ? segments.filter(x => meaningful(x.text)).map(x => ({ start: start + x.start, end: Math.min(end, start + x.end), text: x.text.trim() }))
          : splitTimed(text, start, end)
        for (const p of pieces) this.emit?.({ start: p.start, end: p.end, src: p.text, lang: lang0 === 'auto' ? lang : lang0, final: true })
      } catch (err) {
        this.onError?.(err as Error)
      } finally {
        this.queuedSec -= sec
      }
    })
  }

  async stop(): Promise<void> {
    this.chunker.flush(1)
    await this.queue
    this.stopped = true
    this.opts.engine.release?.()
  }
}
