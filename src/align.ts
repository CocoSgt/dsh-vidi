/**
 * Does each translation sit on its own line? A model translating several lines at once sometimes
 * joins two and writes every later translation one line off. Numbers and Latin-script words
 * (names, products) survive translation as they are, so they tell which line a translation
 * belongs to.
 */

const CJK_NUM = /[〇零一二两三四五六七八九十百千万亿萬億]{2}/
const LATIN_STOP = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'you', 'are', 'was', 'not', 'but', 'have', 'from', 'they', 'what', 'ok', 'okay'])

/** The numbers in a text ("1,200" = "1200"; "5.5" stays one number). */
export function numbers(text: string): Set<string> {
  return new Set((text.match(/\d+(?:[.,]\d+)*/g) ?? []).map(n => n.replace(/,(?=\d{3}\b)/g, '').replace(/,/g, '.')))
}

/** Latin-script words of a text, lowercased (short and everyday ones left out). */
export function words(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z][a-z'’-]*[a-z]/g) ?? []).filter(w => w.length > 2 && !LATIN_STOP.has(w)))
}

const NON_LATIN = new Set(['zh', 'zh-Hant', 'ja', 'ko', 'ru', 'ar', 'hi', 'th'])

export interface AlignedLine { id: number; src: string; tr?: Record<string, string> }

/** Is this translation of line `i` more likely a neighbour's? */
function shifted(lines: AlignedLine[], i: number, lang: string): boolean {
  const me = lines[i]!, tr = me.tr?.[lang]
  if (!tr) return false
  const near = [lines[i - 1], lines[i + 1]].filter((x): x is AlignedLine => !!x)
  const srcN = numbers(me.src), trN = numbers(tr)
  // A number in the translation that the line does not have but a neighbour does.
  for (const n of trN) if (!srcN.has(n) && near.some(x => numbers(x.src).has(n))) return true
  // A number of the line that went to a neighbour's translation instead.
  for (const n of srcN) if (!trN.has(n) && near.some(x => !numbers(x.src).has(n) && numbers(x.tr?.[lang] ?? '').has(n))) return true
  // The line has a number of several digits and the translation has none at all, neither digits nor written out.
  if (srcN.size && !trN.size && !(NON_LATIN.has(lang) && CJK_NUM.test(tr)) && [...srcN].some(n => n.length > 1)) return true
  if (NON_LATIN.has(lang)) {
    // A name left in Latin letters that is a neighbour's, not this line's.
    const srcW = words(me.src)
    for (const w of words(tr)) if (!srcW.has(w) && near.some(x => words(x.src).has(w))) return true
  }
  // The same translation on two lines that say different things.
  if (near.some(x => x.tr?.[lang] === tr && x.src.trim() !== me.src.trim()) && tr.length > 4) return true
  return false
}

/**
 * The lines whose translation cannot be trusted: missing, or looking like a neighbour's. A shift
 * runs on over the following lines, so everything between the first and the last sign of one
 * (and a line either side) is included.
 */
export function suspects(lines: AlignedLine[], targets: string[]): Set<number> {
  const bad = new Set<number>()
  let first = -1, last = -1
  lines.forEach((l, i) => {
    if (targets.some(t => !l.tr?.[t]?.trim())) { bad.add(l.id); return }
    if (targets.some(t => shifted(lines, i, t))) { if (first < 0) first = i; last = i }
  })
  if (first >= 0) for (let i = Math.max(0, first - 1); i <= Math.min(lines.length - 1, last + 1); i++) bad.add(lines[i]!.id)
  return bad
}

/** A reply's ids against the lines asked for: unknown, repeated or out of order means the numbering cannot be trusted. */
export function misnumbered(asked: number[], got: number[]): boolean {
  let at = -1
  const seen = new Set<number>()
  for (const id of got) {
    const i = asked.indexOf(id)
    if (i < 0 || seen.has(id) || i < at) return true
    seen.add(id)
    at = i
  }
  return false
}

/** How alike two versions of a line are (0–1): shared words, or shared characters where there are no spaces. */
export function alike(a: string, b: string): number {
  const units = (s: string) => {
    const w = s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
    return new Set(w.length > 2 && !/[぀-鿿가-힯]/.test(s) ? w : [...s.replace(/[\s\p{P}]/gu, '')])
  }
  const x = units(a), y = units(b)
  if (!x.size || !y.size) return x.size === y.size ? 1 : 0
  let both = 0
  for (const u of x) if (y.has(u)) both++
  return both / Math.min(x.size, y.size)
}
