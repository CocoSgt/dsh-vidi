
/** One subtitle line: 'src' (original) or a target language code. */
export interface SubLine { key: string; show: boolean; /** Font size as % of player width. */ size: number }

export interface SubStyle {
  lines: SubLine[]
  position: 'bottom' | 'top'
  /** Distance from the chosen edge, % of player height. */
  offset: number
  /** Background opacity 0–1. */
  bg: number
}

const STORE = 'dsh-live.subStyle'

/** First line is the main one (largest); the original, when not first, is the smallest. */
const sizeFor = (key: string, i: number) => (i === 0 ? 3.6 : key === 'src' ? 2.4 : 3)

/** `lines`: the subtitle lines the user picked, top to bottom ('src' = original). */
export function defaultStyle(lines: string[]): SubStyle {
  return { lines: lines.map((k, i) => ({ key: k, show: true, size: sizeFor(k, i) })), position: 'bottom', offset: 5, bg: 0.62 }
}

/** Follow the picked lines and their order, keeping saved sizes for lines that stay. */
export function reconcile(style: SubStyle, lines: string[]): SubStyle {
  return {
    ...style,
    lines: lines.map((k, i) => {
      const old = style.lines.find(l => l.key === k)
      return old ? { ...old, show: true } : { key: k, show: true, size: sizeFor(k, i) }
    }),
  }
}

export function loadStyle(lines: string[]): SubStyle {
  try {
    const raw = localStorage.getItem(STORE)
    if (raw) return reconcile(JSON.parse(raw) as SubStyle, lines)
  } catch {}
  return defaultStyle(lines)
}

export function saveStyle(style: SubStyle): void {
  try { localStorage.setItem(STORE, JSON.stringify(style)) } catch {}
}

/** Text per line key for the moment on screen ('src', a language code, or 'site:<lang>'). */
export type LineTexts = Record<string, string | undefined>

/** The subtitle block drawn over the video. `draft` marks the original line while it is still being revised. */
/** Lines to draw: shown, with text, and not repeating a line above (the original and its own language). */
function visibleRows(texts: LineTexts, style: SubStyle) {
  const seen = new Set<string>()
  return style.lines.filter(l => {
    const x = texts[l.key]?.trim()
    if (!l.show || !x || seen.has(x)) return false
    seen.add(x)
    return true
  })
}

export function SubtitleOverlay({ texts, style, draft }: { texts: LineTexts; style: SubStyle; draft?: boolean }) {
  const rows = visibleRows(texts, style)
  if (!rows.length) return null
  const edge = style.position === 'top' ? { top: `${style.offset}%` } : { bottom: `${style.offset}%` }
  return (
    <div className="dshl-sub" data-pos={style.position} style={{ ...edge, ['--subbg' as string]: String(style.bg) }}>
      {rows.map((l, i) => (
        <div key={l.key}>
          <span className={`${i === 0 ? 'tgt' : 'src'} ${l.key === 'src' && draft ? 'draft' : ''} ${l.key.startsWith('site:') ? 'site' : ''}`} style={{ fontSize: `${l.size}cqw` }}>{texts[l.key]}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Draw the same subtitles onto a canvas (for screenshots): sizes are % of the
 * picture width, like the overlay's container units; lines wrap at 92% width.
 */
export function drawSubtitles(g: CanvasRenderingContext2D, W: number, H: number, texts: LineTexts, style: SubStyle): void {
  const rows = visibleRows(texts, style)
  if (!rows.length) return
  const family = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
  const blocks = rows.map((l, i) => {
    const px = (l.size / 100) * W
    g.font = `${i === 0 ? 600 : 400} ${px}px ${family}`
    const words = [...String(texts[l.key])]
    const lines: string[] = []
    let cur = ''
    for (const ch of words) {
      if (g.measureText(cur + ch).width > W * 0.88 && cur) { lines.push(cur); cur = ch.trimStart() } else cur += ch
    }
    if (cur) lines.push(cur)
    return { px, weight: i === 0 ? 600 : 400, lines, color: i === 0 ? '#ffffff' : '#e6e6e6' }
  })
  const lineH = (px: number) => px * 1.55
  const gap = (px: number) => px * 0.3
  const total = blocks.reduce((h, b, i) => h + b.lines.length * lineH(b.px) + (i ? gap(b.px) : 0), 0)
  let y = style.position === 'top' ? (style.offset / 100) * H : H - (style.offset / 100) * H - total
  blocks.forEach((b, i) => {
    if (i) y += gap(b.px)
    g.font = `${b.weight} ${b.px}px ${family}`
    for (const line of b.lines) {
      const w = g.measureText(line).width
      const padX = b.px * 0.45
      const x = (W - w) / 2
      g.fillStyle = `rgba(0,0,0,${style.bg})`
      const r = b.px * 0.22
      g.beginPath()
      g.roundRect(x - padX, y + b.px * 0.08, w + padX * 2, lineH(b.px) - b.px * 0.16, r)
      g.fill()
      g.fillStyle = b.color
      g.textBaseline = 'middle'
      g.shadowColor = 'rgba(0,0,0,.45)'
      g.shadowBlur = b.px * 0.08
      g.shadowOffsetY = b.px * 0.04
      g.fillText(line, x, y + lineH(b.px) / 2)
      g.shadowColor = 'transparent'
      y += lineH(b.px)
    }
  })
}
