/**
 * Subtitle style: a line ends without a full stop or pause mark
 * (。 ． . ｡ ， , 、 ； ; ： :), keeping ellipses, question/exclamation marks,
 * closing quotes and abbreviations such as "U.S.".
 */
export function subtitleText(text: string): string {
  let t = text.trim()
  if (/(\.\.\.|…)$/.test(t)) return t
  // Pause marks first (a line may end with "，" or "、" just like with "。").
  t = t.replace(/[，,、；;：:]+$/, '').trimEnd()
  if (/[。．｡]$/.test(t)) return t.slice(0, -1).trimEnd()
  if (/[^.\s]\.$/.test(t) && !/\b[A-Z]\.[A-Z]\.$|\b(?:Mr|Mrs|Ms|Dr|St|vs|etc|Inc|Ltd|Jr|Sr)\.$/.test(t)) return t.slice(0, -1)
  return t
}

import type { Cue } from './types.ts'

export type ExportFormat = 'srt' | 'vtt' | 'txt' | 'md'

/** Text of one cue for the chosen lines ('src' = original, else a language code), in order. */
/** Subtitle lines of a cue (subtitle style: no punctuation at the end). */
function lines(c: Cue, langs: string[]): string[] {
  return langs.map(l => subtitleText(l === 'src' ? c.src : c.tr?.[l] ?? '')).filter(Boolean)
}

const stamp = (s: number, sep: string) => {
  const ms = Math.max(0, Math.round(s * 1000))
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`
}
const clock = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = Math.floor(s % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`
}

/** Group cues into readable paragraphs: break on a pause > 2.5 s or after ~45 s. */
function paragraphs(cues: Cue[]): Cue[][] {
  const out: Cue[][] = []
  let cur: Cue[] = []
  for (const c of cues) {
    const prev = cur.at(-1)
    if (prev && (c.speaker !== prev.speaker || c.start - prev.end > 2.5 || c.end - cur[0]!.start > 45)) { out.push(cur); cur = [] }
    cur.push(c)
  }
  if (cur.length) out.push(cur)
  return out
}

/** Join text pieces: no space between CJK pieces, a space otherwise. */
function join(parts: string[]): string {
  const cjk = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/
  const joined = parts.reduce((acc, p) => (!acc ? p : cjk.test(acc.at(-1)!) && cjk.test(p[0]!) ? acc + p : `${acc} ${p}`), '')
  // Translations sometimes leave a space after full-width punctuation.
  return joined.replace(/([\u3001\u3002\uff0c\uff01\uff1f\uff1b\uff1a])\s+/g, '$1')
}

/**
 * Export finished cues. `langs` picks and orders the lines: e.g. ['src'] for
 * the original only, ['zh'] for one translation, ['zh', 'src'] bilingual,
 * ['zh', 'ja', 'src'] multilingual.
 */
export function exportCues(cues: Cue[], langs: string[], format: ExportFormat, title = ''): string {
  const rows = cues.filter(c => c.final && lines(c, langs).length)
  // Each line lasts until the next one when only a short gap lies between (no flicker while someone talks).
  const endOf = (i: number) => {
    const c = rows[i]!, n = rows[i + 1]
    const until = n && n.start - c.end <= 4 ? n.start : c.end + 0.6
    return Math.max(c.start + 0.8, Math.min(until, n ? n.start : until))
  }
  if (format === 'srt') return rows.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(endOf(i), ',')}\n${lines(c, langs).join('\n')}\n`).join('\n')
  if (format === 'vtt') return 'WEBVTT\n\n' + rows.map((c, i) => `${stamp(c.start, '.')} --> ${stamp(endOf(i), '.')}\n${lines(c, langs).join('\n')}\n`).join('\n')
  // Readable transcript: paragraphs with a timestamp, each selected language as its own paragraph block.
  const md = format === 'md'
  const head = md && title ? `# ${title}\n\n` : title ? `${title}\n\n` : ''
  return head + paragraphs(rows).map(p => {
    const who = p[0]!.speaker
    const ts = md ? `**${who ? `${who} · ` : ''}${clock(p[0]!.start)}**` : `[${who ? `${who} ` : ''}${clock(p[0]!.start)}]`
    const blocks = [...new Set(langs.map(l => join(p.map(c => (l === 'src' ? c.src : c.tr?.[l] ?? '').trim()).filter(Boolean))).filter(Boolean))]
    return md ? `${ts}\n\n${blocks.join('\n\n')}` : `${ts} ${blocks.join('\n')}`
  }).join('\n\n') + '\n'
}

/** The default set written when a job stops. */
export function defaultExports(targets: string[]): { name: string; langs: string[]; formats: ExportFormat[] }[] {
  return [
    { name: 'source', langs: ['src'], formats: ['srt', 'vtt', 'txt'] },
    ...targets.map(t => ({ name: t, langs: [t], formats: ['srt', 'vtt', 'txt'] as ExportFormat[] })),
    { name: 'multilingual', langs: [...targets, 'src'], formats: ['srt', 'vtt', 'md'] },
  ]
}
