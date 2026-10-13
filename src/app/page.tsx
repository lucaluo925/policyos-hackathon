/**
 * Homepage — V8 truth-aligned.
 *
 * Counters and copy come from the live DB at request time. No hardcoded
 * "1 live pipeline / 61 sources / V2" legacy text. Hero stat bar and the
 * honesty strip are built from `/api/system-status` data, so closing a
 * new pipeline or an evidence-backed submetric bump is visible on the
 * homepage without a code change.
 *
 * Server component. Falls back gracefully when the DB is unreachable —
 * the UI stays usable but stats show "—" rather than lies.
 */

import Link from 'next/link';
import Globe3D, { type GlobeMarker } from '@/components/globe/Globe3D';
import { FeatureIcon, type FeatureIconName } from '@/components/FeatureIcon';
import { Reveal } from '@/components/Reveal';
import { ScrollRevealText } from '@/components/ScrollRevealText';
import { countries } from '@/lib/data/countries';
import { getMetricScore } from '@/lib/data/metrics';
import { isDatabaseConfigured, getPrisma } from '@/lib/db';
import { PIPELINE_COVERAGE } from '@/lib/pipeline/coverage';
import { getT } from '@/lib/i18n/server';
import { POLICY_EVENTS_STUDIED } from '@/lib/research/studies';
import { STALE_DAYS_THRESHOLD } from '@/lib/pipeline/source-health';
import { countryName, type T } from '@/lib/i18n';
import { zhData } from '@/lib/i18n/data-zh';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface SystemSnapshot {
  ok: boolean;
  pipelineTotal: number;
  /**
   * Per-domain split of feedItems, so the three numbers under "Updates
   * collected" add up to the total above them. They used to be the monitored
   * SOURCE counts per domain: correct numbers, but rendered as colour-coded
   * figures directly beneath "Updates collected 336", where they can only
   * read as a breakdown of those 336 -- and they summed to 13.
   */
  feedItemsByDomain: { climate: number; trade: number; immigration: number };
  countriesCovered: number;
  sourcesTotal: number;
  sourcesActive: number;
  sourcesUnstable: number;
  sourcesNotDelivering: number;
  evidenceBacked: number;
  evidenceTotal: number;
  evidencePct: number;
  strongVersions: number;
  mediumVersions: number;
  feedItems: number;
  latestFeedAt: string | null;
  latestRunAt: string | null;
  latestRunPipeline: string | null;
}

async function loadSnapshot(): Promise<SystemSnapshot> {
  if (!isDatabaseConfigured()) {
    return {
      ok: false,
      pipelineTotal: PIPELINE_COVERAGE.length,
      // feedItems is 0 without a database, so its split is 0 too.
      feedItemsByDomain: { climate: 0, trade: 0, immigration: 0 },
      countriesCovered: new Set(PIPELINE_COVERAGE.map((c) => c.countryIso)).size,
      sourcesTotal: PIPELINE_COVERAGE.length,
      sourcesActive: PIPELINE_COVERAGE.length,
      sourcesUnstable: 0,
      sourcesNotDelivering: 0,
      evidenceBacked: 0,
      evidenceTotal: 315,
      evidencePct: 0,
      strongVersions: 0,
      mediumVersions: 0,
      feedItems: 0,
      latestFeedAt: null,
      latestRunAt: null,
      latestRunPipeline: null,
    };
  }

  const prisma = getPrisma();
  const [
    pipelineTotal,
    feedClimate,
    feedTrade,
    feedImmigration,
    distinctCountries,
    sourcesTotal,
    sourcesActive,
    sourcesUnstable,
    sourcesNotDelivering,
    evidenceBacked,
    evidenceTotal,
    strongVersions,
    mediumVersions,
    feedItems,
    latestFeed,
    latestRun,
  ] = await Promise.all([
    prisma.monitoredSource.count({ where: { pipelineKey: { not: null } } }),
    // Split of the same rows feedItems counts, so the parts sum to the whole.
    prisma.newsArticle.count({ where: { ingestionType: 'rss_feed', domain: 'climate' } }),
    prisma.newsArticle.count({ where: { ingestionType: 'rss_feed', domain: 'trade' } }),
    prisma.newsArticle.count({ where: { ingestionType: 'rss_feed', domain: 'immigration' } }),
    prisma.monitoredSource.findMany({ where: { pipelineKey: { not: null } }, distinct: ['countryId'], select: { countryId: true } }),
    prisma.monitoredSource.count(),
    prisma.monitoredSource.count({ where: { active: true } }),
    prisma.monitoredSource.count({ where: { isStable: false } }),
    // Sources that are not actually delivering. isStable is a failure-rate
    // heuristic and misses a source that fails quietly: Canada sat at a 0.30
    // rate, under the threshold, having last succeeded 173 days earlier.
    // Last success is the fact; this counts never-succeeded as well.
    prisma.monitoredSource.count({
      where: {
        OR: [
          { lastSuccessAt: null },
          { lastSuccessAt: { lt: new Date(Date.now() - STALE_DAYS_THRESHOLD * 86_400_000) } },
        ],
      },
    }),
    prisma.scoreSubmetric.count({ where: { evidenceBackedAt: { not: null } } }),
    prisma.scoreSubmetric.count(),
    prisma.policyVersion.count({ where: { evidenceType: 'strong' } }),
    prisma.policyVersion.count({ where: { evidenceType: 'medium' } }),
    prisma.newsArticle.count({ where: { ingestionType: 'rss_feed' } }),
    prisma.newsArticle.findFirst({ where: { ingestionType: 'rss_feed' }, orderBy: { publishedAt: 'desc' }, select: { publishedAt: true } }),
    prisma.pipelineRun.findFirst({ orderBy: { startedAt: 'desc' }, select: { startedAt: true, pipelineKey: true } }),
  ]);

  return {
    ok: true,
    pipelineTotal,
    feedItemsByDomain: { climate: feedClimate, trade: feedTrade, immigration: feedImmigration },
    countriesCovered: distinctCountries.length,
    sourcesTotal,
    sourcesActive,
    sourcesUnstable,
    sourcesNotDelivering,
    evidenceBacked,
    evidenceTotal,
    evidencePct: evidenceTotal > 0 ? Math.round((evidenceBacked / evidenceTotal) * 1000) / 10 : 0,
    strongVersions,
    mediumVersions,
    feedItems,
    latestFeedAt: latestFeed?.publishedAt.toISOString() ?? null,
    latestRunAt: latestRun?.startedAt.toISOString() ?? null,
    latestRunPipeline: latestRun?.pipelineKey ?? null,
  };
}

function relativeAgo(iso: string | null, t: T): string {
  if (!iso) return t('never', '从未');
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return t('just now', '刚刚');
  if (mins < 60) return t(`${mins}m ago`, `${mins} 分钟前`);
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t(`${hrs}h ago`, `${hrs} 小时前`);
  const days = Math.floor(hrs / 24);
  return t(`${days}d ago`, `${days} 天前`);
}

const features: Array<{ icon: FeatureIconName; title: [string, string]; description: [string, string]; href?: string }> = [
  { icon: 'map', title: ['Global Policy Map', '全球政策地图'], description: ['Country scores across climate, trade, and immigration on one interactive map.', '在一张交互地图上查看各国在气候、贸易、移民三个领域的分数。'], href: '/explore' },
  { icon: 'markets', title: ['Policy events × markets', '政策事件 × 市场'], description: ['How US and Chinese stocks reacted when the two countries restricted trade with each other.', '中美互相限制贸易时，两国股市是怎么反应的。'], href: '/research' },
  { icon: 'metrics', title: ['Comparable Metrics', '可比指标'], description: ['Put countries side by side on the same 0–100 scale.', '把不同国家放在同一个 0–100 分的尺子上比较。'], href: '/compare' },
  { icon: 'feed', title: ['Live Official Feeds', '官方实时来源'], description: ['New announcements from government websites, collected automatically.', '自动收集各国政府网站发布的新公告。'], href: '/news' },
  { icon: 'extract', title: ['Reads the fine print', '读懂政策细节'], description: ['Opens each policy page to pick out the key numbers — tax rates, quotas, deadlines.', '打开每一条政策原文，提取关键数字——税率、配额、截止时间。'] },
  { icon: 'history', title: ['Full history', '完整历史'], description: ['See how each policy changed over time, with a link to every original source.', '看到每条政策随时间的变化，每一版都附原始出处链接。'] },
];

const topCountries = countries.slice(0, 6);

export default async function HomePage() {
  const { t, locale } = await getT();
  const snap = await loadSnapshot();

  // One marker per country we actually run a pipeline for — not every country
  // in the dataset, so the globe never claims more coverage than exists.
  const globeMarkers: GlobeMarker[] = Array.from(
    new Set(PIPELINE_COVERAGE.map((c) => c.countryIso)),
  )
    .map((iso) => countries.find((c) => c.iso === iso))
    .filter((c): c is (typeof countries)[number] => Boolean(c))
    .map((c) => ({ lat: c.lat, lon: c.lon }));

  return (
    <div className="min-h-screen">
      {/* Hero — dark band with the 3D globe. The rest of the page stays light;
          the contrast is deliberate and marks the hero as the one "product" shot. */}
      <section className="relative isolate overflow-hidden bg-[#070A12] text-white">
        <div
          aria-hidden
          className="hero-grid pointer-events-none absolute inset-0 opacity-[0.06]"
        />
        <div
          aria-hidden
          className="hero-globe-glow pointer-events-none absolute right-[-18%] top-1/2 h-[760px] w-[760px] -translate-y-1/2 rounded-full blur-3xl"
        />

        <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,540px)] lg:px-8 lg:py-28">
          <div>
            <div className="mb-6 inline-flex items-start gap-2 rounded-2xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 backdrop-blur sm:items-center sm:rounded-full sm:py-1">
              <span className="mt-[0.3rem] h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#4ade80] sm:mt-0" />
              {t(
                `Tracking ${snap.pipelineTotal} official government sources across ${snap.countriesCovered} countries`,
                `自动追踪 ${snap.countriesCovered} 个国家的 ${snap.pipelineTotal} 个政府官方来源`,
              )}
            </div>

            <h1 className="mb-6 text-4xl font-bold leading-[1.06] tracking-tight md:text-[3.5rem]">
              {t('Government policy,', '各国政府政策，')}
              <br className="hidden sm:block" />
              <span className="bg-gradient-to-r from-[#5FB0FF] to-[#9BE1FF] bg-clip-text text-transparent">
                {t('tracked and compared.', '一目了然。')}
              </span>
            </h1>

            <p className="mb-9 max-w-xl text-base leading-relaxed text-white/60 md:text-lg">
              {t(
                'PolicyOS reads official government websites every day, turns changes in climate, trade and immigration policy into simple scores, and links every number back to where it came from.',
                'PolicyOS 每天读取各国政府官网，把气候、贸易、移民方面的政策变化整理成简单的分数，每个数字都能追溯到原始出处。',
              )}
            </p>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/explore"
                className="rounded-full bg-[#2E6BF5] px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-[#1F58DB]"
              >
                {t('Explore the Map', '探索地图')}
              </Link>
              <Link
                href="/verify"
                className="rounded-full border border-white/20 px-6 py-3 text-sm font-medium text-white/85 transition-colors hover:bg-white/10"
              >
                {t('Verify a claim', '核验一条说法')}
              </Link>
            </div>
          </div>

          {/* Globe + the two cards that float over it */}
          <div className="relative mx-auto aspect-square w-full max-w-[540px]">
            <Globe3D markers={globeMarkers} className="absolute inset-0 h-full w-full" />

            <div className="absolute -left-2 top-[14%] hidden w-[196px] rounded-2xl bg-white sm:block p-4 text-[#0b0d12] shadow-[0_18px_50px_rgba(0,3,19,0.45)] sm:-left-6 sm:w-[216px]">
              <div className="text-[11px] font-medium uppercase tracking-wide text-black/45">
                {t('Official sources', '官方来源')}
              </div>
              <div className="mt-1 text-3xl font-semibold tabular-nums">{snap.pipelineTotal}</div>
              <div className="mt-0.5 text-xs text-black/55">
                {t(`across ${snap.countriesCovered} countries`, `覆盖 ${snap.countriesCovered} 个国家`)}
              </div>
            </div>

            <div className="absolute -right-2 bottom-[12%] hidden w-[214px] rounded-2xl bg-white sm:block p-4 text-[#0b0d12] shadow-[0_18px_50px_rgba(0,3,19,0.45)] sm:-right-6 sm:w-[236px]">
              <div className="text-[11px] font-medium uppercase tracking-wide text-black/45">
                {t('Updates collected', '收录的官方更新')}
              </div>
              <div className="mt-1 text-3xl font-semibold tabular-nums">{snap.feedItems}</div>
              <div className="mt-2 flex items-center gap-3 text-[11px] text-black/55">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-climate" />
                  {snap.feedItemsByDomain.climate}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-trade" />
                  {snap.feedItemsByDomain.trade}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-immigration" />
                  {snap.feedItemsByDomain.immigration}
                </span>
              </div>
              {snap.latestRunAt && (
                <div className="mt-2 border-t border-black/10 pt-2 text-[11px] text-black/45">
                  {t('Last updated', '最近更新')} {relativeAgo(snap.latestRunAt, t)}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Key numbers */}
      <section className="border-y border-border bg-surface">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { value: snap.pipelineTotal, label: t('Official sources tracked', '追踪的官方来源') },
              { value: countries.length, label: t('Countries compared', '可对比的国家') },
              { value: snap.feedItems, label: t('Official updates collected', '收录的官方更新') },
              { value: POLICY_EVENTS_STUDIED, label: t('Policy events studied', '研究过的政策事件') },
            ].map((stat, i) => (
              <Reveal key={stat.label} delay={i * 80} className="text-center">
                <div className="text-3xl font-semibold text-foreground">{stat.value}</div>
                <div className="mt-1 text-sm text-muted">{stat.label}</div>
              </Reveal>
            ))}
          </div>
          {snap.latestRunAt && (
            <div className="mt-6 text-center text-xs text-muted">
              {t('Last updated', '最近更新')} {relativeAgo(snap.latestRunAt, t)}
            </div>
          )}
          {/* "Tracked" is not "working". A run that fails is still a run, so the
              line above can read as current while a source has not returned a
              page in months. Say how many, on the front page rather than only
              on the country page that happens to hold the dead one. */}
          {/* The scores are the headline claim, so the front page says how much
              of them rests on a detected change rather than on the seeded
              baseline. The country and comparison pages already do; this was
              the third number computed here and then not rendered. */}
          {snap.evidenceTotal > 0 && (
            <div className="mt-2 text-center text-xs text-muted">
              {t(
                `${snap.evidenceBacked} of ${snap.evidenceTotal} scoring submetrics are backed by a detected policy change (${snap.evidencePct}%); the rest are a seeded baseline.`,
                `${snap.evidenceTotal} 个评分子指标中有 ${snap.evidenceBacked} 个由检测到的政策变更支撑（${snap.evidencePct}%），其余为种子基线。`,
              )}
            </div>
          )}
          {snap.sourcesNotDelivering > 0 && (
            <div className="mt-2 text-center text-xs text-orange-400">
              {t(
                `${snap.sourcesNotDelivering} of these sources ${snap.sourcesNotDelivering === 1 ? 'has' : 'have'} not returned a page in over ${STALE_DAYS_THRESHOLD} days — shown on each country page.`,
                `其中 ${snap.sourcesNotDelivering} 个来源已超过 ${STALE_DAYS_THRESHOLD} 天没有成功抓取——各国家页上有标注。`,
              )}
            </div>
          )}
        </div>
      </section>

      {/* The argument, stated once. Words darken as the section scrolls past,
          which paces the reading instead of handing over a wall of text. */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
          <ScrollRevealText
            text={t(
              'Policy changes faster than anyone can read it. A number in a news story may be a year old, or come from a draft that never passed. PolicyOS reads the official page, records what it said and when, and links every score back to the sentence it came from.',
              '政策变化的速度超过任何人能读完的速度。新闻里的一个数字可能是一年前的，也可能来自一份从未通过的草案。PolicyOS 读官方原文，记录它在什么时候说了什么，并让每一个分数都能回到它出处的那句话。',
            )}
          />
        </div>
      </section>

      {/* How it works, in plain words */}
      <section className="border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                title: t('Where the data comes from', '数据从哪里来'),
                body: t(
                  'Directly from government websites such as GOV.UK, US immigration and German environment ministry pages. If a site changes or goes down, we notice and flag it.',
                  '直接来自各国政府网站，比如英国政府官网、美国移民局、德国环境部等。网站改版或打不开时，系统会发现并标记出来。',
                ),
              },
              {
                title: t('What the scores mean', '分数代表什么'),
                body: t(
                  'Each country gets a 0–100 score for climate, trade and immigration. Higher means more ambitious climate action, more open trade, or more open immigration.',
                  '每个国家在气候、贸易、移民三方面各有一个 0–100 分。分数越高，代表气候行动越积极、贸易越开放、移民政策越宽松。',
                ),
              },
              {
                title: t("What's still an estimate", '哪些还是估算'),
                body: t(
                  'Most scores start from a researched estimate and are updated only when a real policy change is found. Estimates are always labelled.',
                  '多数分数从研究估算起步，只有发现真实的政策变化时才会更新。估算的部分都有标注。',
                ),
              },
            ].map((c) => (
              <div key={c.title} className="p-5 rounded-xl bg-surface border border-border">
                <div className="font-semibold mb-2">{c.title}</div>
                <p className="text-sm text-muted leading-relaxed">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-semibold mb-4">{t('What you can do here', '在这里可以做什么')}</h2>
            <p className="text-muted max-w-2xl mx-auto">
              {t(
                'Policy news is scattered across hundreds of government websites. PolicyOS brings it together in one place you can check.',
                '政策信息分散在成百上千个政府网站上，PolicyOS 把它们汇总到一个可以查证的地方。',
              )}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f, i) => {
              const body = (
                <>
                  <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <FeatureIcon name={f.icon} />
                  </div>
                  <h3 className="mb-2 text-base font-semibold">{t(f.title[0], f.title[1])}</h3>
                  <p className="text-sm leading-relaxed text-muted">{t(f.description[0], f.description[1])}</p>
                </>
              );
              // Two of these describe how the system works rather than naming a
              // page to visit. They used to render as links with
              // pointer-events-none: identical to the clickable cards, and a
              // dead end when clicked. Now they are plainly not links.
              return (
                <Reveal key={f.title[0]} delay={i * 60}>
                  {f.href ? (
                    <Link
                      href={f.href}
                      className="block h-full rounded-xl border border-border bg-surface p-6 transition-colors hover:border-accent/30"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="h-full rounded-xl border border-dashed border-border bg-transparent p-6">
                      {body}
                    </div>
                  )}
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* Country preview */}
      <section className="py-20 bg-surface border-y border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl font-semibold">{t('Featured Countries', '重点国家')}</h2>
              <p className="text-sm text-muted mt-1">{t('Policy scores across three domains', '三个领域的政策分数')}</p>
            </div>
            <Link href="/explore" className="text-sm text-accent hover:text-accent/80 font-medium">
              {t('View all →', '查看全部 →')}
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {topCountries.map((c) => (
              <Link key={c.iso} href={`/countries/${c.iso.toLowerCase()}`} className="p-5 rounded-xl bg-background border border-border hover:border-accent/30 transition-all group">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-2xl">{c.flagEmoji}</span>
                  <div>
                    <div className="font-semibold group-hover:text-accent transition-colors">{countryName(c.iso, c.name, locale)}</div>
                    <div className="text-xs text-muted">{zhData(locale).region(c.region, '')}</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    { key: 'climate' as const, label: t('Climate', '气候'), color: 'bg-climate' },
                    { key: 'trade' as const, label: t('Trade', '贸易'), color: 'bg-trade' },
                    { key: 'immigration' as const, label: t('Immig.', '移民'), color: 'bg-immigration' },
                  ]).map((cat) => {
                    const score = getMetricScore(c.iso, cat.key);
                    return (
                      <div key={cat.key}>
                        <div className="text-xs text-muted mb-1">{cat.label}</div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-surface-2">
                            <div className={`h-full rounded-full ${cat.color}`} style={{ width: `${score}%` }} />
                          </div>
                          <span className="text-xs font-medium w-6 text-right">{score}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-surface border-t border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-semibold mb-4">{t('Start tracking global policy', '开始追踪全球政策')}</h2>
          <p className="text-muted max-w-xl mx-auto mb-8">
            {t(
              'Every number on PolicyOS links back to the government page it came from, so you can check it yourself.',
              'PolicyOS 上的每一个数字都能点回它来自的政府页面，你可以自己核对。',
            )}
          </p>
          <div className="flex justify-center gap-3">
            <Link href="/explore" className="px-6 py-3 rounded-full bg-accent text-white font-medium hover:bg-accent/90 transition-colors">
              {t('Explore the Map', '探索地图')}
            </Link>
            <Link href="/contribute" className="px-6 py-3 rounded-full bg-surface-2 border border-border text-foreground font-medium hover:bg-background transition-colors">
              {t('Contribute Data', '贡献数据')}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
