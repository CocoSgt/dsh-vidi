import { readFileSync } from 'node:fs'

/**
 * Is there a newer Vidi on npm, and install it in one click. Checked when the
 * plugin starts and once a day after that (and whenever the user asks).
 * Installing goes through DSH's own plugin manager (the same call as its
 * Plugins page: version checks, rollback on failure).
 */
export interface UpdateState {
  current: string
  latest?: string
  newer: boolean
  /** The plugin manager can replace this copy (an npm install in a DSH profile). */
  canInstall: boolean
  checkedAt?: number
  error?: string
}

export interface UpdateResult {
  status: 'applied' | 'restart' | 'failed'
  version?: string
  message?: string
}

interface PluginManagerLike {
  listBundles(): Promise<{ name: string; updatable?: boolean }[]>
  updateBundle(name: string, version: string, options?: { requestId?: string }): Promise<{
    result?: { application?: string; error?: { code?: string; diagnostic?: string; message?: string } }
  }>
}

const DAY = 24 * 3600_000
/** pnpm holds back releases younger than a day: offer only versions it will install. */
const MIN_AGE = process.env.VIDI_UPDATE_MIN_AGE_HOURS !== undefined ? Number(process.env.VIDI_UPDATE_MIN_AGE_HOURS) * 3600_000 : DAY
const NAME = 'dsh-vidi'

/** a > b for plain x.y.z versions (pre-releases count as older than the release). */
function greater(a: string, b: string): boolean {
  const parse = (v: string) => { const [core = '', pre] = v.split('-'); return { n: core.split('.').map(x => Number(x) || 0), pre } }
  const x = parse(a), y = parse(b)
  for (let i = 0; i < 3; i++) if ((x.n[i] ?? 0) !== (y.n[i] ?? 0)) return (x.n[i] ?? 0) > (y.n[i] ?? 0)
  return !x.pre && !!y.pre
}

export function updateChecker(log: (m: string) => void, manager: () => PluginManagerLike | undefined) {
  let current = '0.0.0'
  try { current = String(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version) } catch {}
  let latest: string | undefined, checkedAt: number | undefined, error: string | undefined
  let canInstall = false
  let running: Promise<UpdateState> | undefined
  const state = (): UpdateState => ({ current, latest, newer: !!latest && greater(latest, current), canInstall, checkedAt, error })

  const check = (): Promise<UpdateState> => running ??= (async () => {
    try {
      const r = await fetch(`https://registry.npmjs.org/${NAME}`, { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json' } })
      if (!r.ok) throw new Error(`registry ${r.status}`)
      const doc = (await r.json()) as { time?: Record<string, string>; versions?: Record<string, unknown> }
      // The newest release that has been out for a day (what pnpm will install).
      const ripe = Object.keys(doc.versions ?? {})
        .filter(v => !v.includes('-') && Date.now() - Date.parse(doc.time?.[v] ?? '') >= MIN_AGE)
      latest = ripe.reduce<string | undefined>((best, v) => (!best || greater(v, best) ? v : best), undefined)
      error = undefined
      if (latest && greater(latest, current)) log(`update: ${latest} available (running ${current})`)
    } catch (err) {
      error = (err as Error).message
    }
    try { canInstall = !!(await manager()?.listBundles())?.find(b => b.name === NAME)?.updatable } catch { canInstall = false }
    checkedAt = Date.now()
    running = undefined
    return state()
  })()

  /** Install the newest version through DSH's plugin manager. */
  const install = async (): Promise<UpdateResult> => {
    const pm = manager()
    if (!pm || !latest || !greater(latest, current)) return { status: 'failed', message: 'nothing to install' }
    log(`update: installing ${latest}`)
    try {
      const out = await pm.updateBundle(NAME, latest, { requestId: `vidi-update-${Date.now()}` })
      const app = out.result?.application
      if (app === 'restart-required') return { status: 'restart', version: latest }
      if (app === 'applied' || app === 'unchanged') return { status: 'applied', version: latest }
      const e = out.result?.error
      return { status: 'failed', message: e?.diagnostic || e?.message || e?.code || app || 'failed' }
    } catch (err) {
      return { status: 'failed', message: (err as Error).message }
    }
  }

  void check()
  const timer = setInterval(() => void check(), DAY)
  timer.unref?.()
  return {
    state: () => { if (!checkedAt || Date.now() - checkedAt > DAY) void check(); return state() },
    check,
    install,
    stop: () => clearInterval(timer),
  }
}
