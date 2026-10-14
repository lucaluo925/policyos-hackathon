import type { Prisma } from '@prisma/client';
import { getPrisma, isDatabaseConfigured } from '@/lib/db';
import { MONITOR_BATCH_SIZE, paginateMonitorRows, type MonitorQuery, type MonitorResult } from './query';
import { queryDirectMonitor } from './direct-monitor';
import { selectMonitorSource } from './monitor-source';

export async function queryMonitor(query: MonitorQuery): Promise<MonitorResult> {
  if (!isDatabaseConfigured()) return queryDirectMonitor(query);
  return selectMonitorSource(query, {
    hasArchive: async () => !!await getPrisma().newsArticle.findFirst({
      where: { ingestionType: 'rss_feed' }, select: { id: true },
    }),
    archive: queryStoredMonitor,
    official: queryDirectMonitor,
  });
}

async function queryStoredMonitor(query: MonitorQuery): Promise<MonitorResult> {
  // Topic classification is reapplied before pagination: historical stored
  // topics can be superseded by the feed registry's current classifier.
  const conditions: Prisma.NewsArticleWhereInput[] = [{ ingestionType: 'rss_feed' }];
  if (query.country) conditions.push({ policyLinks: { some: { countryIso: query.country } } });
  if (query.days) conditions.push({ publishedAt: { gte: new Date(Date.now() - query.days * 86_400_000) } });
  for (const term of query.q.split(' ').filter(Boolean)) conditions.push({ OR: ['title', 'description', 'source'].map((field) => ({ [field]: { contains: term, mode: 'insensitive' } })) });
  if (query.cursor) conditions.push({ OR: [{ publishedAt: { lt: new Date(query.cursor.publishedAt) } }, { publishedAt: new Date(query.cursor.publishedAt), id: { lt: query.cursor.id } }] });
  const rows = await getPrisma().newsArticle.findMany({ where: { AND: conditions }, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], take: MONITOR_BATCH_SIZE, include: { policyLinks: { select: { countryIso: true } } } });
  return { ...paginateMonitorRows(rows, query), mode: 'database' };
}
