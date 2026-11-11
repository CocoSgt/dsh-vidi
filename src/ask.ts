import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { LlmHandle } from './translate.ts'

/**
 * How long one request may take (ms). A request that sends nothing for `first` (before its first
 * piece) or `idle` (between pieces) hangs: it is given up and asked again. One that keeps sending
 * is alive (a model thinking at length), and only given up after `total`, or `perToken` for each
 * token of room it was given if that is longer.
 */
export const LIMITS = { first: 60_000, idle: 40_000, total: 180_000, perToken: 40, pause: 1500 }

/** The most a reply may be given, whatever the model. */
const MAX_BUDGET = 32_000

/** Models seen thinking before they answer (their thinking counts against the reply's size). */
const thinkers = new Set<string>()
/** Models that refused a reply size: the largest they may be asked for. */
const caps = new Map<string, number>()

export interface AskOptions {
  system: string
  text: string
  image?: unknown
  /** Room for the answer itself; thinking models get more on top. */
  maxTokens: number
  purpose: string
  signal?: AbortSignal
  log?: (msg: string) => void
  tries?: number
}

export class AskError extends Error {
  /** `empty`: the model answered, but with nothing usable (smaller pieces may do); otherwise it could not be reached. */
  constructor(message: string, readonly empty = false) { super(message) }
}

/** Room for a reply: the answer, plus the thinking of a model that thinks first. */
export function budgetFor(key: string, answer: number, grown = 1): number {
  const want = (thinkers.has(key) ? answer * 2 + 6000 : answer) * grown
  return Math.round(Math.min(want, caps.get(key) ?? MAX_BUDGET, MAX_BUDGET))
}

/** For checks: forget what was learned about models. */
export function forgetModels(): void { thinkers.clear(); caps.clear() }

/**
 * One question to the subtitle model, answered as text. A request that hangs is cut off and asked
 * again; one that fails is asked again after a pause; an answer that came back empty or cut short
 * (a thinking model spent the room on its thoughts) is asked again with more room. Throws when no
 * try gave an answer, or at once when `signal` says to stop.
 */
export async function ask(handle: LlmHandle, o: AskOptions): Promise<string> {
  const { provider, model } = handle.selection()
  const key = `${provider}/${model}`
  const tries = o.tries ?? 3
  let grown = 1
  let last = 'no answer', empty = false
  for (let n = 0; n < tries; n++) {
    if (o.signal?.aborted) throw new AskError('stopped')
    const maxTokens = budgetFor(key, o.maxTokens, grown)
    let r: Awaited<ReturnType<typeof once>>
    try {
      r = await once(handle, { ...o, provider, model, maxTokens })
    } catch (err) {
      if (o.signal?.aborted) throw new AskError('stopped')
      last = (err as Error).message || String(err)
      empty = false
      // The model takes less than was asked for: remember, and ask for less.
      const tooMuch = /max[_ ]?(completion[_ ])?tokens|maxTokens/i.test(last) && maxTokens > 1024
      if (tooMuch) caps.set(key, Math.floor(maxTokens / 2))
      // The request itself is refused (wrong model, key, format): asking again gets the same answer.
      else if (/^4\d\d\b/.test(last) && !/^4(08|09|25|29)\b/.test(last)) throw new AskError(last)
      o.log?.(`${o.purpose}: ${last}${n + 1 < tries ? ', asking again' : ''}`)
      if (n + 1 < tries) await sleep(LIMITS.pause * (n + 1), o.signal)
      continue
    }
    if (r.thought) thinkers.add(key)
    if (r.text.trim() && !r.cut) return r.text
    // Empty or cut short: a model that thinks used the room up. More room next time (and from now on).
    if (r.cut || r.thought) thinkers.add(key)
    last = r.cut ? `answer cut short at ${maxTokens} tokens` : 'empty answer'
    empty = true
    const more = budgetFor(key, o.maxTokens, grown * 2)
    o.log?.(`${o.purpose}: ${last}${r.thought ? ' (the model was thinking)' : ''}${n + 1 < tries ? `, asking again with room for ${more}` : ''}`)
    // Nothing more to give and still cut: hand back what there is (the caller may make use of it).
    if (more <= maxTokens && r.text.trim()) return r.text
    grown *= 2
  }
  throw new AskError(last, empty)
}

async function once(handle: LlmHandle, o: AskOptions & { provider: string; model: string }): Promise<{ text: string; cut: boolean; thought: boolean }> {
  const ac = new AbortController()
  const outer = () => ac.abort()
  o.signal?.addEventListener('abort', outer, { once: true })
  let giveUp!: (err: Error) => void
  const gaveUp = new Promise<never>((_, reject) => { giveUp = reject })
  gaveUp.catch(() => {})
  ac.signal.addEventListener('abort', () => giveUp(new AskError('stopped')), { once: true })
  const started = Date.now()
  const total = Math.max(LIMITS.total, o.maxTokens * LIMITS.perToken)
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = (ms: number, what: string) => {
    clearTimeout(timer)
    const left = Math.min(ms, total - (Date.now() - started))
    timer = setTimeout(() => { giveUp(new AskError(left < ms ? `no complete answer in ${Math.round(total / 1000)} s` : what)); ac.abort() }, Math.max(0, left))
  }
  const it = handle.stream({
    provider: o.provider, model: o.model, system: o.system, maxTokens: o.maxTokens, purpose: o.purpose, signal: ac.signal,
    messages: [createUserMessage({ content: [...(o.image ? [o.image as never] : []), { type: 'text', text: o.text }], source: { kind: 'plugin', plugin: 'dsh-vidi' } })],
  })[Symbol.asyncIterator]()
  const asm = new BlockAssembler()
  let cut = false, thought = false
  try {
    arm(LIMITS.first, `no answer in ${Math.round(LIMITS.first / 1000)} s`)
    for (;;) {
      // Raced: a request that never returns must not hold this up, whether or not it listens to the signal.
      const step = await Promise.race([it.next(), gaveUp])
      if (step.done) break
      const c = step.value as { type?: string; reason?: { kind?: string; failure?: { message?: string } }; usage?: { reasoningTokens?: number } }
      arm(LIMITS.idle, `answer stalled for ${Math.round(LIMITS.idle / 1000)} s`)
      if (c.type === 'reasoning-delta') thought = true
      else if (c.type === 'usage') { if ((c.usage?.reasoningTokens ?? 0) > 0) thought = true }
      else if (c.type === 'finish') {
        const kind = c.reason?.kind
        if (kind === 'max-tokens') cut = true
        else if (kind === 'error' || kind === 'aborted') throw new AskError(c.reason?.failure?.message || `request ${kind}`)
        continue
      }
      asm.push(c as never)
    }
  } finally {
    clearTimeout(timer)
    o.signal?.removeEventListener('abort', outer)
    // Let go of the request (not waited for: a stuck one may never answer).
    void Promise.resolve(it.return?.()).catch(() => {})
  }
  const blocks = asm.blocks() as { type: string; text?: string }[]
  if (blocks.some(b => b.type === 'reasoning')) thought = true
  return { text: blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join(''), cut, thought }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const t = setTimeout(done, ms)
    function done() { clearTimeout(t); signal?.removeEventListener('abort', done); resolve() }
    signal?.addEventListener('abort', done, { once: true })
  })
}

/** The first complete JSON value of a kind in a reply (models wrap it in prose or code fences). */
export function jsonIn<T>(out: string, open: '{' | '['): T | undefined {
  const close = open === '{' ? '}' : ']'
  for (let from = out.indexOf(open); from >= 0; from = out.indexOf(open, from + 1)) {
    for (let to = out.lastIndexOf(close); to > from; to = out.lastIndexOf(close, to - 1)) {
      try { return JSON.parse(out.slice(from, to + 1)) as T } catch {}
      // Only the widest and a few narrower spans are worth trying.
      if (out.length - to > 2000) break
    }
    if (from > 2000) break
  }
  return undefined
}
