'use client';

import Link from 'next/link';
import { VerifyClaimLink } from './VerifyClaimLink';
import { makeResearchLead } from '@/lib/intelligence/research-lead';
import { policyClaim } from '@/lib/verify/claim-text';
import { CountryResearchReadError, readCountryResearch } from '@/lib/research/client-read';
import { countryResearchReport } from '@/lib/research/lead-report';
import { useEffect, useRef, useState } from 'react';
import type { CountryResearchResult, CountryResearchDomain, CountryResearchScope } from '@/lib/research/country';
import { countryGovernmentSearchDomains } from '@/lib/verify/sources';
import { useLocale, useT } from '@/lib/i18n/client';

const STATIC_DEMO = process.env.NEXT_PUBLIC_STATIC_DEMO_MODE === '1';

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
  const [judgeRequired, setJudgeRequired] = useState(false);
  const [error, setError] = useState('');
  const [exportError, setExportError] = useState('');

  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);

  const hasGovernmentSearch = countryGovernmentSearchDomains(countryIso).length > 0;

  if (STATIC_DEMO) {
    return <section className="border-t border-border pt-3 space-y-2" aria-label={t('On-demand policy research', '按需政策检索')}>
      <div className="text-xs font-semibold text-muted uppercase tracking-wider">{t('On-demand policy research', '按需政策检索')}</div>
      <p className="text-xs text-muted">{t('Live Tavily country search is paused on this public workspace.', '此公开工作区已暂停 Tavily 实时国家检索。')}</p>
    </section>;
  }

  async function runSearch(scope: CountryResearchScope) {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setActiveScope(scope);
    setStatus('loading');
    setError('');
    setExportError('');
    setJudgeRequired(false);
    try {
      const data = await readCountryResearch({ countryIso, domain, scope }, { signal: request.signal });
      if (controller.current !== request) return;
      setResult(data);
      setStatus('done');
    } catch (cause) {
      if (controller.current !== request) return;
      const code = cause instanceof CountryResearchReadError ? cause.code : 'unavailable';
      setJudgeRequired(code === 'judge_required');
      const messages = {
        judge_required: t('Sign in at the judge testing entrance, then retry this search.', '请通过评委测试入口登录，再重试这次检索。'),
        daily_limit: t('The daily search budget has been reached. Try again tomorrow.', '今日检索额度已用完，请明天重试。'),
        timeout: t('The search wait timed out. A search already sent may still use credits. Retry only when ready.', '检索等待已超时。已发出的检索仍可能使用额度；准备好后再手动重试。'),
        invalid_response: t('The search response was incomplete or invalid. You can retry.', '检索响应不完整或无效，可以重试。'),
        unavailable: t('Live search is unavailable right now. You can retry.', '实时检索暂时不可用，可以重试。'),
      };
      setError(messages[code]);
      setStatus('error');
    } finally { if (controller.current === request) controller.current = null; }
  }

  function stopWaiting() {
    controller.current?.abort(); controller.current = null;
    setStatus('error'); setJudgeRequired(false);
    setError(t('Stopped waiting. A search already sent may still use credits. Retry only when ready.', '已停止等待。已发出的检索仍可能使用额度；准备好后再手动重试。'));
  }

  function exportLeads() {
    if (!result) return;
    setExportError('');
    try {
      let latestStatus: 'pending' | 'failed' | 'complete' = 'complete';
      if (status === 'loading') latestStatus = 'pending';
      else if (status === 'error') latestStatus = 'failed';
      const report = countryResearchReport(result, { status: latestStatus, scope: activeScope ?? result.scope });
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url;
      link.download = `policyos-search-leads-${result.countryIso}-${result.domain}-${report.exportedAt.replace(/[-:.]/g, '')}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setExportError(t('Could not download search leads. Please retry.', '检索线索下载失败，请重试。')); }
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
    {status === 'loading' && <button type="button" onClick={stopWaiting} className="min-h-11 w-full rounded-full border border-border px-4 text-xs">{t('Stop waiting', '停止等待')}</button>}
    <div aria-live="polite" className="space-y-2">
      {status === 'error' && <p role="alert" className="text-xs text-red-500">{t('Latest search: ', '最近一次检索：')}{error}</p>}
      {judgeRequired && <Link href="/judge" target="_blank" rel="noopener noreferrer" className="text-xs text-accent underline">{t('Open judge sign-in in a new tab, then retry here', '在新标签页登录评委入口，再回到这里重试')}</Link>}
      {result && <>
        {status === 'loading' && <p className="text-xs text-muted">{t('Earlier search results remain while this search runs.', '本次检索进行中，仍保留上次结果。')}</p>}
        {status === 'error' && <p className="text-xs text-muted">{t('Earlier search results kept. The latest attempt did not complete.', '已保留上次检索结果；最近一次尝试未完成。')}</p>}
        <p className="text-xs text-muted">{result.scope === 'country-government' ? t('Result scope: country government sites', '结果范围：该国政府站点') : t('Result scope: public sources', '结果范围：公开来源')}</p>
        <button type="button" onClick={exportLeads} className="min-h-11 text-xs text-accent underline">{t('Download search leads (JSON)', '下载检索线索（JSON）')}</button>
        {exportError && <p role="alert" className="text-xs text-red-500">{exportError}</p>}
        <p className="text-[11px] text-muted">{t('Search hits are unverified leads. Review the draft claim before starting Verify; opening a lead does not start a check.', '检索命中是未经核验的线索。开始核验前请检查并编辑草稿声明；打开线索不会自动核验。')}</p>
        <p className="text-[11px] text-muted">{t('Searched', '检索于')} {new Date(result.searchedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')} · Tavily {result.requestId || '—'}</p>
        {result.search && <details className="text-xs text-muted">
          <summary className="cursor-pointer">{t('Search request details', '检索请求详情')}</summary>
          <p className="mt-1 break-words">{t('Query: ', '查询词：')}{result.search.query}</p>
          <p className="mt-1 break-words">{result.search.includeDomains.length
            ? t('Restricted domains: ', '限定域名：') + result.search.includeDomains.join(', ')
            : t('No domain restriction was requested.', '本次请求未限制域名。')}</p>
        </details>}
        {result.scope === 'country-government' && <p className="text-xs text-muted">{t('Restricted to known government domains for this country. Results may be source indexes or homepages, not policy announcements; inspect the exact issuing text and date.', '仅检索该国已知政府域名。结果可能是目录或主页，并非政策公告；请核对具体发布原文与日期。')}</p>}
        {result.items.length === 0 && <p className="text-xs text-muted">{result.scope === 'country-government'
          ? t('No matching government-site links found. Try the broader search or a precise claim in Verify.', '未找到符合条件的政府站点链接。可尝试公开来源检索，或到核验页输入具体声明。')
          : t('No clearly country- and topic-specific links found. Try a precise claim in Verify.', '未找到同时明确关联该国和领域的链接。可以到核验页输入具体声明。')}</p>}
        {result.items.map(item => {
          const claim = policyClaim(result.countryName, item.title, item.excerpt);
          const canTransfer = makeResearchLead({ claim, sourceUrl: item.url }) !== null;
          return <article key={item.url} className="rounded-lg border border-border bg-background p-2.5 space-y-1">
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="block text-xs font-semibold text-accent break-words underline underline-offset-2">{item.title}</a>
          <div className="text-[10px] text-muted break-all">{new URL(item.url).hostname} · {item.countryGovernmentDomain ? t('Country government domain', '该国政府域名') : item.recognizedOfficialDomain ? t('Other recognized official domain', '其他已识别官方域名') : t('Publisher not classified', '发布方未分类')}</div>
          {item.excerpt && <p className="text-xs text-muted line-clamp-4">{item.excerpt}</p>}
          {canTransfer && <VerifyClaimLink claim={claim} sourceUrl={item.url}
            label={t('Open as a verification lead', '打开为核验线索')} className="block text-xs" />}
        </article>;
        })}
      </>}
    </div>
  </section>;
}
