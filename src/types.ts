/** One subtitle cue. Times are seconds on the job's media timeline (0 = first audio sample). */
export interface Cue {
  id: number
  start: number
  end: number
  /** Source-language text. */
  src: string
  /** Translation into the target language (absent until translated). */
  tgt?: string
  /** Detected source language code, when the provider reports it. */
  lang?: string
  /** false = still being revised by the provider (draft). */
  final: boolean
}

/** What a speech provider hands back: cue text without an id yet. */
export type ProviderCue = Omit<Cue, 'id'> & { key?: string }

/** A speech provider consumes 16 kHz mono s16le PCM and emits cues. */
export interface SpeechProvider {
  readonly name: string
  /** True when the provider already returns translations (no LLM pass needed). */
  readonly translates: boolean
  start(emit: (cue: ProviderCue) => void, onError: (err: Error) => void): Promise<void>
  push(pcm: Buffer): void
  stop(): Promise<void>
}

export type Mode = 'realtime' | 'polished'

export type JobStatus = 'resolving' | 'running' | 'stopping' | 'stopped' | 'error'

export interface JobOptions {
  url: string
  mode: Mode
  /** Source language code or 'auto'. */
  srcLang: string
  /** Target language code. */
  tgtLang: string
  /** Speech provider id. */
  provider: string
  /** Conversation (session) the job belongs to. */
  conversationId: string
}

export interface JobSummary extends JobOptions {
  id: string
  status: JobStatus
  message?: string
  title?: string
  startedAt: number
  dir: string
  cueCount: number
  files: string[]
}
