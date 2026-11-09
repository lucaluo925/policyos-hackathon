import Link from 'next/link';
import { VerifyClaimLink } from '@/components/VerifyClaimLink';
import { looksLikeNavLabel } from '@/lib/pipeline/helpers/html-extractor';
import { sourceHealth } from '@/lib/pipeline/source-health';
import { runState } from '@/lib/pipeline/run-outcome';
import { reviewSchedule } from '@/lib/freshness/review-schedule';
import { RunStateBadge } from '@/components/RunStateBadge';
import { collapseUnchanged, diffWords } from '@/lib/policy/version-change';
import { policyClaim } from '@/lib/verify/claim-text';
import { notFound } from 'next/navigation';
import { countries, getCountry } from '@/lib/data/countries';
import { getMetrics, getMetricScore, metricDefinitions, type CategoryKey, getCategoryLabel, getCategoryColor } from '@/lib/data/metrics';
import { getPoliciesByCountry, type Policy } from '@/lib/data/policies';
import { getOfficialNews } from '@/lib/news/official';
import { formatGDP, formatPopulation, formatMetricValue } from '@/lib/format';
import {
  getLifecycle,
  getFreshnessLabel,
  getLastVerifiedAt,
  getCountryFreshness,
  getVersions,
  getScoreChanges,
  getSourcesForCountryDomain,
  type PolicyLifecycle,
  type PolicyVersion,
  type VerificationConfidence,
} from '@/lib/freshness';
import { isDatabaseConfigured, getPrisma } from '@/lib/db';
import { getT } from '@/lib/i18n/server';
import { countryName, originalLanguageLabel } from '@/lib/i18n';
import { zhData } from '@/lib/i18n/data-zh';
import { DOMAIN_LABEL } from '@/lib/i18n';
import { word, type Locale } from '@/lib/i18n';
const CAT_ZH: Record<string, string> = { climate: '气候与环境', trade: '贸易与关税', immigration: '移民与边境' };
const CAPITAL_ZH: Record<string, string> = { US: '华盛顿', CN: '北京', DE: '柏林', GB: '伦敦', FR: '巴黎', JP: '东京', IN: '新德里', BR: '巴西利亚', AU: '堪培拉', CA: '渥太华', KR: '首尔', SA: '利雅得', NG: '阿布贾', SE: '斯德哥尔摩', SG: '新加坡' };

// Live DB data — need per-request rendering when DB is configured.
export const dynamic = 'force-dynamic';

export function generateStaticParams() {
  return countries.map(c => ({ iso: c.iso.toLowerCase() }));
}

/** Fetch live DB-backed data for this country when DATABASE_URL is set.
 *  Returns null when the DB isn't configured, so the page can render the
 *  curated view without DB-specific sections. */
async function fetchLiveCountryData(iso: string) {
  if (!isDatabaseConfigured()) return null;
  try {
    const prisma = getPrisma();
    const code = iso.toUpperCase();
    const country = await prisma.country.findFirst({
      where: { OR: [{ iso2: code }, { iso3: code }] },
      select: { id: true, iso2: true },
    });
    if (!country) return null;

    const [
      dbPolicies,
      domainScores,
      scoreChangeLogs,
      monitoredSources,
      pipelineRuns,
      evidenceBacked,
      totalSubmetrics,
      feedItems,
    ] = await Promise.all([
      prisma.policy.findMany({
        where: { countryId: country.id },
        include: {
          currentVersion: true,
          versions: { orderBy: { versionNumber: 'desc' }, take: 12 },
          // The true count, so the page can say how many of them are shown.
          _count: { select: { versions: true } },
        },
        orderBy: [{ domain: 'asc' }, { updatedAt: 'desc' }],
      }),
      prisma.domainScore.findMany({ where: { countryId: country.id } }),
      prisma.scoreChangeLog.findMany({
        where: { countryId: country.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.monitoredSource.findMany({
        where: { countryId: country.id, active: true },
        orderBy: [{ trustPriority: 'asc' }, { sourceName: 'asc' }],
      }),
      prisma.pipelineRun.findMany({
        where: { monitoredSource: { countryId: country.id } },
        orderBy: { startedAt: 'desc' },
        take: 10,
        include: { monitoredSource: true },
      }),
      prisma.scoreSubmetric.count({
        where: { countryId: country.id, evidenceBackedAt: { not: null } },
      }),
      prisma.scoreSubmetric.count({ where: { countryId: country.id } }),
      prisma.policyNewsLink.findMany({
        where: { countryIso: country.iso2 },
        orderBy: { createdAt: 'desc' },
        take: 15,
        include: { newsArticle: true },
      }),
    ]);
    return {
      // Second line of defence. The scrapers used to store site navigation
      // as policy records — menu entries, language switchers, volume
      // indexes — and those rows have been deleted, but a parser pointed at
      // a restyled page could produce more. Showing a menu entry as a
      // tracked policy is the worst thing this product can do, so the read
      // path refuses them too rather than trusting the write path alone.
      dbPolicies: dbPolicies.filter((p) => !looksLikeNavLabel(p.title)),
      domainScores,
      scoreChangeLogs,
      monitoredSources,
      pipelineRuns,
      evidenceBacked,
      totalSubmetrics,
      feedItems,
    };
  } catch {
    // If the DB connection fails, render the curated view rather than 500 the page.
    return null;
  }
}

function shortRelative(date: Date | string | null | undefined): string {
  if (!date) return 'never';
  const then = new Date(date).getTime();
  const diffMs = Date.now() - then;
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/* ── Status Badge (policy status) ─────────────────────────────────── */
function StatusBadge({ status, locale }: { status: Policy['status']; locale: Locale }) {
  const styles: Record<string, string> = {
    active: 'bg-green-500/15 text-green-400',
    pending: 'bg-yellow-500/15 text-yellow-400',
    expired: 'bg-gray-500/15 text-gray-400',
    suspended: 'bg-red-500/15 text-red-400',
    repealed: 'bg-red-500/15 text-red-400',
    superseded: 'bg-orange-500/15 text-orange-400',
    amended: 'bg-blue-500/15 text-blue-400',
    unknown: 'bg-gray-500/15 text-gray-400',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || styles.active}`}>
      {word(status, locale)}
    </span>
  );
}

/* One shape for the page's metadata rows. They wrap below sm only: five
   columns do not fit 390px, and unwrapped the fixed-width leading columns ate
   the line, leaving the trailing truncate spans at zero width and the status
   badge off-screen. At >=640px the row was already readable, so it stays on
   one line and keeps truncating -- wrapping there only made the block ragged.
   Shared, because the defect existed in all three rows. */
const META_ROW = 'flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1 text-xs';

/* ── Freshness Badge ──────────────────────────────────────────────── */
function FreshnessBadge({ policyId, locale }: { policyId: string; locale: Locale }) {
  const label = getFreshnessLabel(policyId);
  const config: Record<string, { text: string; classes: string; icon: string }> = {
    verified: { text: 'Verified', classes: 'bg-green-500/15 text-green-400 border-green-500/30', icon: '✓' },
    recently_reviewed: { text: 'Recently reviewed', classes: 'bg-blue-500/15 text-blue-400 border-blue-500/30', icon: '↻' },
    pending_verification: { text: 'Pending verification', classes: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30', icon: '⏳' },
    potentially_stale: { text: 'Potentially stale', classes: 'bg-orange-500/15 text-orange-400 border-orange-500/30', icon: '⚠' },
    unknown: { text: 'Unverified', classes: 'bg-gray-500/15 text-gray-400 border-gray-500/30', icon: '?' },
  };
  const c = config[label];
  // The date, for the same reason the comparison page shows it: the label is
  // judged against the real clock now, so an old curated snapshot grades
  // everything the same and only the date distinguishes the records.
  const verifiedAt = getLastVerifiedAt(policyId);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium ${c.classes}`}>
      <span>{c.icon}</span> {locale === 'zh' ? word(label, locale) : c.text}
      {verifiedAt && <span className="opacity-70">· {verifiedAt.slice(0, 10)}</span>}
    </span>
  );
}

/* ── Confidence Indicator ─────────────────────────────────────────── */
function ConfidenceIndicator({ confidence }: { confidence: VerificationConfidence }) {
  const levels: Record<VerificationConfidence, { dots: number; color: string; label: string }> = {
    high: { dots: 3, color: 'bg-green-400', label: 'High confidence' },
    medium: { dots: 2, color: 'bg-yellow-400', label: 'Medium confidence' },
    low: { dots: 1, color: 'bg-orange-400', label: 'Low confidence' },
    unverified: { dots: 0, color: 'bg-gray-400', label: 'Unverified' },
  };
  const l = levels[confidence];
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted" title={l.label}>
      {[0, 1, 2].map(i => (
        <span key={i} className={`w-1 h-1 rounded-full ${i < l.dots ? l.color : 'bg-surface-2'}`} />
      ))}
      <span className="ml-0.5">{l.label}</span>
    </span>
  );
}

/* ── Metric Bar ───────────────────────────────────────────────────── */
function MetricBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/* ── Source Provenance ─────────────────────────────────────────────── */
function SourceProvenance({ lifecycle }: { lifecycle: PolicyLifecycle }) {
  const methodLabels: Record<string, string> = {
    official_source: 'Official source',
    trusted_secondary_source: 'Trusted secondary',
    ai_inferred: 'AI-inferred',
    user_submitted_unverified: 'User-submitted',
    seeded_data: 'Curated dataset',
  };
  const sourceLabels: Record<string, string> = {
    government: 'Government',
    legislature: 'Legislature',
    ministry: 'Ministry',
    court: 'Court',
    multilateral: 'Multilateral',
    reputable_media: 'Media',
    think_tank: 'Think tank',
    community_submission: 'Community',
  };

  // shortRelative, not a hardcoded date. This component was unrendered, so
  // it still carried `new Date('2026-04-17')` -- the frozen clock taken out of
  // getFreshnessLabel this morning. Against the real clock that subtraction is
  // negative, and the card would have read "-176 days ago".
  const verifiedText = shortRelative(lifecycle.lastVerifiedAt);

  return (
    <div className="mt-2 pt-2 border-t border-border/30 space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted">Verified {verifiedText}</span>
        <ConfidenceIndicator confidence={lifecycle.verificationConfidence} />
      </div>
      <div className="flex items-center gap-2 text-[10px] text-muted">
        <span>{methodLabels[lifecycle.verificationMethod] || lifecycle.verificationMethod}</span>
        <span>&middot;</span>
        <span>{sourceLabels[lifecycle.sourceType] || lifecycle.sourceType}</span>
        {lifecycle.officialSourceUrl && (
          <>
            <span>&middot;</span>
            <a href={lifecycle.officialSourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline truncate max-w-[200px]">
              Source
            </a>
          </>
        )}
      </div>
      {lifecycle.notes && (
        <div className="text-[10px] text-muted/60 italic">{lifecycle.notes}</div>
      )}
    </div>
  );
}

/* ── Version History Item ─────────────────────────────────────────── */
function VersionItem({ version }: { version: PolicyVersion }) {
  const typeColors: Record<string, string> = {
    created: 'bg-green-500/15 text-green-400',
    amended: 'bg-blue-500/15 text-blue-400',
    suspended: 'bg-orange-500/15 text-orange-400',
    repealed: 'bg-red-500/15 text-red-400',
    superseded: 'bg-orange-500/15 text-orange-400',
    status_change: 'bg-yellow-500/15 text-yellow-400',
    correction: 'bg-purple-500/15 text-purple-400',
    verified: 'bg-green-500/15 text-green-400',
  };
  return (
    <div className="relative">
      <div className="absolute -left-[25px] top-1 w-3 h-3 rounded-full border-2 border-border bg-surface" />
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-xs text-muted">{version.createdAt.slice(0, 10)}</span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${typeColors[version.changeType] || 'bg-gray-500/15 text-gray-400'}`}>
          {version.changeType.replace('_', ' ')}
        </span>
      </div>
      <div className="text-xs">{version.summary}</div>
      {version.sourceUrl && (
        <a href={version.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-accent hover:underline">
          View source
        </a>
      )}
    </div>
  );
}

/* ── Main Page ────────────────────────────────────────────────────── */
export default async function CountryPage({ params }: { params: Promise<{ iso: string }> }) {
  const { iso } = await params;
  const country = getCountry(iso.toUpperCase());
  if (!country) notFound();

  const metrics = getMetrics(country.iso);
  const policies = getPoliciesByCountry(country.iso);
  const official = await getOfficialNews({ country: country.iso, limit: 8 });
  const freshness = getCountryFreshness(country.iso);
  const scoreHistory = getScoreChanges(country.iso);
  const categoryKeys: CategoryKey[] = ['climate', 'trade', 'immigration'];

  // Live DB-backed data. Null when DATABASE_URL isn't configured.
  const live = await fetchLiveCountryData(country.iso);
  const { t, locale } = await getT();
  const displayName = countryName(country.iso, country.name, locale);
  const zd = zhData(locale);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted mb-6">
        <Link href="/explore" className="hover:text-foreground transition-colors">{t('Countries', '国家')}</Link>
        <span>/</span>
        <span className="text-foreground">{displayName}</span>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <span className="text-5xl">{country.flagEmoji}</span>
          <div>
            <h1 className="text-3xl md:text-4xl font-semibold">{displayName}</h1>
            <p className="text-muted text-sm mt-1">
              {zd.gov(country.governmentType, '')} &middot; {zd.region(country.region, '')} &middot; {zd.income(country.incomeGroup, '')}
            </p>
          </div>
        </div>
        <Link
          href={`/compare?countries=${country.iso.toLowerCase()}`}
          className="px-4 py-2 rounded-full bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors self-start"
        >
          {t('Compare with other countries', '与其他国家对比')}
        </Link>
      </div>

      {/* Key info */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: t('Capital', '首都'), value: locale === 'zh' ? CAPITAL_ZH[country.iso] ?? country.capital : country.capital },
          { label: t('Population', '人口'), value: formatPopulation(country.population) },
          { label: t('GDP', 'GDP（名义）'), value: formatGDP(country.gdp) },
          { label: t('Region', '地区'), value: zd.region(country.region, '') },
        ].map(item => (
          <div key={item.label} className="p-4 rounded-xl bg-surface border border-border">
            <div className="text-xs text-muted mb-1">{item.label}</div>
            <div className="text-sm font-semibold">{item.value}</div>
          </div>
        ))}
      </div>

      {/* Metric scores overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {categoryKeys.map(cat => {
          const score = getMetricScore(country.iso, cat);
          const color = getCategoryColor(cat);
          const domainSources = getSourcesForCountryDomain(country.iso, cat);
          return (
            <div key={cat} className="p-5 rounded-xl bg-surface border border-border">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium">{t(getCategoryLabel(cat), CAT_ZH[cat])}</span>
                <span className="text-2xl font-bold" style={{ color }}>{score}</span>
              </div>
              <MetricBar value={score} color={color} />
              {/* What backs this number. The card showed a bare score while
                  the sources behind it were computed one line above and
                  thrown away. A score with no stated provenance is the same
                  failure as a version row that claims a change it cannot
                  evidence, just quieter. */}
              <div className="mt-2 text-[10px] text-muted">
                {domainSources.length === 0 ? (
                  <span className="text-orange-400">
                    {t('No monitored source for this domain', '该领域暂无监控来源')}
                  </span>
                ) : (
                  <>
                    {domainSources.length}{' '}
                    {t(
                      domainSources.length === 1 ? 'monitored source' : 'monitored sources',
                      '个监控来源',
                    )}
                    {' · '}
                    {domainSources
                      .filter((src) => src.isActive)
                      .length}{' '}
                    {t('active', '生效中')}
                  </>
                )}
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2">
                {metrics && Object.entries(metrics[cat]).map(([key, value]) => {
                  const def = metricDefinitions.find(d => d.slug === key);
                  if (!def) return null;
                  return (
                    <div key={key} className="flex items-center justify-between text-xs">
                      <span className="text-muted">{zd.metricName(def.slug, def.name)}</span>
                      <span className="font-medium">{locale === 'zh' ? formatMetricValue(value as number, def.unit).replace('/ton', '/吨') : formatMetricValue(value as number, def.unit)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Policies with freshness */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">{t('Policies', '政策')}</h2>
        <div className="space-y-3">
          {categoryKeys.map(cat => {
            const catPolicies = policies.filter(p => p.category === cat);
            if (catPolicies.length === 0) return null;
            return (
              <div key={cat}>
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: getCategoryColor(cat) }} />
                  {t(getCategoryLabel(cat), CAT_ZH[cat])}
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
                  {catPolicies.map(policy => {
                    const lifecycle = getLifecycle(policy.id);
                    const lifecycleStatus = lifecycle?.status || policy.status;

                    return (
                      <div key={policy.id} className="p-4 rounded-xl bg-surface border border-border hover:border-accent/20 transition-colors">
                        {/* Header: title + badges. flex-wrap, not a fixed row:
                            the freshness badge carries a date now, so the
                            badge pair runs ~230px wide. Measured at 390px,
                            the unwrapped row put "active" at x=509 and
                            scrolled the whole page sideways by 119px. */}
                        <div className="flex flex-wrap sm:flex-nowrap items-start justify-between gap-2 mb-2">
                          <h4 className="text-sm font-semibold leading-snug">{zd.policyTitle(policy.id, policy.title)}</h4>
                          <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 flex-shrink-0">
                            <FreshnessBadge policyId={policy.id} locale={locale} />
                            <StatusBadge status={lifecycleStatus as Policy['status']} locale={locale} />
                          </div>
                        </div>

                        {/* Description */}
                        <p className="text-xs text-muted mb-3 leading-relaxed">{zd.policyDesc(policy.id, policy.description)}</p>

                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                          <span>
                            {policy.effectiveDate} &middot; {policy.sourceName}
                          </span>
                          {/* A policy record is the product's core data, and a
                              "Pending verification" badge on one is literally a
                              claim asking to be checked. English title and
                              description are passed, not the localised ones:
                              retrieval and every prompt in the pipeline are
                              English. */}
                          <VerifyClaimLink
                            claim={policyClaim(country.name, policy.title, policy.description)}
                            label={t('Check against sources', '对照来源核验')}
                          />
                        </div>

                        {/* How this record was verified, and by what kind of
                            source. A product about checking claims should say
                            which of its own records came from an official
                            document, which were AI-inferred, and which are
                            curated seed data -- the card showed a confidence
                            badge but never that distinction. */}
                        {lifecycle && <SourceProvenance lifecycle={lifecycle} />}

                        {/* The curated change record, which is hand-authored
                            and so means what it says -- unlike a live version
                            row, where only 15.6% of consecutive pairs differ
                            in content at all. Shown only above one version: a
                            single record is not a history, and labelling it
                            one is the same overstatement this page spent the
                            day removing. */}
                        {(() => {
                          const recorded = getVersions(policy.id);
                          if (recorded.length < 2) return null;
                          return (
                            <div className="mt-3 pt-3 border-t border-border/30">
                              <div className="text-[10px] font-semibold text-muted mb-2">
                                {t(
                                  `Recorded changes (${recorded.length})`,
                                  `已记录变更（${recorded.length}）`,
                                )}
                              </div>
                              <div className="pl-6 border-l border-border/40 space-y-2.5">
                                {[...recorded].reverse().map((v) => (
                                  <VersionItem key={v.id} version={v} />
                                ))}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Timeline */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">{t('Policy Timeline', '政策时间线')}</h2>
        <div className="relative pl-6 border-l-2 border-border space-y-4">
          {[...policies]
            .sort((a, b) => new Date(b.effectiveDate).getTime() - new Date(a.effectiveDate).getTime())
            .map(policy => {
              const lifecycle = getLifecycle(policy.id);
              return (
                <div key={policy.id} className="relative">
                  <div className="absolute -left-[25px] top-1 w-3 h-3 rounded-full border-2 border-border bg-surface" style={{ borderColor: getCategoryColor(policy.category) }} />
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs text-muted">{policy.effectiveDate}</span>
                    {lifecycle && <FreshnessBadge policyId={policy.id} locale={locale} />}
                  </div>
                  <div className="text-sm font-semibold">{zd.policyTitle(policy.id, policy.title)}</div>
                  <div className="text-xs text-muted">
                    {t(DOMAIN_LABEL[policy.category][0], DOMAIN_LABEL[policy.category][1])} &middot; {zd.status(lifecycle?.status || policy.status, '')}
                    {lifecycle && (locale === 'zh' ? ` · 核实于 ${lifecycle.lastVerifiedAt.slice(0, 10)}` : ` · Verified ${lifecycle.lastVerifiedAt.slice(0, 10)}`)}
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* Official updates (real, from government feeds) */}
      <div className="mb-10">
        <h2 className="text-xl font-semibold mb-1">{t('Latest official updates', '最新官方公告')}</h2>
        <p className="text-sm text-muted mb-4">
          {t('Collected automatically from government websites.', '自动收集自政府官网。')}
        </p>
        {official.length === 0 ? (
          <p className="text-sm text-muted p-4 rounded-xl bg-surface border border-border">
            {t(
              `We don't track an official news feed for ${country.name} yet.`,
              `暂未接入${displayName}的官方公告来源。`,
            )}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-xl bg-surface border border-border overflow-hidden">
            {official.map((it) => (
              <li key={it.id}>
                <a href={it.url ?? '#'} target="_blank" rel="noopener noreferrer" className="block px-5 py-3.5 hover:bg-surface-2 transition-colors">
                  <div className="text-xs text-muted mb-0.5">
                    {word(it.domain, locale)} · {it.source} · {it.publishedAt.slice(0, 10)}
                    {it.lang !== 'en' && originalLanguageLabel(it.lang, locale) ? ` · ${originalLanguageLabel(it.lang, locale)}` : ''}
                  </div>
                  <div className="text-sm font-medium leading-snug">{it.title}</div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="group rounded-xl border border-border bg-surface/60 [&_summary::-webkit-details-marker]:hidden">
        <summary className="cursor-pointer list-none px-5 py-4 flex items-center justify-between text-sm font-medium">
          <span>{t('For researchers: data sources and update records', '给研究者：数据来源与更新记录')}</span>
          <span className="text-muted group-open:rotate-180 transition-transform">⌄</span>
        </summary>
        <div className="px-5 pb-6 pt-2">
      {/* Freshness summary */}
      <div className="mb-8 p-4 rounded-xl bg-surface border border-border">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold">{t('Data Freshness', '数据新鲜度')}</h3>
            <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${
              freshness.overallConfidence === 'high' ? 'bg-green-500/15 text-green-400 border-green-500/30'
              : freshness.overallConfidence === 'medium' ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
              : 'bg-orange-500/15 text-orange-400 border-orange-500/30'
            }`}>
              {t(`${freshness.overallConfidence} confidence`, `可信度${word(freshness.overallConfidence, locale)}`)}
            </span>
          </div>
          {/* A date in the past is not a "next" check. Measured on production
              2026-10-10, every country page announced one: US 2026-04-19,
              GB 2026-02-18, DE 2026-03-20, CN 2026-03-08, CA 2026-04-20 --
              six to eight months earlier. These are the curated lifecycles,
              laid out around the fixture's April reference date; the live
              pipelines check daily and are reported further down. */}
          {(() => {
            const sched = reviewSchedule(freshness.nextScheduledCheck);
            if (sched.state === 'unknown') return null;
            if (sched.state === 'scheduled') {
              return (
                <div className="text-xs text-muted">
                  {t('Next scheduled check', '下次计划检查')}: {sched.date}
                </div>
              );
            }
            return (
              <div className="text-xs text-orange-400">
                {t(
                  `Curated review overdue since ${sched.date} (${sched.days} days)`,
                  `策展记录复核已逾期，自 ${sched.date} 起（${sched.days} 天）`,
                )}
              </div>
            );
          })()}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="p-2 rounded-lg bg-background border border-border/50">
            <div className="text-[10px] text-muted">{t('Total Policies', '政策总数')}</div>
            <div className="text-lg font-bold">{freshness.totalPolicies}</div>
          </div>
          <div className="p-2 rounded-lg bg-background border border-border/50">
            <div className="text-[10px] text-muted">{t('Active', '生效中')}</div>
            <div className="text-lg font-bold text-green-400">{freshness.activePolicies}</div>
          </div>
          <div className="p-2 rounded-lg bg-background border border-border/50">
            <div className="text-[10px] text-muted">{t('Recently Verified', '近期已核实')}</div>
            <div className="text-lg font-bold text-blue-400">{freshness.recentlyVerified}</div>
          </div>
          <div className="p-2 rounded-lg bg-background border border-border/50">
            <div className="text-[10px] text-muted">{t('Potentially Stale', '可能过期')}</div>
            <div className="text-lg font-bold text-orange-400">{freshness.stalePolicies}</div>
          </div>
          <div className="p-2 rounded-lg bg-background border border-border/50">
            <div className="text-[10px] text-muted">{t('Pending Review', '待复核')}</div>
            <div className="text-lg font-bold text-yellow-400">{freshness.pendingReview}</div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-4 text-[10px] text-muted">
          <span>{t('Sources: World Bank, WTO, UNFCCC, UNHCR, national government publications', '来源：世界银行、世贸组织、联合国气候变化框架公约、联合国难民署及各国政府出版物')}</span>
          <span>&middot;</span>
          <span>{t('Last full verification', '最近一次全面核实')}: {freshness.lastFullVerification.slice(0, 10)}</span>
        </div>
      </div>

      {/* Score change history */}
      {scoreHistory.length > 0 && (
        <div className="mb-8 p-4 rounded-xl bg-surface border border-border">
          <h3 className="text-sm font-semibold mb-3">{t('Score Change History', '分数变化历史')}</h3>
          <div className="space-y-2">
            {scoreHistory.map(change => (
              <div key={change.id} className={META_ROW}>
                <span className="text-muted w-20 flex-shrink-0">{change.computedAt.slice(0, 10)}</span>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: getCategoryColor(change.category) }} />
                <span className="text-muted">{t(getCategoryLabel(change.category), CAT_ZH[change.category])}</span>
                <span className={`font-bold ${change.delta > 0 ? 'text-green-400' : change.delta < 0 ? 'text-red-400' : 'text-muted'}`}>
                  {change.delta > 0 ? '+' : ''}{change.delta}
                </span>
                <span className="text-muted">{change.previousScore} → {change.newScore}</span>
                <span className="text-muted/60 truncate">{change.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Live database section ───────────────────────────────────────
          Rendered only when DATABASE_URL is configured. Everything above
          is curated seed data; everything here is live from Postgres. */}
      {live && (
        <div className="mt-10 pt-8 border-t border-border">
          <div className="flex items-center gap-2 mb-6">
            <h2 className="text-xl font-semibold">{t('Live database', '实时数据库')}</h2>
            <span className="text-[10px] px-2 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/30">
              DB-backed
            </span>
          </div>

          {/* Evidence-backed coverage + live pipeline summary */}
          <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-surface border border-border">
              <div className="text-[10px] text-muted uppercase tracking-wider mb-1">Live pipelines</div>
              <div className="text-2xl font-bold">{live.monitoredSources.length}</div>
              <div className="text-[10px] text-muted">
                {live.pipelineRuns[0]
                  ? <>last run {shortRelative(live.pipelineRuns[0].startedAt)}</>
                  : 'never run'}
                {live.pipelineRuns[0] && runState(live.pipelineRuns[0]) === 'abandoned' && (
                  <span className="text-orange-400"> — did not finish</span>
                )}
              </div>
              {/* A run that fails still counts as a run, so the line above
                  can read "last run today" for a source that has never
                  once returned a page. Say how many are not working. */}
              {(() => {
                const broken = live.monitoredSources.filter(
                  (s) => sourceHealth(s).state !== 'healthy',
                ).length;
                return broken > 0 ? (
                  <div className="text-[10px] text-orange-400">
                    {broken} not reachable
                  </div>
                ) : null;
              })()}
            </div>
            <div className="p-3 rounded-lg bg-surface border border-border">
              <div className="text-[10px] text-muted uppercase tracking-wider mb-1">Evidence-backed submetrics</div>
              <div className="text-2xl font-bold">
                {live.evidenceBacked} / {live.totalSubmetrics}
              </div>
              <div className="w-full h-1.5 rounded-full bg-surface-2 overflow-hidden mt-1">
                <div
                  className="h-full bg-green-400"
                  style={{
                    width: `${
                      live.totalSubmetrics === 0 ? 0 : (live.evidenceBacked / live.totalSubmetrics) * 100
                    }%`,
                  }}
                />
              </div>
              <div className="text-[10px] text-muted mt-1">remainder seeded baseline</div>
            </div>
            <div className="p-3 rounded-lg bg-surface border border-border">
              <div className="text-[10px] text-muted uppercase tracking-wider mb-1">Official feed items</div>
              <div className="text-2xl font-bold">{live.feedItems.length}</div>
              <div className="text-[10px] text-muted">
                {live.feedItems[0]
                  ? <>latest {shortRelative(live.feedItems[0].newsArticle.publishedAt)}</>
                  : 'no feed items yet'}
              </div>
            </div>
          </div>

          {/* Pipeline runs timeline */}
          {live.pipelineRuns.length > 0 && (
            <div className="mb-6 p-4 rounded-xl bg-surface border border-border">
              <h3 className="text-sm font-semibold mb-3">{t('Recent pipeline runs', '近期采集记录')}</h3>
              <div className="space-y-2">
                {live.pipelineRuns.slice(0, 5).map((r) => (
                  <div key={r.id} className={META_ROW}>
                    <span className="text-muted w-24 flex-shrink-0 whitespace-nowrap">
                      {shortRelative(r.startedAt)}
                    </span>
                    <span className="font-mono text-[11px] min-w-[12rem] truncate">{r.pipelineKey}</span>
                    <RunStateBadge run={r} size="xs" />
                    <span className="text-muted truncate">{r.changeType ?? '—'}</span>
                    <span className="text-muted/70 truncate">{r.summary ?? ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live official feed items (distinct from curated news) */}
          {live.feedItems.length > 0 && (
            <div className="mb-6 p-4 rounded-xl bg-surface border border-border">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold">{t('Live official updates', '官方实时更新')}</h3>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/30">
                  official_feed
                </span>
              </div>
              <div className="space-y-2">
                {live.feedItems.slice(0, 8).map((fi) => (
                  <a
                    key={fi.id}
                    href={fi.newsArticle.url ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs hover:bg-background rounded px-2 py-1 transition-colors"
                  >
                    <span className="text-muted mr-2">
                      {new Date(fi.newsArticle.publishedAt).toISOString().slice(0, 10)}
                    </span>
                    <span className="font-medium">{fi.newsArticle.title}</span>
                    <span className="text-muted ml-2">· {fi.newsArticle.source}</span>
                  </a>
                ))}
              </div>
              <p className="text-[10px] text-muted italic mt-2">
                Ingested directly from the issuing government’s RSS/Atom feed.
              </p>
            </div>
          )}

          {/* Domain scores (DB) */}
          {live.domainScores.length > 0 && (
            <div className="mb-6 p-4 rounded-xl bg-surface border border-border">
              <h3 className="text-sm font-semibold mb-3">{t('Domain scores (live)', '各领域分数（实时）')}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {live.domainScores.map((s) => (
                  <div key={s.id} className="p-3 rounded-lg bg-background border border-border/50">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted">{s.domain}</span>
                      <span
                        className="text-lg font-bold"
                        style={{ color: getCategoryColor(s.domain as CategoryKey) }}
                      >
                        {s.score.toFixed(2)}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-muted">
                      v{s.methodologyVersion} &middot; {shortRelative(s.lastComputedAt)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* DB policies */}
          {live.dbPolicies.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold mb-3">
                {t(`Policies (${live.dbPolicies.length} live records)`, `政策（${live.dbPolicies.length} 条实时记录）`)}
              </h3>
              <div className="space-y-3">
                {live.dbPolicies.map((p) => (
                  <div key={p.id} className="p-4 rounded-xl bg-surface border border-border">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <h4 className="text-sm font-semibold leading-snug">{p.title}</h4>
                        <div className="text-[10px] text-muted mt-0.5">
                          {p.domain} &middot; {p.status} &middot; {p.verificationConfidence} confidence
                        </div>
                      </div>
                      <div className="text-[10px] text-muted whitespace-nowrap">
                        {p.versions.length} version{p.versions.length !== 1 ? 's' : ''}
                      </div>
                    </div>
                    {p.summary && (
                      <p className="text-xs text-muted mb-2 leading-relaxed">{p.summary}</p>
                    )}
                    <div className="mb-2 text-[11px]">
                      <VerifyClaimLink
                        claim={policyClaim(country.name, p.title, p.summary)}
                        label={t('Check against sources', '对照来源核验')}
                      />
                    </div>
                    {p.versions.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-border/30">
                        {(() => {
                          // A version row means the watched page changed, not that
                          // the policy did. Across the database only 15.6% of
                          // consecutive versions differ in content at all, and one
                          // record carries 102 identical ones. Grouping by content
                          // keeps the history honest about which were edits.
                          const groups = collapseUnchanged(p.versions);
                          const changes = groups.length;
                          return (
                            <>
                              <div className="text-[10px] font-semibold text-muted mb-1.5">
                                Version history — {changes} content {changes === 1 ? 'state' : 'states'} across the
                                {' '}{p.versions.length} most recent of {p._count.versions} recorded checks
                              </div>
                              <div className="space-y-2">
                                {groups.map((g, gi) => {
                                  const older = groups[gi + 1]?.version;
                                  const parts =
                                    older && g.version.summary
                                      ? diffWords(older.summary ?? '', g.version.summary)
                                      : null;
                                  return (
                                    <div key={g.version.id} className="text-[11px]">
                                      <div className="flex items-center gap-2">
                                        <span className="text-muted w-10">v{g.version.versionNumber}</span>
                                        <span className="px-1.5 py-0.5 rounded bg-surface-2 text-[10px] text-muted">
                                          {g.version.changeType}
                                        </span>
                                        <span className="text-muted">{shortRelative(g.version.createdAt)}</span>
                                        {g.checks > 1 && (
                                          <span className="px-1.5 py-0.5 rounded bg-surface-2 text-[10px] text-muted">
                                            {g.checks} checks, no content change
                                          </span>
                                        )}
                                      </div>
                                      {parts ? (
                                        <p className="mt-1 leading-relaxed">
                                          {parts.map((part, pi) => (
                                            <span
                                              key={pi}
                                              className={
                                                part.type === 'added'
                                                  ? 'bg-green-500/15 text-green-300'
                                                  : part.type === 'removed'
                                                    ? 'bg-red-500/15 text-red-300 line-through'
                                                    : 'text-muted'
                                              }
                                            >
                                              {part.text}{' '}
                                            </span>
                                          ))}
                                        </p>
                                      ) : (
                                        <p className="mt-1 text-muted leading-relaxed">
                                          {g.version.summary ?? '—'}
                                        </p>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    )}
                    {p.officialSourceUrl && (
                      <a
                        href={p.officialSourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-block text-[11px] text-accent hover:underline"
                      >
                        Official source
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Score change log */}
          {live.scoreChangeLogs.length > 0 && (
            <div className="mb-6 p-4 rounded-xl bg-surface border border-border">
              <h3 className="text-sm font-semibold mb-3">{t('Score change history (live)', '分数变化历史（实时）')}</h3>
              <div className="space-y-2">
                {live.scoreChangeLogs.map((c) => (
                  <div key={c.id} className={META_ROW}>
                    <span className="text-muted w-20 flex-shrink-0">
                      {shortRelative(c.createdAt)}
                    </span>
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: getCategoryColor(c.domain as CategoryKey) }}
                    />
                    <span className="text-muted">{getCategoryLabel(c.domain as CategoryKey)}</span>
                    <span
                      className={`font-bold ${
                        c.delta > 0 ? 'text-green-400' : c.delta < 0 ? 'text-red-400' : 'text-muted'
                      }`}
                    >
                      {c.delta > 0 ? '+' : ''}
                      {c.delta.toFixed(2)}
                    </span>
                    <span className="text-muted">
                      {c.previousScore.toFixed(2)} → {c.newScore.toFixed(2)}
                    </span>
                    {c.explanation && (
                      <span className="text-muted/60 truncate">{c.explanation}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Monitored sources */}
          {live.monitoredSources.length > 0 && (
            <div className="mb-6 p-4 rounded-xl bg-surface border border-border">
              <h3 className="text-sm font-semibold mb-3">{t('Monitored sources', '监控的来源')}</h3>
              <div className="space-y-2">
                {live.monitoredSources.map((s) => {
                  // `lastCheckedAt` is stamped on every attempt, successful
                  // or not, so on its own it reports a source as current
                  // while it has been returning 404 for months.
                  const health = sourceHealth(s);
                  return (
                    <div key={s.id} className="text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{s.sourceName}</div>
                          <a
                            href={s.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-accent hover:underline truncate block"
                          >
                            {s.sourceUrl}
                          </a>
                        </div>
                        <div className="text-right text-[10px] text-muted whitespace-nowrap">
                          <div>
                            {s.domain} &middot; {s.sourceType}
                          </div>
                          <div>Last checked {shortRelative(s.lastCheckedAt)}</div>
                        </div>
                      </div>
                      {health.label && (
                        <div className="mt-1 rounded border border-orange-500/30 bg-orange-500/10 px-2 py-1 text-[10px] text-orange-300">
                          {health.label}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p className="text-[10px] text-muted italic">
            Methodology: domain scores are weighted averages of up to 7 submetrics per domain. Changes are logged
            only when a policy version with non-zero impact lands and recomputation moves the score.
          </p>
        </div>
      )}
        </div>
      </details>
    </div>
  );
}
