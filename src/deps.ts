import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface DepStatus {
  name: string
  ok: boolean
  version?: string
  hint?: string
}

async function which(bin: string): Promise<string | undefined> {
  try {
    const { stdout } = await run('/usr/bin/which', [bin])
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

async function version(bin: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout, stderr } = await run(bin, args, { timeout: 10_000 })
    return (stdout || stderr).split('\n')[0]?.trim()
  } catch {
    return undefined
  }
}

/** Check the external tools dsh-live relies on. */
export async function checkDeps(whisperModel: string): Promise<DepStatus[]> {
  const out: DepStatus[] = []
  const ytdlp = await which('yt-dlp')
  out.push({ name: 'yt-dlp', ok: !!ytdlp, version: ytdlp ? await version(ytdlp, ['--version']) : undefined, hint: 'brew install yt-dlp' })
  const ffmpeg = await which('ffmpeg')
  out.push({ name: 'ffmpeg', ok: !!ffmpeg, version: ffmpeg ? await version(ffmpeg, ['-version']) : undefined, hint: 'brew install ffmpeg' })
  const ws = await which('whisper-server')
  out.push({ name: 'whisper-server', ok: !!ws, hint: 'brew install whisper-cpp (local subtitles)' })
  out.push({ name: 'whisper model', ok: existsSync(whisperModel), version: whisperModel, hint: 'download ggml-large-v3-turbo-q5_0.bin from huggingface.co/ggerganov/whisper.cpp' })
  const mtx = await which('mediamtx')
  out.push({ name: 'mediamtx', ok: !!mtx, hint: 'brew install mediamtx (restreaming)' })
  return out
}
