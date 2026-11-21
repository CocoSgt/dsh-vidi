import { useEffect, useRef, useState } from 'react'
import type { LiveKey } from './locales.ts'

interface Dep { name: string; ok: boolean; hint?: string }
interface Step { id: string; state: 'wait' | 'run' | 'done' | 'fail' | 'skip'; detail?: string; pct?: number }
interface SetupState { running: boolean; steps: Step[]; error?: string; brewInstall?: string; finishedAt?: number }

/**
 * "Install first" with a one-click install: Vidi installs the missing tools through Homebrew and
 * downloads the subtitle model, showing each step as it goes. Without Homebrew it gives the one line
 * to paste into Terminal (that needs the computer's password, so it cannot be done from here).
 */
export function SetupNote(props: { missing: Dep[]; local: boolean; t: (k: LiveKey) => string; onDone: () => void }) {
  const { missing, local, t, onDone } = props
  const [st, setSt] = useState<SetupState | null>(null)
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const done = useRef(onDone)
  done.current = onDone

  // Follows the install from wherever it was started (this page, another window, before a reload):
  // every second while it runs, every few seconds otherwise; the page reloads what is missing when it ends.
  const was = useRef(false)
  const poll = () => {
    clearTimeout(timer.current)
    fetch('/live/api/setup').then(r => r.json()).then((s: SetupState) => {
      if (s.running || s.steps.length) setSt(s)
      if (was.current && !s.running) done.current()
      was.current = s.running
      timer.current = setTimeout(poll, s.running ? 1000 : 4000)
    }).catch(() => { timer.current = setTimeout(poll, 4000) })
  }
  useEffect(() => {
    poll()
    return () => clearTimeout(timer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const start = () => {
    setSt({ running: true, steps: [] })
    fetch('/live/api/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ local }) })
      .then(r => r.json()).then((s: SetupState) => { setSt(s); was.current = s.running; poll() })
      .catch(() => setSt({ running: false, steps: [], error: t('setup.failed') }))
  }

  const running = !!st?.running
  const failed = !running && !!st?.error
  const label = (id: string) => id === 'model' ? t('setup.model') : id === 'whisper-server' ? 'whisper-cpp' : id
  const state = (s: Step) => s.state === 'run' ? (s.detail ?? t('setup.running')) : s.state === 'done' ? t('setup.done')
    : s.state === 'fail' ? (s.detail ?? t('setup.failed')) : t('setup.wait')

  return (
    <div className="dshl-note warn dshl-setup">
      <div className="row">
        <span>{t('note.install')}</span>
        {!running && missing.map(d => <code key={d.name}>{d.hint}</code>)}
        <button className="dshl-btn small primary" disabled={running} onClick={start} title={local ? t('setup.tip') : undefined}>
          {running ? t('setup.installing') : failed ? t('setup.retry') : t('setup.go')}
        </button>
      </div>
      {st && st.steps.length > 0 && (
        <ul className="steps">
          {st.steps.map(s => (
            <li key={s.id} className={s.state}>
              <b>{label(s.id)}</b>
              <span className="detail">{state(s)}</span>
              {s.id === 'model' && s.state === 'run' && s.pct !== undefined && <span className="bar"><i style={{ width: `${s.pct}%` }} /></span>}
            </li>
          ))}
        </ul>
      )}
      {failed && st?.error === 'no-brew' && st.brewInstall && (
        <div className="row">
          <span>{t('setup.noBrew')}</span>
          <code className="cmd">{st.brewInstall}</code>
          <button className="dshl-btn small" onClick={() => void navigator.clipboard.writeText(st.brewInstall!).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}>
            {copied ? t('setup.copied') : t('setup.copy')}
          </button>
        </div>
      )}
      {failed && st?.error !== 'no-brew' && <div className="row"><span>{t('setup.failed')}: {st?.error}</span></div>}
    </div>
  )
}
