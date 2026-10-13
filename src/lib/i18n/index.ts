/**
 * Minimal two-language support (English / 简体中文).
 *
 * Strings are translated inline at the call site — `t('Map', '地图')` — which
 * keeps both versions next to each other and avoids a key registry for a
 * site this size. The choice is stored in the `lang` cookie; with no cookie
 * the browser's Accept-Language decides (zh-* → Chinese, otherwise English).
 */

export type Locale = 'en' | 'zh';
export const LOCALE_COOKIE = 'lang';

export type T = (en: string, zh: string) => string;

export function makeT(locale: Locale): T {
  return (en, zh) => (locale === 'zh' ? zh : en);
}

/**
 * English is the default for everyone who has not chosen otherwise.
 *
 * This used to fall back to Accept-Language, which meant a visitor with a
 * Chinese-first browser landed on the Chinese copy. For an international
 * audience that makes the page a visitor sees depend on their browser
 * settings, which is both unpredictable and wrong for the default
 * presentation. Chinese is now opt-in through the navbar toggle, which sets
 * the cookie; the cookie still wins over everything.
 */
export function resolveLocale(cookieValue: string | undefined): Locale {
  return cookieValue === 'zh' ? 'zh' : 'en';
}

/** Country names shown in the UI (data keeps English names as the source of truth). */
export const COUNTRY_ZH: Record<string, string> = {
  US: '美国', CN: '中国', DE: '德国', GB: '英国', FR: '法国', JP: '日本', IN: '印度', BR: '巴西',
  AU: '澳大利亚', CA: '加拿大', KR: '韩国', SA: '沙特阿拉伯', NG: '尼日利亚', SE: '瑞典', SG: '新加坡',
};

export function countryName(iso: string, english: string, locale: Locale): string {
  return locale === 'zh' ? COUNTRY_ZH[iso.toUpperCase()] ?? english : english;
}

export const DOMAIN_LABEL: Record<string, [string, string]> = {
  climate: ['Climate', '气候'],
  trade: ['Trade', '贸易'],
  immigration: ['Immigration', '移民'],
};

export function relativeAgo(iso: string | null | undefined, t: T): string {
  if (!iso) return t('never', '从未');
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return t('just now', '刚刚');
  if (mins < 60) return t(`${mins}m ago`, `${mins} 分钟前`);
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t(`${hrs}h ago`, `${hrs} 小时前`);
  const days = Math.floor(hrs / 24);
  return t(`${days}d ago`, `${days} 天前`);
}

/** Short status / enum words that come from data rather than JSX. */
const WORD_ZH: Record<string, string> = {
  verified: '已核实', recently_reviewed: '近期已复查', pending_verification: '待核实', potentially_stale: '可能过期', unknown: '未知',
  high: '高', medium: '中', low: '低', climate: '气候', trade: '贸易', immigration: '移民',
  active: '生效中', pending: '待生效', suspended: '已暂停', amended: '已修订', expired: '已失效', repealed: '已废止', superseded: '已被取代', proposed: '提案中',
  none: '无', highschool: '高中', bachelor: '本科', master: '硕士', phd: '博士',
  basic: '基础', intermediate: '中等', fluent: '流利', native: '母语',
  employer: '雇主担保', family: '家庭担保', institutional: '机构担保', self: '自费',
  improving: '改善中', declining: '下降中', stable: '平稳',
};

export function word(key: string, locale: Locale): string {
  if (locale !== 'zh') return key.replace(/_/g, ' ');
  return WORD_ZH[key] ?? key.replace(/_/g, ' ');
}

const LANG_NAME: Record<string, [string, string]> = {
  de: ['German', '德语'],
  fr: ['French', '法语'],
  pt: ['Portuguese', '葡萄牙语'],
  sv: ['Swedish', '瑞典语'],
  hi: ['Hindi', '印地语'],
  ja: ['Japanese', '日语'],
  zh: ['Chinese', '中文'],
  ko: ['Korean', '韩语'],
};

/** "In German" / "德语原文" — shown next to titles that aren't in English. */
export function originalLanguageLabel(code: string, locale: Locale): string | null {
  const n = LANG_NAME[code];
  if (!n) return null;
  return locale === 'zh' ? `${n[1]}原文` : `In ${n[0]}`;
}
