'use client';

import { useEffect, useRef, useState } from 'react';
import type { CountryResearchResult, CountryResearchDomain, CountryResearchScope } from '@/lib/research/country';
import { countryGovernmentSearchDomains } from '@/lib/verify/sources';
import { useLocale, useT } from '@/lib/i18n/client';

export default function CountryResearch({ countryIso, domain }: {
  countryIso: string;
  domain: CountryResearchDomain;
}) {
  const t = useT();
  const locale = useLocale();
  const controller = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [activeScope, setActiveScope] = useState<CountryResearchScope | null>(null);
  const [result, setResult] = useState<CountryResearchResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => () => controller.current?.abort(), []);

  const hasGovernmentSearch = countryGovernmentSearchDomains(countryIso).length > 0;

  async function runSearch(scope: CountryResearchScope) {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setActiveScope(scope);
    setStatus('loading');
    setResult(null);
    setError('');
    try {
      const response = await fetch('/api/explore/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country: countryIso, domain, scope }),
        signal: request.signal,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(response.status === 429
          ? t('The daily search budget has been reached. Try again tomorrow.', '今日检索额度已用完，请明天重试。')
          : t('Live search is unavailable right now.', '实时检索暂时不可用。'));
      }
      setResult(data as CountryResearchResult);
      setStatus('done');
    } catch (cause) {
      if (request.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : t('Search unavailable.', '检索不可用。'));
      setStatus('error');
    }
  }

  return <section className="border-t border-border pt-3 space-y-2" aria-label={t('On-demand policy research', '按需政策检索')}>
    <div className="text-xs font-semibold text-muted uppercase tracking-wider">{t('On-demand policy research', '按需政策检索')}</div>
    <p className="text-xs text-muted">{t('Search public sources for this country and domain. Results must identify the country and topic; check dates and original text before relying on them.', '搜索该国家及当前领域的公开来源。结果需明确关联该国和领域；使用前请核对日期和原文。')}</p>
    <button type="button" onClick={() => runSearch('public')} disabled={status === 'loading'}
      className="min-h-11 w-full rounded-full bg-accent px-4 text-xs font-semibold text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
      {status === 'loading' && activeScope === 'public' ? t('Searching public sources…', '正在检索公开来源…') : t('Search this country', '检索这个国家')}
    </button>
    {hasGovernmentSearch && <button type="button" onClick={() => runSearch('country-government')} disabled={status === 'loading'}
      className="min-h-11 w-full rounded-full border border-accent px-4 text-xs font-semibold text-accent disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
      {status === 'loading' && activeScope === 'country-government' ? t('Searching government sites…', '正在检索政府站点…') : t('Search country government sites', '检索该国政府站点')}
    </button>}
    <div aria-live="polite" className="space-y-2">
      {status === 'error' && <p role="alert" className="text-xs text-red-500">{t('Search failed: ', '检索失败：')}{error}</p>}
      {status === 'done' && result && <>
        <p className="text-[11px] text-muted">{t('Searched', '检索于')} {new Date(result.searchedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')} · Tavily {result.requestId || '—'}</p>
        {result.scope === 'country-government' && <p className="text-xs text-muted">{t('Restricted to known government domains for this country. Results may be source indexes or homepages, not policy announcements; inspect the exact issuing text and date.', '仅检索该国已知政府域名。结果可能是目录或主页，并非政策公告；请核对具体发布原文与日期。')}</p>}
        {result.items.length === 0 && <p className="text-xs text-muted">{result.scope === 'country-government'
          ? t('No matching government-site links found. Try the broader search or a precise claim in Verify.', '未找到符合条件的政府站点链接。可尝试公开来源检索，或到核验页输入具体声明。')
          : t('No clearly country- and topic-specific links found. Try a precise claim in Verify.', '未找到同时明确关联该国和领域的链接。可以到核验页输入具体声明。')}</p>}
        {result.items.map(item => <article key={item.url} className="rounded-lg border border-border bg-background p-2.5 space-y-1">
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="block text-xs font-semibold text-accent break-words underline underline-offset-2">{item.title}</a>
          <div className="text-[10px] text-muted break-all">{new URL(item.url).hostname} · {item.countryGovernmentDomain ? t('Country government domain', '该国政府域名') : item.recognizedOfficialDomain ? t('Other recognized official domain', '其他已识别官方域名') : t('Publisher not classified', '发布方未分类')}</div>
          {item.excerpt && <p className="text-xs text-muted line-clamp-4">{item.excerpt}</p>}
        </article>)}
      </>}
    </div>
  </section>;
}
