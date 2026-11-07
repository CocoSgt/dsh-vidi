import type { ProviderCue, SpeechProvider } from '../types.ts'
import { pcmToWav, type WhisperServer } from '../whisper.ts'
import { PauseChunker, type Chunk } from './chunker.ts'

export interface LocalOptions {
  whisper: WhisperServer
  /** Source language code or 'auto'. */
  lang: string
  /** Shortest chunk worth sending (seconds). */
  minSec: number
  /** Longest chunk before a forced cut (seconds). */
  maxSec: number
  /** Extra recogniser prompt (glossary terms), read per chunk. */
  prompt?: () => string
}

/** Drop empty lines, bracketed noise tags ([Music], (applause)) and punctuation-only lines. */
export function meaningful(text: string): boolean {
  return !!text && !/^\[.*\]$|^\(.*\)$/.test(text) && /[\p{L}\p{N}]/u.test(text)
}

/**
 * Local whisper.cpp provider. Cuts the audio at short pauses and transcribes
 * each chunk on the resident whisper-server, strictly in order; the previous
 * text and the glossary ride along as prompt for continuity.
 */
export class LocalProvider implements SpeechProvider {
  readonly name = 'local'
  readonly translates = false
  private readonly chunker: PauseChunker
  private queue: Promise<void> = Promise.resolve()
  private lastText = ''
  private emit?: (cue: ProviderCue) => void
  private onError?: (err: Error) => void
  private stopped = false

  constructor(private readonly opts: LocalOptions) {
    this.chunker = new PauseChunker(opts.minSec, opts.maxSec, c => this.transcribe(c))
  }

  async start(emit: (cue: ProviderCue) => void, onError: (err: Error) => void): Promise<void> {
    this.emit = emit
    this.onError = onError
    await this.opts.whisper.acquire()
  }

  push(pcm: Buffer): void {
    if (!this.stopped) this.chunker.push(pcm)
  }

  private transcribe({ start, end, pcm, level }: Chunk): void {
    // Skip near-silent chunks: whisper hallucinates on them ("Thank you.").
    if (level < 0.006) return
    const wav = pcmToWav(pcm)
    this.queue = this.queue.then(async () => {
      if (this.stopped) return
      try {
        const terms = this.opts.prompt?.() ?? ''
        const prompt = [terms && `Glossary: ${terms}.`, this.lastText.slice(-200)].filter(Boolean).join(' ')
        const { text, lang } = await this.opts.whisper.transcribe(wav, this.opts.lang, prompt)
        if (!meaningful(text)) return
        this.lastText = text
        this.emit?.({ start, end, src: text, lang, final: true })
      } catch (err) {
        this.onError?.(err as Error)
      }
    })
  }

  async stop(): Promise<void> {
    this.chunker.flush(1)
    await this.queue
    this.stopped = true
    this.opts.whisper.release()
  }
}
