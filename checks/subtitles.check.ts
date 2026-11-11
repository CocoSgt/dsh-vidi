/**
 * Checks for the subtitle pipeline's handling of a model that hangs, a model that thinks its answer
 * away, and a model that writes translations one line off. No network: the model is played here.
 *
 *   node --experimental-transform-types --no-warnings checks/subtitles.check.ts
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ask, budgetFor, forgetModels, LIMITS } from '../src/ask.ts'
import { suspects } from '../src/align.ts'
import { Glossary } from '../src/glossary.ts'
import { LiveJob, SETTLE } from '../src/job.ts'
import { Polisher } from '../src/polish.ts'
import { translateBatch, Translator, type LlmHandle } from '../src/translate.ts'
import type { Cue } from '../src/types.ts'
import { UsageMeter } from '../src/usage.ts'

let failed = 0
function ok(cond: unknown, what: string): void {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${what}`)
  if (!cond) failed++
}

// ── A model played by this script ──

/** "Translate" into Chinese the way a real one does: names and numbers stay, the rest becomes Chinese. */
const zh = (src: string) => '译' + src.replace(/\b[a-z][a-z']*\b/g, '字').replace(/\s+/g, '') 
type Chunk = Record<string, unknown>
const answer = (text: string): Chunk[] => [
  { type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } },
  { type: 'finish', reason: { kind: 'stop' } },
]
const userText = (o: Record<string, unknown>) => ((o.messages as { content: { type: string; text?: string }[] }[])[0]!.content.find(c => c.type === 'text')!.text ?? '')
const linesIn = (text: string): { id: number; src: string }[] => JSON.parse(text.slice(text.lastIndexOf('\n[') + 1))
const lineIn = (text: string) => text.slice(text.lastIndexOf('Line to translate:\n') + 'Line to translate:\n'.length)

interface Play { calls: Record<string, unknown>[]; handle: LlmHandle }
/** A model whose every request goes through `reply` (which may hang, think, or answer wrongly). */
function model(reply: (o: Record<string, unknown>, n: number) => AsyncIterable<Chunk> | Chunk[]): Play {
  const calls: Record<string, unknown>[] = []
  return {
    calls,
    handle: {
      selection: () => ({ provider: 'play', model: 'm' }),
      async *stream(o: Record<string, unknown>) { calls.push(o); yield* reply(o, calls.length) as AsyncIterable<Chunk> },
    },
  }
}
/** The right answer to any of the three kinds of request. */
function honest(o: Record<string, unknown>): Chunk[] {
  const text = userText(o)
  if (o.purpose === 'live-subtitle-translate') return answer(JSON.stringify({ zh: zh(lineIn(text)) }))
  const rows = linesIn(text)
  if (o.purpose === 'live-polish') return answer(JSON.stringify({ lines: rows.map(r => ({ id: r.id, speaker: 'Speaker 1', src: r.src, tr: { zh: zh(r.src) } })) }))
  return answer(JSON.stringify(rows.map(r => ({ id: r.id, zh: zh(r.src) }))))
}
/** A request that never answers and does not listen to being told to stop. */
const hang = (): AsyncIterable<Chunk> => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<Chunk>>(() => {}) }) })

const SRC = [
  'We shipped 3 models this year.', 'A good example is Opus 5.5.', 'It writes code for hours without help.', 'Revenue grew to 47 billion dollars.',
  'That is up from 12 last year.', 'Claude Code is used by 80 percent of our engineers.', 'We think 2027 will be bigger.', 'Thank you all for coming.',
]
const cues = (n = SRC.length, from = 1): Cue[] => Array.from({ length: n }, (_, i) => ({ id: from + i, start: i * 3, end: i * 3 + 3, src: SRC[i % SRC.length]!, final: true }))

function polisher(play: Play, signal?: AbortSignal) {
  const out = new Map<number, { src: string; tr: Record<string, string> }>()
  const logs: string[] = []
  const dir = mkdtempSync(join(tmpdir(), 'vidi-check-'))
  const glossary = new Glossary(join(dir, 'glossary.json'), ['zh'], () => {}, () => {}, '')
  const p = new Polisher({
    llm: () => play.handle, glossary, log: m => logs.push(m), brief: () => '', siteText: () => [], targets: () => ['zh'], signal,
    onLine: (cue, src, tr) => { cue.src = src; cue.tr = { ...cue.tr, ...tr }; out.set(cue.id, { src, tr }) },
  })
  return { p, out, logs }
}

function job(play: Play) {
  const dir = mkdtempSync(join(tmpdir(), 'vidi-check-'))
  const logs: string[] = []
  const glossary = new Glossary(join(dir, 'glossary.json'), ['zh'], () => {}, () => {}, '')
  const j = new LiveJob('check', { source: 'file', url: 'x', mode: 'polished', srcLang: 'en', tgtLangs: ['zh'], provider: 'local' } as never, {
    dir, makeProvider: () => { throw new Error('none') }, translator: new Translator(() => play.handle), llm: () => play.handle,
    usage: new UsageMeter(() => {}), glossary, log: (m: string) => logs.push(m),
  } as never)
  return { j, logs, any: j as unknown as { endRun(s: string): Promise<void>; polisher: Polisher; fill(): Promise<void> } }
}

const fast = () => { Object.assign(LIMITS, { first: 250, idle: 250, total: 1500, perToken: 0, pause: 20 }); SETTLE.wait = 400 }

// ── 1. A request that never returns ──
async function hangs() {
  console.log('1. A request that never returns')
  fast(); forgetModels()
  let t = Date.now()
  const once = model((o, n) => (n === 1 ? hang() : honest(o)))
  const text = await ask(once.handle, { system: 's', text: 'Line to translate:\nHello 42', maxTokens: 100, purpose: 'live-subtitle-translate' })
  ok(text.includes('42') && once.calls.length === 2, `a hung request is given up and asked again (${Date.now() - t} ms, ${once.calls.length} requests)`)
  ok((once.calls[0]!.signal as AbortSignal).aborted, 'the hung request is told to stop')

  // A stall in the middle of an answer.
  const stall = model((o, n) => (n === 1 ? (async function* () { yield { type: 'text-delta', index: 0, text: '{"zh":"' }; await new Promise(() => {}) })() : honest(o)))
  ok((await ask(stall.handle, { system: 's', text: 'Line to translate:\nHello 42', maxTokens: 100, purpose: 'live-subtitle-translate' })).includes('42'), 'an answer that stalls half way is asked for again')

  // A model that keeps thinking aloud is not hung; one that goes on past the total time is.
  const slow = model(async function* (o) { for (let i = 0; i < 8; i++) { await new Promise(r => setTimeout(r, 120)); yield { type: 'reasoning-delta', index: 0, text: '…' } } yield* honest(o).map(c => ('index' in c ? { ...c, index: 1 } : c)) })
  ok((await ask(slow.handle, { system: 's', text: 'Line to translate:\nHello 42', maxTokens: 100, purpose: 'live-subtitle-translate' })).includes('42') && slow.calls.length === 1, 'a model thinking for longer than the no-answer limit, but sending all along, is waited for')
  forgetModels()
  const endless = model((o, n) => (n > 1 ? honest(o) : (async function* () { for (;;) { await new Promise(r => setTimeout(r, 100)); yield { type: 'reasoning-delta', index: 0, text: '…' } } })()))
  ok((await ask(endless.handle, { system: 's', text: 'Line to translate:\nHello 42', maxTokens: 100, purpose: 'live-subtitle-translate' })).includes('42') && endless.calls.length === 2, 'one that never stops thinking is given up after the total time')
  forgetModels()

  // The provider reports a failure ("fetch failed").
  const flaky = model((o, n) => (n === 1 ? [{ type: 'finish', reason: { kind: 'error', failure: { message: 'fetch failed' } } }] : honest(o)))
  ok((await ask(flaky.handle, { system: 's', text: 'Line to translate:\nHello 42', maxTokens: 100, purpose: 'live-subtitle-translate' })).includes('42'), 'a failed request ("fetch failed") is asked again')

  // A request the provider refuses outright is not asked again.
  const refused = model(() => [{ type: 'finish', reason: { kind: 'error', failure: { message: '400: {"code":20015,"message":"bad role"}' } } }])
  ok(await ask(refused.handle, { system: 's', text: 'x', maxTokens: 100, purpose: 'live-subtitle-translate' }).then(() => false, () => true) && refused.calls.length === 1, 'a request the provider refuses (400) fails at once instead of being repeated')

  // Everything hangs: the polisher gives the lines up and its queue empties.
  const dead = model(() => hang())
  const a = polisher(dead)
  t = Date.now()
  for (const c of cues()) a.p.add(c)
  await a.p.flush()
  ok(a.p.backlog === 0 && Date.now() - t < 5000, `with a model that never answers, polishing still comes to an end (${Date.now() - t} ms)`)
  ok(a.logs.some(l => /not polished/.test(l)), 'and says the lines were not polished')

  // Pausing returns although requests are stuck.
  const b = job(model(() => hang()))
  for (const c of cues()) { b.j.cues.push(c); b.any.polisher.add(c) }
  t = Date.now()
  await b.any.endRun('paused')
  ok(Date.now() - t < 1000, `pausing returns while requests are stuck (${Date.now() - t} ms)`)
  ok(b.j.summary().subs.state === 'paused', 'and the video says its subtitles are paused')
  await b.j.close().catch(() => {})

  // Closing gives up what is under way.
  const ac = new AbortController()
  const c = polisher(model(() => hang()), ac.signal)
  for (const cue of cues()) c.p.add(cue)
  t = Date.now()
  setTimeout(() => ac.abort(), 50)
  await c.p.flush()
  ok(Date.now() - t < 200, `closing the video gives up stuck requests at once (${Date.now() - t} ms)`)
}

// ── 2. A model that thinks its answer away ──
async function thinks() {
  console.log('2. A thinking model that returns empty text')
  fast(); forgetModels()
  /** Thinks for 3000 tokens before answering: with less room than that, the answer is empty or cut. */
  const thinker = (need = 3000) => (o: Record<string, unknown>): Chunk[] => {
    const room = Number(o.maxTokens)
    const thought = [{ type: 'block-start', index: 0, blockType: 'reasoning' }, { type: 'reasoning-delta', index: 0, text: 'hmm…' }, { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'hmm…' } }]
    if (room < need) return [...thought, { type: 'usage', usage: { inputTokens: 10, outputTokens: room, reasoningTokens: room } }, { type: 'finish', reason: { kind: 'max-tokens' } }]
    return [...thought, ...honest(o).map(c => ('index' in c ? { ...c, index: 1 } : c))]
  }
  const m = model(thinker())
  const a = polisher(m)
  const batch = cues()
  for (const c of batch) a.p.add(c)
  await a.p.flush()
  ok(a.out.size === batch.length && batch.every(c => c.tr?.zh), `polish: every line translated although the first answer was all thinking (${m.calls.length} requests: ${m.calls.map(c => c.maxTokens).join(' → ')} tokens)`)
  ok(budgetFor('play/m', 2720) > 3000, `the model is remembered as one that thinks: its next request starts with room for ${budgetFor('play/m', 2720)}`)
  const n = m.calls.length
  for (const c of cues(8, 101)) a.p.add(c)
  await a.p.flush()
  ok(m.calls.length === n + 1, 'the next batch goes through in one request')

  forgetModels()
  const m2 = model(thinker())
  const got = await translateBatch(m2.handle, ['zh'], cues(15).map(c => ({ id: c.id, src: c.src })))
  ok(got.size === 15, `batch translation: all 15 lines although the first answer was all thinking (${m2.calls.map(c => c.maxTokens).join(' → ')} tokens)`)

  // A batch the model cannot do whole: unreadable above 4 lines.
  forgetModels()
  const picky = model(o => (o.purpose !== 'live-subtitle-translate' && linesIn(userText(o)).length > 4 ? answer('{"lines":[{"id":1,"src":"We shi') : honest(o)))
  const b = polisher(picky)
  for (const c of batch.map(c => ({ ...c, tr: undefined }))) b.p.add(c)
  await b.p.flush()
  ok(b.out.size === 8 && [...b.out.values()].every(x => x.tr.zh), `polish: an unreadable answer is retried in smaller pieces, not marked done (${picky.calls.length} requests)`)
  const got2 = await translateBatch(picky.handle, ['zh'], cues(15).map(c => ({ id: c.id, src: c.src })))
  ok(got2.size === 15, 'batch translation: the same')

  // Empty however much room it gets: each line is translated on its own.
  const mute = model(o => (o.purpose === 'live-subtitle-translate' ? honest(o) : answer('')))
  const c = polisher(mute)
  for (const cue of cues()) c.p.add(cue)
  await c.p.flush()
  ok(c.out.size === 8 && [...c.out.values()].every(x => x.tr.zh), 'polish: when batches stay empty, lines are translated one by one')

  // Filling in translations goes past lines that fail.
  forgetModels()
  const poison = model(o => {
    const text = userText(o)
    if (o.purpose === 'live-subtitle-translate') return /POISON/.test(lineIn(text)) ? answer('') : honest(o)
    const rows = linesIn(text)
    return rows.some(r => /POISON/.test(r.src)) ? answer('I cannot do that.') : honest(o)
  })
  const j = job(poison)
  const all = cues(60)
  for (const i of [0, 1, 2, 20, 41]) all[i]!.src = `POISON ${i}`
  j.j.cues.push(...all)
  await j.j.setTargets(['zh'])
  const without = all.filter(x => !x.tr?.zh)
  ok(without.length === 5 && without.every(x => /POISON/.test(x.src)), `adding a language: 55 of 60 lines translated, only the 5 that cannot be are left (${without.length} left; the first three lines fail and do not stop the rest)`)
  ok(j.logs.some(l => /still without a translation/.test(l)), 'and the log names the lines left')
  // A model that is gone altogether: filling stops instead of walking every line.
  const gone = job(model(() => [{ type: 'finish', reason: { kind: 'error', failure: { message: 'fetch failed' } } }]))
  gone.j.cues.push(...cues(60))
  const t = Date.now()
  await gone.j.setTargets(['zh'])
  ok(Date.now() - t < 3000 && gone.logs.some(l => /gives nothing, stopping/.test(l)), `adding a language with the model unreachable stops after two batches (${Date.now() - t} ms)`)
  await j.j.close().catch(() => {}); await gone.j.close().catch(() => {})
}

// ── 3. Translations one line off ──
async function shifts() {
  console.log('3. Translations on the neighbouring line')
  fast(); forgetModels()
  const right = (c: Cue) => c.tr?.zh === zh(c.src)
  // The check itself, on the case that was seen.
  const seen = SRC.slice(0, 4).map((src, i) => ({ id: i + 1, src, tr: { zh: zh(SRC[i === 0 ? 0 : i + 1]!) } }))
  ok(suspects(seen, ['zh']).has(2), '"A good example is Opus 5.5." carrying the next line\'s translation is noticed')
  ok(suspects(SRC.map((src, i) => ({ id: i + 1, src, tr: { zh: zh(src) } })), ['zh']).size === 0, 'correct translations are left alone')
  ok(suspects([{ id: 1, src: 'It raised 3 billion dollars.', tr: { zh: '它筹集了30亿美元。' } }, { id: 2, src: 'Five people joined.', tr: { zh: '有5个人加入。' } }], ['zh']).size === 0, 'numbers written the Chinese way (3 billion → 30亿) are not taken for a shift')

  /** From the second line on, every translation is the next line's; the last one is left out or repeated. */
  const slip = (how: 'drop' | 'repeat' | 'merge') => (o: Record<string, unknown>): Chunk[] => {
    const text = userText(o)
    if (o.purpose === 'live-subtitle-translate') return honest(o)
    const rows = linesIn(text)
    if (rows.length < 5) return honest(o)
    const tr = rows.map((r, i) => (i === 0 ? zh(r.src) : i + 1 < rows.length ? zh(rows[i + 1]!.src) : zh(r.src)))
    if (how === 'merge') tr[0] = zh(rows[0]!.src + ' ' + rows[1]!.src)
    let outRows = rows.map((r, i) => ({ id: r.id, src: r.src, zh: tr[i]! }))
    if (how === 'drop') outRows = outRows.slice(0, -1)
    if (o.purpose === 'live-polish') return answer(JSON.stringify({ lines: outRows.map(r => ({ id: r.id, speaker: 'Speaker 1', src: r.src, tr: { zh: r.zh } })) }))
    return answer(JSON.stringify(outRows.map(r => ({ id: r.id, zh: r.zh }))))
  }
  for (const how of ['drop', 'repeat', 'merge'] as const) {
    const m = model(slip(how))
    const a = polisher(m)
    const batch = cues()
    for (const c of batch) a.p.add(c)
    await a.p.flush()
    ok(batch.every(right), `polish, shifted (${how}): every line ends with its own translation (${m.calls.length} requests)${batch.every(right) ? '' : ' — wrong: ' + batch.filter(c => !right(c)).map(c => c.id).join(',')}`)
    ok(a.logs.some(l => /on the wrong line/.test(l)), '  and the log says which lines were redone')
    const lines = cues(8).map(c => ({ id: c.id, src: c.src }))
    const got = await translateBatch(m.handle, ['zh'], lines)
    ok(lines.every(l => got.get(l.id)?.zh === zh(l.src)), `batch translation, shifted (${how}): every line ends with its own translation`)
  }

  // Ids out of order or made up: the numbering is not trusted.
  const jumbled = model(o => {
    if (o.purpose === 'live-subtitle-translate') return honest(o)
    const rows = linesIn(userText(o))
    if (rows.length < 5) return honest(o)
    return answer(JSON.stringify(rows.map((r, i) => ({ id: rows[(i + 3) % rows.length]!.id, zh: zh(r.src) }))))
  })
  const lines = cues(8).map(c => ({ id: c.id, src: c.src }))
  const got = await translateBatch(jumbled.handle, ['zh'], lines)
  ok(lines.every(l => got.get(l.id)?.zh === zh(l.src)), 'ids returned out of order: asked again in smaller pieces, every line right')

  // The polished text itself on the wrong id.
  const swapped = model(o => {
    if (o.purpose !== 'live-polish') return honest(o)
    const rows = linesIn(userText(o))
    return answer(JSON.stringify({ lines: rows.map((r, i) => { const x = rows[i === 2 ? 3 : i === 3 ? 2 : i]!; return { id: r.id, src: x.src, tr: { zh: zh(x.src) } } }) }))
  })
  const s = polisher(swapped)
  const batch = cues()
  const before = batch.map(c => c.src)
  for (const c of batch) s.p.add(c)
  await s.p.flush()
  ok(batch.every((c, i) => c.src === before[i] && right(c)), 'polish: text returned under another line\'s id is not taken; the line keeps its words and gets its own translation')
}

await hangs()
await thinks()
await shifts()
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed')
process.exit(failed ? 1 : 0)
