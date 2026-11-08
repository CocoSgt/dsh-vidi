import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons.tsx'
import type { LiveKey } from './locales.ts'
import { Pick } from './Pick.tsx'
import type { DubView } from './dub.ts'

export interface VoiceList {
  vendors: string[]
  presets: { id: string; vendor: string; label: string }[]
  mine: { id: string; vendor: string; label: string; ready: boolean }[]
  clone: string[]
  readAloud: string
}

async function post(path: string, body: unknown): Promise<any> {
  const r = await fetch(`/live/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
  return j
}

export function useVoices(ui: 'en' | 'zh') {
  const [list, setList] = useState<VoiceList | null>(null)
  const reload = () => fetch(`/live/api/voices?ui=${ui}`).then(r => r.json()).then(setList).catch(() => {})
  useEffect(() => { void reload() }, [ui])
  return { list, reload }
}

const VENDOR_NAMES: Record<string, string> = { openai: 'OpenAI', siliconflow: 'SiliconFlow', gemini: 'Gemini', elevenlabs: 'ElevenLabs' }
const vendorName = (v: string, t: (k: LiveKey) => string) => (v === 'siliconflow' ? t('dub.sf') : VENDOR_NAMES[v] ?? v)

/** One test sentence at a time, played right here. */
function useTry() {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const play = async (voice: string, lang: string) => {
    audio.current?.pause()
    setBusy(voice); setError('')
    try {
      const r = await fetch('/live/api/voices/try', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ voice, lang }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
      const url = URL.createObjectURL(await r.blob())
      const a = new Audio(url)
      audio.current = a
      a.onended = () => URL.revokeObjectURL(url)
      await a.play()
    } catch (e) { setError((e as Error).message) }
    setBusy(null)
  }
  useEffect(() => () => audio.current?.pause(), [])
  return { play, busy, error }
}

/**
 * The player's voiceover menu: switch it on, which subtitle language is
 * spoken, with which voice (try it), and what happens to the original sound.
 */
export function DubMenu(props: {
  jobId: string
  view: DubView | null
  /** Subtitle languages the video has (the voice speaks one of them). */
  langs: { value: string; label: string }[]
  voices: VoiceList | null
  onMake: () => void
  at: number
  t: (k: LiveKey) => string
}) {
  const { jobId, view, langs, voices, onMake, at, t } = props
  const [error, setError] = useState('')
  const tryer = useTry()
  const set = async (patch: Record<string, unknown>) => {
    setError('')
    try { await post('dub', { jobId, at, ...patch }) } catch (e) { setError((e as Error).message) }
  }
  if (!view) return null
  const none = voices && !voices.vendors.length
  const options = [
    ...(voices?.mine ?? []).map(v => ({ value: v.id, label: v.label, hint: vendorName(v.vendor, t), group: t('dub.mine'), disabled: !v.ready })),
    ...(voices?.presets ?? []).map(v => ({ value: v.id, label: v.label, group: vendorName(v.vendor, t) })),
  ]
  const lang = langs.some(l => l.value === view.lang) ? view.lang : langs[0]?.value ?? view.lang
  return (
    <div className="dshl-submenu dshl-dubmenu">
      <button className={`dshl-switchrow ${view.on ? 'on' : ''}`} disabled={!view.on && (!!none || !langs.length)} onClick={() => void set({ on: !view.on, lang })}>
        <span className="n">{t('dub.enable')}</span>
        <span className="sw" aria-hidden><i /></span>
      </button>
      {none ? <p className="mt">{t('dub.noKey')}</p> : !langs.length ? <p className="mt">{t('dub.noLang')}</p> : <>
        <div className="slots">
          <label className="slot">
            <span>{t('dub.lang')}</span>
            <Pick value={lang} onChange={v => void set({ lang: v })} options={langs} />
          </label>
          <label className="slot">
            <span>{t('dub.voice')}</span>
            <span className="vrow">
              <Pick value={view.voice} onChange={v => void set({ voice: v })} options={options} placeholder={t('dub.pick')} />
              <button className="ghost try" title={t('dub.try')} aria-label={t('dub.try')} disabled={!!tryer.busy} onClick={() => void tryer.play(view.voice, lang)}>
                {tryer.busy ? <span className="spin" /> : <Icon.play />}
              </button>
            </span>
          </label>
          <button className="swap make" onClick={onMake}>＋ {t('dub.make')}</button>
        </div>
        <div className="opts">
          <div className="opt"><span>{t('dub.original')}</span>
            <span className="seg">
              <button className={view.original === 'duck' ? 'on' : ''} onClick={() => void set({ original: 'duck' })}>{t('dub.duck')}</button>
              <button className={view.original === 'off' ? 'on' : ''} onClick={() => void set({ original: 'off' })}>{t('dub.off')}</button>
            </span>
          </div>
          {(error || tryer.error || view.error) && <p className="err">{error || tryer.error || t('dub.failed').replace('{e}', view.error ?? '')}</p>}
          <p className="mt">{t('dub.how')}</p>
        </div>
      </>}
    </div>
  )
}

type Source = 'mic' | 'file' | 'video'

/**
 * Make a voice from a recording: read a passage into the microphone, give a
 * file, or take someone talking in this video. The sample is sent to a
 * service that learns voices (SiliconFlow or ElevenLabs), and the new voice
 * is chosen for this video.
 */
export function VoiceMaker(props: {
  jobId?: string
  at: number
  voices: VoiceList
  onDone: (voiceId: string) => void
  onClose: () => void
  t: (k: LiveKey) => string
}) {
  const { jobId, at, voices, onDone, onClose, t } = props
  const [source, setSource] = useState<Source>('mic')
  const [mics, setMics] = useState<{ id: string; name: string; preferred?: boolean }[]>([])
  const [mic, setMic] = useState('')
  const [rec, setRec] = useState<{ state: string; sec: number; level: number } | null>(null)
  const [sample, setSample] = useState<{ id: string; dur: number } | null>(null)
  const [text, setText] = useState(voices.readAloud)
  const [name, setName] = useState('')
  const [vendor, setVendor] = useState(voices.clone[0] ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/live/api/devices').then(r => r.json()).then((j: { devices?: { id: string; name: string; kind: string; preferred?: boolean }[] }) => {
      const m = (j.devices ?? []).filter(d => d.kind === 'mic')
      setMics(m)
      setMic(m.find(d => d.preferred)?.id ?? m[0]?.id ?? '')
    }).catch(() => {})
  }, [])

  // While recording: how long, and how loud (so it is clear the microphone hears you).
  useEffect(() => {
    if (rec?.state !== 'recording') return
    const timer = window.setInterval(() => {
      fetch('/live/api/voices/record').then(r => r.json()).then(j => {
        if (j.error) { setError(t('dub.micFailed').replace('{e}', j.error)); void stop('cancel'); return }
        if (j.state === 'recording') setRec({ state: 'recording', sec: j.sec, level: j.level })
        if (j.sec >= 29.5) void stop('stop')
      }).catch(() => {})
    }, 120)
    return () => window.clearInterval(timer)
  }, [rec?.state])

  const startRec = async () => {
    setError(''); setSample(null)
    try { await post('voices/record', { action: 'start', mic }); setRec({ state: 'recording', sec: 0, level: 0 }) } catch (e) { setError((e as Error).message) }
  }
  const stop = async (action: 'stop' | 'cancel') => {
    setRec(r => (r ? { ...r, state: 'stopping' } : r))
    try {
      const j = await post('voices/record', { action })
      if (j.sample) {
        if (j.dur < 4) setError(t('dub.tooShort'))
        else setSample({ id: j.sample, dur: j.dur })
      }
    } catch (e) { setError((e as Error).message) }
    setRec(null)
  }
  const upload = async (f: File) => {
    setBusy(true); setError(''); setSample(null)
    try {
      const r = await fetch('/live/api/voices/upload', { method: 'POST', body: f })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      setSample({ id: j.sample, dur: j.dur })
      setText('')
      if (!name) setName(f.name.replace(/\.[^.]+$/, '').slice(0, 30))
    } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }
  const fromVideo = async () => {
    if (!jobId) return
    setBusy(true); setError(''); setSample(null)
    try {
      const j = await post('voices/fromVideo', { jobId, at })
      setSample({ id: j.sample, dur: j.dur })
      setText(j.text)
      if (!name) setName(t('dub.videoVoice'))
    } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }
  const save = async () => {
    if (!sample) return
    setBusy(true); setError('')
    try {
      const j = await post('voices/save', { sample: sample.id, name: name.trim() || t('dub.myVoice'), text, vendor })
      onDone(j.id)
    } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }
  const pickSource = (s: Source) => {
    if (rec) return
    setSource(s); setSample(null); setError('')
    setText(s === 'mic' ? voices.readAloud : '')
  }

  const body = (
    <div className="dshl-modal" role="dialog" aria-modal="true" onMouseDown={e => { if (e.target === e.currentTarget && !rec) onClose() }}>
      <div className="box dshl-voicemaker">
        <button className="ghost x" onClick={() => { if (rec) void stop('cancel'); onClose() }} title={t('login.close')}><Icon.close /></button>
        <h3>{t('dub.makeTitle')}</h3>
        {!voices.clone.length ? <p>{t('dub.noClone')}</p> : <>
          <div className="dshl-seg src">
            {(['mic', 'file', 'video'] as Source[]).filter(s => s !== 'video' || jobId).map(s => (
              <button key={s} className={source === s ? 'on' : ''} onClick={() => pickSource(s)}>{t(`dub.src.${s}` as LiveKey)}</button>
            ))}
          </div>
          {source === 'mic' && <>
            <p className="lead">{t('dub.micLead')}</p>
            <blockquote className="read">{voices.readAloud}</blockquote>
            {mics.length > 1 && <div className="row"><span>{t('dev.audio')}</span><Pick value={mic} onChange={setMic} options={mics.map(m => ({ value: m.id, label: m.name }))} /></div>}
            {rec ? (
              <div className="recbar">
                <span className="dot" />
                <span className="sec">{rec.sec.toFixed(0)}″</span>
                <span className="meter"><i style={{ width: `${Math.min(100, rec.level * 140)}%` }} /></span>
                <button className="dshl-btn primary" disabled={rec.state !== 'recording'} onClick={() => void stop('stop')}>{t('dub.recStop')}</button>
              </div>
            ) : (
              <button className="dshl-btn primary rec" onClick={() => void startRec()}><span className="dot" />{sample ? t('dub.recAgain') : t('dub.recStart')}</button>
            )}
          </>}
          {source === 'file' && <>
            <p className="lead">{t('dub.fileLead')}</p>
            <input ref={file} type="file" accept="audio/*,video/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
            <button className="dshl-btn" disabled={busy} onClick={() => file.current?.click()}>{busy ? t('dub.working') : t('dub.pickFile')}</button>
          </>}
          {source === 'video' && <>
            <p className="lead">{t('dub.videoLead')}</p>
            <button className="dshl-btn" disabled={busy} onClick={() => void fromVideo()}>{busy ? t('dub.working') : t('dub.takeVideo')}</button>
          </>}
          {sample && (
            <div className="got">
              <audio controls src={`/live/api/voices/sample?sample=${encodeURIComponent(sample.id)}`} />
              <label className="row"><span>{t('dub.name')}</span><input className="dshl-input" value={name} placeholder={t('dub.myVoice')} onChange={e => setName(e.target.value)} /></label>
              <label className="row top"><span>{t('dub.said')}</span><textarea className="dshl-input" rows={3} value={text} placeholder={t('dub.saidHint')} onChange={e => setText(e.target.value)} /></label>
              {voices.clone.length > 1 && <div className="row"><span>{t('dub.by')}</span><Pick value={vendor} onChange={setVendor} options={voices.clone.map(v => ({ value: v, label: vendorName(v, t) }))} /></div>}
              <p className="note">{t('dub.privacy').replace('{s}', vendorName(vendor, t))}</p>
              <div className="acts"><button className="dshl-btn primary" disabled={busy || !text.trim()} onClick={() => void save()}>{busy ? t('dub.working') : t('dub.save')}</button></div>
            </div>
          )}
          {error && <p className="err">{error}</p>}
        </>}
      </div>
    </div>
  )
  return body
}
