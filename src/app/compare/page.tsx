/**
 * /compare — V8: server-rendered first paint + client-side charts.
 *
 * Previous version was `ssr: false` with a "Loading comparison tool..."
 * placeholder, so the first paint was blank/useless. Now the page is a
 * server component that fetches live data from the DB and renders a
 * meaningful comparison grid on first paint (scores per domain, live
 * pipelines, evidence coverage, last run, last score change). The
 * recharts client component hydrates below it.
 */

import Link from 'next/link';
import { countries } from '@/lib/data/countries';
import { getMetricScore, getCategoryColor } from '@/lib/data/metrics';
import { isDatabaseConfigured, getPrisma } from '@/lib/db';
import CompareClient from './CompareClient';
import { getT } from '@/lib/i18n/server';
import { countryName, DOMAIN_LABEL, relativeAgo, type T } from '@/lib/i18n';
import { zhData } from '@/lib/i18n/data-zh';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseIsoList(param: string | string[] | undefined): string[] {
  if (!param) return [];
  const raw = Array.isArray(param) ? param.join(',') : param;
  return raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((iso) => countries.find((c) => c.iso === iso));
}

interface CountrySummary {
  iso: string;
  name: string;
  flag: string;
  region: string;
  scores: { climate: number | null; trade: number | null; immigration: number | null };
  seededScores: { climate: number; trade: number; immigration: number };
  livePipelines: number;
  evidenceBacked: number;
  evidenceTotal: number;
  latestRunAt: string | null;
  latestScoreChange: {
    at: string;
    domain: string;
    delta: number;
    newScore: number;
  } | null;
  anyUnstable: boolean;
}

async function loadSummary(isos: string[]): Promise<CountrySummary[]> {
  const out: CountrySummary[] = [];
  const dbReady = isDatabaseConfigured();
  const prisma = dbReady ? getPrisma() : null;

  for (const iso of isos) {
    const curated = countries.find((c) => c.iso === iso);
    if (!curated) continue;
    const base: CountrySummary = {
      iso,
      name: curated.name,
      flag: curated.flagEmoji,
      region: curated.region ?? '',
      scores: { climate: null, trade: null, immigration: null },
      seededScores: {
        climate: getMetricScore(iso, 'climate'),
        trade: getMetricScore(iso, 'trade'),
        immigration: getMetricScore(iso, 'immigration'),
      },
      livePipelines: 0,
      evidenceBacked: 0,
      evidenceTotal: 0,
      latestRunAt: null,
      latestScoreChange: null,
      anyUnstable: false,
    };

    if (prisma) {
      try {
        const country = await prisma.country.findFirst({
          where: { OR: [{ iso2: iso }, { iso3: iso }] },
          select: { id: true },
        });
        if (country) {
          const [domainScores, pipelines, evidenceBacked, evidenceTotal, latestRun, latestScoreChange] =
            await Promise.all([
              prisma.domainScore.findMany({ where: { countryId: country.id } }),
              prisma.monitoredSource.findMany({
                where: { countryId: country.id, pipelineKey: { not: null } },
                select: { id: true, isStable: true },
              }),
              prisma.scoreSubmetric.count({
                where: { countryId: country.id, evidenceBackedAt: { not: null } },
              }),
              prisma.scoreSubmetric.count({ where: { countryId: country.id } }),
              prisma.pipelineRun.findFirst({
                where: { monitoredSource: { countryId: country.id } },
                orderBy: { startedAt: 'desc' },
                select: { startedAt: true },
              }),
              prisma.scoreChangeLog.findFirst({
                where: { countryId: country.id },
                orderBy: { createdAt: 'desc' },
                select: { createdAt: true, domain: true, delta: true, newScore: true },
              }),
            ]);
          for (const ds of domainScores) {
            base.scores[ds.domain as 'climate' | 'trade' | 'immigration'] = Number(ds.score.toFixed(1));
          }
          base.livePipelines = pipelines.length;
          base.anyUnstable = pipelines.some((p) => !p.isStable);
          base.evidenceBacked = evidenceBacked;
          base.evidenceTotal = evidenceTotal;
          base.latestRunAt = latestRun?.startedAt.toISOString() ?? null;
          if (latestScoreChange) {
            base.latestScoreChange = {
              at: latestScoreChange.createdAt.toISOString(),
              domain: latestScoreChange.domain,
              delta: Number(latestScoreChange.delta.toFixed(2)),
              newScore: Number(latestScoreChange.newScore.toFixed(2)),
            };
          }
        }
      } catch {
        /* fall through — keep seeded baseline only */
      }
    }
    out.push(base);
  }
  return out;
}

function coverageLabel(livePipelines: number, evidenceBacked: number, t: T): {
  label: string;
  tone: 'strong' | 'partial' | 'seeded';
} {
  if (livePipelines >= 2 && evidenceBacked >= 1) return { label: t('updated from live sources', '实时来源更新'), tone: 'strong' };
  if (livePipelines >= 1) return { label: t('partly live', '部分实时'), tone: 'partial' };
  return { label: t('estimated', '估算'), tone: 'seeded' };
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ countries?: string }>;
}) {
  const params = await searchParams;
  let isos = parseIsoList(params.countries);
  if (isos.length === 0) isos = ['US', 'DE'];

  const summary = await loadSummary(isos);
  const { t, locale } = await getT();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-3xl md:text-4xl font-semibold">{t('Compare Countries', '国家对比')}</h1>
        <span className="text-[10px] px-2 py-1 rounded bg-surface border border-border text-muted">
          {t('live', '实时')}
        </span>
      </div>
      <p className="text-muted text-sm mb-6">
        {t(
          'Scores from 0 to 100 on climate, trade and immigration. Click a country to see the policies behind its scores.',
          '气候、贸易、移民三方面的 0–100 分。点击国家名，可以看到分数背后的具体政策。',
        )}
      </p>

      {/* ── SSR comparison grid ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
        {summary.map((c) => {
          const cov = coverageLabel(c.livePipelines, c.evidenceBacked, t);
          const toneStyle =
            cov.tone === 'strong'
              ? 'bg-green-500/15 text-green-400 border-green-500/30'
              : cov.tone === 'partial'
              ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
              : 'bg-gray-500/15 text-gray-400 border-gray-500/30';
          return (
            <div key={c.iso} className="p-4 rounded-xl bg-surface border border-border">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{c.flag}</span>
                  <div>
                    <Link
                      href={`/countries/${c.iso.toLowerCase()}`}
                      className="font-semibold hover:text-accent"
                    >
                      {countryName(c.iso, c.name, locale)}
                    </Link>
                    <div className="text-[11px] text-muted">{zhData(locale).region(c.region, '')}</div>
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded border text-[10px] font-medium ${toneStyle}`}>
                  {cov.label}
                </span>
              </div>

              <div className="space-y-2">
                {(['climate', 'trade', 'immigration'] as const).map((domain) => {
                  const live = c.scores[domain];
                  const seeded = c.seededScores[domain];
                  const diff = live != null ? live - seeded : 0;
                  const color = getCategoryColor(domain);
                  return (
                    <div key={domain} className="flex items-center gap-2 text-xs">
                      <span className="w-20 capitalize text-muted">{t(DOMAIN_LABEL[domain][0], DOMAIN_LABEL[domain][1])}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${live ?? seeded}%`, background: color }}
                        />
                      </div>
                      <span className="font-semibold w-10 text-right" style={{ color }}>
                        {(live ?? seeded).toFixed(live != null ? 1 : 0)}
                      </span>
                      {diff !== 0 && (
                        <span
                          className={`text-[10px] w-10 text-right ${
                            diff > 0 ? 'text-green-400' : 'text-red-400'
                          }`}
                        >
                          {diff > 0 ? '+' : ''}
                          {diff.toFixed(1)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 pt-3 border-t border-border/40 grid grid-cols-3 gap-2 text-[11px]">
                <div>
                  <div className="text-muted">{t('Sources', '来源数')}</div>
                  <div className="font-semibold">
                    {c.livePipelines}
                    {c.anyUnstable && (
                      <span className="ml-1 text-orange-400" title={t('At least one source unstable', '至少一个来源不稳定')}>
                        ⚠
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-muted">{t('Backed by real changes', '有真实依据')}</div>
                  <div className="font-semibold">
                    {c.evidenceBacked} / {c.evidenceTotal}
                  </div>
                </div>
                <div>
                  <div className="text-muted">{t('Last updated', '最近更新')}</div>
                  <div className="font-semibold">{relativeAgo(c.latestRunAt, t)}</div>
                </div>
              </div>

              {c.latestScoreChange && (
                <div className="mt-2 text-[11px] text-muted">
                  {t('last score change:', '最近分数变化：')}{' '}
                  <span className="text-foreground">
                    {t(DOMAIN_LABEL[c.latestScoreChange.domain]?.[0] ?? c.latestScoreChange.domain, DOMAIN_LABEL[c.latestScoreChange.domain]?.[1] ?? c.latestScoreChange.domain)} {c.latestScoreChange.delta > 0 ? '+' : ''}
                    {c.latestScoreChange.delta}
                  </span>{' '}
                  → <span className="text-foreground">{c.latestScoreChange.newScore}</span> (
                  {relativeAgo(c.latestScoreChange.at, t)})
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Selected-country chips (server-rendered state) */}
      <div className="text-[11px] text-muted mb-2">
        {t(
          `Selected: ${summary.map((c) => c.iso).join(', ')} · change the selection below for interactive radar/bar charts.`,
          `已选：${summary.map((c) => c.iso).join('、')} · 在下方修改选择，可查看交互式雷达图和柱状图。`,
        )}
      </div>

      {/* Client-side charts + picker hydrate below the SSR summary */}
      <CompareClient initialIsos={summary.map((c) => c.iso)} />
    </div>
  );
}
