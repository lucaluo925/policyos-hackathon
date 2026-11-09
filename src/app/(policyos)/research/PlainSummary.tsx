/**
 * Plain-language view of the two event studies, for a general audience.
 * No statistics vocabulary here — the full technical tables live below it
 * in a collapsed "for researchers" section of the page.
 */
import type { T } from '@/lib/i18n';

type Row = { car01: number | null } | undefined;
type EventRow = { id: string; instant: string; baskets: Record<string, Row> };
type CnEvent = { id: string; instant: string };
type CnPer = { id: string; basket: string; car01: number | null };

// One-line, jargon-free descriptions. Where the exact companies named in a
// rule are not certain, the wording stays general on purpose.
const US_EVENTS: Record<string, [string, string]> = {
  E01: ['Memory-chip maker Fujian Jinhua added to the US restricted list', '存储芯片企业福建晋华被列入美国限制名单'],
  E02: ['Huawei added to the US restricted list', '华为被列入美国限制名单'],
  E03: ['Chinese supercomputer makers added to the list', '多家中国超级计算机企业被列入名单'],
  E04: ['Dozens of Huawei affiliates added', '数十家华为关联公司被列入名单'],
  E05: ['New rule blocks factories using US tools from making chips for Huawei', '新规限制用美国设备为华为代工芯片'],
  E06: ['Huawei restrictions widened to cut off chip supply', '对华为的限制扩大，切断芯片供应'],
  E07: ['SMIC, China’s largest chipmaker, added to the list', '中国最大芯片代工厂中芯国际被列入名单'],
  E08: ['Chinese supercomputing chip designers added (incl. Phytium)', '飞腾等中国超算芯片企业被列入名单'],
  E09: ['Broad new limits on advanced chips and chipmaking equipment', '大范围限制先进芯片和芯片制造设备'],
  E10: ['Memory maker YMTC and dozens of Chinese firms added', '长江存储等数十家中国企业被列入名单'],
  E11: ['More Chinese tech firms added to the list', '更多中国科技企业被列入名单'],
  E12: ['Chip and equipment limits tightened further', '芯片和设备限制进一步收紧'],
  E13: ['Limits on AI memory chips; ~140 Chinese firms added', '限制人工智能存储芯片，约 140 家中国企业被列入名单'],
  E14: ['More Chinese chip and AI firms added', '又一批中国芯片和人工智能企业被列入名单'],
  E15: ['More Chinese server and computing firms added', '又一批中国服务器和计算企业被列入名单'],
  E16: ['More Chinese chip-related firms added', '又一批中国芯片相关企业被列入名单'],
};

const CN_EVENTS: Record<string, [string, string]> = {
  C01: ['Export licences required for gallium and germanium', '镓、锗出口改为需要许可'],
  C02: ['Tighter export rules for graphite', '石墨出口管理收紧'],
  C03: ['Export of rare-earth processing technology banned', '禁止出口稀土加工技术'],
  C04: ['Export licences required for antimony', '锑出口改为需要许可'],
  C05: ['Gallium, germanium and antimony exports to the US banned', '禁止向美国出口镓、锗、锑'],
  C06: ['Export controls on tungsten, tellurium, bismuth, molybdenum and indium', '钨、碲、铋、钼、铟实施出口管制'],
  C07: ['Export controls on seven rare earths', '七种稀土实施出口管制'],
  C08: ['Rare-earth controls extended to products made abroad', '稀土管制扩大到海外生产的相关产品'],
};

const pct = (v: number | null | undefined) =>
  v == null ? '–' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
const tone = (v: number | null | undefined) =>
  v == null ? 'text-muted' : v >= 0.03 ? 'text-green-400' : v <= -0.03 ? 'text-red-400' : 'text-foreground';
const month = (iso: string) => iso.slice(0, 7);

function avg(xs: Array<number | null | undefined>) {
  const v = xs.filter((x): x is number => typeof x === 'number');
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function Stat({ value, label, note }: { value: number | null; label: string; note: string }) {
  return (
    <div className="p-5 rounded-xl bg-surface border border-border">
      <div className={`text-3xl font-semibold tabular-nums ${tone(value)}`}>{pct(value)}</div>
      <div className="text-sm font-medium mt-2">{label}</div>
      <div className="text-sm text-muted mt-1 leading-relaxed">{note}</div>
    </div>
  );
}

export default function PlainSummary({
  t,
  usEvents,
  cnEvents,
  cnPer,
}: {
  t: T;
  usEvents: EventRow[];
  cnEvents: CnEvent[];
  cnPer: CnPer[] | null;
}) {
  const usEquip = avg(usEvents.map((e) => e.baskets.US_SEMI_EQUIP?.car01));
  const cnEquip = avg(usEvents.map((e) => e.baskets.CN_SEMI_EQUIP_SUBSTITUTE?.car01));
  const oct2022 = usEvents.find((e) => e.id === 'E09')?.baskets.CN_SEMI_EQUIP_SUBSTITUTE?.car01 ?? null;
  const cnOf = (id: string, basket: string) => cnPer?.find((r) => r.id === id && r.basket === basket)?.car01 ?? null;
  const mp = cnPer ? avg(cnEvents.map((e) => cnOf(e.id, 'US_RARE_EARTH'))) : null;
  const cnMat = cnPer ? avg(cnEvents.map((e) => cnOf(e.id, 'CN_STRATEGIC_MATERIALS'))) : null;

  return (
    <div className="space-y-14">
      <header className="max-w-3xl">
        <h1 className="text-3xl md:text-5xl font-semibold leading-tight">
          {t('When governments restrict trade, how do stocks react?', '政府出手限制贸易时，股市会怎么反应？')}
        </h1>
        <p className="text-lg text-muted mt-4 leading-relaxed">
          {t(
            'We collected every US restriction on chip exports to China from 2018 to 2025, and every Chinese restriction on exporting key minerals from 2023 to 2025. For each one, we looked at how much the related stocks rose or fell over the next two trading days compared with the overall market.',
            '我们整理了 2018–2025 年美国限制对华芯片出口的每一次公告，以及 2023–2025 年中国限制关键矿产出口的每一次公告。对每一次，都看相关股票在之后两个交易日里，比整个大盘多涨或多跌了多少。',
          )}
        </p>
      </header>

      <section>
        <h2 className="text-2xl font-semibold mb-1">{t('1 · US limits chip sales to China', '一 · 美国限制向中国出售芯片')}</h2>
        <p className="text-muted mb-5">{t('16 announcements, 2018–2025', '16 次公告，2018–2025 年')}</p>
        <div className="grid md:grid-cols-3 gap-4">
          <Stat
            value={usEquip}
            label={t('US chip-equipment makers (average)', '美国芯片设备公司（平均）')}
            note={t('Almost no reaction on average. Markets may already expect these moves.', '平均来看几乎没有反应，市场可能早有预期。')}
          />
          <Stat
            value={cnEquip}
            label={t('Chinese chip-equipment makers (average)', '中国芯片设备公司（平均）')}
            note={t('No sign of the “home-grown winners” boost many expected.', '没有出现很多人预想的“国产替代”上涨。')}
          />
          <Stat
            value={oct2022}
            label={t('Chinese chip-equipment makers, Oct 2022', '中国芯片设备公司，2022 年 10 月')}
            note={t('The one big exception: after the broadest US rule, they fell sharply.', '最大的例外：美国出台范围最广的限制后，它们大幅下跌。')}
          />
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-1">{t('2 · China limits exports of key minerals', '二 · 中国限制关键矿产出口')}</h2>
        <p className="text-muted mb-5">{t('8 announcements, 2023–2025 — rare earths, gallium, germanium and others', '8 次公告，2023–2025 年——稀土、镓、锗等')}</p>
        {cnPer ? (
          <div className="grid md:grid-cols-2 gap-4">
            <Stat
              value={mp}
              label={t('MP Materials, the main US rare-earth miner (average)', '美国主要稀土矿企 MP Materials（平均）')}
              note={t('Clearly rose — investors saw it as a replacement supplier.', '明显上涨——投资者把它看作替代供应商。')}
            />
            <Stat
              value={cnMat}
              label={t('Chinese rare-earth and minor-metal producers (average)', '中国稀土和小金属企业（平均）')}
              note={t('Usually rose, as the restrictions made their products scarcer abroad.', '多数时候上涨，因为限制让它们的产品在海外更稀缺。')}
            />
          </div>
        ) : (
          <p className="text-muted">{t('Results coming soon.', '结果即将公布。')}</p>
        )}
      </section>

      <section className="p-5 rounded-xl bg-surface border border-border max-w-3xl">
        <h2 className="text-base font-semibold mb-2">{t('How to read these numbers', '这些数字怎么看')}</h2>
        <ul className="text-sm text-muted space-y-2 leading-relaxed list-disc pl-5">
          <li>{t('“+4.8%” means the stock did 4.8% better than the overall market over those two days — the market’s own ups and downs are taken out.', '“+4.8%”表示这两天里这只股票比整个大盘多涨了 4.8%，大盘本身的涨跌已经扣掉了。')}</li>
          <li>{t('There are only 16 and 8 announcements, and some came at the same time as other US–China news, so treat these as signals, not proof.', '公告次数只有 16 次和 8 次，有些还和其他中美消息撞在同一时间，所以只能作为参考，不能当作定论。')}</li>
          <li>{t('This is research, not investment advice.', '这是研究，不是投资建议。')}</li>
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-4">{t('Every announcement', '每一次公告')}</h2>
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="text-muted text-xs">
              <tr>
                <th className="text-left font-medium px-4 py-3">{t('When', '时间')}</th>
                <th className="text-left font-medium px-4 py-3">{t('What happened', '发生了什么')}</th>
                <th className="text-right font-medium px-4 py-3 whitespace-nowrap">{t('US equipment', '美国设备股')}</th>
                <th className="text-right font-medium px-4 py-3 whitespace-nowrap">{t('China equipment', '中国设备股')}</th>
              </tr>
            </thead>
            <tbody>
              {usEvents.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="px-4 py-3 text-muted whitespace-nowrap tabular-nums">{month(e.instant)}</td>
                  <td className="px-4 py-3">{US_EVENTS[e.id] ? t(US_EVENTS[e.id][0], US_EVENTS[e.id][1]) : e.id}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${tone(e.baskets.US_SEMI_EQUIP?.car01)}`}>{pct(e.baskets.US_SEMI_EQUIP?.car01)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${tone(e.baskets.CN_SEMI_EQUIP_SUBSTITUTE?.car01)}`}>{pct(e.baskets.CN_SEMI_EQUIP_SUBSTITUTE?.car01)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {cnPer && (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface mt-6">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="text-muted text-xs">
                <tr>
                  <th className="text-left font-medium px-4 py-3">{t('When', '时间')}</th>
                  <th className="text-left font-medium px-4 py-3">{t('What China announced', '中国宣布了什么')}</th>
                  <th className="text-right font-medium px-4 py-3 whitespace-nowrap">MP Materials</th>
                  <th className="text-right font-medium px-4 py-3 whitespace-nowrap">{t('Chinese producers', '中国生产商')}</th>
                </tr>
              </thead>
              <tbody>
                {cnEvents.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="px-4 py-3 text-muted whitespace-nowrap tabular-nums">{month(e.instant)}</td>
                    <td className="px-4 py-3">{CN_EVENTS[e.id] ? t(CN_EVENTS[e.id][0], CN_EVENTS[e.id][1]) : e.id}</td>
                    <td className={`px-4 py-3 text-right tabular-nums ${tone(cnOf(e.id, 'US_RARE_EARTH'))}`}>{pct(cnOf(e.id, 'US_RARE_EARTH'))}</td>
                    <td className={`px-4 py-3 text-right tabular-nums ${tone(cnOf(e.id, 'CN_STRATEGIC_MATERIALS'))}`}>{pct(cnOf(e.id, 'CN_STRATEGIC_MATERIALS'))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted mt-3">
          {t('Change over the two trading days after each announcement, compared with the overall market.', '每次公告后两个交易日内，相对大盘的涨跌。')}
        </p>
      </section>
    </div>
  );
}
