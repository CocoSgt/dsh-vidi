/**
 * Line breaking for subtitles drawn on a canvas (burned into clips and
 * restreams, screenshots): break where the text allows, never start a line
 * with closing punctuation, and spread the text evenly over the lines it
 * needs — so a long line wraps as two halves instead of a full line plus one
 * orphaned character.
 */

/** Characters that may not begin a line (they stay with the text before them). */
const NO_START = new Set(Array.from('，。、；：！？）》」』】〕〉”’…—,.;:!?)]}%'))

/** Where a sentence pauses: breaking right after these reads best. */
const PAUSE = '，。、；：！？,;:!? '

/** Greedy breaking at `width`: Latin text at spaces, CJK between any two characters. */
function greedy(chars: string[], width: number, measure: (s: string) => number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const ch of chars) {
    const next = cur + ch
    if (cur && measure(next) > width && !NO_START.has(ch)) {
      // Inside a Latin word: go back to the last space when there is a reasonable one.
      const sp = cur.lastIndexOf(' ')
      // A pause (punctuation or a space) in the last part of the line is the nicer place to break.
      const pause = Math.max(...Array.from(PAUSE).map(p => cur.lastIndexOf(p)))
      if (/[A-Za-z0-9]/.test(ch) && /[A-Za-z0-9]$/.test(cur) && sp > cur.length * 0.3) { lines.push(cur.slice(0, sp)); cur = cur.slice(sp + 1) + ch }
      else if (pause > cur.length * 0.6 && pause < cur.length - 1) { lines.push(cur.slice(0, pause + 1).trimEnd()); cur = cur.slice(pause + 1).trimStart() + ch }
      else { lines.push(cur.trimEnd()); cur = ch.trimStart() }
    } else cur = next
  }
  if (cur.trim()) lines.push(cur.trimEnd())
  return lines
}

/** Wrap `text` to at most `maxWidth`, using as few lines as possible, each about the same length. */
export function wrapBalanced(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const chars = Array.from(text.trim())
  const first = greedy(chars, maxWidth, measure)
  if (first.length < 2) return first
  // The narrowest width that still fits in the same number of lines evens them out.
  let lo = measure(text) / first.length * 0.9, hi = maxWidth, best = first
  for (let i = 0; i < 14 && hi - lo > 1; i++) {
    const mid = (lo + hi) / 2
    const lines = greedy(chars, mid, measure)
    if (lines.length <= first.length) { best = lines; hi = mid } else lo = mid
  }
  return atPauses(best, maxWidth, measure)
}

/** Move each break to a nearby pause (within 4 characters) when both lines still fit. */
function atPauses(lines: string[], maxWidth: number, measure: (s: string) => number): string[] {
  const out = lines.map(l => Array.from(l))
  for (let k = 0; k + 1 < out.length; k++) {
    const a = out[k]!, b = out[k + 1]!
    if (PAUSE.includes(a.at(-1) ?? '')) continue
    // Latin lines were split at a space: put it back while moving the break.
    const sep = /[\x21-\x7e]$/.test(a.join('')) && /^[\x21-\x7e]/.test(b.join('')) ? [' '] : []
    let pick: number | undefined
    for (let d = 1; d <= 4 && pick === undefined; d++) {
      for (const shift of [d, -d]) {
        // shift > 0: take characters from the next line; < 0: give some to it.
        const cut = a.length + shift
        if (cut <= 0) continue
        const joined = [...a, ...sep, ...b]
        if (cut >= joined.length) continue
        if (!PAUSE.includes(joined[cut - 1]!)) continue
        const na = joined.slice(0, cut).join('').trimEnd(), nb = joined.slice(cut).join('').trimStart()
        if (nb && measure(na) <= maxWidth && measure(nb) <= maxWidth) { pick = shift; break }
      }
    }
    if (pick !== undefined) {
      const joined = [...a, ...sep, ...b], cut = a.length + pick
      out[k] = Array.from(joined.slice(0, cut).join('').trimEnd())
      out[k + 1] = Array.from(joined.slice(cut).join('').trimStart())
    }
  }
  return out.map(l => l.join(''))
}
