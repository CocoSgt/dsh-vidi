import type { ProviderCue, SpeechProvider } from '../types.ts'
import { PauseChunker, type Chunk } from './chunker.ts'
import { Upsampler } from './openai.ts'

/** Output languages gpt-realtime-translate speaks (the input can be any of 70+). */
export const TRANSLATE_TARGETS = ['es', 'pt', 'fr', 'ja', 'ru', 'zh', 'de', 'ko', 'hi', 'id', 'vi', 'it', 'en']

export interface OpenAITranslateOptions {
  apiKey: string
  model: string
  /** One target language (the first translation line on screen). */
  target: string
  minSec: number
  maxSec: number
  log?: (msg: string) => void
  url?: string
}

/**
 * OpenAI live interpretation (gpt-realtime-translate): audio streams in, the
 * translation and the source transcript stream back as text, so no separate
 * translation pass is needed. The service has no turns of its own, so the
 * shared pause detector decides where a subtitle ends; text that arrives
 * shortly after a pause still belongs to the line before it.
 */
export class OpenAITranslateProvider implements SpeechProvider {
  readonly name = 'openai-translate'
  readonly translates = true
  private ws?: WebSocket
  private readonly chunker: PauseChunker
  private up = new Upsampler()
  private emit?: (cue: ProviderCue) => void
  private onError?: (err: Error) => void
  private stopped = false
  private reconnects = 0
  /** Text of the line being collected (source transcript and translation). */
  private src = ''
  private tr = ''
  private lineStart = 0
  private seq = 0
  /** A finished stretch of audio whose text may still be arriving. */
  private closing?: { start: number; end: number; timer: ReturnType<typeof setTimeout> }

  constructor(private readonly opts: OpenAITranslateOptions) {
    if (!TRANSLATE_TARGETS.includes(opts.target)) {
      throw new Error(`OpenAI live translation speaks only ${TRANSLATE_TARGETS.join(', ')}; choose one of these as the subtitle language, or another engine`)
    }
    this.chunker = new PauseChunker(opts.minSec, opts.maxSec, c => this.onChunk(c))
  }

  async start(emit: (cue: ProviderCue) => void, onError: (err: Error) => void): Promise<void> {
    this.emit = emit
    this.onError = onError
    await this.connect()
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = this.opts.url ?? `wss://api.openai.com/v1/realtime/translations?model=${encodeURIComponent(this.opts.model)}`
      const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${this.opts.apiKey}` } } as never)
      this.ws = ws
      let opened = false
      ws.onopen = () => {
        opened = true
        this.reconnects = 0
        this.send({
          type: 'session.update',
          session: { audio: { input: { transcription: { model: 'gpt-realtime-whisper' }, noise_reduction: { type: 'far_field' } }, output: { language: this.opts.target } } },
        })
        resolve()
      }
      ws.onmessage = ev => { try { this.onEvent(JSON.parse(String(ev.data))) } catch {} }
      ws.onerror = () => { if (!opened) reject(new Error('could not reach OpenAI live translation (check the API key and network)')) }
      ws.onclose = ev => {
        if (!opened || this.stopped || this.ws !== ws) return
        this.opts.log?.(`openai-translate: connection closed (${ev.code} ${ev.reason || ''}), reconnecting`)
        if (++this.reconnects > 5) { this.onError?.(new Error('OpenAI live translation keeps dropping')); return }
        setTimeout(() => { if (!this.stopped) this.connect().catch(err => this.onError?.(err as Error)) }, 1000 * this.reconnects)
      }
    })
  }

  private send(event: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event))
  }

  push(pcm: Buffer): void {
    if (this.stopped) return
    // Everything goes up, silence included: the service keeps its own pace.
    this.send({ type: 'session.input_audio_buffer.append', audio: this.up.push(Buffer.from(pcm)).toString('base64') })
    this.chunker.push(pcm)
  }

  backlog(): number {
    return this.closing ? this.chunker.now - this.closing.start : 0
  }

  private draft(): void {
    if (!this.src.trim() && !this.tr.trim()) return
    this.emit?.({ key: `ot:${this.seq}`, start: this.lineStart, end: Math.max(this.chunker.now, this.lineStart + 0.5), src: this.src.trim(), tr: this.tr.trim() ? { [this.opts.target]: this.tr.trim() } : undefined, final: false })
  }

  /** A pause ended a stretch: wait a moment for its last words, then finish the line. */
  private onChunk({ start, end }: Chunk): void {
    if (this.closing) this.finish()
    if (!this.src.trim() && !this.tr.trim()) { this.lineStart = end; return }
    this.lineStart = start
    this.closing = { start, end, timer: setTimeout(() => this.finish(), 1500) }
  }

  private finish(): void {
    const c = this.closing
    if (!c) return
    clearTimeout(c.timer)
    this.closing = undefined
    const src = this.src.trim(), tr = this.tr.trim()
    if (src || tr) this.emit?.({ key: `ot:${this.seq}`, start: c.start, end: Math.max(c.end, c.start + 0.5), src: src || tr, tr: tr ? { [this.opts.target]: tr } : undefined, final: true })
    this.seq++
    this.src = ''
    this.tr = ''
    this.lineStart = c.end
  }

  private onEvent(ev: { type: string; [k: string]: unknown }): void {
    switch (ev.type) {
      case 'session.input_transcript.delta':
        this.src += String(ev.delta ?? '')
        this.draft()
        break
      case 'session.output_transcript.delta':
        this.tr += String(ev.delta ?? '')
        this.draft()
        break
      case 'error': {
        const err = (ev.error ?? {}) as { message?: string }
        this.onError?.(new Error(`OpenAI: ${err.message ?? 'error'}`))
        break
      }
    }
  }

  async stop(): Promise<void> {
    this.chunker.flush(0.5)
    await new Promise(r => setTimeout(r, 1500))
    this.finish()
    this.stopped = true
    try { this.ws?.close() } catch {}
  }
}
