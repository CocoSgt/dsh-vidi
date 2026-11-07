/** Language names for the UI, by interface language. */
const NAMES: Record<string, { en: string; zh: string }> = {
  en: { en: 'English', zh: '英语' }, zh: { en: 'Chinese (Simplified)', zh: '简体中文' }, 'zh-Hant': { en: 'Chinese (Traditional)', zh: '繁体中文' },
  ja: { en: 'Japanese', zh: '日语' }, ko: { en: 'Korean', zh: '韩语' }, es: { en: 'Spanish', zh: '西班牙语' }, fr: { en: 'French', zh: '法语' },
  de: { en: 'German', zh: '德语' }, pt: { en: 'Portuguese', zh: '葡萄牙语' }, ru: { en: 'Russian', zh: '俄语' }, it: { en: 'Italian', zh: '意大利语' },
  ar: { en: 'Arabic', zh: '阿拉伯语' }, hi: { en: 'Hindi', zh: '印地语' }, id: { en: 'Indonesian', zh: '印尼语' }, vi: { en: 'Vietnamese', zh: '越南语' },
  th: { en: 'Thai', zh: '泰语' }, tr: { en: 'Turkish', zh: '土耳其语' }, nl: { en: 'Dutch', zh: '荷兰语' }, pl: { en: 'Polish', zh: '波兰语' },
}

export function langLabel(code: string, ui: 'en' | 'zh', fallback?: string): string {
  return NAMES[code]?.[ui] ?? fallback ?? code
}
