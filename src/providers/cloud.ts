import type { KeyName } from '../keys.ts'
import { ISO } from '../whisper.ts'
import type { ChunkEngine } from './local.ts'

/** An online speech service: which key it needs, where to get one, and how it is called. */
export interface CloudService {
  /** Engine id (what the page picks). */
  id: string
  /** Key it uses (OpenAI's live translation shares the OpenAI key). */
  key: KeyName
  label: string
  /** Page where a key can be created. */
  keyUrl: string
  /** Default model (overridable in the plugin settings). */
  model: string
  /** 'realtime' / 'translate' stream audio (OpenAI); the others transcribe chunk by chunk. */
  kind: 'realtime' | 'translate' | 'whisper-api' | 'gemini' | 'deepgram' | 'elevenlabs' | 'dashscope' | 'volc'
  /** OpenAI-compatible /audio/transcriptions base URL. */
  base?: string
  /** Where the service is run from, for grouping the list ('cn' = mainland China). */
  region: 'intl' | 'cn'
  /** Model name shown on the page, when it differs from `model`. */
  modelLabel?: string
}

export const SERVICES: CloudService[] = [
  { id: 'openai', key: 'openai', label: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys', model: 'gpt-live-transcribe', region: 'intl', kind: 'realtime' },
  // Speech in, translation out (and the source text), in one streaming pass: no LLM translation needed.
  { id: 'openai-translate', key: 'openai', label: 'OpenAI live translation', keyUrl: 'https://platform.openai.com/api-keys', model: 'gpt-realtime-translate', region: 'intl', kind: 'translate' },
  // 'auto' = Gemini 3.5 Transcribe when the key can use it, else the newest Flash.
  { id: 'gemini', key: 'gemini', label: 'Google Gemini', keyUrl: 'https://aistudio.google.com/apikey', model: 'auto', modelLabel: 'gemini-3.5-transcribe', region: 'intl', kind: 'gemini' },
  { id: 'deepgram', key: 'deepgram', label: 'Deepgram', keyUrl: 'https://console.deepgram.com/', model: 'nova-3', region: 'intl', kind: 'deepgram' },
  { id: 'elevenlabs', key: 'elevenlabs', label: 'ElevenLabs', keyUrl: 'https://elevenlabs.io/app/settings/api-keys', model: 'scribe_v2', region: 'intl', kind: 'elevenlabs' },
  { id: 'mistral', key: 'mistral', label: 'Mistral', keyUrl: 'https://console.mistral.ai/api-keys', model: 'voxtral-mini-latest', region: 'intl', kind: 'whisper-api', base: 'https://api.mistral.ai/v1' },
  { id: 'groq', key: 'groq', label: 'Groq', keyUrl: 'https://console.groq.com/keys', model: 'whisper-large-v3-turbo', region: 'intl', kind: 'whisper-api', base: 'https://api.groq.com/openai/v1' },
  { id: 'dashscope', key: 'dashscope', label: 'Alibaba Cloud Bailian', keyUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key', model: 'qwen3-asr-flash', region: 'cn', kind: 'dashscope', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'volc', key: 'volc', label: 'Volcengine Doubao', keyUrl: 'https://console.volcengine.com/speech/new/', model: 'volc.bigasr.auc_turbo', modelLabel: 'Seed-ASR 极速版', region: 'cn', kind: 'volc' },
  { id: 'siliconflow', key: 'siliconflow', label: 'SiliconFlow', keyUrl: 'https://cloud.siliconflow.cn/account/ak', model: 'FunAudioLLM/SenseVoiceSmall', region: 'cn', kind: 'whisper-api', base: 'https://api.siliconflow.cn/v1' },
  { id: 'glm', key: 'glm', label: 'Zhipu GLM', keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys', model: 'glm-asr-2512', region: 'cn', kind: 'whisper-api', base: 'https://open.bigmodel.cn/api/paas/v4' },
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
  if (/api\.mistral\.ai|^ mistral$/.test(k)) return 'mistral'
  if (/dashscope|maas\.aliyuncs\.com|^ (dashscope|bailian|aliyun|qwen)$/.test(k)) return 'dashscope'
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

/** Glossary terms from a recogniser hint ("Glossary: a, b, c. …"), for services that take a word list. */
const termsOf = (prompt: string): string[] => (/Glossary: ([^\n]*?)\.(?:\s|$)/.exec(prompt)?.[1] ?? '').split(', ').map(x => x.trim()).filter(Boolean)

/** Three-letter language codes some services answer with, to the two-letter ones used here. */
const ISO3: Record<string, string> = { eng: 'en', zho: 'zh', cmn: 'zh', yue: 'yue', jpn: 'ja', kor: 'ko', fra: 'fr', deu: 'de', spa: 'es', por: 'pt', rus: 'ru', ita: 'it', ara: 'ar', hin: 'hi', vie: 'vi', tha: 'th', ind: 'id' }
const lang2 = (l?: string) => { if (!l) return undefined; const k = l.toLowerCase().split(/[-_]/)[0]!; return ISO3[k] ?? (ISO[k] ?? k) }

/** Deepgram (Nova-3): one request per chunk, glossary as key terms, language detected per chunk. */
export function deepgramEngine(model: string, key: () => string | undefined): ChunkEngine {
  return {
    name: 'deepgram',
    async transcribe(wav, lang, prompt) {
      const apiKey = key()
      if (!apiKey) throw new Error('no Deepgram key')
      const q = new URLSearchParams({ model, smart_format: 'true', punctuate: 'true' })
      if (lang !== 'auto') q.set('language', lang); else q.set('detect_language', 'true')
      for (const t of termsOf(prompt ?? '').slice(0, 50)) q.append('keyterm', t)
      const r = await fetch(`https://api.deepgram.com/v1/listen?${q}`, { method: 'POST', headers: { Authorization: `Token ${apiKey}`, 'content-type': 'audio/wav' }, body: new Uint8Array(wav), signal: AbortSignal.timeout(TIMEOUT) })
      if (!r.ok) await fail(r)
      const j = await r.json() as { results?: { channels?: { detected_language?: string; alternatives?: { transcript?: string; confidence?: number }[] }[] } }
      const ch = j.results?.channels?.[0]
      return { text: (ch?.alternatives?.[0]?.transcript ?? '').trim(), lang: lang2(ch?.detected_language) }
    },
  }
}

/** ElevenLabs Scribe: multipart upload per chunk; glossary as key terms. */
export function elevenLabsEngine(model: string, key: () => string | undefined): ChunkEngine {
  return {
    name: 'elevenlabs',
    async transcribe(wav, lang, prompt) {
      const apiKey = key()
      if (!apiKey) throw new Error('no ElevenLabs key')
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'chunk.wav')
      form.append('model_id', model)
      form.append('tag_audio_events', 'false')
      if (lang !== 'auto') form.append('language_code', lang)
      for (const t of termsOf(prompt ?? '').slice(0, 50)) form.append('keyterms', t)
      const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': apiKey }, body: form, signal: AbortSignal.timeout(TIMEOUT) })
      if (!r.ok) await fail(r)
      const j = await r.json() as { text?: string; language_code?: string }
      return { text: (j.text ?? '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim(), lang: lang2(j.language_code) }
    },
  }
}

/** Alibaba Cloud Bailian (Qwen3-ASR-Flash), OpenAI-compatible chat call with the chunk inline. */
export function dashscopeEngine(base: string, model: string, key: () => string | undefined): ChunkEngine {
  return {
    name: 'dashscope',
    async transcribe(wav, lang) {
      const apiKey = key()
      if (!apiKey) throw new Error('no Alibaba Cloud Bailian key')
      const body = {
        model, stream: false,
        messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${wav.toString('base64')}` } }] }],
        asr_options: { enable_itn: true, ...(lang !== 'auto' ? { language: lang } : {}) },
      }
      const r = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT) })
      if (!r.ok) await fail(r)
      const j = await r.json() as { choices?: { message?: { content?: string; annotations?: { language?: string }[] } }[] }
      const m = j.choices?.[0]?.message
      return { text: (m?.content ?? '').replace(/\s+/g, ' ').trim(), lang: lang2(m?.annotations?.[0]?.language) }
    },
  }
}

/** Volcengine Doubao speech (recording recognition, flash edition): one request per chunk, API key from the new speech console. */
export function volcEngine(resource: string, key: () => string | undefined): ChunkEngine {
  return {
    name: 'volc',
    async transcribe(wav) {
      const apiKey = key()
      if (!apiKey) throw new Error('no Volcengine speech key')
      const body = { user: { uid: 'dsh-vidi' }, audio: { data: wav.toString('base64') }, request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true } }
      const r = await fetch('https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash', {
        method: 'POST',
        headers: { 'X-Api-Key': apiKey, 'X-Api-Resource-Id': resource, 'X-Api-Request-Id': crypto.randomUUID(), 'X-Api-Sequence': '-1', 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT),
      })
      const code = r.headers.get('X-Api-Status-Code')
      // 20000003 = no speech in this chunk.
      if (code === '20000003') return { text: '' }
      if (!r.ok || (code && code !== '20000000')) {
        const msg = r.headers.get('X-Api-Message') ?? (await r.text().catch(() => '')).slice(0, 200)
        throw new Error(`Volcengine ${code ?? r.status}: ${msg}`)
      }
      const j = await r.json() as { result?: { text?: string } }
      return { text: (j.result?.text ?? '').trim() }
    },
  }
}

/** Newest Gemini Flash model the key can use (when the setting says "auto"). */
async function pickGeminiModel(apiKey: string): Promise<string> {
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(TIMEOUT) })
  if (!r.ok) await fail(r)
  const j = await r.json() as { models?: { name: string; supportedGenerationMethods?: string[] }[] }
  const names = (j.models ?? []).map(m => m.name.replace(/^models\//, ''))
  // The dedicated speech-to-text model when the key has it (Gemini 3.5 Transcribe and later).
  const transcribe = names.filter(n => /^gemini-\d+(\.\d+)?-transcribe$/.test(n)).sort((a, b) => Number(/\d+(\.\d+)?/.exec(b)![0]) - Number(/\d+(\.\d+)?/.exec(a)![0]))
  if (transcribe[0]) return transcribe[0]
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
      if (/-transcribe$/.test(chosen)) return transcribeModel(apiKey, chosen, wav, lang, prompt ?? '', onUsage)
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

const BCP47: Record<string, string> = { zh: 'zh-CN', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', pt: 'pt-BR', ru: 'ru-RU', it: 'it-IT' }

/** Gemini's dedicated transcription model (Interactions API): verbatim text, glossary as custom vocabulary. */
async function transcribeModel(apiKey: string, model: string, wav: Buffer, lang: string, prompt: string, onUsage: (model: string, u: { inputTokens?: number; outputTokens?: number }) => void): Promise<{ text: string; lang?: string }> {
  const vocab = termsOf(prompt).slice(0, 100)
  const body = {
    model: `models/${model}`,
    input: [{ type: 'audio', data: wav.toString('base64'), mime_type: 'audio/wav' }],
    generation_config: {
      transcription_config: {
        ...(lang !== 'auto' ? { language_codes: [BCP47[lang] ?? lang] } : {}),
        ...(vocab.length ? { custom_vocabulary: vocab } : {}),
        mode: { type: 'verbatim' },
      },
    },
  }
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST', headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!r.ok) await fail(r)
  const j = await r.json() as { steps?: { type?: string; content?: { type?: string; text?: string }[] }[]; usage?: { total_input_tokens?: number; total_output_tokens?: number } }
  if (j.usage) onUsage(model, { inputTokens: j.usage.total_input_tokens, outputTokens: j.usage.total_output_tokens })
  const text = (j.steps ?? []).filter(st => st.type === 'model_output').flatMap(st => st.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('')
  const clean = text.replace(/\s+/g, ' ').trim()
  return { text: clean, lang: lang !== 'auto' ? lang : scriptLang(clean) }
}

/** The language a transcript is written in, when its script says so (kana, hangul, Han); else unknown. */
function scriptLang(text: string): string | undefined {
  const n = (re: RegExp) => (text.match(re) ?? []).length
  const han = n(/\p{Script=Han}/gu), kana = n(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu), hangul = n(/\p{Script=Hangul}/gu)
  const letters = n(/\p{L}/gu)
  if (!letters) return undefined
  if (kana > letters * 0.1) return 'ja'
  if (hangul > letters * 0.3) return 'ko'
  if (han > letters * 0.3) return 'zh'
  return undefined
}

/** Check a key before saving it: a cheap authenticated read on the service. */
export async function verifyKey(svc: CloudService, key: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const probe: { url: string; headers: Record<string, string> } | null =
      svc.kind === 'gemini' ? { url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', headers: { 'x-goog-api-key': key } }
        : svc.key === 'openai' ? { url: 'https://api.openai.com/v1/models', headers: { Authorization: `Bearer ${key}` } }
          : svc.kind === 'deepgram' ? { url: 'https://api.deepgram.com/v1/projects', headers: { Authorization: `Token ${key}` } }
            : svc.kind === 'elevenlabs' ? { url: 'https://api.elevenlabs.io/v1/models', headers: { 'xi-api-key': key } }
              // Zhipu and Volcengine speech have no free authenticated read: accept the key, the first request reports problems.
              : svc.id === 'glm' || svc.kind === 'volc' ? null
                : { url: `${svc.base}/models`, headers: { Authorization: `Bearer ${key}` } }
    if (!probe) return { ok: true }
    const r = await fetch(probe.url, { headers: probe.headers, signal: AbortSignal.timeout(10_000) })
    if (r.ok) return { ok: true }
    const body = await r.json().catch(() => ({})) as { error?: { message?: string } | string; message?: string; detail?: { message?: string } | string; err_msg?: string }
    const detail = typeof body.detail === 'object' ? body.detail?.message : body.detail
    return { ok: false, message: (typeof body.error === 'object' ? body.error?.message : body.error) ?? body.message ?? detail ?? body.err_msg ?? `HTTP ${r.status}` }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}
