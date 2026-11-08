import { readFileSync } from 'node:fs'

/**
 * Is there a newer Vidi on npm? Checked when the plugin starts and once a day
 * after that (and whenever the user asks). Only reads the public registry;
 * installing stays with DSH's plugin page.
 */
export interface UpdateState {
  current: string
  latest?: string
  newer: boolean
  checkedAt?: number
  error?: string
}

const DAY = 24 * 3600_000

/** a > b for plain x.y.z versions (pre-releases count as older than the release). */
function greater(a: string, b: string): boolean {
  const parse = (v: string) => { const [core = '', pre] = v.split('-'); return { n: core.split('.').map(x => Number(x) || 0), pre } }
  const x = parse(a), y = parse(b)
  for (let i = 0; i < 3; i++) if ((x.n[i] ?? 0) !== (y.n[i] ?? 0)) return (x.n[i] ?? 0) > (y.n[i] ?? 0)
  return !x.pre && !!y.pre
}

export function updateChecker(log: (m: string) => void): { state(): UpdateState; check(): Promise<UpdateState>; stop(): void } {
  let current = '0.0.0'
  try { current = String(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version) } catch {}
  let latest: string | undefined, checkedAt: number | undefined, error: string | undefined
  let running: Promise<UpdateState> | undefined
  const state = (): UpdateState => ({ current, latest, newer: !!latest && greater(latest, current), checkedAt, error })
  const check = (): Promise<UpdateState> => running ??= (async () => {
    try {
      const r = await fetch('https://registry.npmjs.org/dsh-vidi/latest', { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } })
      if (!r.ok) throw new Error(`registry ${r.status}`)
      latest = String(((await r.json()) as { version?: string }).version ?? '') || undefined
      error = undefined
      if (latest && greater(latest, current)) log(`update: ${latest} available (running ${current})`)
    } catch (err) {
      error = (err as Error).message
    } finally {
      checkedAt = Date.now()
      running = undefined
    }
    return state()
  })()
  void check()
  const timer = setInterval(() => void check(), DAY)
  timer.unref?.()
  return { state: () => { if (!checkedAt || Date.now() - checkedAt > DAY) void check(); return state() }, check, stop: () => clearInterval(timer) }
}
