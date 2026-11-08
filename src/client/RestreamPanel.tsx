import { useEffect, useState } from 'react'
import { Icon } from './icons.tsx'
import type { LiveKey } from './locales.ts'
import type { SubStyle } from './subStyle.tsx'
import { Pick } from './Pick.tsx'

type Content = 'burn' | 'clean' | 'subs'
export interface RestreamTarget { id: string; platform: string; server: string; key: string; content?: Content }
export interface RestreamStatus {
  running: boolean
  at: number
  startedAt: number
  burn: boolean
  height: number
  message?: string
  targets: { id: string; platform: string; server: string; state: 'connecting' | 'live' | 'retrying' | 'error' | 'stopped'; message?: string; since: number }[]
}

/** Platforms, in the order people in China most often push to; YouTube and Twitch have one fixed ingest address. */
export const PLATFORMS = ['bilibili', 'douyin', 'kuaishou', 'wechat', 'douyu', 'huya', 'yy', 'cc', 'youtube', 'twitch', 'custom'] as const
const FIXED: Record<string, string> = { youtube: 'rtmp://a.rtmp.youtube.com/live2', twitch: 'rtmp://live.twitch.tv/app' }

async function post(path: string, body: unknown): Promise<any> {
  const r = await fetch(`/live/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
  return j
}

const CLOCK = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = Math.floor(s % 60)
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(ss).padStart(2, '0')}`
}
const host = (s: string) => s.replace(/^[a-z]+:\/\//i, '').split('/')[0] ?? s

/**
 * The player's restream menu: saved destinations (tick the ones to push to),
 * adding one (platform, server address, stream key — copied from the
 * platform's own streaming tool), subtitles drawn in or not, picture size,
 * then start. While running, each destination shows its own state.
 */
export function RestreamPanel(props: { jobId: string; status?: RestreamStatus; now: number; style: SubStyle; t: (k: LiveKey) => string }) {
  const { jobId, status, now, style, t } = props
  const running = !!status?.running
  const [targets, setTargets] = useState<RestreamTarget[]>([])
  const [picked, setPicked] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('dsh-live.rsPicked') ?? '[]') } catch { return [] } })
  const [editing, setEditing] = useState<{ id?: string; platform: string; server: string; key: string; content: Content } | null>(null)
  const [burn, setBurn] = useState(true)
  const [height, setHeight] = useState<720 | 1080>(720)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/live/api/restream/targets').then(r => r.json()).then(j => {
      const list: RestreamTarget[] = j.targets ?? []
      setTargets(list)
      if (!list.length) setEditing({ platform: 'bilibili', server: '', key: '', content: 'burn' })
    }).catch(() => {})
  }, [])
  useEffect(() => { try { localStorage.setItem('dsh-live.rsPicked', JSON.stringify(picked)) } catch {} }, [picked])
  // The running clock ticks on its own.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setTick(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [running])
  /** Known notes from the host, in the page's language. */
  const note = (m?: string) => (m === 'ended' ? t('rs.m.ended') : m === 'no-burn' ? t('rs.m.noBurn') : m === 'stalled' ? t('rs.m.stalled') : m)

  const pname = (p: string) => t(`rs.p.${p}` as LiveKey)
  const save = async () => {
    if (!editing) return
    setBusy(true); setError('')
    try {
      const j = await post('restream/targets', { target: editing })
      const list: RestreamTarget[] = j.targets
      setTargets(list)
      const added = editing.id ?? list.at(-1)?.id
      if (added && !picked.includes(added)) setPicked(v => [...v, added])
      setEditing(null)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const remove = async (id: string) => {
    const j = await post('restream/targets', { remove: id }).catch(() => null)
    if (j) { setTargets(j.targets); setPicked(v => v.filter(x => x !== id)) }
  }
  const start = async () => {
    setBusy(true); setError('')
    try { await post('restream', { jobId, action: 'start', targets: picked.filter(id => targets.some(x => x.id === id)), from: now, burn, height, style }) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const stop = async (targetId?: string) => {
    setBusy(true)
    try { await post('restream', { jobId, action: 'stop', targetId }) } catch {} finally { setBusy(false) }
  }
  const add = async (id: string) => { await post('restream', { jobId, action: 'start', targets: [id], from: now, burn, height, style }).catch(e => setError((e as Error).message)) }

  const stateOf = (id: string) => (running ? status!.targets.find(x => x.id === id) : undefined)
  const chosen = picked.filter(id => targets.some(x => x.id === id))

  if (editing) {
    const fixed = FIXED[editing.platform]
    return (
      <div className="dshl-rs">
        <div className="rs-head">{editing.id ? t('rs.edit') : t('rs.add')}</div>
        <label className="rs-field"><span>{t('rs.platform')}</span>
          <Pick value={editing.platform} onChange={v => setEditing({ ...editing, platform: v, server: FIXED[v] ?? (FIXED[editing.platform] === editing.server ? '' : editing.server) })}
            options={PLATFORMS.map(p => ({ value: p, label: pname(p) }))} />
        </label>
        <p className="rs-hint">{t(`rs.h.${editing.platform}` as LiveKey)}</p>
        <label className="rs-field"><span>{t('rs.content')}</span>
          <Pick value={editing.content} onChange={v => setEditing({ ...editing, content: v as Content })}
            options={(['burn', 'clean', 'subs'] as const).map(c => ({ value: c, label: t(`rs.c.${c}` as LiveKey) }))} />
        </label>
        {editing.content === 'subs' && <p className="rs-hint">{t('rs.c.subs.d')}</p>}
        <label className="rs-field"><span>{t('rs.server')}</span>
          <input type="text" spellCheck={false} placeholder={fixed ?? 'rtmp://…'} value={editing.server} onChange={e => setEditing({ ...editing, server: e.target.value })} />
        </label>
        <label className="rs-field"><span>{t('rs.key')}</span>
          <input type="password" autoComplete="off" spellCheck={false} placeholder={editing.id ? t('rs.keyKeep') : t('rs.keyPh')} value={editing.key} onChange={e => setEditing({ ...editing, key: e.target.value })} />
        </label>
        {error && <p className="rs-err">{error}</p>}
        <div className="rs-actions">
          {targets.length > 0 && <button className="dshl-btn small" onClick={() => { setEditing(null); setError('') }}>{t('player.cancel')}</button>}
          <button className="dshl-btn small primary" disabled={busy || !editing.server.trim()} onClick={() => void save()}>{t('rs.save')}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="dshl-rs">
      <div className="rs-head">
        <span>{running ? t('rs.running').replace('{t}', CLOCK((Date.now() - status!.startedAt) / 1000)) : t('rs.title')}</span>
        {!running && <button className="dshl-link" onClick={() => setEditing({ platform: 'bilibili', server: '', key: '', content: 'burn' })}>+ {t('rs.add')}</button>}
      </div>
      <div className="rs-list">
        {targets.map(x => {
          const st = stateOf(x.id)
          const on = running ? !!st : picked.includes(x.id)
          return (
            <div key={x.id} className={`rs-row ${on ? 'on' : ''}`}>
              {running
                ? <span className={`rs-dot ${st?.state ?? 'off'}`} />
                : <input type="checkbox" checked={on} onChange={e => setPicked(v => e.target.checked ? [...v, x.id] : v.filter(id => id !== x.id))} />}
              <span className="rs-name">{pname(x.platform)}<small>{host(x.server)} · {t(`rs.c.${x.content ?? 'burn'}` as LiveKey)}</small></span>
              {running
                ? st
                  ? <span className={`rs-state ${st.state}`} title={st.message}>{t(`rs.s.${st.state}` as LiveKey)}</span>
                  : <button className="dshl-link" onClick={() => void add(x.id)}>{t('rs.join')}</button>
                : <span className="rs-tools">
                    <button className="ghost" title={t('rs.edit')} onClick={() => setEditing({ id: x.id, platform: x.platform, server: x.server, key: '', content: x.content ?? 'burn' })}><Icon.pencil /></button>
                    <button className="ghost" title={t('rs.remove')} onClick={() => void remove(x.id)}><Icon.close /></button>
                  </span>}
              {running && st && <button className="ghost" title={t('rs.stopOne')} onClick={() => void stop(x.id)}><Icon.close /></button>}
            </div>
          )
        })}
      </div>
      {running && status!.targets.some(x => x.state === 'error' || x.state === 'retrying') && (
        <p className="rs-err">{status!.targets.filter(x => x.message && x.state !== 'live').map(x => `${pname(x.platform)}：${x.message}`).join('；')}</p>
      )}
      {!running && (
        <div className="rs-opts">
          <span className="seg">
            {([720, 1080] as const).map(h => <button key={h} className={height === h ? 'on' : ''} onClick={() => setHeight(h)}>{h}p</button>)}
          </span>
        </div>
      )}
      {status?.message && <p className="rs-hint">{note(status.message)}</p>}
      {error && <p className="rs-err">{error}</p>}
      {running
        ? <button className="dshl-btn block rs-stop" disabled={busy} onClick={() => void stop()}>{t('rs.stop')}</button>
        : <button className="dshl-btn block primary" disabled={busy || !chosen.length} onClick={() => void start()}>
            {chosen.length ? t('rs.start').replace('{n}', String(chosen.length)) : t('rs.pick')}
          </button>}
      {!running && <p className="rs-hint">{t('rs.note')}</p>}
      <OverlayLink t={t} />
    </div>
  )
}

/** The subtitle page for OBS's Browser Source: lay the subtitles over your own picture without encoding anything. */
function OverlayLink({ t }: { t: (k: LiveKey) => string }) {
  const [url, setUrl] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => { fetch('/live/api/overlay').then(r => r.json()).then(j => setUrl(j.url ?? '')).catch(() => {}) }, [])
  if (!url) return null
  return (
    <div className="rs-overlay">
      <span className="rs-sub">{t('rs.overlay')}</span>
      <span className="rs-url"><code>{url}</code>
        <button className="dshl-link" onClick={() => void navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}>{copied ? t('tr.copied') : t('rs.copy')}</button>
      </span>
      <p className="rs-hint">{t('rs.overlay.d')}</p>
    </div>
  )
}
