import { Icon } from './icons.tsx'
import type { LiveKey } from './locales.ts'

const MAX_TRANSLATIONS = 4

/**
 * Pick subtitle lines with one tap each: the original, translations, and the
 * site's own subtitle tracks. Picked chips are numbered top to bottom; one is
 * single-language, two bilingual, more multilingual. ⇅ rotates the order.
 */
export function LineChips(props: {
  lines: string[]
  onChange: (lines: string[]) => void
  /** Languages that can be added as translations. */
  options: [string, string][]
  /** The site's own tracks: key 'site:<lang>' and a label. */
  site?: { key: string; label: string }[]
  name: (key: string) => string
  t: (k: LiveKey) => string
}) {
  const { lines, onChange, options, site = [], name, t } = props
  const translations = lines.filter(l => l !== 'src' && !l.startsWith('site:'))
  const shown = ['src', ...translations, ...site.map(s => s.key)]
  const toggle = (k: string) => {
    if (lines.includes(k)) { if (lines.length > 1) onChange(lines.filter(x => x !== k)) }
    else onChange([...lines, k])
  }
  const label = (k: string) => site.find(s => s.key === k)?.label ?? name(k)
  return (
    <div className="dshl-chips">
      <div className="row">
        {shown.map(k => {
          const i = lines.indexOf(k)
          return (
            <button key={k} className={`chip ${i >= 0 ? 'on' : ''} ${k.startsWith('site:') ? 'site' : ''}`} onClick={() => toggle(k)}>
              {i >= 0 && <i>{i + 1}</i>}{label(k)}
            </button>
          )
        })}
        {translations.length < MAX_TRANSLATIONS && (
          <select className="chip add" value="" onChange={e => { if (e.target.value) onChange([...lines, e.target.value]) }} title={t('in.addLang')}>
            <option value="">{t('sub.addLang')}</option>
            {options.filter(([k]) => !lines.includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        )}
        {lines.length > 1 && (
          <button className="chip ghost" title={t('sub.swap')} onClick={() => onChange([...lines.slice(1), lines[0]!])}><Icon.swap /></button>
        )}
      </div>
    </div>
  )
}
