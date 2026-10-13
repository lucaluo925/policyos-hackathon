import { cookies } from 'next/headers';
import { LOCALE_COOKIE, makeT, resolveLocale, type Locale, type T } from './index';

export async function getLocale(): Promise<Locale> {
  const c = await cookies();
  return resolveLocale(c.get(LOCALE_COOKIE)?.value);
}

export async function getT(): Promise<{ t: T; locale: Locale }> {
  const locale = await getLocale();
  return { t: makeT(locale), locale };
}
