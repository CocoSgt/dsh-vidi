import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

export interface PickOption {
  value: string
  label: string
  /** Small grey text after the label (a note such as "no key"). */
  hint?: string
  /** Options with the same group are listed under that heading. */
  group?: string
  disabled?: boolean
}

/** Theme tokens copied onto the list, so it looks like the place it opened from (light page, dark player menu). */
const TOKENS = ['--bg', '--l1', '--l2', '--ink', '--muted', '--faint', '--line', '--hover', '--accent']

/**
 * A drop-down in the page's own style, in place of the browser's <select>
 * (which draws a system menu as wide as the screen allows). The list is sized
 * to its options, scrolls when long, opens upward when there is no room
 * below, and works with the keyboard (arrows, Enter, Esc, typing a letter).
 */
export function Pick(props: {
  value: string
  options: PickOption[]
  onChange: (value: string) => void
  /** Shown when the value matches no option. */
  placeholder?: string
  disabled?: boolean
  className?: string
  title?: string
  /** Fixed label on the button instead of the chosen option (for "add …" buttons). */
  label?: string
}) {
  const { value, options, onChange, placeholder, disabled, className, title, label } = props
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [place, setPlace] = useState<CSSProperties>({})
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const chosen = options.find(o => o.value === value)
  const usable = options.map((o, i) => (o.disabled ? -1 : i)).filter(i => i >= 0)

  const close = (focus = true) => { setOpen(false); if (focus) btn.current?.focus() }
  const choose = (o: PickOption) => { if (o.disabled) return; onChange(o.value); close() }

  // Place the list under (or over) the button, at least as wide, within the window; take its colours.
  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    const cs = getComputedStyle(btn.current)
    const vars = Object.fromEntries(TOKENS.map(k => [k, cs.getPropertyValue(k).trim()]).filter(([, v]) => v))
    const room = window.innerHeight - r.bottom - 8, above = r.top - 8
    const up = room < 220 && above > room
    const maxH = Math.max(120, Math.min(320, up ? above - 4 : room - 4))
    const width = Math.min(Math.max(r.width, 180), window.innerWidth - 16)
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8)
    setPlace({ ...vars, left, width, maxHeight: maxH, ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }), fontFamily: cs.fontFamily } as CSSProperties)
    setActive(Math.max(0, options.findIndex(o => o.value === value)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Keep the active option in view; close on a click elsewhere, scrolling the page or resizing.
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }) }, [active, open])
  useEffect(() => {
    if (!open) return
    const away = (e: Event) => { if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close(false) }
    const gone = (e: Event) => { if (!list.current?.contains(e.target as Node)) close(false) }
    document.addEventListener('pointerdown', away, true)
    window.addEventListener('resize', gone)
    window.addEventListener('scroll', gone, true)
    return () => { document.removeEventListener('pointerdown', away, true); window.removeEventListener('resize', gone); window.removeEventListener('scroll', gone, true) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const onKey = (e: ReactKeyboardEvent) => {
    if (disabled) return
    const step = (d: number) => {
      const at = usable.indexOf(active)
      setActive(usable[Math.min(usable.length - 1, Math.max(0, (at < 0 ? (d > 0 ? -1 : usable.length) : at) + d))] ?? -1)
    }
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); setOpen(true) }
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); step(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(usable[0] ?? -1) }
    else if (e.key === 'End') { e.preventDefault(); setActive(usable.at(-1) ?? -1) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const o = options[active]; if (o) choose(o) }
    else if (e.key === 'Tab') close(false)
    else if (e.key.length === 1) {
      // Jump to the next option starting with the typed letter.
      const k = e.key.toLowerCase()
      const from = usable.indexOf(active)
      const hit = [...usable.slice(from + 1), ...usable.slice(0, from + 1)].find(i => options[i]!.label.toLowerCase().startsWith(k))
      if (hit !== undefined) setActive(hit)
    }
  }

  let lastGroup: string | undefined
  return (
    <>
      <button ref={btn} type="button" className={`dshl-select ${open ? 'open' : ''} ${className ?? ''}`} disabled={disabled} title={title}
        aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(v => !v)} onKeyDown={onKey}>
        <span className="v">{label ?? chosen?.label ?? placeholder ?? ''}</span>
        <i className="caret" aria-hidden="true" />
      </button>
      {open && createPortal(
        <div ref={list} className="dshl-options" role="listbox" style={place} onKeyDown={onKey}>
          {options.map((o, i) => {
            const head = o.group && o.group !== lastGroup ? <div className="grp" key={`g:${o.group}`}>{o.group}</div> : null
            lastGroup = o.group
            return [head,
              <div key={o.value} data-i={i} role="option" aria-selected={o.value === value} aria-disabled={o.disabled || undefined}
                className={`opt ${o.value === value ? 'on' : ''} ${i === active ? 'act' : ''} ${o.disabled ? 'off' : ''}`}
                onPointerEnter={() => !o.disabled && setActive(i)} onClick={() => choose(o)}>
                <span className="l">{o.label}</span>{o.hint && <span className="h">{o.hint}</span>}
                {o.value === value && <svg className="ok" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
              </div>]
          })}
        </div>,
        // In full screen only the full-screen element is drawn: put the list inside it.
        document.fullscreenElement ?? document.body,
      )}
    </>
  )
}
