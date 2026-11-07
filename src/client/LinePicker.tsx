import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons.tsx'
import type { LiveKey } from './locales.ts'

const MAX_TRANSLATIONS = 4

/**
 * Which subtitle lines to show, top to bottom. 'src' is the original speech;
 * any other key is a translation language. Original only, one translation
 * only, bilingual or several languages are all just a pick here.
 */
export function LinePicker(props: {
  lines: string[]
  onChange: (lines: string[]) => void
  options: [string, string][]
  name: (key: string) => string
  disabled?: boolean
  t: (k: LiveKey) => string
}) {
  const { lines, onChange, options, name, disabled, t } = props
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const toggle = (key: string) => {
    if (lines.includes(key)) { if (lines.length > 1) onChange(lines.filter(k => k !== key)) }
    else if (key === 'src' || lines.filter(k => k !== 'src').length < MAX_TRANSLATIONS) onChange([...lines, key])
  }
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= lines.length) return
    const next = lines.slice()
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    onChange(next)
  }

  return (
    <div className="dshl-pick" ref={box}>
      <button className="dshl-ctl" disabled={disabled} onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span className="dshl-ctl-label">{t('in.subs')}</span>
        <span>{lines.map(name).join(' · ')}</span>
        <span className="caret" />
      </button>
      {open && (
        <div className="dshl-pop pick">
          <div className="order">
            {lines.map((k, i) => (
              <div className="row" key={k}>
                <span className="n">{i + 1}</span>
                <span className="name">{name(k)}</span>
                <button className="ghost" disabled={i === 0} onClick={() => move(i, -1)} title={t('sub.up')}>↑</button>
                <button className="ghost" disabled={i === lines.length - 1} onClick={() => move(i, 1)} title={t('sub.down')}>↓</button>
                <button className="ghost" disabled={lines.length === 1} onClick={() => toggle(k)} title={t('in.remove')}><Icon.close /></button>
              </div>
            ))}
          </div>
          <div className="all">
            {[['src', name('src')] as [string, string], ...options].filter(([k]) => !lines.includes(k)).map(([k, label]) => (
              <button key={k} className="opt" onClick={() => toggle(k)}><Icon.plus /> {label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
