/**
 * /visa — Visa Intelligence UI.
 *
 * Server component shell (with safety disclaimers), client component below
 * for the form + live result. Scoring happens in the server-only engine;
 * the client just posts to /api/visa/assess and renders the response.
 */

import VisaClient from './VisaClient';
import { getT } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

export default async function VisaPage() {
  const { t } = await getT();
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-3xl md:text-4xl font-semibold mb-2">{t('Visa Intelligence', '签证评估')}</h1>
        <p className="text-muted text-sm max-w-3xl">
          {t(
            'Policy-aware visa probability assistant. Fill in your profile on the left and see a structured assessment on the right. The engine combines your inputs with PolicyOS immigration scores and recent policy changes in the destination country.',
            '结合政策信息的签证概率助手。在左侧填写个人情况，右侧给出结构化评估。模型会把你的信息与 PolicyOS 的移民分数和目的国近期政策变化结合起来。',
          )}
        </p>
      </div>

      <div className="mb-6 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30">
        <div className="text-xs font-semibold text-yellow-400 mb-1">{t('This is NOT legal advice', '这不是法律建议')}</div>
        <ul className="text-[11px] text-yellow-200/80 list-disc list-inside space-y-0.5">
          <li>{t('Results are estimates based on publicly available policy data in PolicyOS.', '结果是基于 PolicyOS 公开政策数据的估计。')}</li>
          <li>{t('Actual decisions depend on case officers, documentation, and factors this model cannot see.', '实际结果取决于签证官、材料以及本模型无法看到的因素。')}</li>
          <li>{t('No exact approval percentage is promised — results are always presented as ranges.', '不承诺具体通过率——结果始终以区间形式给出。')}</li>
        </ul>
      </div>

      <VisaClient />
    </div>
  );
}
