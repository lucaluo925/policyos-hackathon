'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { AnnouncementBundle } from '@/lib/announcements/types';
import { useT } from '@/lib/i18n/client';

type ReadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; bundle: AnnouncementBundle }
  | { kind: 'error' };

function utcTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export default function SourceReadCheck({ countryIso, connectorCount }: { countryIso: string; connectorCount: number }) {
  const t = useT();
  const [state, setState] = useState<ReadState>({ kind: 'idle' });
  const pending = useRef<AbortController | null>(null);

  useEffect(() => () => pending.current?.abort(), []);

  if (connectorCount === 0) {
    return <p className="text-xs text-muted" data-testid="source-read-none">{t('No direct announcement reader is configured here. A policy-source location, if listed above, has not been checked by this control.', '这里没有配置可直接读取的公告源。上方若列有政策来源位置，本控件不会替它检查。')}</p>;
  }

  const check = async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState({ kind: 'loading' });
    try {
      const response = await fetch(`/api/announcements?country=${encodeURIComponent(countryIso)}`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Read failed');
      const bundle: AnnouncementBundle = await response.json();
      if (bundle.country !== countryIso || !Array.isArray(bundle.sources) || !Array.isArray(bundle.items)) throw new Error('Invalid source response');
      setState({ kind: 'loaded', bundle });
    } catch {
      if (!controller.signal.aborted) setState({ kind: 'error' });
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  };

  const sources = state.kind === 'loaded' ? state.bundle.sources : [];
  const available = sources.filter(source => source.status === 'available').length;
  const retained = sources.filter(source => source.status === 'retained').length;
  const unavailable = sources.filter(source => source.status === 'unavailable').length;

  return (
    <div className="mt-3 rounded-lg border border-border bg-background p-3 text-xs" data-testid="source-read-check">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{t('Official announcement read', '官方公告读取')}</span>
        <button type="button" onClick={check} disabled={state.kind === 'loading'} className="min-h-10 shrink-0 whitespace-nowrap rounded-lg border border-border bg-surface-2 px-3 text-accent hover:bg-surface disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          {state.kind === 'loading' ? t('Checking…', '检查中…') : t('Check now', '立即检查')}
        </button>
      </div>
      {state.kind === 'idle' && <p className="mt-2 text-muted">{t('Run a current read of the configured public feeds.', '读取当前配置的公开公告源。')}</p>}
      {state.kind === 'loading' && <p className="mt-2 text-muted" role="status">{t('Reading official feeds; this may take a few seconds.', '正在读取官方来源，可能需要几秒钟。')}</p>}
      {state.kind === 'error' && <p className="mt-2 text-muted" role="status" data-testid="source-read-error">{t('The check could not complete. No source availability is confirmed.', '本次检查未完成，不能确认来源可用。')}</p>}
      {state.kind === 'loaded' && <div className="mt-2 space-y-2" role="status" data-testid="source-read-result">
        <p>{t(`${available} readable · ${retained} older cache retained · ${unavailable} unavailable`, `${available} 个可读取 · ${retained} 个保留旧缓存 · ${unavailable} 个不可用`)}</p>
        <p className="text-muted">{t(`${state.bundle.items.length} topic-matched research lead(s) in this response. A readable feed does not prove a policy is in force.`, `本次返回 ${state.bundle.items.length} 条符合主题的研究线索。来源可读取不代表政策已生效。`)}</p>
        <ul className="max-h-28 space-y-1 overflow-y-auto border-t border-border pt-2">
          {sources.map(source => <li key={source.sourceId} className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="block truncate" title={source.name}>{source.name}</span>
              <span className="block text-[10px] text-muted">{source.status === 'retained'
                ? t(`Last success: ${utcTime(source.fetchedAt) ?? 'unknown'}`, `上次成功：${utcTime(source.fetchedAt) ?? '未知'}`)
                : source.status === 'available'
                  ? t(`Read: ${utcTime(source.fetchedAt) ?? 'unknown'}`, `读取：${utcTime(source.fetchedAt) ?? '未知'}`)
                  : t(`Checked: ${utcTime(source.checkedAt) ?? 'unknown'}`, `检查：${utcTime(source.checkedAt) ?? '未知'}`)}</span>
            </span>
            <span className="shrink-0 text-muted">{source.status === 'available' ? t(`read · ${source.records}`, `已读 · ${source.records}`) : source.status === 'retained' ? t('older cache', '旧缓存') : t('failed', '失败')}</span>
          </li>)}
        </ul>
        <Link href={`/intelligence?country=${countryIso}`} className="block text-accent">{t('Inspect titles, dates and original links →', '查看标题、日期和原文链接 →')}</Link>
      </div>}
    </div>
  );
}
