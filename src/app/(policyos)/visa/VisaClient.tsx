'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useT } from '@/lib/i18n/client';
import { countryName, word } from '@/lib/i18n';

interface VisaAssessment {
  band: 'very_low' | 'low' | 'medium' | 'medium_high' | 'high';
  bandLabel: string;
  confidence: 'high' | 'medium' | 'low';
  factors: Array<{ key: string; contribution: number; note: string }>;
  risks: {
    refusalRisk: 'low' | 'medium' | 'high';
    financialSufficiency: 'low' | 'medium' | 'high';
    policyUncertainty: 'low' | 'medium' | 'high';
    countrySpecificScrutiny: 'low' | 'medium' | 'high';
  };
  improvements: Array<{ suggestion: string; expectedGain: number }>;
  policyLinks: Array<{
    policyId: string;
    title: string;
    summary?: string | null;
    sourceUrl?: string | null;
    recentChange?: { at: string; delta: number; direction: 'tightening' | 'liberalising' | 'neutral' };
  }>;
  immigrationScore: number | null;
  immigrationTrend: 'tightening' | 'liberalising' | 'stable' | 'unknown';
  disclaimers: string[];
  generatedAt: string;
}

const COUNTRIES = [
  { iso: 'US', name: 'United States' },
  { iso: 'CA', name: 'Canada' },
  { iso: 'GB', name: 'United Kingdom' },
  { iso: 'AU', name: 'Australia' },
  { iso: 'DE', name: 'Germany' },
  { iso: 'FR', name: 'France' },
  { iso: 'SG', name: 'Singapore' },
  { iso: 'JP', name: 'Japan' },
  { iso: 'KR', name: 'South Korea' },
  { iso: 'BR', name: 'Brazil' },
  { iso: 'IN', name: 'India' },
];

const bandColor: Record<VisaAssessment['band'], string> = {
  very_low: 'text-red-400 border-red-500/40 bg-red-500/10',
  low: 'text-orange-400 border-orange-500/40 bg-orange-500/10',
  medium: 'text-yellow-400 border-yellow-500/40 bg-yellow-500/10',
  medium_high: 'text-teal-400 border-teal-500/40 bg-teal-500/10',
  high: 'text-green-400 border-green-500/40 bg-green-500/10',
};

const riskColor: Record<'low' | 'medium' | 'high', string> = {
  low: 'bg-green-500/15 text-green-400',
  medium: 'bg-yellow-500/15 text-yellow-400',
  high: 'bg-red-500/15 text-red-400',
};

const confColor: Record<'high' | 'medium' | 'low', string> = {
  high: 'bg-green-500/15 text-green-400',
  medium: 'bg-yellow-500/15 text-yellow-400',
  low: 'bg-orange-500/15 text-orange-400',
};

export default function VisaClient() {
  const t = useT();
  const locale = useLocale();
  const [form, setForm] = useState({
    countryIso: 'CA',
    visaType: 'work',
    education: 'bachelor',
    field: '',
    yearsExperience: 3,
    englishLevel: 'fluent',
    annualSalaryUsd: 55000,
    previousVisasDenied: 0,
    previousVisasApproved: 0,
    criminalRecord: false,
    sponsorship: 'employer',
  });
  const [assessment, setAssessment] = useState<VisaAssessment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/visa/assess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setAssessment(data as VisaAssessment);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Form */}
      <form onSubmit={submit} className="lg:col-span-2 p-5 rounded-xl bg-surface border border-border space-y-4 h-fit">
        <h2 className="text-sm font-semibold">{t('Your profile', '你的情况')}</h2>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-muted">{t('Destination', '目的国')}</span>
            <select
              value={form.countryIso}
              onChange={(e) => setForm({ ...form, countryIso: e.target.value })}
              className="px-2 py-1.5 rounded bg-background border border-border"
            >
              {COUNTRIES.map((c) => (
                <option key={c.iso} value={c.iso}>
                  {countryName(c.iso, c.name, locale)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted">{t('Visa type', '签证类型')}</span>
            <select
              value={form.visaType}
              onChange={(e) => setForm({ ...form, visaType: e.target.value })}
              className="px-2 py-1.5 rounded bg-background border border-border"
            >
              {['student', 'work', 'pr', 'visit', 'family'].map((v) => (
                <option key={v} value={v}>{t(v.toUpperCase(), ({ student: '学生', work: '工作', pr: '永居', visit: '访问', family: '家庭团聚' } as Record<string, string>)[v] ?? v)}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted">{t('Education', '学历')}</span>
            <select
              value={form.education}
              onChange={(e) => setForm({ ...form, education: e.target.value })}
              className="px-2 py-1.5 rounded bg-background border border-border"
            >
              {['none', 'highschool', 'bachelor', 'master', 'phd'].map((v) => (
                <option key={v} value={v}>{word(v, locale)}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted">{t('Years experience', '工作年限')}</span>
            <input
              type="number"
              min={0}
              max={40}
              value={form.yearsExperience}
              onChange={(e) => setForm({ ...form, yearsExperience: Number(e.target.value) || 0 })}
              className="px-2 py-1.5 rounded bg-background border border-border"
            />
          </label>
          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-muted">{t('Field of study / occupation (optional)', '专业 / 职业（选填）')}</span>
            <input
              type="text"
              value={form.field}
              onChange={(e) => setForm({ ...form, field: e.target.value })}
              className="px-2 py-1.5 rounded bg-background border border-border"
              placeholder={t('e.g. software engineering', '例如：软件工程')}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted">{t('English level', '英语水平')}</span>
            <select
              value={form.englishLevel}
              onChange={(e) => setForm({ ...form, englishLevel: e.target.value })}
              className="px-2 py-1.5 rounded bg-background border border-border"
            >
              {['none', 'basic', 'intermediate', 'fluent', 'native'].map((v) => (
                <option key={v} value={v}>{word(v, locale)}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted">{t('Salary / funds (USD/yr)', '年收入 / 资金（美元）')}</span>
            <input
              type="number"
              min={0}
              value={form.annualSalaryUsd}
              onChange={(e) => setForm({ ...form, annualSalaryUsd: Number(e.target.value) || 0 })}
              className="px-2 py-1.5 rounded bg-background border border-border"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted">{t('Prior visas approved', '曾获批签证数')}</span>
            <input
              type="number"
              min={0}
              max={20}
              value={form.previousVisasApproved}
              onChange={(e) => setForm({ ...form, previousVisasApproved: Number(e.target.value) || 0 })}
              className="px-2 py-1.5 rounded bg-background border border-border"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted">{t('Prior visas denied', '曾被拒签证数')}</span>
            <input
              type="number"
              min={0}
              max={10}
              value={form.previousVisasDenied}
              onChange={(e) => setForm({ ...form, previousVisasDenied: Number(e.target.value) || 0 })}
              className="px-2 py-1.5 rounded bg-background border border-border"
            />
          </label>
          <label className="flex items-center gap-2 col-span-2">
            <input
              type="checkbox"
              checked={form.criminalRecord}
              onChange={(e) => setForm({ ...form, criminalRecord: e.target.checked })}
            />
            <span className="text-muted">{t('Criminal record', '有犯罪记录')}</span>
          </label>
          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-muted">{t('Sponsorship', '担保')}</span>
            <select
              value={form.sponsorship}
              onChange={(e) => setForm({ ...form, sponsorship: e.target.value })}
              className="px-2 py-1.5 rounded bg-background border border-border"
            >
              {['none', 'employer', 'family', 'institutional'].map((v) => (
                <option key={v} value={v}>{word(v, locale)}</option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="w-full px-4 py-2 rounded-full bg-accent text-white text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
        >
          {busy ? t('Assessing…', '评估中…') : t('Assess', '开始评估')}
        </button>
        {error && <div className="text-xs text-red-400">{error}</div>}
      </form>

      {/* Result */}
      <div className="lg:col-span-3 space-y-4">
        {!assessment ? (
          <div className="p-6 rounded-xl bg-surface border border-border text-sm text-muted">
            {t(
              "Fill in the form and press Assess. Results combine your profile with the destination country's live PolicyOS immigration score and recent policy changes.",
              '填写表单后点击"开始评估"。结果会把你的情况与目的国在 PolicyOS 上的实时移民分数和近期政策变化结合起来。',
            )}
          </div>
        ) : (
          <>
            <div className={`p-6 rounded-xl border ${bandColor[assessment.band]}`}>
              <div className="text-xs uppercase tracking-wider opacity-70 mb-1">{t('Probability band', '概率区间')}</div>
              <div className="text-3xl font-bold mb-2">{assessment.bandLabel}</div>
              <div className="flex items-center gap-2 text-xs">
                <span className={`px-2 py-0.5 rounded ${confColor[assessment.confidence]}`}>
                  {t(`${assessment.confidence} confidence`, `可信度：${({ high: '高', medium: '中', low: '低' } as Record<string, string>)[assessment.confidence] ?? assessment.confidence}`)}
                </span>
                <span className="text-muted">
                  {t('immigration score', '移民分数')}: {assessment.immigrationScore?.toFixed(1) ?? '—'} · {t('trend', '趋势')} {word(assessment.immigrationTrend, locale)}
                </span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-surface border border-border">
              <div className="text-xs font-semibold mb-2">{t('Risk breakdown', '风险拆解')}</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {([
                  [t('Visa refusal risk', '拒签风险'), assessment.risks.refusalRisk],
                  [t('Financial sufficiency', '资金充足度'), assessment.risks.financialSufficiency],
                  [t('Policy uncertainty', '政策不确定性'), assessment.risks.policyUncertainty],
                  [t('Country-specific scrutiny', '国别审查'), assessment.risks.countrySpecificScrutiny],
                ] as Array<[string, 'low' | 'medium' | 'high']>).map(([label, risk]) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-muted">{label}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${riskColor[risk]}`}>{t(risk, ({ low: '低', medium: '中', high: '高' } as Record<string, string>)[risk] ?? risk)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-surface border border-border">
              <div className="text-xs font-semibold mb-2">{t('Factor contributions', '各因素贡献')}</div>
              <div className="space-y-1 text-[11px]">
                {assessment.factors.map((f) => (
                  <div key={f.key} className="flex items-center gap-2">
                    <span className="w-32 text-muted">{f.key.replace(/_/g, ' ')}</span>
                    <span
                      className={`w-12 text-right font-mono ${
                        f.contribution > 0 ? 'text-green-400' : f.contribution < 0 ? 'text-red-400' : 'text-muted'
                      }`}
                    >
                      {f.contribution > 0 ? '+' : ''}
                      {f.contribution.toFixed(1)}
                    </span>
                    <span className="text-muted/70 truncate">{f.note}</span>
                  </div>
                ))}
              </div>
            </div>

            {assessment.policyLinks.length > 0 && (
              <div className="p-4 rounded-xl bg-surface border border-border">
                <div className="text-xs font-semibold mb-2">{t('Relevant policies from PolicyOS', 'PolicyOS 中的相关政策')}</div>
                <div className="space-y-2 text-[11px]">
                  {assessment.policyLinks.map((p) => (
                    <div key={p.policyId} className="flex items-start gap-2">
                      <span
                        className={`mt-0.5 px-1.5 py-0.5 rounded text-[10px] ${
                          p.recentChange?.direction === 'tightening'
                            ? 'bg-red-500/15 text-red-400'
                            : p.recentChange?.direction === 'liberalising'
                            ? 'bg-green-500/15 text-green-400'
                            : 'bg-gray-500/15 text-gray-400'
                        }`}
                      >
                        {p.recentChange?.direction ?? 'no recent change'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">
                          {p.sourceUrl ? (
                            <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                              {p.title}
                            </a>
                          ) : (
                            p.title
                          )}
                        </div>
                        {p.summary && <div className="text-muted line-clamp-2">{p.summary}</div>}
                        {p.recentChange && (
                          <div className="text-muted">
                            Δ {p.recentChange.delta > 0 ? '+' : ''}
                            {p.recentChange.delta.toFixed(2)} · {new Date(p.recentChange.at).toISOString().slice(0, 10)}
                          </div>
                        )}
                        <Link href={`/countries/${p.policyId.split('-')[0]?.toLowerCase() ?? 'us'}`} className="text-accent text-[10px] hover:underline">
                          view country →
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {assessment.improvements.length > 0 && (
              <div className="p-4 rounded-xl bg-surface border border-border">
                <div className="text-xs font-semibold mb-2">{t('Improvement suggestions', '改进建议')}</div>
                <ul className="space-y-1 text-[11px]">
                  {assessment.improvements.map((imp, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-green-400 font-mono">+{imp.expectedGain}</span>
                      <span>{imp.suggestion}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-[10px] text-yellow-200/80">
              {assessment.disclaimers.join(' · ')}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
