'use client';
import Link from 'next/link';
import { useLocale, useT } from '@/lib/i18n/client';
import type { VerificationAvailability as Availability } from '@/lib/verify/availability';

export default function VerificationAvailability({ availability, loading, refresh }: {
  availability: Availability | null; loading: boolean; refresh: () => void;
}) {
  const t = useT(), locale = useLocale();
  const text = availability ? {
    judge_required: t('Sign in at the judge testing entrance to use live checks.', '请通过评委测试入口登录后使用实时核验。'),
    available: t('Application checks allow a live attempt now.', '应用检查通过，当前可尝试实时核验。'),
    daily_limit: t('Live checks are at the shared daily limit.', '实时核验已达到共享日限额。'),
    budget_limit: t('Live checks are stopped by the model spending limit. The owner must review access.', '实时核验已因模型费用上限停止，需要项目负责人检查。'),
    expired: t('The live-check access period has ended. The owner must review access.', '实时核验的开放期限已结束，需要项目负责人检查。'),
    paused: t('Live checks are paused. Dated recorded runs still open.', '实时核验已暂停，仍可打开带日期的运行记录。'),
    unavailable: t('Live checks need an operator check. Dated recorded runs still open.', '实时核验需要负责人检查，仍可打开带日期的运行记录。'),
  }[availability.status] : loading
    ? t('Checking live-check availability…', '正在检查实时核验是否可用…')
    : t('Could not check availability. The server will check limits when you start.', '暂时无法查询可用状态；开始核验时，服务器仍会检查限制。');
  return <aside data-testid="verification-availability" className="mb-5 rounded-xl border border-border bg-surface-2 p-4 text-sm" aria-live="polite">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-medium">{t('Live check availability', '实时核验可用状态')}</h2>
      <button type="button" disabled={loading} onClick={refresh} className="text-xs text-accent underline disabled:opacity-40">{t('Check availability', '检查可用状态')}</button>
    </div>
    <p className="mt-2">{text}</p>
    {availability?.status === 'judge_required' && <Link href="/judge" target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-accent underline">{t('Open judge sign-in in a new tab, then check availability here', '在新标签页登录评委入口，再回到这里检查可用状态')}</Link>}
    {availability?.retryAt && <p className="mt-2 text-xs text-muted">{t('The next slot may open at ', '下一个名额可能在以下时间开放：')}{new Date(availability.retryAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-GB')}{t('. Shared usage may move this time.', '。共享使用情况可能改变这个时间。')}</p>}
    {availability?.status === 'daily_limit' && !availability.retryAt && <p className="mt-2 text-xs text-muted">{t('No slot is expected before the access period ends. The owner must review access.', '预计开放期限结束前不会有新名额，需要项目负责人检查。')}</p>}
    <p className="mt-2 text-xs text-muted">{t('This read-only check does not reserve a run, confirm provider credits, or guarantee completion. Recorded runs use no live calls.', '这项只读检查不预留核验名额、不确认服务商额度，也不保证核验完成。查看运行记录不调用实时服务。')}</p>
  </aside>;
}
