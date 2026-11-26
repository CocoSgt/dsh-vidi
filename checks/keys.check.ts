/**
 * Speech keys: one entered on DSH's Models page (stored as a record, "llm-pi-ai/openai") is found, the
 * usual key names come first, and a key typed into Vidi never overwrites the Models page record.
 *
 *   node --experimental-transform-types --no-warnings checks/keys.check.ts
 */
import { KeyStore } from '../src/keys.ts'
import { speechServiceOf } from '../src/providers/cloud.ts'
let ok = 0, bad = 0; const t = (c: boolean, m: string) => { console.log(c ? '  ok  ' : '  FAIL', m); c ? ok++ : bad++ }
// A DSH whose only OpenAI key was entered on the Models page (a record), like the other user's.
const refs = new Map<string, string>(), sets: string[] = []
const creds = {
  resolve: async (r: string) => refs.has(r) ? { value: refs.get(r)!, source: 'file' } : undefined,
  set: async (r: string, v: string) => { sets.push(r); refs.set(r, v) }, unset: async (r: string) => { refs.delete(r) },
  listRecords: async () => [{ key: 'llm-pi-ai/openai', kind: 'api-key' }, { key: 'llm-pi-ai/google', kind: 'api-key' }, { key: 'deepseek-account-platform/default', kind: 'grant' }],
  readRecord: async (k: string) => k === 'llm-pi-ai/openai' ? { kind: 'api-key', key: 'sk-models-page-openai-1234' } : k === 'llm-pi-ai/google' ? { kind: 'api-key', key: 'AIza-models-page-9999' } : undefined,
}
const ks = new KeyStore('/nonexistent/keys.json', () => ({}))
ks.creds = creds as any; ks.serviceOf = id => speechServiceOf(id)
await ks.refresh()
t(ks.get('openai') === 'sk-models-page-openai-1234', 'OpenAI key entered on DSH\'s Models page is found')
t(ks.get('gemini') === 'AIza-models-page-9999', 'Google key from the Models page is found for Gemini')
t(ks.info('openai').source === 'dsh' && ks.info('openai').provider === 'openai', 'and shown as coming from DSH')
t(ks.get('groq') === undefined, 'services with no key stay unset')
refs.set('OPENAI_API_KEY', 'sk-named-key-5678'); await ks.refresh()
t(ks.get('openai') === 'sk-named-key-5678', 'a key under the usual name still comes first')
refs.delete('OPENAI_API_KEY'); await ks.refresh()
await ks.save('openai', 'sk-entered-in-vidi-0000')
t(sets.at(-1) === 'OPENAI_API_KEY' && ks.get('openai') === 'sk-entered-in-vidi-0000', 'a key typed into Vidi is saved under OPENAI_API_KEY, not over the Models page record')
const old = new KeyStore('/nonexistent/keys.json', () => ({})); old.creds = { resolve: creds.resolve, set: creds.set, unset: creds.unset } as any
refs.clear(); await old.refresh()
t(old.get('openai') === undefined, 'an older DSH without records still works (nothing found, no crash)')
console.log(bad ? `${bad} FAILED` : `all ${ok} passed`)
process.exit(bad ? 1 : 0)
