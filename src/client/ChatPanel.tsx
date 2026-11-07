import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Icon } from './icons.tsx'
import type { LiveKey } from './locales.ts'
import { Markdown } from './Markdown.tsx'

/** The parts of DS-Harness's session face this panel uses. */
export interface SessionFaceLike {
  getSnapshot(): any
  subscribe(fn: () => void): () => void
  prompt(content: { type: 'text'; text: string }[], mode: 'queue' | 'steer'): Promise<unknown>
  cancel(): Promise<unknown>
}

const CLOCK = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = Math.floor(s % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`
}

const NOOP = () => () => {}
const EMPTY = {}

type Block = { kind?: string; type?: string; text?: string; name?: string }

const textOf = (blocks: readonly Block[] | undefined) =>
  (blocks ?? []).filter(b => (b.kind ?? b.type) === 'text').map(b => b.text ?? '').join('').trim()
const toolsOf = (blocks: readonly Block[] | undefined) =>
  (blocks ?? []).filter(b => (b.kind ?? b.type) === 'tool-call').map(b => b.name ?? '')

/**
 * A compact chat with DeepSeek about the open video: the real session behind
 * it (same tools, files, history), shown the way this page needs it — short
 * messages, which tools ran, and one-tap prompts that carry the current time.
 */
export function ChatPanel(props: { face?: SessionFaceLike; source?: { getSnapshot(): any; subscribe(fn: () => void): () => void }; now: number; lines: string[]; hasVideo: boolean; jobsDir?: string; t: (k: LiveKey) => string }) {
  const { face, source, now, lines, hasVideo, jobsDir, t } = props
  // Files in the video folder open from the chat (played or downloaded by the browser).
  const fileUrl = (p: string) => {
    if (!jobsDir || !p.startsWith(`${jobsDir}/`)) return undefined
    const [id, ...rest] = p.slice(jobsDir.length + 1).split('/')
    return id && rest.length ? `/live/media/${encodeURIComponent(id)}/${rest.map(encodeURIComponent).join('/')}` : undefined
  }
  const snap = useSyncExternalStore(face?.subscribe.bind(face) ?? NOOP, () => face?.getSnapshot() ?? EMPTY)
  // Newer DS-Harness: messages come from the conversation's chat view ("legacy" keeps the flat list).
  const view = useSyncExternalStore(source?.subscribe.bind(source) ?? NOOP, () => source?.getSnapshot() ?? EMPTY)
  const flat = view?.legacy ?? snap
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  const nodes: any[] = Array.isArray(flat.nodes) ? flat.nodes : Array.isArray(snap.chat?.nodes) ? snap.chat.nodes : []
  const running: boolean = !!snap.running
  const partialText = textOf(flat.partial?.blocks)
  const partialTools = toolsOf(flat.partial?.blocks)
  const runningTools: string[] = (flat.runningCalls ?? []).map((c: any) => c.name ?? c.toolName ?? '').filter(Boolean)

  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }) }, [nodes.length, partialText.length, running])

  const send = async (text = draft) => {
    const body = text.trim()
    if (!face || !body || sending) return
    setSending(true)
    try { await face.prompt([{ type: 'text', text: body }], 'queue'); setDraft('') } finally { setSending(false) }
  }
  // Quick prompts fill the box (so they can be edited) instead of sending — nothing costs tokens until Send.
  const fill = (text: string) => { setDraft(text); setTimeout(() => box.current?.focus(), 0) }
  const at = CLOCK(now)
  const around = `${CLOCK(Math.max(0, now - 30))}–${CLOCK(now + 30)}`

  const rows = nodes.flatMap((n, i) => {
    if (n.kind === 'user') { const text = textOf(n.content); return text ? [<div className="msg user" key={i}>{text}</div>] : [] }
    if (n.kind === 'assistant') {
      // Keep the model's order: text, then the tools it called (and so on).
      return ((n.blocks ?? []) as Block[]).flatMap((b, j) => {
        const k = b.kind ?? b.type
        if (k === 'text' && b.text?.trim()) return [<div className="msg bot" key={`${i}-${j}`}><Markdown text={b.text.trim()} fileUrl={fileUrl} /></div>]
        if (k === 'tool-call') return [<div className="msg tool" key={`${i}-${j}`}><Icon.gear /> {b.name}</div>]
        return []
      })
    }
    if (n.kind === 'turn-error') return [<div className="msg err" key={i}>{String(n.message ?? n.error ?? 'error')}</div>]
    return []
  })

  return (
    <div className="dshl-chat">
      <div className="msgs" ref={list}>
        {rows.length === 0 && !running && <div className="dshl-muted pad">{t('chat.empty')}</div>}
        {rows}
        {running && (
          <>
            {[...partialTools, ...runningTools].map((name, j) => <div className="msg tool on" key={`p${j}`}><Icon.gear /> {name}</div>)}
            <div className="msg bot live">{partialText ? <Markdown text={partialText} fileUrl={fileUrl} /> : <span className="dshl-muted">{t('chat.thinking')}</span>}</div>
          </>
        )}
        {snap.promptError && <div className="msg err">{String(snap.promptError.message ?? snap.promptError)}</div>}
      </div>
      {hasVideo && (
        <div className="quick">
          <button onClick={() => fill(t('chat.p.frame').replace('{t}', at))}>{t('chat.q.frame')}</button>
          <button onClick={() => fill(t('chat.p.clip').replace('{r}', around).replace('{l}', lines.join(', ')))}>{t('chat.q.clip')}</button>
          <button onClick={() => fill(t('chat.p.summary'))}>{t('chat.q.summary')}</button>
          <button onClick={() => fill(t('chat.p.download'))}>{t('chat.q.download')}</button>
        </div>
      )}
      <div className="composer">
        <textarea ref={box} rows={2} value={draft} placeholder={t('chat.placeholder')} disabled={!face}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} />
        {running
          ? <button className="dshl-btn small stop" onClick={() => void face?.cancel()}>{t('chat.stop')}</button>
          : <button className="dshl-btn small primary" disabled={!draft.trim() || sending || !face} onClick={() => void send()}>{t('chat.send')}</button>}
      </div>
    </div>
  )
}
