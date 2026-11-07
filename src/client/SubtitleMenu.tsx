import type { LiveKey } from './locales.ts'
import type { SubStyle } from './subStyle.tsx'

/** Sizes (% of picture width) for the main line and the second line, per step. */
const SIZES = { s: [2.8, 2.2], m: [3.6, 2.8], l: [4.8, 3.6] } as const
type Size = keyof typeof SIZES
const BGS = { none: 0, light: 0.4, dark: 0.75 } as const
type Bg = keyof typeof BGS

/**
 * The player's subtitle menu: a main line (large) and an optional second
 * line (smaller), each a plain dropdown — works the same with a mouse and on
 * a phone. "None" as the second line means one language. Then size,
 * position and background.
 */
export function SubtitleMenu(props: {
  lines: string[]
  onLines: (lines: string[]) => void
  /** Languages that can be added as translations. */
  options: [string, string][]
  site: { key: string; label: string }[]
  name: (key: string) => string
  style: SubStyle
  onStyle: (s: SubStyle) => void
  t: (k: LiveKey) => string
}) {
  const { lines, onLines, options, site, name, style, onStyle, t } = props
  const main = lines[0] ?? 'src'
  const second = lines[1] ?? ''
  const label = (k: string) => site.find(s => s.key === k)?.label ?? name(k)
  // Choices: the original, languages already in use, the site's own tracks, then any other language (translated on demand).
  const inUse = lines.filter(l => l !== 'src' && !l.startsWith('site:'))
  const choices = (
    <>
      <option value="src">{label('src')}</option>
      {inUse.map(k => <option key={k} value={k}>{label(k)}</option>)}
      {site.length > 0 && <optgroup label={t('sub.siteGroup')}>{site.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</optgroup>}
      <optgroup label={t('sub.translateTo')}>
        {options.filter(([k]) => !inUse.includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </optgroup>
    </>
  )
  const setMain = (v: string) => onLines(v === second ? [v, main] : second ? [v, second] : [v])
  const setSecond = (v: string) => onLines(!v ? [main] : v === main ? [main] : [main, v])
  const first = style.lines.find(l => l.show)?.size ?? SIZES.m[0]
  const size: Size = first < 3.2 ? 's' : first > 4.2 ? 'l' : 'm'
  const setSize = (z: Size) => onStyle({ ...style, lines: style.lines.map((l, i) => ({ ...l, size: SIZES[z][i === 0 ? 0 : 1] })) })
  const bg: Bg = style.bg < 0.2 ? 'none' : style.bg < 0.6 ? 'light' : 'dark'

  return (
    <div className="dshl-submenu">
      <div className="slots">
        <label className="slot">
          <span>{t('sub.main')}</span>
          <select value={main} onChange={e => setMain(e.target.value)}>{choices}</select>
        </label>
        <label className="slot">
          <span>{t('sub.second')}</span>
          <select value={second} onChange={e => setSecond(e.target.value)}>
            <option value="">{t('sub.none')}</option>
            {choices}
          </select>
        </label>
        {second && <button className="swap" onClick={() => onLines([second, main])}>⇅ {t('sub.swapMain')}</button>}
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
