/**
 * Starting a command-line tool. A tool that is not installed (or cannot be started) makes Node raise an
 * "error" event instead of "exit"; with nobody listening it ends the whole DSH host. Here it becomes an
 * ordinary failed run: a line on stderr saying so, then "exit" with code 127.
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'

/** The exit code of a tool that could not be started (as in a shell). */
export const NOT_STARTED = 127
/** What its stderr says, and (through it) the message the page shows in the page's language. */
export const missingTool = (cmd: string): string => `tool not found: ${cmd}`

export function spawnTool(cmd: string, args: string[], options: SpawnOptions): ChildProcess {
  const p = spawn(cmd, args, options)
  // A pipe to a process that never came up, or went away, must not end the host either.
  for (const s of p.stdio ?? []) s?.on('error', () => {})
  p.on('error', err => {
    if (p.pid !== undefined) return // started: "exit" follows by itself
    const why = (err as NodeJS.ErrnoException).code === 'ENOENT' ? missingTool(cmd) : `${cmd}: ${err.message}`
    p.stderr?.emit('data', Buffer.from(`${why}\n`))
    p.emit('exit', NOT_STARTED, null)
  })
  return p
}
