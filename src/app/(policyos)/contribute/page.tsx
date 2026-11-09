'use client';

import { useState } from 'react';
import Link from 'next/link';
import { countries } from '@/lib/data/countries';
import { type CategoryKey } from '@/lib/data/metrics';
import { useLocale, useT } from '@/lib/i18n/client';
import { countryName } from '@/lib/i18n';

interface ContributionForm {
  type: string;
  country: string;
  category: CategoryKey | '';
  title: string;
  description: string;
  sourceUrl: string;
  email: string;
}

export default function ContributePage() {
  const t = useT();
  const locale = useLocale();
  const [form, setForm] = useState<ContributionForm>({
    type: 'policy_update',
    country: '',
    category: '',
    title: '',
    description: '',
    sourceUrl: '',
    email: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ id: string; createdAt: string } | null>(null);
  const [error, setError] = useState('');

  // Simple client-side validation helpers
  const isValidUrl = (url: string) => {
    try { new URL(url); return true; } catch { return false; }
  };
  const isValidEmail = (email: string) => !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Client-side validation
    if (!isValidUrl(form.sourceUrl)) {
      setError('Please enter a valid source URL (e.g., https://...)');
      return;
    }
    if (!isValidEmail(form.email)) {
      setError(t('Please enter a valid email address or leave it blank', '请填写有效的邮箱，或留空'));
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch('/api/contributions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Submission failed (HTTP ${res.status})`);
      }

      setSubmitted({ id: data.id, createdAt: data.createdAt ?? new Date().toISOString() });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('Something went wrong', '出错了，请重试'));
    } finally {
      setSubmitting(false);
    }
  };

  const update = (field: keyof ContributionForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="p-6 rounded-xl bg-surface border border-green-500/30">
          <div className="flex items-center gap-3 mb-4">
            <span className="w-10 h-10 rounded-full bg-green-500/15 text-green-400 flex items-center justify-center text-lg font-bold flex-shrink-0">
              ✓
            </span>
            <div>
              <h1 className="text-lg font-semibold">{t('Contribution received', '已收到你的贡献')}</h1>
              <p className="text-xs text-muted mt-0.5">
                {t('Your submission has been written to the review queue and will be evaluated by a reviewer.', '你的提交已进入复核队列，会由审核人员评估。')}
              </p>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-background border border-border/50 text-xs space-y-1.5 mb-4">
            <div className="flex justify-between">
              <span className="text-muted">{t('Confirmation ID', '确认编号')}</span>
              <span className="font-mono text-foreground">{submitted.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">{t('Received', '提交时间')}</span>
              <span className="text-foreground">{new Date(submitted.createdAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">{t('Status', '状态')}</span>
              <span className="text-yellow-400">{t('Pending review', '待复核')}</span>
            </div>
          </div>

          <p className="text-xs text-muted mb-4 leading-relaxed">
            {t(
              'Submissions are labelled user-submitted-unverified and do not change any policy record until approved. Reviewers can merge, reject, or mark them as proposal-only.',
              '提交内容标记为"用户提交、未核实"，在获批之前不会改动任何政策记录。审核人员可以合并、拒绝或标记为仅提案。',
            )}
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                setSubmitted(null);
                setForm({ type: 'policy_update', country: '', category: '', title: '', description: '', sourceUrl: '', email: '' });
              }}
              className="px-4 py-2 rounded-full bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
            >
              {t('Submit another', '再提交一条')}
            </button>
            <Link
              href="/"
              className="px-4 py-2 rounded-full bg-surface-2 border border-border text-foreground text-sm font-medium hover:bg-background transition-colors"
            >
              {t('Back to home', '返回首页')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl md:text-4xl font-semibold mb-2">{t('Contribute', '贡献数据')}</h1>
      <p className="text-muted text-sm mb-3">
        {t('Help keep PolicyOS accurate and up to date. Submit policy updates, corrections, or new data sources.', '帮助 PolicyOS 保持准确和及时：提交政策更新、更正或新的数据来源。')}
      </p>
      <div className="mb-8 p-3 rounded-lg bg-surface border border-border/50 text-xs text-muted leading-relaxed">
        <span className="text-foreground font-medium">{t('How this works:', '流程说明：')}</span>{' '}
        {t(
          'Every submission goes into the review queue marked user-submitted-unverified. A reviewer approves, rejects, or flags it as proposal-only before it affects any policy record. You will get a confirmation ID after submitting.',
          '每条提交都会进入复核队列，标记为"用户提交、未核实"。审核人员批准、拒绝或标记为仅提案之后，才会影响政策记录。提交后你会收到一个确认编号。',
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Contribution type */}
        <div>
          <label className="block text-sm font-medium mb-2">{t('Contribution Type', '贡献类型')}</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { value: 'policy_update', label: t('Policy Update', '政策更新') },
              { value: 'new_policy', label: t('New Policy', '新政策') },
              { value: 'correction', label: t('Correction', '更正') },
              { value: 'source_addition', label: t('Add Source', '补充来源') },
              { value: 'translation', label: t('Translation', '翻译') },
              { value: 'local_insight', label: t('Local Insight', '本地洞察') },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => update('type', opt.value)}
                className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                  form.type === opt.value
                    ? 'border-accent bg-accent/10 text-foreground'
                    : 'border-border bg-surface text-muted hover:text-foreground'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Country */}
        <div>
          <label className="block text-sm font-medium mb-2">{t('Country *', '国家 *')}</label>
          <select
            required
            value={form.country}
            onChange={e => update('country', e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground text-sm appearance-none cursor-pointer focus:outline-none focus:border-accent"
          >
            <option value="">{t('Select a country…', '选择国家…')}</option>
            {countries.map(c => (
              <option key={c.iso} value={c.iso}>{c.flagEmoji} {countryName(c.iso, c.name, locale)}</option>
            ))}
          </select>
        </div>

        {/* Category */}
        <div>
          <label className="block text-sm font-medium mb-2">{t('Policy Category *', '政策领域 *')}</label>
          <select
            required
            value={form.category}
            onChange={e => update('category', e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground text-sm appearance-none cursor-pointer focus:outline-none focus:border-accent"
          >
            <option value="">{t('Select a category…', '选择领域…')}</option>
            <option value="climate">{t('Climate & Environment', '气候与环境')}</option>
            <option value="trade">{t('Trade & Tariffs', '贸易与关税')}</option>
            <option value="immigration">{t('Immigration & Borders', '移民与边境')}</option>
          </select>
        </div>

        {/* Title */}
        <div>
          <label className="block text-sm font-medium mb-2">{t('Title *', '标题 *')}</label>
          <input
            required
            type="text"
            value={form.title}
            onChange={e => update('title', e.target.value)}
            placeholder={t('e.g., Germany raises carbon tax to €65/tonne', '例如：德国将碳税提高到每吨 65 欧元')}
            className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground text-sm placeholder:text-muted/50 focus:outline-none focus:border-accent"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium mb-2">{t('Description *', '描述 *')}</label>
          <textarea
            required
            rows={4}
            value={form.description}
            onChange={e => update('description', e.target.value)}
            placeholder={t('What changed, what it affects, and why it matters…', '说明政策变化的内容、影响范围和意义…')}
            className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground text-sm placeholder:text-muted/50 focus:outline-none focus:border-accent resize-y"
          />
        </div>

        {/* Source URL */}
        <div>
          <label className="block text-sm font-medium mb-2">{t('Source URL *', '来源链接 *')}</label>
          <input
            required
            type="url"
            value={form.sourceUrl}
            onChange={e => update('sourceUrl', e.target.value)}
            placeholder="https://..."
            className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground text-sm placeholder:text-muted/50 focus:outline-none focus:border-accent"
          />
        </div>

        {/* Email */}
        <div>
          <label className="block text-sm font-medium mb-2">{t('Your Email (optional)', '你的邮箱（选填）')}</label>
          <input
            type="email"
            value={form.email}
            onChange={e => update('email', e.target.value)}
            placeholder={t('For attribution and follow-up', '用于署名和后续联系')}
            className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground text-sm placeholder:text-muted/50 focus:outline-none focus:border-accent"
          />
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full px-6 py-3 rounded-full bg-accent text-white font-medium hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? t('Submitting…', '提交中…') : t('Submit Contribution', '提交')}
        </button>

        <p className="text-xs text-muted text-center">
          {t('By submitting, you agree that your contribution may be edited and published under CC BY-SA 4.0.', '提交即表示你同意你的贡献可能被编辑，并以 CC BY-SA 4.0 协议发布。')}
        </p>
      </form>
    </div>
  );
}
