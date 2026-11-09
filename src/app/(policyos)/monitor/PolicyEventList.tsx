'use client';

import type { ReactNode } from 'react';
import { useT } from '@/lib/i18n/client';
import { aggregatePolicyEvents } from '@/lib/news/policy-events';
import type { MonitorItem } from '@/lib/news/query';

export default function PolicyEventList({ items, renderItem }: {
  items: MonitorItem[];
  renderItem: (item: MonitorItem) => ReactNode;
}) {
  const t = useT();
  const events = aggregatePolicyEvents(items);
  return <section data-testid="policy-events" aria-label={t('Policy event candidates', '政策事件线索')}>
    <p className="text-xs text-muted mb-3">{t(
      `${items.length} loaded announcements in ${events.length} candidate group(s). Groups use document links and conservative text similarity within 14 days. They may describe different policies; inspect each original. Loading more can change the groups.`,
      `将已加载的 ${items.length} 条公告整理为 ${events.length} 组线索。依据文件链接和 14 天内的文本相似度保守关联，仍可能涉及不同政策，请逐条查看原文。加载更多后分组可能变化。`,
    )}</p>
    <div className="space-y-4">{events.map(event => <article key={event.id} className="rounded-xl border border-border bg-surface overflow-hidden">
      {event.items.length > 1 && <div className="px-4 py-3 border-b border-border" data-testid="policy-event-group">
        <h2 className="text-sm font-medium">{t('Potentially related policy announcements', '可能相关的政策公告')}</h2>
        <p className="text-xs text-muted mt-1">{event.items.length} {t('announcements', '条公告')} · {new Set(event.items.map(item => item.source)).size} {t('source labels (not a measure of independent confirmation)', '个来源名称（不代表独立证实次数）')}</p>
        <p className="text-xs text-muted mt-1">{t('Grouping basis: ', '关联依据：')}{event.links.every(link => link.reason === 'same_document')
          ? t('Same document URL after removing tracking parameters', '去除追踪参数后为同一文件链接')
          : event.links.every(link => link.reason === 'same_title')
            ? t('Matching titles, country, topic and language', '标题、国家、领域与语言匹配')
            : t('Matching document links or similar titles and summaries; association is unverified', '文件链接匹配或标题摘要相似，关联未经核验')}</p>
      </div>}
      <ul className="divide-y divide-border">{event.items.map(renderItem)}</ul>
    </article>)}</div>
  </section>;
}
