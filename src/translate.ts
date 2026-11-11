import { ask, AskError, jsonIn } from './ask.ts'
import { misnumbered, numbers, suspects, words } from './align.ts'

/** Display names used in prompts (the model understands English names best). */
export const LANGS: Record<string, string> = {
  auto: 'Auto-detect', en: 'English', zh: 'Simplified Chinese', 'zh-Hant': 'Traditional Chinese', ja: 'Japanese',
  ko: 'Korean', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', ru: 'Russian', it: 'Italian',
  ar: 'Arabic', hi: 'Hindi', id: 'Indonesian', vi: 'Vietnamese', th: 'Thai', tr: 'Turkish', nl: 'Dutch', pl: 'Polish',
}

export interface LlmHandle {
  stream(options: Record<string, unknown>): AsyncIterable<unknown>
  /** The subtitle model: translation, polishing, glossary. */
  selection(): { provider: string; model: string }
  /** A JPEG as a message image block, when the subtitle model can read images (else undefined). */
  image?(jpeg: Buffer): Promise<unknown | undefined>
}

export interface ContextLine { src: string; tr?: Record<string, string> }

export interface CallOptions { signal?: AbortSignal; log?: (msg: string) => void }

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

  async translate(targets: string[], line: string, context: ContextLine[], glossary = '', signal?: AbortSignal, reference = '', log?: (msg: string) => void): Promise<Record<string, string> | undefined> {
    const handle = this.llm()
    if (!handle) return undefined
    return translateLine(handle, targets, line, context, glossary, reference, { signal, log })
  }
}

/**
 * One line translated on its own (the lines before only as context). A reply that is really the
 * line before it (its numbers or names, not this line's) is asked for again without the context.
 */
export async function translateLine(handle: LlmHandle, targets: string[], line: string, context: ContextLine[], glossary = '', reference = '', o: CallOptions = {}): Promise<Record<string, string> | undefined> {
  if (!line.trim() || targets.length === 0) return undefined
  const names = targets.map(t => `"${t}" (${LANGS[t] ?? t})`).join(', ')
  const system = [
    `You translate live speech subtitles. Target languages: ${names}.`,
    'Translate only the final line. Be faithful, natural and concise, like professional subtitles, with normal punctuation.',
    'Follow the glossary when it covers a term. Otherwise keep brand, product and model names in their original form, and give well-known people, places and organisations their standard name in the target language.',
    'If the line is a fragment, translate the fragment as-is; do not complete it.',
    `Reply with one JSON object mapping each language code to its translation, e.g. {${targets.map(t => `"${t}": "..."`).join(', ')}} — nothing else.`,
  ].join(' ')
  const once = async (ctxLines: ContextLine[]) => {
    const ctx = ctxLines.slice(-6).map(c => `- ${c.src}${c.tr ? `\n  => ${JSON.stringify(c.tr)}` : ''}`).join('\n')
    const text = [
      glossary ? `Glossary:\n${glossary}\n` : '',
      ctx ? `Earlier lines (context, already translated — do not translate these):\n${ctx}\n` : '',
      reference ? `The video's own subtitles around this moment (from the site; may be inaccurate or misaligned — use them to fix names, terms and misheard words, not as the answer):\n${reference}\n` : '',
      `Line to translate:\n${line}`,
    ].join('\n')
    const out = await ask(handle, { system, text, maxTokens: 300 + 300 * targets.length, purpose: 'live-subtitle-translate', signal: o.signal, log: o.log })
    return parseTranslations(out.trim(), targets)
  }
  const tr = await once(context)
  const before = context.at(-1)
  if (tr && before && targets.some(t => borrowed(tr[t] ?? '', line, before.src))) {
    o.log?.('translate: the answer belongs to the line before, asking again without context')
    return await once([]) ?? tr
  }
  return tr
}

/** Does a translation carry a number or name that `other` has and its own line does not? */
function borrowed(tr: string, own: string, other: string): boolean {
  const n = numbers(own), on = numbers(other)
  for (const x of numbers(tr)) if (!n.has(x) && on.has(x)) return true
  if (/[^\x00-ɏ]/.test(tr)) {
    const w = words(own), ow = words(other)
    for (const x of words(tr)) if (!w.has(x) && ow.has(x)) return true
  }
  return false
}

export interface BatchLine { id: number; src: string }

/**
 * Translate many finished lines at once (adding a language to a video that
 * already has subtitles). Returns id → { lang: text }.
 *
 * Every line is checked against its id. A reply that cannot be read, or whose numbering is off, is
 * asked for again in two halves (then line by line); lines left out, or whose translation looks like a neighbour's,
 * are translated one at a time. A line no try could translate is simply absent from the result.
 */
export async function translateBatch(handle: LlmHandle, targets: string[], lines: BatchLine[], glossary = '', o: CallOptions = {}, depth = 0): Promise<Map<number, Record<string, string>>> {
  const res = new Map<number, Record<string, string>>()
  if (!lines.length || !targets.length) return res
  const alone = async (l: BatchLine) => {
    const i = lines.indexOf(l)
    const context = lines.slice(Math.max(0, i - 3), i).map(c => ({ src: c.src, tr: res.get(c.id) }))
    try {
      const tr = await translateLine(handle, targets, l.src, context, glossary, '', o)
      if (tr) res.set(l.id, tr); else res.delete(l.id)
    } catch (err) {
      if (o.signal?.aborted) throw err
      res.delete(l.id)
      o.log?.(`translate: line ${l.id} failed (${(err as Error).message})`)
    }
  }
  if (lines.length === 1) { await alone(lines[0]!); return res }
  const halves = async () => {
    // Halves once; if a half fails too, its lines go one at a time.
    if (depth > 0) { for (const l of lines) await alone(l); return res }
    const mid = Math.ceil(lines.length / 2)
    for (const part of [lines.slice(0, mid), lines.slice(mid)]) {
      for (const [id, tr] of await translateBatch(handle, targets, part, glossary, o, depth + 1)) res.set(id, tr)
    }
    return res
  }
  const names = targets.map(t => `"${t}" (${LANGS[t] ?? t})`).join(', ')
  const system = [
    `You translate subtitles into: ${names}. Keep each line separate (same ids), faithful, natural and concise, with normal punctuation.`,
    'One translation per id, in the same order: never join two lines into one or move part of a line to the next, even when a sentence runs across lines.',
    'Use the earlier and later lines as context. Keep brand, product and model names as they are; follow the glossary.',
    `Reply with JSON only: [{"id":1,${targets.map(t => `"${t}":"…"`).join(',')}}]`,
  ].join(' ')
  const text = [glossary ? `Glossary:\n${glossary}\n` : '', 'Lines:', JSON.stringify(lines.map(l => ({ id: l.id, src: l.src })))].filter(Boolean).join('\n')
  let out: string
  try {
    out = await ask(handle, { system, text, maxTokens: 400 + lines.length * 90 * targets.length, purpose: 'live-translate-batch', signal: o.signal, log: o.log })
  } catch (err) {
    if (o.signal?.aborted) throw err
    // The model cannot be reached: smaller pieces would only wait as long again.
    if (!(err instanceof AskError && err.empty)) { o.log?.(`translate: ${lines.length} lines failed (${(err as Error).message})`); return res }
    // It answers, but with nothing (after more room was tried): smaller pieces may still get through.
    o.log?.(`translate: ${lines.length} lines failed (${(err as Error).message}), trying smaller`)
    return halves()
  }
  const rows = jsonIn<Record<string, unknown>[]>(out, '[')
  if (!Array.isArray(rows)) { o.log?.(`translate: unreadable answer for ${lines.length} lines (${out.slice(0, 80)}), trying smaller`); return halves() }
  const ids = rows.map(r => Number(r?.id))
  if (misnumbered(lines.map(l => l.id), ids)) { o.log?.(`translate: answer numbered wrongly for ${lines.length} lines, trying smaller`); return halves() }
  for (const row of rows) {
    const tr: Record<string, string> = {}
    for (const t of targets) if (typeof row[t] === 'string' && (row[t] as string).trim()) tr[t] = (row[t] as string).trim()
    if (Object.keys(tr).length) res.set(Number(row.id), tr)
  }
  const bad = suspects(lines.map(l => ({ ...l, tr: res.get(l.id) })), targets)
  if (bad.size) {
    o.log?.(`translate: ${bad.size} of ${lines.length} lines missing or on the wrong line (ids ${[...bad].join(', ')}), translating them one by one`)
    for (const l of lines) if (bad.has(l.id)) await alone(l)
  }
  return res
}

/** Pull the JSON object out of the reply; fall back to plain text for a single target. */
export function parseTranslations(out: string, targets: string[]): Record<string, string> | undefined {
  const obj = jsonIn<Record<string, unknown>>(out, '{')
  if (obj && typeof obj === 'object') {
    const res: Record<string, string> = {}
    for (const t of targets) if (typeof obj[t] === 'string' && obj[t]) res[t] = (obj[t] as string).trim()
    if (Object.keys(res).length) return res
  }
  if (targets.length === 1 && out && !out.startsWith('{')) return { [targets[0]!]: out }
  return undefined
}
