/** One subtitle cue. Times are seconds on the job's media timeline (0 = first audio sample). */
export interface Cue {
  id: number
  start: number
  end: number
  /** Source-language text. */
  src: string
  /** Translations keyed by target language code (filled in as they arrive). */
  tr?: Record<string, string>
  /** Detected source language code, when the provider reports it. */
  lang?: string
  /** false = still being revised by the provider (draft). */
  final: boolean
  /** Re-read with context (fixed words, better translation). */
  polished?: boolean
}

/** What a speech provider hands back: cue text without an id yet. */
export type ProviderCue = Omit<Cue, 'id'> & { key?: string }

/** A speech provider consumes 16 kHz mono s16le PCM and emits cues. */
export interface SpeechProvider {
  readonly name: string
  /** Seconds of audio received but not yet turned into finished lines (used to pace videos). */
  backlog?(): number
  /** True when the provider already returns translations (no LLM pass needed). */
  readonly translates: boolean
  start(emit: (cue: ProviderCue) => void, onError: (err: Error) => void): Promise<void>
  push(pcm: Buffer): void
  stop(): Promise<void>
}

export type Mode = 'realtime' | 'polished'

export type JobStatus = 'resolving' | 'running' | 'stopping' | 'stopped' | 'error'

/** Subtitles are separate from playback: off until asked, can pause and resume. */
export type SubsState = 'off' | 'running' | 'paused' | 'done'

/** Where the media comes from. */
export type SourceKind = 'url' | 'push' | 'file'

export interface JobOptions {
  source: SourceKind
  /** url: page or stream URL. file: absolute path on this machine. push: 'rtmp' | 'srt'. */
  url: string
  mode: Mode
  /** Source language code or 'auto'. */
  srcLang: string
  /** Target language codes (one or more). */
  tgtLangs: string[]
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
  /** For push sources: where to send the stream. */
  ingest?: { rtmp?: string; srt?: string; key?: string }
  /** A video (known length, plays from the start) rather than a live stream. */
  vod?: boolean
  /** Length in seconds, when known. */
  duration?: number
  /** Browser whose saved login is being used (the OS may ask permission to read it). */
  loginBrowser?: string
  /** Set when the site needs a login no browser session provided. */
  needsLogin?: { site: string; browser?: string; detail: string }
  subs?: { state: SubsState; at: number }
  usage?: import('./usage.ts').UsageSummary
  site?: import('./sitesubs.ts').SiteTrack[]
}
