import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'

/** Display names used in prompts (the model understands English names best). */
export const LANGS: Record<string, string> = {
  auto: 'Auto-detect', en: 'English', zh: 'Simplified Chinese', 'zh-Hant': 'Traditional Chinese', ja: 'Japanese',
  ko: 'Korean', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', ru: 'Russian', it: 'Italian',
  ar: 'Arabic', hi: 'Hindi', id: 'Indonesian', vi: 'Vietnamese', th: 'Thai', tr: 'Turkish', nl: 'Dutch', pl: 'Polish',
}

export interface LlmHandle {
  stream(options: Record<string, unknown>): AsyncIterable<unknown>
  selection(): { provider: string; model: string }
}

export interface ContextLine { src: string; tr?: Record<string, string> }

/**
 * Line-by-line subtitle translation through the harness's current model.
 * One call per line returns every requested target language as JSON; the
 * previous few lines (with their translations) ride along as context so
 * pronouns, terms and split sentences stay consistent.
 */
export class Translator {
  constructor(private readonly llm: () => LlmHandle | undefined) {}

  get available(): boolean {
    return this.llm() !== undefined
  }

  async translate(targets: string[], line: string, context: ContextLine[], glossary = '', signal?: AbortSignal): Promise<Record<string, string> | undefined> {
    const handle = this.llm()
    if (!handle || !line.trim() || targets.length === 0) return undefined
    const names = targets.map(t => `"${t}" (${LANGS[t] ?? t})`).join(', ')
    const system = [
      `You translate live speech subtitles. Target languages: ${names}.`,
      'Translate only the final line. Be faithful, natural and concise, like professional subtitles.',
      'Follow the glossary when it covers a term. Otherwise keep brand, product and model names in their original form, and give well-known people, places and organisations their standard name in the target language.',
      'If the line is a fragment, translate the fragment as-is; do not complete it.',
      `Reply with one JSON object mapping each language code to its translation, e.g. {${targets.map(t => `"${t}": "..."`).join(', ')}} — nothing else.`,
    ].join(' ')
    const ctx = context.slice(-6).map(c => `- ${c.src}${c.tr ? `\n  => ${JSON.stringify(c.tr)}` : ''}`).join('\n')
    const text = [
      glossary ? `Glossary:\n${glossary}\n` : '',
      ctx ? `Earlier lines (context, already translated):\n${ctx}\n` : '',
      `Line to translate:\n${line}`,
    ].join('\n')
    const { provider, model } = handle.selection()
    const assembler = new BlockAssembler()
    for await (const chunk of handle.stream({
      provider, model, system, maxTokens: 300 + 300 * targets.length, purpose: 'live-subtitle-translate', signal,
      messages: [createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'dsh-live' } })],
    })) {
      assembler.push(chunk as never)
    }
    const out = assembler.blocks()
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { type: string; text?: string }) => b.text ?? '')
      .join('')
      .trim()
    return parseTranslations(out, targets)
  }
}

/** Pull the JSON object out of the reply; fall back to plain text for a single target. */
export function parseTranslations(out: string, targets: string[]): Record<string, string> | undefined {
  const m = out.match(/\{[\s\S]*\}/)
  if (m) {
    try {
      const obj = JSON.parse(m[0]) as Record<string, unknown>
      const res: Record<string, string> = {}
      for (const t of targets) if (typeof obj[t] === 'string' && obj[t]) res[t] = (obj[t] as string).trim()
      if (Object.keys(res).length) return res
    } catch {}
  }
  if (targets.length === 1 && out && !out.startsWith('{')) return { [targets[0]!]: out }
  return undefined
}
