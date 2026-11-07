import type { KeyName } from '../keys.ts'
import { ISO } from '../whisper.ts'
import type { ChunkEngine } from './local.ts'

/** An online speech service: which key it needs, where to get one, and how it is called. */
export interface CloudService {
  id: KeyName
  label: string
  /** Page where a key can be created. */
  keyUrl: string
  /** Default model (overridable in the plugin settings). */
  model: string
  /** 'realtime' streams audio (OpenAI); the others transcribe chunk by chunk. */
  kind: 'realtime' | 'whisper-api' | 'gemini'
  /** OpenAI-compatible /audio/transcriptions base URL. */
  base?: string
}

export const SERVICES: CloudService[] = [
  { id: 'openai', label: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys', model: 'gpt-live-transcribe', kind: 'realtime' },
  { id: 'gemini', label: 'Google Gemini', keyUrl: 'https://aistudio.google.com/apikey', model: 'auto', kind: 'gemini' },
  { id: 'groq', label: 'Groq', keyUrl: 'https://console.groq.com/keys', model: 'whisper-large-v3-turbo', kind: 'whisper-api', base: 'https://api.groq.com/openai/v1' },
  { id: 'siliconflow', label: 'SiliconFlow', keyUrl: 'https://cloud.siliconflow.cn/account/ak', model: 'FunAudioLLM/SenseVoiceSmall', kind: 'whisper-api', base: 'https://api.siliconflow.cn/v1' },
  { id: 'glm', label: 'Zhipu GLM', keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys', model: 'glm-asr-2512', kind: 'whisper-api', base: 'https://open.bigmodel.cn/api/paas/v4' },
]

export const service = (id: string) => SERVICES.find(s => s.id === id)

/** Which speech service a DSH model provider also is, by its address (or its id when it has none). */
export function speechServiceOf(id: string, baseURL?: string): KeyName | undefined {
  const host = (() => { try { return baseURL ? new URL(baseURL).host : '' } catch { return '' } })()
  const k = `${host} ${id}`.toLowerCase()
  if (/generativelanguage\.googleapis\.com|^ (google|gemini)$/.test(k)) return 'gemini'
  if (/api\.openai\.com|^ openai$/.test(k)) return 'openai'
  if (/api\.groq\.com|^ groq$/.test(k)) return 'groq'
  if (/siliconflow/.test(k)) return 'siliconflow'
  if (/bigmodel\.cn|(^|\.)z\.ai|^ (glm|zhipu|zhipuai|zai)$/.test(k)) return 'glm'
  return undefined
}

const TIMEOUT = 30_000

async function fail(r: Response): Promise<never> {
  const body = await r.text().catch(() => '')
  let msg = body.slice(0, 200)
  try { const j = JSON.parse(body); msg = j.error?.message ?? j.message ?? j.error ?? msg } catch {}
  throw new Error(`${r.status} ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`.trim())
}

/**
 * OpenAI-compatible file transcription (Groq, SiliconFlow, Zhipu…): one
 * request per chunk. Groq's whisper returns timed segments and the language.
 */
export function whisperApiEngine(svc: CloudService, model: string, key: () => string | undefined): ChunkEngine {
  return {
    name: svc.id,
    async transcribe(wav, lang, prompt) {
      const apiKey = key()
      if (!apiKey) throw new Error(`no ${svc.label} key`)
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'chunk.wav')
      form.append('model', model)
      if (svc.id === 'groq') {
        form.append('response_format', 'verbose_json')
        form.append('temperature', '0')
        if (lang !== 'auto') form.append('language', lang)
        if (prompt) form.append('prompt', prompt.slice(-600))
      } else if (svc.id === 'glm' && prompt) {
        form.append('prompt', prompt.slice(-600))
      }
      const r = await fetch(`${svc.base}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(TIMEOUT) })
      if (!r.ok) await fail(r)
      const j = await r.json() as { text?: string; language?: string; segments?: { start: number; end: number; text: string; avg_logprob?: number }[] }
      // SenseVoice may tag emotions/events like <|HAPPY|> or emoji; keep the words.
      const text = (j.text ?? '').replace(/<\|[^|]*\|>/g, '').replace(/[\u{1F300}-\u{1FAFF}]/gu, '').replace(/\s+/g, ' ').trim()
      const lps = (j.segments ?? []).map(x => x.avg_logprob).filter((x): x is number => typeof x === 'number')
      return {
        text,
        lang: j.language ? (ISO[j.language.toLowerCase()] ?? j.language) : undefined,
        logprob: lps.length ? lps.reduce((a, b) => a + b, 0) / lps.length : undefined,
        segments: j.segments?.map(x => ({ start: x.start, end: x.end, text: x.text })),
      }
    },
  }
}

/** Newest Gemini Flash model the key can use (when the setting says "auto"). */
async function pickGeminiModel(apiKey: string): Promise<string> {
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(TIMEOUT) })
  if (!r.ok) await fail(r)
  const j = await r.json() as { models?: { name: string; supportedGenerationMethods?: string[] }[] }
  const flash = (j.models ?? [])
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .filter(n => /^gemini-\d+(\.\d+)?-flash(-preview)?$/.test(n))
  const version = (n: string) => Number(/^gemini-(\d+(?:\.\d+)?)/.exec(n)![1])
  flash.sort((a, b) => version(b) - version(a) || (a.includes('preview') ? 1 : 0) - (b.includes('preview') ? 1 : 0))
  return flash[0] ?? 'gemini-2.5-flash'
}

/**
 * Google Gemini: each chunk goes up as inline audio with a strict
 * "transcribe verbatim" instruction and comes back as JSON with the
 * language. Token usage is reported to the meter.
 */
export function geminiEngine(model: string, key: () => string | undefined, onUsage: (model: string, u: { inputTokens?: number; outputTokens?: number }) => void, log: (m: string) => void): ChunkEngine {
  let chosen = model !== 'auto' ? model : ''
  /** Index into the thinking settings tried below (kept once one works). */
  let think = 0
  return {
    name: 'gemini',
    async acquire() {
      const apiKey = key()
      if (!apiKey) throw new Error('no Google Gemini key')
      if (!chosen) { chosen = await pickGeminiModel(apiKey); log(`gemini: using ${chosen}`) }
    },
    async transcribe(wav, lang, prompt) {
      const apiKey = key()
      if (!apiKey) throw new Error('no Google Gemini key')
      const instruction = [
        'Transcribe the speech in this audio exactly as spoken, in the language spoken (do not translate).',
        lang !== 'auto' ? `The speaker uses language code "${lang}".` : '',
        'Add normal punctuation. If there is no speech (silence, music, noise), return an empty text.',
        prompt ? `Context that may help with names and terms (do not copy it): ${prompt.slice(-600)}` : '',
        'Reply with JSON: {"lang":"<ISO 639-1 code>","text":"…"}',
      ].filter(Boolean).join('\n')
      // Least thinking the model accepts: models differ, so step down the list on a refusal and remember.
      const thinking = [
        /^gemini-2\./.test(chosen) ? { thinkingBudget: 0 } : { thinkingLevel: 'minimal' },
        { thinkingLevel: 'low' },
        undefined,
      ].slice(think)
      let r: Response | undefined
      for (const cfg of thinking) {
        const body = {
          contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'audio/wav', data: wav.toString('base64') } }, { text: instruction }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json', ...(cfg ? { thinkingConfig: cfg } : {}) },
        }
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(chosen)}:generateContent`, {
          method: 'POST', headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT),
        })
        if (r.status === 400 && cfg && /think/i.test(await r.clone().text())) { think++; continue }
        break
      }
      if (!r!.ok) await fail(r!)
      const j = await r!.json() as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } }
      if (j.usageMetadata) onUsage(chosen, { inputTokens: j.usageMetadata.promptTokenCount, outputTokens: (j.usageMetadata.candidatesTokenCount ?? 0) + (j.usageMetadata.thoughtsTokenCount ?? 0) })
      const out = (j.candidates?.[0]?.content?.parts ?? []).filter(p => !p.thought).map(p => p.text ?? '').join('')
      let parsed: { lang?: string; text?: string } = {}
      try { parsed = JSON.parse(out.match(/\{[\s\S]*\}/)?.[0] ?? '{}') } catch {}
      return { text: (parsed.text ?? '').replace(/\s+/g, ' ').trim(), lang: parsed.lang?.toLowerCase().split('-')[0] }
    },
  }
}

/** Check a key before saving it: a cheap authenticated read on the service. */
export async function verifyKey(svc: CloudService, key: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const url = svc.kind === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1'
      : svc.id === 'openai' ? 'https://api.openai.com/v1/models'
        : svc.id === 'glm' ? null
          : `${svc.base}/models`
    // Zhipu has no free listing endpoint: accept the key and let the first request report problems.
    if (!url) return { ok: true }
    const r = await fetch(url, { headers: svc.kind === 'gemini' ? { 'x-goog-api-key': key } : { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) })
    if (r.ok) return { ok: true }
    const body = await r.json().catch(() => ({})) as { error?: { message?: string } | string; message?: string }
    return { ok: false, message: (typeof body.error === 'object' ? body.error?.message : body.error) ?? body.message ?? `HTTP ${r.status}` }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}
