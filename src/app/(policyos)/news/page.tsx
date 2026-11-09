import type { Metadata } from 'next';
import Link from 'next/link';
import { VerifyClaimLink } from '@/components/VerifyClaimLink';
import type { Domain } from '@prisma/client';
import { getT } from '@/lib/i18n/server';
import { countryName, originalLanguageLabel, word } from '@/lib/i18n';
import { countries } from '@/lib/data/countries';
import { getOfficialNews } from '@/lib/news/official';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Policy updates | PolicyOS' };

const DOMAINS: Array<Domain | 'all'> = ['all', 'climate', 'trade', 'immigration'];

export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string; country?: string }>;
}) {
  const { t, locale } = await getT();
  const sp = await searchParams;
  const domain = (['climate', 'trade', 'immigration'] as const).find((d) => d === sp.domain);
  const country = sp.country && countries.some((c) => c.iso === sp.country!.toUpperCase()) ? sp.country.toUpperCase() : undefined;
  const items = await getOfficialNews({ domain, country, limit: 80 });
  const all = await getOfficialNews({ limit: 300 });
  const countriesWithItems = countries.filter((c) => all.some((i) => i.countries.includes(c.iso)));

  const href = (d?: string, c?: string) => {
    const q = new URLSearchParams();
    if (d && d !== 'all') q.set('domain', d);
    if (c) q.set('country', c.toLowerCase());
    const s = q.toString();
    return s ? `/news?${s}` : '/news';
  };
  const pill = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-[13px] border transition-colors ${
      active ? 'bg-foreground text-background border-foreground' : 'bg-surface border-border text-muted hover:text-foreground'
    }`;
  const dateFmt = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-3xl md:text-4xl font-semibold mb-2">{t('Policy updates', '政策动态')}</h1>
      <p className="text-muted mb-8">
        {t(
          'The latest announcements, collected automatically from official government websites. Each one links to the original page.',
          '自动收集各国政府官网发布的最新公告，每一条都链接到原始页面。',
        )}
      </p>

      <Link href="/monitor" className="inline-flex min-h-11 items-center rounded-lg border border-border bg-surface px-4 text-sm mb-5">{t('Explore policy events, save and monitor updates →', '查看政策事件、收藏与关注动态 →')}</Link>
      <div className="flex flex-wrap gap-2 mb-3">
        {DOMAINS.map((d) => (
          <Link key={d} href={href(d, country)} className={pill((domain ?? 'all') === d)}>
            {d === 'all' ? t('All topics', '全部领域') : word(d, locale)}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mb-8">
        <Link href={href(domain)} className={pill(!country)}>
          {t('All countries', '全部国家')}
        </Link>
        {countriesWithItems.map((c) => (
          <Link key={c.iso} href={href(domain, c.iso)} className={pill(country === c.iso)}>
            {c.flagEmoji} {countryName(c.iso, c.name, locale)}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="p-8 rounded-xl bg-surface border border-border text-center text-muted">
          {t('No official updates for this selection yet.', '这个筛选条件下暂时没有官方公告。')}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-xl bg-surface border border-border overflow-hidden">
          {items.map((it) => (
            <li key={it.id} className="px-5 py-4 transition-colors hover:bg-surface-2">
              <div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted mb-1">
                  {it.countries.map((iso) => {
                    const c = countries.find((x) => x.iso === iso);
                    return c ? <span key={iso}>{c.flagEmoji} {countryName(iso, c.name, locale)}</span> : null;
                  })}
                  <span>· {word(it.domain, locale)}</span>
                  <span>· {it.source}</span>
                  <span>· {dateFmt(it.publishedAt)}</span>
                  {it.lang !== 'en' && originalLanguageLabel(it.lang, locale) && (
                    <span className="px-1.5 py-0.5 rounded-md bg-surface-2 border border-border">{originalLanguageLabel(it.lang, locale)}</span>
                  )}
                </div>
                <a
                  href={it.url ?? '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium leading-snug hover:underline"
                >
                  {it.title}
                </a>
                {/* The headline of an official update is already claim-shaped, so this is
                    the natural place to hand it to the verifier. It pre-fills rather than
                    auto-running: a verification costs real search and model calls, and the
                    visitor should be the one to spend them. */}
                <div className="mt-2 text-xs">
                  <VerifyClaimLink
                    claim={it.title}
                    sourceUrl={it.url}
                    label={t('Check this against sources', '对照来源核验这条')}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {locale === 'zh' && items.length > 0 && (
        <p className="text-xs text-muted mt-3">标题为政府官网原文。</p>
      )}
    </div>
  );
}
