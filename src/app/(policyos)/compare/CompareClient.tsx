'use client';

import { useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { countries } from '@/lib/data/countries';
import { getMetrics, getMetricScore, metricDefinitions, type CategoryKey, getCategoryLabel } from '@/lib/data/metrics';
import { getPoliciesByCountry } from '@/lib/data/policies';
import { getCountryFreshness, getFreshnessLabel, getLastVerifiedAt } from '@/lib/freshness';
import { useLocale, useT } from '@/lib/i18n/client';
import { countryName } from '@/lib/i18n';
import { zhData } from '@/lib/i18n/data-zh';
import { DOMAIN_LABEL, word } from '@/lib/i18n';
const zhRadar: Record<string, string> = { carbonPolicyStrength: '碳政策', tradeOpennessIndex: '贸易开放', immigrationOpenness: '移民开放', climateActionAlignment: '气候行动', tradeProtectionIndex: '贸易保护', borderControlIntensity: '边境管控' };

const COLORS = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6'];

const RADAR_METRICS = [
  { slug: 'carbonPolicyStrength', label: 'Carbon Policy' },
  { slug: 'tradeOpennessIndex', label: 'Trade Openness' },
  { slug: 'immigrationOpenness', label: 'Immigration Open.' },
  { slug: 'climateActionAlignment', label: 'Climate Action' },
  { slug: 'tradeProtectionIndex', label: 'Trade Protection' },
  { slug: 'borderControlIntensity', label: 'Border Control' },
];

export default function CompareClient({ initialIsos }: { initialIsos?: string[] } = {}) {
  const t = useT();
  const locale = useLocale();
  const cn = (c: { iso: string; name: string }) => countryName(c.iso, c.name, locale);
  const zd = zhData(locale);
  // initialIsos is passed from the server component's parsed ?countries= list
  // so the client state matches what SSR rendered above.
  const searchParams = useSearchParams();
  const paramCountries = searchParams.get('countries')?.split(',').map(s => s.toUpperCase()).filter(iso => countries.find(c => c.iso === iso)) || [];
  const firstSelection = (initialIsos && initialIsos.length > 0)
    ? initialIsos
    : (paramCountries.length > 0 ? paramCountries : ['US', 'DE']);

  const [selectedIsos, setSelectedIsos] = useState<string[]>(firstSelection);

  const toggleCountry = (iso: string) => {
    setSelectedIsos(prev => {
      if (prev.includes(iso)) return prev.filter(i => i !== iso);
      if (prev.length >= 5) return prev;
      return [...prev, iso];
    });
  };

  const selectedCountries = useMemo(() =>
    selectedIsos.map(iso => countries.find(c => c.iso === iso)!).filter(Boolean),
    [selectedIsos]
  );

  // Radar data
  const radarData = RADAR_METRICS.map(metric => {
    const point: Record<string, string | number> = { metric: locale === 'zh' ? zhRadar[metric.slug] ?? metric.label : metric.label };
    selectedCountries.forEach(c => {
      const m = getMetrics(c.iso);
      if (m) {
        const allMetrics = { ...m.climate, ...m.trade, ...m.immigration } as Record<string, number>;
        point[c.iso] = allMetrics[metric.slug] ?? 0;
      }
    });
    return point;
  });

  // Bar data for composite scores
  const barData = selectedCountries.map(c => ({
    name: cn(c),
    iso: c.iso,
    Climate: getMetricScore(c.iso, 'climate'),
    Trade: getMetricScore(c.iso, 'trade'),
    Immigration: getMetricScore(c.iso, 'immigration'),
  }));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h2 className="text-2xl font-semibold mb-2">{t('Interactive comparison', '交互式对比')}</h2>
      <p className="text-muted text-sm mb-6">{t('Select 2–5 countries to compare their policy profiles side by side.', '选择 2–5 个国家，并排比较它们的政策概况。')}</p>

      {/* Country selector */}
      <div className="flex flex-wrap gap-2 mb-8">
        {countries.map(c => (
          <button
            key={c.iso}
            onClick={() => toggleCountry(c.iso)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
              selectedIsos.includes(c.iso)
                ? 'bg-accent text-white border-accent'
                : 'bg-surface border-border text-muted hover:text-foreground hover:border-accent/40'
            }`}
          >
            {c.flagEmoji} {cn(c)}
          </button>
        ))}
      </div>

      {selectedCountries.length < 2 ? (
        <div className="text-center py-20 text-muted">
          <p className="text-lg">{t('Select at least 2 countries to compare', '请至少选择 2 个国家')}</p>
          <p className="text-xs mt-2">{t('Pick at least two countries above to render the radar, bar chart, metric table, and policy comparison.', '在上方至少选两个国家，即可显示雷达图、柱状图、指标表和政策对比。')}</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Freshness warning banner: surfaces if any selected country has stale or low-confidence data */}
          {(() => {
            const freshnessSummaries = selectedCountries.map(c => ({ country: c, f: getCountryFreshness(c.iso) }));
            const hasStale = freshnessSummaries.some(s => s.f.stalePolicies > 0);
            const hasLowConfidence = freshnessSummaries.some(s => s.f.overallConfidence !== 'high');
            if (!hasStale && !hasLowConfidence) return null;
            return (
              <div className="p-4 rounded-xl bg-surface border border-orange-500/30">
                <div className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-orange-500/15 text-orange-400 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">!</span>
                  <div className="flex-1">
                    <div className="text-sm font-semibold mb-1">{t('Comparison includes policies with freshness caveats', '对比中包含时效性存疑的政策')}</div>
                    <div className="text-xs text-muted mb-2 leading-relaxed">
                      {t("Scores below mix verified and seeded data; some underlying policies haven't been re-verified recently.", '下方分数混合了已核实数据和预置数据，部分底层政策近期未重新核实。')}
                    </div>
                    <div className="flex flex-wrap gap-3 text-[11px]">
                      {freshnessSummaries.map(({ country, f }) => (
                        <span key={country.iso} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-background border border-border/50">
                          <span>{country.flagEmoji}</span>
                          <span className="text-muted">{cn(country)}:</span>
                          {f.stalePolicies > 0 && <span className="text-orange-400">{t(`${f.stalePolicies} stale`, `${f.stalePolicies} 条过期`)}</span>}
                          {f.recentlyVerified > 0 && <span className="text-green-400">{t(`${f.recentlyVerified} verified`, `${f.recentlyVerified} 条已核实`)}</span>}
                          <span className={`${f.overallConfidence === 'high' ? 'text-green-400' : f.overallConfidence === 'medium' ? 'text-yellow-400' : 'text-orange-400'}`}>
                            · {t(`${f.overallConfidence} confidence`, `可信度${word(f.overallConfidence, locale)}`)}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Radar */}
            <div className="p-6 rounded-xl bg-surface border border-border">
              <h3 className="text-base font-semibold mb-4">{t('Policy Profile Radar', '政策概况雷达图')}</h3>
              <ResponsiveContainer width="100%" height={380}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="var(--color-border)" />
                  <PolarAngleAxis dataKey="metric" tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={{ fill: 'var(--color-muted)', fontSize: 10 }} />
                  {selectedCountries.map((c, i) => (
                    <Radar key={c.iso} name={cn(c)} dataKey={c.iso} stroke={COLORS[i]} fill={COLORS[i]} fillOpacity={0.12} strokeWidth={2} />
                  ))}
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            {/* Bar chart */}
            <div className="p-6 rounded-xl bg-surface border border-border">
              <h3 className="text-base font-semibold mb-4">{t('Composite Scores by Domain', '各领域综合分数')}</h3>
              <ResponsiveContainer width="100%" height={380}>
                <BarChart data={barData} layout="vertical">
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                  <XAxis type="number" domain={[0, 100]} tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fill: 'var(--color-foreground)', fontSize: 12 }} width={100} />
                  <Tooltip contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-foreground)', fontSize: 12 }} />
                  <Bar dataKey="Climate" name={t('Climate', '气候')} fill="#10B981" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="Trade" name={t('Trade', '贸易')} fill="#3B82F6" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="Immigration" name={t('Immigration', '移民')} fill="#8B5CF6" radius={[0, 4, 4, 0]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Scorecard table */}
          <div className="p-6 rounded-xl bg-surface border border-border overflow-x-auto">
            <h3 className="text-base font-semibold mb-4">{t('Detailed Metric Comparison', '指标明细对比')}</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-4 text-muted font-medium">{t('Metric', '指标')}</th>
                  {selectedCountries.map(c => (
                    <th key={c.iso} className="text-center py-2 px-3 font-medium">
                      {c.flagEmoji} {cn(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metricDefinitions.map(def => {
                  const values = selectedCountries.map(c => {
                    const m = getMetrics(c.iso);
                    if (!m) return 0;
                    const all = { ...m.climate, ...m.trade, ...m.immigration } as Record<string, number>;
                    return all[def.slug] ?? 0;
                  });
                  const maxVal = Math.max(...values);
                  return (
                    <tr key={def.slug} className="border-b border-border/50">
                      <td className="py-2.5 pr-4">
                        <div className="font-medium text-foreground">{zd.metricName(def.slug, def.name)}</div>
                        <div className="text-[10px] text-muted">{t(DOMAIN_LABEL[def.category][0], DOMAIN_LABEL[def.category][1])}</div>
                      </td>
                      {selectedCountries.map((c, i) => {
                        const val = values[i];
                        return (
                          <td key={c.iso} className="text-center py-2.5 px-3">
                            <span className={`text-sm font-semibold ${val === maxVal && val > 0 ? 'text-accent' : 'text-foreground'}`}>
                              {def.unit === '$/ton' ? `$${val}` : val}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Policy differences */}
          <div className="p-6 rounded-xl bg-surface border border-border">
            <h3 className="text-base font-semibold mb-4">{t('Key Policy Differences', '主要政策差异')}</h3>
            <div className="space-y-6">
              {(['climate', 'trade', 'immigration'] as CategoryKey[]).map(cat => (
                <div key={cat}>
                  <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: cat === 'climate' ? '#10B981' : cat === 'trade' ? '#3B82F6' : '#8B5CF6' }} />
                    {t(getCategoryLabel(cat), ({ climate: '气候与环境', trade: '贸易与关税', immigration: '移民与边境' } as Record<string, string>)[cat])}
                  </h4>
                  <div className="grid grid-cols-1 gap-3">
                    {selectedCountries.map(c => {
                      const policies = getPoliciesByCountry(c.iso).filter(p => p.category === cat);
                      const topPolicy = policies[0];
                      if (!topPolicy) return null;
                      const freshnessLabel = getFreshnessLabel(topPolicy.id);
                      const verifiedAt = getLastVerifiedAt(topPolicy.id);
                      const freshnessColor = freshnessLabel === 'verified' ? 'text-green-400 border-green-500/30 bg-green-500/10'
                        : freshnessLabel === 'recently_reviewed' ? 'text-blue-400 border-blue-500/30 bg-blue-500/10'
                        : freshnessLabel === 'pending_verification' ? 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10'
                        : freshnessLabel === 'potentially_stale' ? 'text-orange-400 border-orange-500/30 bg-orange-500/10'
                        : 'text-gray-400 border-gray-500/30 bg-gray-500/10';
                      return (
                        <div key={c.iso} className="p-3 rounded-lg bg-background border border-border/50">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span>{c.flagEmoji}</span>
                            <span className="text-sm font-medium">{cn(c)}</span>
                            <span className="text-xs text-muted">{t('Score', '分数')}: {getMetricScore(c.iso, cat)}/100</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${freshnessColor}`}>
                              {word(freshnessLabel, locale)}
                            </span>
                            {/* The date, because once the label is judged against
                                the real clock an old snapshot grades everything the
                                same and the date is what still carries information. */}
                            {verifiedAt && (
                              <span className="text-[10px] text-muted">
                                {t('verified', '核实于')} {verifiedAt.slice(0, 10)}
                              </span>
                            )}
                          </div>
                          <div className="text-xs font-medium mb-1">{zd.policyTitle(topPolicy.id, topPolicy.title)}</div>
                          <div className="text-xs text-muted line-clamp-2">{zd.policyDesc(topPolicy.id, topPolicy.description)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
