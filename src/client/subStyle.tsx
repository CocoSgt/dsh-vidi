import type { LiveKey } from './locales.ts'

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

export function defaultStyle(targets: string[]): SubStyle {
  return {
    lines: [...targets.map((k, i) => ({ key: k, show: true, size: i === 0 ? 3.6 : 3 })), { key: 'src', show: true, size: 2.4 }],
    position: 'bottom',
    offset: 5,
    bg: 0.62,
  }
}

/** Keep saved preferences, but make sure every current target language has a line and stale ones are dropped. */
export function reconcile(style: SubStyle, targets: string[]): SubStyle {
  const want = new Set(['src', ...targets])
  const lines = style.lines.filter(l => want.has(l.key))
  for (const k of targets) if (!lines.some(l => l.key === k)) lines.splice(lines.findIndex(l => l.key === 'src'), 0, { key: k, show: true, size: 3 })
  if (!lines.some(l => l.key === 'src')) lines.push({ key: 'src', show: true, size: 2.4 })
  return { ...style, lines }
}

export function loadStyle(targets: string[]): SubStyle {
  try {
    const raw = localStorage.getItem(STORE)
    if (raw) return reconcile(JSON.parse(raw) as SubStyle, targets)
  } catch {}
  return defaultStyle(targets)
}

export function saveStyle(style: SubStyle): void {
  try { localStorage.setItem(STORE, JSON.stringify(style)) } catch {}
}

interface CueLike { src: string; tr?: Record<string, string>; final: boolean }

/** The subtitle block drawn over the video. */
export function SubtitleOverlay({ cue, style }: { cue: CueLike; style: SubStyle }) {
  const rows = style.lines.filter(l => l.show).map(l => ({ l, text: l.key === 'src' ? cue.src : cue.tr?.[l.key] })).filter(r => r.text)
  if (!rows.length) return null
  const edge = style.position === 'top' ? { top: `${style.offset}%` } : { bottom: `${style.offset}%` }
  return (
    <div className="dshl-sub" data-pos={style.position} style={{ ...edge, ['--subbg' as string]: String(style.bg) }}>
      {rows.map(({ l, text }) => (
        <div key={l.key}>
          <span className={l.key === 'src' ? `src ${cue.final ? '' : 'draft'}` : 'tgt'} style={{ fontSize: `${l.size}cqw` }}>{text}</span>
        </div>
      ))}
    </div>
  )
}

/** Settings panel: which lines, order, size per line, position, background. */
export function SubtitleSettings(props: {
  style: SubStyle
  onChange: (s: SubStyle) => void
  onReset: () => void
  langName: (key: string) => string
  t: (k: LiveKey) => string
}) {
  const { style, onChange, onReset, langName, t } = props
  const setLine = (i: number, patch: Partial<SubLine>) => onChange({ ...style, lines: style.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) })
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= style.lines.length) return
    const lines = style.lines.slice()
    ;[lines[i], lines[j]] = [lines[j]!, lines[i]!]
    onChange({ ...style, lines })
  }
  return (
    <div className="dshl-card dshl-subcfg">
      <h3>{t('sub.lines')}</h3>
      {style.lines.map((l, i) => (
        <div className="row" key={l.key}>
          <input type="checkbox" checked={l.show} onChange={e => setLine(i, { show: e.target.checked })} />
          <span>{l.key === 'src' ? t('sub.source') : langName(l.key)}</span>
          <input type="range" min={1.4} max={6} step={0.1} value={l.size} title={`${t('sub.size')} ${l.size}`} onChange={e => setLine(i, { size: Number(e.target.value) })} />
          <button className="mini" title={t('sub.up')} onClick={() => move(i, -1)}>↑</button>
          <button className="mini" title={t('sub.down')} onClick={() => move(i, 1)}>↓</button>
        </div>
      ))}
      <div className="opt">
        <span>{t('sub.position')}</span>
        <span className="dshl-seg">
          <button className={style.position === 'bottom' ? 'on' : ''} onClick={() => onChange({ ...style, position: 'bottom' })}>{t('pos.bottom')}</button>
          <button className={style.position === 'top' ? 'on' : ''} onClick={() => onChange({ ...style, position: 'top' })}>{t('pos.top')}</button>
        </span>
      </div>
      <div className="opt">
        <span>{t('sub.offset')} {style.offset}%</span>
        <input type="range" min={0} max={40} step={1} value={style.offset} onChange={e => onChange({ ...style, offset: Number(e.target.value) })} />
      </div>
      <div className="opt">
        <span>{t('sub.bg')} {Math.round(style.bg * 100)}%</span>
        <input type="range" min={0} max={1} step={0.05} value={style.bg} onChange={e => onChange({ ...style, bg: Number(e.target.value) })} />
      </div>
      <button className="dshl-btn" onClick={onReset}>{t('sub.reset')}</button>
    </div>
  )
}

export type PresetName = 'everyday' | 'present' | 'single'

/** Quick presets: everyday viewing, big presentation text, minimal single line. */
export function preset(name: PresetName, targets: string[]): SubStyle {
  const base = defaultStyle(targets)
  if (name === 'present') {
    return { ...base, offset: 6, bg: 0.78, lines: base.lines.map(l => ({ ...l, size: l.key === 'src' ? 3.4 : l.key === targets[0] ? 5.4 : 4.2 })) }
  }
  if (name === 'single') {
    return { ...base, offset: 4, bg: 0.45, lines: base.lines.map(l => ({ ...l, show: l.key === targets[0], size: 3.8 })) }
  }
  return base
}
