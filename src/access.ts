import { execFile, spawn } from 'node:child_process'

/**
 * Camera / microphone permission for the app Vidi runs in. On macOS a program
 * this host starts counts as the app itself, so a small system script can read
 * the app's permission and ask for it (the system dialog names the app); the
 * capture that follows (ffmpeg) is then allowed. Elsewhere there is nothing to
 * ask: capture just tries.
 */
export type AccessKind = 'camera' | 'microphone' | 'screen'
export type AccessState = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'

const LOAD = '$.NSBundle.bundleWithPath("/System/Library/Frameworks/AVFoundation.framework").load; const D = $.NSClassFromString("AVCaptureDevice");'
const MEDIA: Record<'camera' | 'microphone', string> = { camera: 'vide', microphone: 'soun' }
const STATES: AccessState[] = ['not-determined', 'restricted', 'denied', 'granted']

function jxa(script: string, timeout: number): Promise<string> {
  return new Promise(resolve => {
    execFile('osascript', ['-l', 'JavaScript', '-e', script], { timeout }, (err, out) => resolve(err ? '' : String(out).trim()))
  })
}

/** This app's camera and microphone permission (macOS); 'unknown' elsewhere. */
export async function accessStatus(): Promise<Record<'camera' | 'microphone', AccessState>> {
  if (process.platform !== 'darwin') return { camera: 'unknown', microphone: 'unknown' }
  const out = await jxa(`${LOAD} JSON.stringify({ camera: D.authorizationStatusForMediaType("vide"), microphone: D.authorizationStatusForMediaType("soun") })`, 10_000)
  try {
    const j = JSON.parse(out) as Record<string, string>
    return { camera: STATES[Number(j.camera)] ?? 'unknown', microphone: STATES[Number(j.microphone)] ?? 'unknown' }
  } catch { return { camera: 'unknown', microphone: 'unknown' } }
}

/** Ask once (the system dialog); answers the state afterwards. Already decided: just the state. */
export async function askAccess(kind: 'camera' | 'microphone'): Promise<AccessState> {
  if (process.platform !== 'darwin') return 'unknown'
  const before = (await accessStatus())[kind]
  if (before !== 'not-determined') return before
  await jxa(`${LOAD} let done = null; D.requestAccessForMediaTypeCompletionHandler("${MEDIA[kind]}", ok => { done = ok });
    const end = Date.now() + 120000;
    while (done === null && Date.now() < end) $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.2));
    String(done)`, 130_000)
  return (await accessStatus())[kind]
}

/** Open the system's privacy page for this kind of device, where the app can be switched on. */
export function openPrivacySettings(kind: AccessKind): boolean {
  if (process.platform === 'darwin') {
    const pane = kind === 'camera' ? 'Privacy_Camera' : kind === 'microphone' ? 'Privacy_Microphone' : 'Privacy_ScreenCapture'
    spawn('open', [`x-apple.systempreferences:com.apple.preference.security?${pane}`], { stdio: 'ignore', detached: true }).unref()
    return true
  }
  if (process.platform === 'win32') {
    const page = kind === 'camera' ? 'privacy-webcam' : kind === 'microphone' ? 'privacy-microphone' : 'privacy'
    spawn('cmd', ['/c', 'start', '', `ms-settings:${page}`], { stdio: 'ignore', detached: true }).unref()
    return true
  }
  return false
}
