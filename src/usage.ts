import type { LlmHandle } from './translate.ts'

export interface ModelUsage {
  provider: string
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  calls: number
}

export interface UsageSummary {
  models: ModelUsage[]
  /** Seconds of audio recognised, per engine ('local', 'openai'). */
  audio: Record<string, number>
  total: number
}

/** Token counts per model for one video, plus how much audio each speech engine handled. */
export class UsageMeter {
  private models = new Map<string, ModelUsage>()
  private audio: Record<string, number> = {}

  constructor(private readonly onChange: () => void) {}

  add(provider: string, model: string, u: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number }): void {
    const k = `${provider}/${model}`
    const m = this.models.get(k) ?? { provider, model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0 }
    m.input += u.inputTokens ?? 0
    m.output += u.outputTokens ?? 0
    m.cacheRead += u.cacheReadTokens ?? 0
    m.cacheWrite += u.cacheWriteTokens ?? 0
    m.reasoning += u.reasoningTokens ?? 0
    m.calls++
    this.models.set(k, m)
    this.onChange()
  }

  addAudio(engine: string, sec: number): void {
    this.audio[engine] = (this.audio[engine] ?? 0) + sec
  }

  summary(): UsageSummary {
    const models = [...this.models.values()]
    return { models, audio: { ...this.audio }, total: models.reduce((n, m) => n + m.input + m.output + m.cacheRead + m.cacheWrite, 0) }
  }
}

/** Wrap the harness model so every call's usage lands in the meter. */
export function metered(llm: LlmHandle, meter: UsageMeter): LlmHandle {
  return {
    selection: () => llm.selection(),
    async *stream(options: Record<string, unknown>) {
      for await (const chunk of llm.stream(options)) {
        const c = chunk as { type?: string; usage?: Record<string, number> }
        if (c.type === 'usage' && c.usage) meter.add(String(options.provider ?? ''), String(options.model ?? ''), c.usage)
        yield chunk
      }
    },
  }
}
