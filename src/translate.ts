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

export interface ContextLine { src: string; tgt?: string }

/**
 * Line-by-line subtitle translation through the harness's current model.
 * The previous few lines (with their translations) ride along as context so
 * pronouns, terms and split sentences stay consistent.
 */
export class Translator {
  constructor(private readonly llm: () => LlmHandle | undefined) {}

  get available(): boolean {
    return this.llm() !== undefined
  }

  async translate(target: string, line: string, context: ContextLine[], glossary = '', signal?: AbortSignal): Promise<string | undefined> {
    const handle = this.llm()
    if (!handle || !line.trim()) return undefined
    const targetName = LANGS[target] ?? target
    const system = [
      `You translate live speech subtitles into ${targetName}.`,
      'Translate only the final line. Be faithful, natural and concise, like professional subtitles.',
      'Keep product names, model names, people and company names in their original form unless a glossary says otherwise.',
      'If the line is a fragment, translate the fragment as-is; do not complete it.',
      'Output the translation only — no quotes, notes or explanations.',
    ].join(' ')
    const ctx = context.slice(-6).map(c => `- ${c.src}${c.tgt ? `\n  => ${c.tgt}` : ''}`).join('\n')
    const text = [
      glossary ? `Glossary:\n${glossary}\n` : '',
      ctx ? `Earlier lines (context, already translated):\n${ctx}\n` : '',
      `Line to translate:\n${line}`,
    ].join('\n')
    const { provider, model } = handle.selection()
    const assembler = new BlockAssembler()
    for await (const chunk of handle.stream({
      provider, model, system, maxTokens: 400, purpose: 'live-subtitle-translate', signal,
      messages: [createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'dsh-live' } })],
    })) {
      assembler.push(chunk as never)
    }
    const out = assembler.blocks()
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { type: string; text?: string }) => b.text ?? '')
      .join('')
      .trim()
    return out || undefined
  }
}
