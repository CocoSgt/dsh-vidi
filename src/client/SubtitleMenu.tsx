import type { LiveKey } from './locales.ts'
import type { SubStyle } from './subStyle.tsx'
import { Pick } from './Pick.tsx'

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
  const choices = [
    { value: 'src', label: label('src') },
    ...inUse.map(k => ({ value: k, label: label(k) })),
    ...site.map(s => ({ value: s.key, label: s.label, group: t('sub.siteGroup') })),
    ...options.filter(([k]) => !inUse.includes(k)).map(([k, v]) => ({ value: k, label: v, group: t('sub.translateTo') })),
  ]
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
          <Pick value={main} onChange={setMain} options={choices} />
        </label>
        <label className="slot">
          <span>{t('sub.second')}</span>
          <Pick value={second} onChange={setSecond} options={[{ value: '', label: t('sub.none') }, ...choices]} />
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
