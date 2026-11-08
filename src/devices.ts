import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

/**
 * Cameras, screens and microphones on the computer Vidi runs on, read
 * through ffmpeg (AVFoundation on macOS, DirectShow on Windows, V4L2 +
 * PulseAudio on Linux), so a talk in front of the camera can be subtitled
 * without OBS.
 */
export interface Device {
  /** What ffmpeg opens it by (the name, or an index/path where names do not work). */
  id: string
  name: string
  kind: 'camera' | 'screen' | 'mic'
}

/** Which devices to open: a camera or screen, a microphone, or both. */
export interface DeviceChoice { video?: string; audio?: string }

function ffmpegList(args: string[]): Promise<string> {
  return new Promise(resolve => {
    // Listing "fails" by design (there is no input); the list is on stderr.
    execFile('ffmpeg', ['-hide_banner', ...args], { timeout: 8000 }, (_err, _out, err) => resolve(String(err ?? '')))
  })
}

export async function listDevices(): Promise<Device[]> {
  if (process.platform === 'darwin') {
    const text = await ffmpegList(['-f', 'avfoundation', '-list_devices', 'true', '-i', ''])
    const out: Device[] = []
    let section: 'video' | 'audio' | undefined
    for (const line of text.split('\n')) {
      if (/video devices:/i.test(line)) section = 'video'
      else if (/audio devices:/i.test(line)) section = 'audio'
      const m = /\]\s+\[(\d+)\]\s+(.+?)\s*$/.exec(line)
      if (!m || !section) continue
      const [, index, name] = m as unknown as [string, string, string]
      // "a:b" separates the video and audio device, so a name with a colon is opened by its index.
      const id = name.includes(':') ? index : name
      if (section === 'audio') out.push({ id, name, kind: 'mic' })
      else out.push({ id, name: name.replace(/^Capture screen (\d+)$/, 'Screen $1'), kind: /^Capture screen/.test(name) ? 'screen' : 'camera' })
    }
    // Virtual sound cards (streaming apps, meeting apps) are not microphones.
    return out.filter(d => !(d.kind === 'mic' && /speakers|audio device|blackhole|soundflower|loopback/i.test(d.name)))
  }
  if (process.platform === 'win32') {
    const text = await ffmpegList(['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'])
    const out: Device[] = []
    let section: 'video' | 'audio' | undefined
    for (const line of text.split('\n')) {
      if (/DirectShow video devices/i.test(line)) section = 'video'
      else if (/DirectShow audio devices/i.test(line)) section = 'audio'
      if (/Alternative name/i.test(line)) continue
      const m = /"([^"]+)"\s*(?:\((video|audio)\))?/.exec(line)
      if (!m) continue
      const kind = m[2] ?? section
      if (kind) out.push({ id: m[1]!, name: m[1]!, kind: kind === 'audio' ? 'mic' : 'camera' })
    }
    return out
  }
  // Linux: V4L2 cameras and the default PulseAudio/PipeWire input.
  const cams = existsSync('/dev') ? readdirSync('/dev').filter(f => /^video\d+$/.test(f)) : []
  return [
    ...cams.map(f => {
      let name = f
      try { name = readFileSync(`/sys/class/video4linux/${f}/name`, 'utf8').trim() || f } catch {}
      return { id: `/dev/${f}`, name, kind: 'camera' as const }
    }),
    { id: 'default', name: 'Default microphone', kind: 'mic' as const },
  ]
}

/** ffmpeg input for the chosen devices: arguments plus which streams carry the picture and the sound. */
export function deviceInput(c: DeviceChoice, q: string[]): { args: string[]; audio: string; video?: string } {
  if (!c.audio) throw new Error('choose a microphone')
  if (process.platform === 'darwin') {
    return {
      args: [...q, '-f', 'avfoundation', '-framerate', '30', ...(c.video ? ['-capture_cursor', '1'] : []), '-i', `${c.video ?? 'none'}:${c.audio}`],
      audio: '0:a:0', video: c.video ? '0:v:0' : undefined,
    }
  }
  if (process.platform === 'win32') {
    return {
      args: [...q, '-f', 'dshow', '-rtbufsize', '256M', '-i', [c.video ? `video=${c.video}` : '', `audio=${c.audio}`].filter(Boolean).join(':')],
      audio: '0:a:0', video: c.video ? '0:v:0' : undefined,
    }
  }
  return c.video
    ? { args: [...q, '-f', 'v4l2', '-framerate', '30', '-i', c.video, ...q, '-f', 'pulse', '-i', c.audio], audio: '1:a:0', video: '0:v:0' }
    : { args: [...q, '-f', 'pulse', '-i', c.audio], audio: '0:a:0' }
}
