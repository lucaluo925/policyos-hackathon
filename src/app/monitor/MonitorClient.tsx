'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { countries as curatedCountries } from '@/lib/data/countries';
import { countryDirectory as countries } from '@/lib/data/country-directory';
import { countryName, word } from '@/lib/i18n';
import { useLocale, useT } from '@/lib/i18n/client';
import { VerifyClaimLink } from '@/components/VerifyClaimLink';
import PolicyEventList from './PolicyEventList';
import { policyEventsJson } from '@/lib/news/policy-events';
import type { MonitorItem, MonitorResult } from '@/lib/news/query';
import { EMPTY_FILTER, SAVED_ITEMS_KEY, WATCH_RULES_KEY, readSavedItems, readWatchRules, filterSavedItems, unseenItems, monitorCsv, type WatchFilter, type WatchRule } from '@/lib/news/watch';

export default function MonitorClient() {
  const t = useT();
  const locale = useLocale();
  const [filter, setFilter] = useState<WatchFilter>(EMPTY_FILTER);
  const [draft, setDraft] = useState('');
  const [items, setItems] = useState<MonitorItem[]>([]);
  const [saved, setSaved] = useState<MonitorItem[]>([]);
  const [rules, setRules] = useState<WatchRule[]>([]);
  const [savedOnly, setSavedOnly] = useState(false);
  const [eventsView, setEventsView] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'unavailable'>('loading');
  const [busyMore, setBusyMore] = useState(false);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<MonitorResult | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [sourceInfo, setSourceInfo] = useState<MonitorResult | null>(null);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      try { setSaved(readSavedItems(localStorage.getItem(SAVED_ITEMS_KEY))); setRules(readWatchRules(localStorage.getItem(WATCH_RULES_KEY))); }
      catch { setNotice(t('Browser storage is unavailable. Saved items will last only for this visit.', '浏览器存储不可用，收藏与关注仅在本次访问中保留。')); }
    });
    const sync = (event: StorageEvent) => {
      if (event.key === SAVED_ITEMS_KEY) setSaved(readSavedItems(event.newValue));
      if (event.key === WATCH_RULES_KEY) setRules(readWatchRules(event.newValue));
    };
    window.addEventListener('storage', sync);
    return () => { cancelled = true; window.removeEventListener('storage', sync); };
  }, [t]);

  const fetchPage = useCallback(async (signal: AbortSignal, nextCursor?: string) => {
    const query = new URLSearchParams();
    Object.entries(filter).forEach(([key, value]) => { if (value) query.set(key, value); });
    if (nextCursor) query.set('cursor', nextCursor);
    const response = await fetch(`/api/monitor?${query}`, { cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
    if (!response.ok) throw new Error('Could not load announcements');
    return await response.json() as MonitorResult;
  }, [filter]);

  useEffect(() => {
    const controller = new AbortController();
    const run = ++generation.current;
    let initialized = false;
    let running = false;
    async function load(initial: boolean) {
      if (running) return;
      running = true;
      try {
        const result = await fetchPage(controller.signal);
        if (controller.signal.aborted || generation.current !== run) return;
        setCheckedAt(result.checkedAt);
        setSourceInfo(result);
        setState(result.available ? 'ready' : 'unavailable');
        if (initial || !initialized) {
          seen.current = new Set(result.items.map((item) => item.id));
          setItems(result.items); setCursor(result.nextCursor); setPending(null); setBusyMore(false); initialized = true;
        } else {
          const fresh = unseenItems(result.items, seen.current);
          if (fresh.length) setPending({ ...result, items: fresh });
        }
      } catch {
        if (!controller.signal.aborted && generation.current === run) {
          if (initial) setState('error');
          else setNotice(t('The latest refresh failed. Previously loaded announcements are still shown.', '刷新失败，当前保留此前读取的公告。'));
        }
      } finally { running = false; }
    }
    void load(true);
    const timer = window.setInterval(() => { if (!document.hidden && !savedOnly) void load(false); }, 60_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [fetchPage, refresh, savedOnly, t]);

  function updateFilter(next: WatchFilter) {
    setState('loading'); setItems([]); setCursor(null); setPending(null); setSourceInfo(null); setCheckedAt(null); setFilter(next); setNotice('');
  }
  function persist(key: string, value: unknown) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { setNotice(t('Browser storage is unavailable; this change is kept for this visit only.', '浏览器存储不可用，此次修改仅保留到页面关闭。')); }
  }
  function toggleSave(item: MonitorItem) {
    const exists = saved.some((row) => row.id === item.id);
    if (!exists && saved.length >= 200) { setNotice(t('You can save up to 200 announcements.', '最多可收藏 200 条公告。')); return; }
    const next = exists ? saved.filter((row) => row.id !== item.id) : [item, ...saved];
    setSaved(next); persist(SAVED_ITEMS_KEY, next);
  }
  function saveRule() {
    if (rules.some((r) => r.q === filter.q && r.country === filter.country && r.domain === filter.domain && r.days === filter.days)) { setNotice(t('These watch conditions are already saved.', '这组关注条件已经保存。')); return; }
    if (rules.length >= 20) { setNotice(t('You can save up to 20 watch conditions.', '最多可保存 20 组关注条件。')); return; }
    const country = countries.find((c) => c.iso === filter.country);
    const name = [country ? countryName(country.iso, country.name, locale) : t('All countries', '全部国家'), filter.domain ? word(filter.domain, locale) : t('All topics', '全部领域'), filter.q, filter.days ? t(`${filter.days} days`, `${filter.days} 天`) : ''].filter(Boolean).join(' · ');
    const next = [...rules, { ...filter, id: crypto.randomUUID(), name }]; setRules(next); persist(WATCH_RULES_KEY, next);
    setNotice(t('Watch conditions saved in this browser.', '已在此浏览器保存关注条件。'));
  }
  async function loadMore() {
    if (!cursor || busyMore) return;
    const run = generation.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    setBusyMore(true);
    try {
      const result = await fetchPage(controller.signal, cursor);
      if (generation.current !== run) return;
      setItems((previous) => [...previous, ...result.items.filter((item) => !previous.some((row) => row.id === item.id))]);
      result.items.forEach((item) => seen.current.add(item.id)); setCursor(result.nextCursor);
    } catch { if (generation.current === run) setNotice(t('Could not load more. Please try again.', '加载更多失败，请重试。')); }
    finally { window.clearTimeout(timeout); if (generation.current === run) setBusyMore(false); }
  }
  const displayed = savedOnly ? filterSavedItems(saved, filter) : items;
  function exportItems() {
    const url = URL.createObjectURL(new Blob([monitorCsv(displayed)], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'policyos-announcements.csv'; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportEvents() {
    try {
      const url = URL.createObjectURL(new Blob([policyEventsJson(displayed)], { type: 'application/json;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'policyos-policy-events.json';
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setNotice(t('Could not export policy events. Please try again.', '政策事件导出失败，请重试。')); }
  }
  function renderItem(item: MonitorItem) {
        const isSaved = saved.some((row) => row.id === item.id);
        return <li key={item.id} className="p-4 sm:p-5"><div className="flex justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted mb-2"><span>{item.source}</span><span>· {word(item.domain, locale)}</span><time dateTime={item.publishedAt}>· {item.datePrecision === 'day' ? item.publishedAt : new Date(item.publishedAt).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-GB')}</time>{item.countries.map((iso) => { const c = countries.find((row) => row.iso === iso); return c ? <Link href={curatedCountries.some(profile => profile.iso === iso) ? `/countries/${iso.toLowerCase()}` : `/intelligence?country=${iso}`} key={iso} className="hover:underline">{countryName(iso, c.name, locale)}</Link> : null; })}</div><h2 className="text-base font-medium leading-relaxed">{item.url && /^https?:\/\//.test(item.url) ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{item.title} ↗</a> : item.title}</h2>{item.description && <p className="text-sm text-muted mt-2 line-clamp-2">{item.description}</p>}<div className="flex flex-wrap gap-4 text-xs mt-3"><VerifyClaimLink claim={item.title} sourceUrl={item.url} label={t('Check against sources', '对照来源核验')} /><span className="text-muted">{item.provenance === 'official_feed' ? t('Official feed', '官方来源') : t('Collected feed', '采集来源')}</span></div></div><button type="button" aria-pressed={isSaved} aria-label={isSaved ? t(`Unsave: ${item.title}`, `取消收藏：${item.title}`) : t(`Save: ${item.title}`, `收藏：${item.title}`)} className="w-11 h-11 shrink-0 rounded-lg border border-border text-lg" onClick={() => toggleSave(item)}>{isSaved ? '★' : '☆'}</button></div></li>;
  }
  const fieldClass = 'min-h-11 rounded-lg border border-border bg-background px-3 text-sm';
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6"><div><h1 className="text-3xl font-semibold">{t('Policy monitor', '政策监测')}</h1><p className="text-sm text-muted mt-2">{t('Explore related policy announcements, inspect original sources and check a claim.', '查看相关政策公告、追溯原始来源并核验声明。')}</p></div><Link href="/explore" className="text-sm text-accent py-2">{t('Global map →', '全球地图 →')}</Link></div>
      <section className="rounded-xl border border-border bg-surface p-4 mb-5" aria-label={t('Monitor filters', '监测筛选')}>
        <form className="flex gap-2 mb-3" onSubmit={(event) => { event.preventDefault(); updateFilter({ ...filter, q: draft.trim() }); }}><label htmlFor="monitor-search" className="sr-only">{t('Search official announcements', '搜索官方公告')}</label><input id="monitor-search" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={160} placeholder={t('Keywords, agency or policy…', '关键词、机构或政策名称…')} className={`${fieldClass} flex-1 min-w-0`} /><button className="min-h-11 rounded-lg bg-accent text-white px-5 text-sm font-medium" type="submit">{t('Search', '搜索')}</button></form>
        <div className="grid gap-3 sm:grid-cols-3"><label className="text-xs text-muted">{t('Country', '国家')}<select className={`${fieldClass} block w-full mt-1 text-foreground`} value={filter.country} onChange={(e) => updateFilter({ ...filter, country: e.target.value })}><option value="">{sourceInfo?.mode === 'database' ? t('All collected countries', '全部已采集国家') : sourceInfo?.mode === 'direct' ? t('Featured official sources', '精选官方来源') : t('All available sources', '全部可用来源')}</option>{countries.map((c) => <option key={c.iso} value={c.iso}>{countryName(c.iso, c.name, locale)}</option>)}</select></label><label className="text-xs text-muted">{t('Topic', '领域')}<select className={`${fieldClass} block w-full mt-1 text-foreground`} value={filter.domain} onChange={(e) => updateFilter({ ...filter, domain: e.target.value })}><option value="">{t('All topics', '全部领域')}</option>{['climate', 'trade', 'immigration'].map((domain) => <option key={domain} value={domain}>{word(domain, locale)}</option>)}</select></label><label className="text-xs text-muted">{t('Published', '发布时间')}<select className={`${fieldClass} block w-full mt-1 text-foreground`} value={filter.days} onChange={(e) => updateFilter({ ...filter, days: e.target.value })}><option value="">{t('All available', '全部可用')}</option>{['1', '7', '30'].map((days) => <option key={days} value={days}>{t(`Past ${days} day(s)`, `过去 ${days} 天`)}</option>)}</select></label></div>
        <div className="flex flex-wrap items-center gap-3 mt-4 text-xs"><button type="button" className="min-h-10 rounded-lg border border-border px-3" onClick={saveRule}>{t('+ Save watch conditions', '+ 保存关注条件')}</button><button type="button" className="min-h-10 rounded-lg border border-border px-3" onClick={() => { setDraft(''); updateFilter(EMPTY_FILTER); }}>{t('Reset filters', '重置筛选')}</button><span className="text-muted">{t('Checks current conditions every 60s while this page is open.', '页面打开时，每 60 秒读取当前筛选条件下的动态。')}</span></div>
      </section>
      {sourceInfo?.mode === 'direct' && <p data-testid="monitor-direct-scope" className="text-xs text-muted mb-4">{filter.country ? t('Reading configured official sources for the selected country. Source availability is shown below.', '正在读取所选国家已配置的官方来源；下方显示来源可用情况。') : t('Starter view: MY, NZ, HK, CH, NO and ZA official announcement sources. Select a country to read its configured sources.', '起始视图读取马来西亚、新西兰、香港、瑞士、挪威和南非的官方公告来源；选择国家可读取其已配置来源。')}{sourceInfo.sourceSummary && ` · ${t('Sources read', '成功读取')} ${sourceInfo.sourceSummary.available} · ${t('Retained', '保留旧数据')} ${sourceInfo.sourceSummary.retained} · ${t('Unavailable', '暂不可用')} ${sourceInfo.sourceSummary.unavailable}`}</p>}
      {rules.length > 0 && <section className="mb-5" aria-label={t('Saved watch conditions', '已保存关注条件')}><h2 className="text-sm font-medium mb-2">{t('Saved watch conditions', '我的关注条件')}</h2><div className="flex flex-wrap gap-2">{rules.map((rule) => <div key={rule.id} className="flex border border-border rounded-lg bg-surface"><button type="button" className="text-xs px-3 min-h-10" onClick={() => { setDraft(rule.q); setSavedOnly(false); updateFilter({ q: rule.q, country: rule.country, domain: rule.domain, days: rule.days }); }}>{rule.name}</button><button type="button" aria-label={t(`Remove watch conditions: ${rule.name}`, `移除关注条件：${rule.name}`)} className="px-3 min-h-10 text-muted" onClick={() => { const next = rules.filter((r) => r.id !== rule.id); setRules(next); persist(WATCH_RULES_KEY, next); }}>×</button></div>)}</div><p className="text-xs text-muted mt-2">{t('Select conditions to monitor them. Stored on this browser; no background email or push.', '选择一组条件开始监测。保存在此浏览器，不发送后台邮件或推送。')}</p></section>}
      {notice && <p className="text-sm text-muted border border-border rounded-lg p-3 mb-4" role="status">{notice}</p>}
      {pending && !savedOnly && <button type="button" aria-live="polite" className="w-full text-left rounded-lg bg-accent/10 border border-accent/30 p-3 mb-4 text-sm text-accent" onClick={() => { setState('loading'); setRefresh((n) => n + 1); }}>{t(`${pending.items.length} new announcement(s) found — show latest`, `发现 ${pending.items.length} 条新公告，点击查看最新结果`)}</button>}
      <div className="flex flex-wrap justify-between items-center gap-3 mb-3"><div className="flex gap-2 text-sm"><button type="button" aria-pressed={!savedOnly && eventsView} className={`min-h-10 px-3 rounded-lg ${!savedOnly && eventsView ? 'bg-foreground text-background' : 'text-muted'}`} onClick={() => { setSavedOnly(false); setEventsView(true); }}>{t('Policy events', '政策事件')}</button><button type="button" aria-pressed={!savedOnly && !eventsView} className={`min-h-10 px-3 rounded-lg ${!savedOnly && !eventsView ? 'bg-foreground text-background' : 'text-muted'}`} onClick={() => { setSavedOnly(false); setEventsView(false); }}>{t('Announcements', '官方公告')}</button><button type="button" aria-pressed={savedOnly} className={`min-h-10 px-3 rounded-lg ${savedOnly ? 'bg-foreground text-background' : 'text-muted'}`} onClick={() => setSavedOnly(true)}>{t(`Saved (${saved.length})`, `收藏（${saved.length}）`)}</button></div><div className="flex gap-3 text-xs"><button type="button" disabled={!displayed.length} className="min-h-10 px-2 disabled:opacity-40" onClick={exportEvents}>{t('Export event groups (JSON)', '导出事件分组（JSON）')}</button><button type="button" disabled={!displayed.length} className="min-h-10 px-2 disabled:opacity-40" onClick={exportItems}>{t(`Export loaded results (${displayed.length})`, `导出已加载结果（${displayed.length}）`)}</button><button type="button" className="min-h-10 px-2" onClick={() => { setState('loading'); setRefresh((n) => n + 1); }}>{t('Refresh', '刷新')}</button></div></div>
      {!savedOnly && state === 'loading' ? <p role="status" className="p-8 border border-border rounded-xl text-muted">{t('Loading official announcements…', '正在读取官方公告…')}</p> : !savedOnly && state === 'error' ? <p role="alert" className="p-8 border border-border rounded-xl">{t('Could not load updates. Use Refresh to try again.', '动态加载失败，请点击刷新重试。')}</p> : !savedOnly && state === 'unavailable' ? <p className="p-8 border border-border rounded-xl text-muted">{sourceInfo?.emptyReason === 'no_source' ? t('No official announcement connector is configured for this country. You can still investigate a precise claim in Research.', '这个国家尚未配置官方公告连接器；仍可在研究工作台核查具体声明。') : sourceInfo?.emptyReason === 'sources_unavailable' ? t('Configured official sources could not be read. This does not mean there are no announcements.', '已配置的官方来源暂时无法读取，这不代表没有公告。') : t('The announcement database is unavailable.', '公告数据库暂不可用。')}</p> : displayed.length === 0 ? <p className="p-8 border border-border rounded-xl text-muted">{savedOnly ? t('No saved announcements match these filters.', '没有符合筛选条件的收藏公告。') : sourceInfo?.mode === 'direct' ? t('No matching announcements in the official sources that were read. Try another topic or time window.', '已成功读取的官方来源中没有符合条件的公告；可尝试其他领域或时间范围。') : t('No matching announcements in this batch. If available, load more to search older records.', '当前批次没有匹配公告。如可加载更多，可继续查找较早记录。')}</p> : eventsView ? <PolicyEventList items={displayed} renderItem={renderItem} /> : <ul className="divide-y divide-border rounded-xl bg-surface border border-border">{displayed.map(renderItem)}</ul>}
      {!savedOnly && state === 'ready' && cursor && <button type="button" className="w-full min-h-11 border border-border rounded-lg mt-4 text-sm disabled:opacity-50" disabled={busyMore} onClick={() => void loadMore()}>{busyMore ? t('Loading…', '加载中…') : t('Load more announcements', '加载更多公告')}</button>}
      <p className="text-xs text-muted mt-4">{sourceInfo?.mode === 'direct' ? t('Direct official-source reads are cached for 10 minutes. Titles are research leads, not proof that a policy is in force.', '直接读取的官方来源缓存 10 分钟。标题仅供研究，不证明政策已生效。') : sourceInfo?.mode === 'database' ? t('Only previously collected announcements are queried; refreshing does not run government-source ingestion.', '仅查询已采集公告；刷新不会触发政府来源采集。') : t('Checking available sources…', '正在确认可用来源…')}{checkedAt && ` · ${t('Last read', '最近读取')} ${new Date(checkedAt).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-GB')}`}</p>
    </div>
  );
}
