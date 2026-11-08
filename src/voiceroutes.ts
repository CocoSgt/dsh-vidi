import { spawn, type ChildProcess } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { CLONE_VENDORS, cloneVoice, ffmpegBuffer, PRESETS, SAMPLE_RATE, speak, VOICE_VENDORS, VoiceLibrary, wav, type DubSettings, type SpeakDeps, type VoiceVendor } from './dub.ts'
import { deviceInput, listDevices } from './devices.ts'
import type { LiveJob } from './job.ts'

/** What to read aloud for a voice sample (about ten seconds, the way people talk). */
export const READ_ALOUD: Record<string, string> = {
  zh: '今天想跟你聊聊最近发生的几件事。有些挺有意思，有些让人意外。我会慢慢说，你有什么想法，随时打断我。',
  en: "Today I'd like to talk about a few things that happened recently. Some are interesting, some are surprising. I'll take it slowly, so feel free to jump in any time.",
}

/** Sentences to try a voice with, per language. */
const TRY_TEXT: Record<string, string> = {
  zh: '大家好，这是视频的中文配音，听起来怎么样？',
  en: 'Hi everyone, this is the English voiceover. How does it sound?',
  ja: 'こんにちは、これは日本語の吹き替えです。いかがでしょうか。',
  ko: '안녕하세요, 한국어 더빙입니다. 어떻게 들리나요?',
  fr: "Bonjour à tous, voici le doublage en français. Qu'en pensez-vous ?",
  de: 'Hallo zusammen, das ist die deutsche Synchronisation. Wie klingt sie?',
  es: 'Hola a todos, este es el doblaje en español. ¿Qué tal suena?',
}

export interface VoiceRoutesDeps {
  dataDir: string
  speakDeps: SpeakDeps
  library: VoiceLibrary
  loadJob: (id: string) => LiveJob | undefined
  dubPrefs: () => Partial<DubSettings>
  saveDubPrefs: (p: Partial<DubSettings>) => void
  readJson: (req: IncomingMessage) => Promise<Record<string, unknown>>
  send: (res: ServerResponse, status: number, body: unknown) => void
  log: (m: string) => void
}

/** The service a voice belongs to. */
export function vendorOf(library: VoiceLibrary, voice: string): VoiceVendor | undefined {
  const [kind, id = ''] = voice.split(/:(.*)/s) as [string, string]
  if (kind === 'mine') return library.get(id)?.vendor
  return (VOICE_VENDORS as string[]).includes(kind) ? kind as VoiceVendor : undefined
}

/**
 * Voiceover and voice routes (under /live/api/): the video's voiceover
 * settings and clips, the voices on offer, trying one, and making one from
 * a recording (the microphone, a file, or someone in the video).
 */
export function voiceRoutes(d: VoiceRoutesDeps) {
  const tmpDir = join(d.dataDir, 'voices', 'tmp')
  mkdirSync(tmpDir, { recursive: true })
  const tmpPath = (id: string) => join(tmpDir, `${id.replace(/[^\w-]/g, '')}.wav`)
  const ready = (v: VoiceVendor) => !!d.speakDeps.key(v)

  /** One microphone recording at a time: its ffmpeg, the file, and how loud it is now (for the meter). */
  type Rec = { proc: ChildProcess; id: string; startedAt: number; level: number; error?: string; done?: Promise<void> }
  let rec = undefined as Rec | undefined

  /** Turn any audio into a sample: 24 kHz mono WAV, at most 30 s, loudness evened out. */
  const toSample = async (input: Buffer, id: string): Promise<number> => {
    const pcm = await ffmpegBuffer(['-i', 'pipe:0', '-t', '30', '-af', 'highpass=f=70,loudnorm=I=-18:TP=-2', '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', 'pipe:1'], input)
    writeFileSync(tmpPath(id), wav(pcm))
    return pcm.length / (SAMPLE_RATE * 2)
  }

  const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

  return async (route: string, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    const { send, readJson } = d
    if (route === 'dub' && req.method === 'POST') {
      // { jobId, on?, lang?, voice?, original? }: change this video's voiceover.
      const b = await readJson(req)
      const job = d.loadJob(String(b.jobId))
      if (!job) { send(res, 404, { error: 'no such job' }); return true }
      const patch: Partial<DubSettings> = {}
      if (typeof b.on === 'boolean') patch.on = b.on
      if (typeof b.lang === 'string') patch.lang = b.lang
      if (typeof b.voice === 'string' && vendorOf(d.library, b.voice)) patch.voice = b.voice
      if (b.original === 'duck' || b.original === 'off') patch.original = b.original
      const view = await job.setDub(patch)
      d.saveDubPrefs({ voice: view.voice, original: view.original, lang: view.lang })
      if (typeof b.at === 'number') job.dub.setFocus('page', b.at)
      send(res, 200, view)
      return true
    }
    if (route === 'dub/focus' && req.method === 'POST') {
      // Where the page is playing: voices are made ahead of it.
      const b = await readJson(req)
      const job = d.loadJob(String(b.jobId))
      if (job && job.opts.dub?.on) job.dub.setFocus('page', typeof b.at === 'number' ? b.at : undefined)
      send(res, 200, { ok: true })
      return true
    }
    if (route === 'dub/clip') {
      const job = d.loadJob(url.searchParams.get('jobId') ?? '')
      const file = job?.dub.clipFile(Number(url.searchParams.get('id')))
      if (!file) { res.writeHead(404); res.end(); return true }
      res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'max-age=31536000, immutable', 'content-length': String(statSync(file).size) })
      createReadStream(file).pipe(res)
      return true
    }
    if (route === 'voices' && req.method !== 'POST') {
      // What can be chosen: preset voices of services with a key, voices made from recordings, who can make them.
      const ui = url.searchParams.get('ui') === 'en' ? 'en' : 'zh'
      send(res, 200, {
        vendors: VOICE_VENDORS.filter(ready),
        presets: PRESETS.filter(p => ready(p.vendor)).map(p => ({ id: `${p.vendor}:${p.id}`, vendor: p.vendor, label: p[ui] })),
        mine: d.library.list().map(v => ({ id: `mine:${v.id}`, vendor: v.vendor, label: v.name, ready: ready(v.vendor), createdAt: v.createdAt })),
        clone: CLONE_VENDORS.filter(ready),
        readAloud: READ_ALOUD[ui] ?? READ_ALOUD.en,
        defaults: d.dubPrefs(),
      })
      return true
    }
    if (route === 'voices/try' && req.method === 'POST') {
      // { voice, lang, text? }: a sentence in that voice, as WAV.
      const b = await readJson(req)
      const lang = String(b.lang ?? 'zh')
      const text = typeof b.text === 'string' && b.text.trim() ? b.text.slice(0, 200) : TRY_TEXT[lang.split('-')[0]!] ?? TRY_TEXT.en!
      try {
        const pcm = await speak(d.speakDeps, String(b.voice), text, lang)
        res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'no-store' })
        res.end(wav(pcm))
      } catch (err) { send(res, 502, { error: (err as Error).message }) }
      return true
    }
    if (route === 'voices/record') {
      if (req.method !== 'POST') {
        // How the recording is going (polled while it runs).
        send(res, 200, rec ? { state: rec.done ? 'stopping' : 'recording', id: rec.id, sec: (Date.now() - rec.startedAt) / 1000, level: rec.level, error: rec.error } : { state: 'idle' })
        return true
      }
      const b = await readJson(req)
      if (b.action === 'start') {
        if (rec) { rec.proc.kill('SIGKILL'); rec = undefined }
        const mics = (await listDevices()).filter(x => x.kind === 'mic')
        const mic = mics.find(m => m.id === b.mic) ?? mics.find(m => m.preferred) ?? mics[0]
        if (!mic) { send(res, 400, { error: 'no microphone' }); return true }
        const id = newId()
        const input = deviceInput({ audio: mic.id }, [])
        // The sample to a file, and a small copy of the sound on stdout for the level meter.
        const proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...input.args, '-t', '30',
          '-map', input.audio, '-ac', '1', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le', join(tmpDir, `${id}.raw.wav`),
          '-map', input.audio, '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] })
        const r: Rec = { proc, id, startedAt: Date.now(), level: 0 }
        rec = r
        let err = ''
        proc.stderr!.on('data', x => { err = (err + x).slice(-300) })
        proc.stdout!.on('data', (pcm: Buffer) => {
          let peak = 0
          for (let i = 0; i + 1 < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)))
          r.level = Math.max(peak / 32768, r.level * 0.7)
        })
        proc.on('exit', code => { if (code && !r.done) r.error = err.trim().split('\n').pop() || 'the microphone could not be opened' })
        send(res, 200, { state: 'recording', id, mic: mic.name })
        return true
      }
      if (b.action === 'stop' || b.action === 'cancel') {
        const r = rec
        if (!r) { send(res, 200, { state: 'idle' }); return true }
        r.done = new Promise(ok => { r.proc.once('exit', () => ok()); setTimeout(ok, 3000) })
        // "q" lets ffmpeg finish the file properly.
        try { r.proc.stdin!.write('q') } catch {}
        await r.done
        rec = undefined
        const raw = join(tmpDir, `${r.id}.raw.wav`)
        if (b.action === 'cancel' || !existsSync(raw)) { rmSync(raw, { force: true }); send(res, 200, { state: 'idle', error: r.error }); return true }
        try {
          const dur = await toSample(readFileSync(raw), r.id)
          rmSync(raw, { force: true })
          send(res, 200, { state: 'done', sample: r.id, dur })
        } catch (err) { send(res, 500, { error: (err as Error).message }) }
        return true
      }
      send(res, 400, { error: 'unknown action' })
      return true
    }
    if (route === 'voices/upload' && req.method === 'POST') {
      // Raw audio (or video) file as the body.
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      const id = newId()
      try { send(res, 200, { sample: id, dur: await toSample(Buffer.concat(chunks), id) }) } catch (err) { send(res, 400, { error: (err as Error).message }) }
      return true
    }
    if (route === 'voices/fromVideo' && req.method === 'POST') {
      // { jobId, at }: someone talking in the video near `at` (lines in a row, 8–20 s), with what they say.
      const b = await readJson(req)
      const job = d.loadJob(String(b.jobId))
      if (!job) { send(res, 404, { error: 'no such job' }); return true }
      const at = typeof b.at === 'number' ? b.at : 0
      const lines = job.cues.filter(c => c.final && c.src.trim())
      let best: { from: number; to: number; text: string; score: number } | undefined
      for (let i = 0; i < lines.length; i++) {
        const run = [lines[i]!]
        // One speaker (when known), no long pauses, about ten seconds of talk.
        for (let k = i + 1; k < lines.length && lines[k]!.end - run[0]!.start <= 20; k++) {
          const c = lines[k]!
          if (c.start - run.at(-1)!.end > 0.8 || (c.speaker && run[0]!.speaker && c.speaker !== run[0]!.speaker)) break
          run.push(c)
        }
        const from = run[0]!.start, to = run.at(-1)!.end
        if (to - from < 7) continue
        const score = Math.abs(from - at) + Math.abs(to - from - 12)
        if (!best || score < best.score) best = { from, to, text: run.map(c => c.src.trim()).join(' '), score }
      }
      if (!best) { send(res, 400, { error: 'no stretch of talk long enough yet (subtitles needed)' }); return true }
      const id = newId()
      try {
        const dur = await toSample(await job.audio(best.from, best.to), id)
        send(res, 200, { sample: id, dur, text: best.text, from: best.from, to: best.to })
      } catch (err) { send(res, 500, { error: (err as Error).message }) }
      return true
    }
    if (route === 'voices/sample') {
      // A recording to listen to: a fresh sample (?sample=) or a saved voice's (?id=).
      const s = url.searchParams.get('sample'), id = url.searchParams.get('id')
      const file = s ? tmpPath(s) : id ? d.library.samplePath(id.replace(/^mine:/, '')) : ''
      if (!file || !existsSync(file)) { res.writeHead(404); res.end(); return true }
      res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'no-store' })
      createReadStream(file).pipe(res)
      return true
    }
    if (route === 'voices/save' && req.method === 'POST') {
      // { sample, name, text, vendor }: make a voice from a sample.
      const b = await readJson(req)
      const file = tmpPath(String(b.sample ?? ''))
      if (!existsSync(file)) { send(res, 404, { error: 'the recording is gone, record again' }); return true }
      const vendor = (CLONE_VENDORS as string[]).includes(String(b.vendor)) ? b.vendor as VoiceVendor : CLONE_VENDORS.find(ready)
      if (!vendor || !ready(vendor)) { send(res, 400, { error: 'no service that can learn a voice (SiliconFlow or ElevenLabs key needed)' }); return true }
      const sample = readFileSync(file)
      const name = String(b.name ?? '').trim().slice(0, 40) || 'My voice'
      const text = String(b.text ?? '').trim()
      try {
        const remote = await cloneVoice(d.speakDeps, vendor, name, sample, text)
        const id = newId()
        d.library.add({ id, name, vendor, remote, text, createdAt: Date.now() }, sample)
        rmSync(file, { force: true })
        send(res, 200, { id: `mine:${id}` })
      } catch (err) { send(res, 502, { error: (err as Error).message }) }
      return true
    }
    if (route === 'voices/remove' && req.method === 'POST') {
      const b = await readJson(req)
      d.library.remove(String(b.id ?? '').replace(/^mine:/, ''))
      send(res, 200, { ok: true })
      return true
    }
    if (route === 'voices/rename' && req.method === 'POST') {
      const b = await readJson(req)
      d.library.rename(String(b.id ?? '').replace(/^mine:/, ''), String(b.name ?? '').trim().slice(0, 40))
      send(res, 200, { ok: true })
      return true
    }
    return false
  }
}
