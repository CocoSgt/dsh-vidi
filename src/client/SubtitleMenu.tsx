import type { LiveKey } from './locales.ts'
import type { SubStyle } from './subStyle.tsx'

const MAX_TRANSLATIONS = 4
/** Sizes (% of picture width) for the first line and the others, per step. */
const SIZES = { s: [2.8, 2.2], m: [3.6, 2.8], l: [4.8, 3.6] } as const
type Size = keyof typeof SIZES
const BGS = { none: 0, light: 0.4, dark: 0.75 } as const
type Bg = keyof typeof BGS

/**
 * The player's subtitle menu: a plain list of lines to show (checked = shown,
 * number = order, "move up" on hover), then size, position and background.
 */
export function SubtitleMenu(props: {
  lines: string[]
  onLines: (lines: string[]) => void
  options: [string, string][]
  site: { key: string; label: string }[]
  name: (key: string) => string
  style: SubStyle
  onStyle: (s: SubStyle) => void
  t: (k: LiveKey) => string
}) {
  const { lines, onLines, options, site, name, style, onStyle, t } = props
  const translations = lines.filter(l => l !== 'src' && !l.startsWith('site:'))
  // Shown lines first (in order), then the rest.
  const all = ['src', ...translations, ...site.map(s => s.key)]
  const rows = [...lines.filter(l => all.includes(l)), ...all.filter(k => !lines.includes(k))]
  const label = (k: string) => site.find(s => s.key === k)?.label ?? name(k)
  const toggle = (k: string) => {
    if (lines.includes(k)) { if (lines.length > 1) onLines(lines.filter(x => x !== k)) }
    else onLines([...lines, k])
  }
  const up = (k: string) => {
    const i = lines.indexOf(k)
    if (i <= 0) return
    const next = lines.slice()
    ;[next[i - 1], next[i]] = [next[i]!, next[i - 1]!]
    onLines(next)
  }
  const first = style.lines.find(l => l.show)?.size ?? SIZES.m[0]
  const size: Size = first < 3.2 ? 's' : first > 4.2 ? 'l' : 'm'
  const setSize = (z: Size) => onStyle({ ...style, lines: style.lines.map((l, i) => ({ ...l, size: SIZES[z][i === 0 ? 0 : 1] })) })
  const bg: Bg = style.bg < 0.2 ? 'none' : style.bg < 0.6 ? 'light' : 'dark'

  return (
    <div className="dshl-submenu">
      <div className="list">
        {rows.map(k => {
          const i = lines.indexOf(k)
          return (
            <div key={k} className={`row ${i >= 0 ? 'on' : ''}`}>
              <button className="pick" onClick={() => toggle(k)}>
                <span className="check" aria-hidden="true">{i >= 0 ? '✓' : ''}</span>
                <span className="name">{label(k)}</span>
              </button>
              {i > 0 && <button className="up" title={t('sub.up')} onClick={() => up(k)}>↑</button>}
              {i >= 0 && lines.length > 1 && <span className="n">{i + 1}</span>}
            </div>
          )
        })}
        {translations.length < MAX_TRANSLATIONS && (
          <label className="row add">
            <span className="check" aria-hidden="true">+</span>
            <select value="" onChange={e => { if (e.target.value) onLines([...lines, e.target.value]) }}>
              <option value="">{t('sub.addTranslation')}</option>
              {options.filter(([k]) => !lines.includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="opts">
        <div className="opt"><span>{t('sub.size')}</span>
          <span className="seg">{(['s', 'm', 'l'] as Size[]).map(z => <button key={z} className={size === z ? 'on' : ''} onClick={() => setSize(z)}>{t(`sub.size.${z}` as LiveKey)}</button>)}</span>
        </div>
        <div className="opt"><span>{t('sub.position')}</span>
          <span className="seg">
            <button className={style.position === 'bottom' ? 'on' : ''} onClick={() => onStyle({ ...style, position: 'bottom' })}>{t('pos.bottom')}</button>
            <button className={style.position === 'top' ? 'on' : ''} onClick={() => onStyle({ ...style, position: 'top' })}>{t('pos.top')}</button>
          </span>
        </div>
        <div className="opt"><span>{t('sub.bg')}</span>
          <span className="seg">{(['none', 'light', 'dark'] as Bg[]).map(b => <button key={b} className={bg === b ? 'on' : ''} onClick={() => onStyle({ ...style, bg: BGS[b] })}>{t(`sub.bg.${b}` as LiveKey)}</button>)}</span>
        </div>
      </div>
    </div>
  )
}
