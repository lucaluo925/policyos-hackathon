import type { Metadata } from 'next';
import data from '@/lib/research/event-study-v1.json';
import { getT } from '@/lib/i18n/server';
import PlainSummary from './PlainSummary';

export const metadata: Metadata = {
  title: 'Research — Export controls × semiconductor stocks | PolicyOS',
  description:
    'Pre-registered event study linking PolicyOS policy events to US and A-share semiconductor returns.',
};

type BasketRow = { day: string | null; n: number | null; carM1P1: number | null; car01: number | null; car05: number | null; t01: number | null };
type EventRow = { id: string; cluster: string; instant: string; scope: string; title: string; nDocs: number; url: string; baskets: Record<string, BasketRow> };
type Win = { n: number; mean_car?: number; median_car?: number; t?: number; p_t_one_sided?: number; n_expected_sign?: number; p_sign_one_sided?: number };
type Summary = { expectedSign: string; hypothesis: string | null; windows: Record<string, Win>; placebo: { p_placebo?: number | null } };

const BASKETS: Array<{ key: string; label: string; zh: string; short: string; shortZh: string }> = [
  { key: 'US_SEMI_EQUIP', label: 'US equipment (AMAT, LRCX, KLAC) vs SPY', zh: '美股设备股（AMAT、LRCX、KLAC）vs SPY', short: 'US equip', shortZh: '美设备' },
  { key: 'US_SEMI_BROAD', label: 'SOXX vs SPY', zh: 'SOXX vs SPY', short: 'SOXX', shortZh: 'SOXX' },
  { key: 'CN_SEMI_EQUIP_SUBSTITUTE', label: 'CN equipment (6 names) vs CSI 300', zh: 'A 股设备股（6 只）vs 沪深 300', short: 'CN equip', shortZh: 'A股设备' },
  { key: 'CN_SEMI_INDEX_ROBUST', label: 'CNI Semiconductor 980017 vs CSI 300', zh: '国证芯片 980017 vs 沪深 300', short: 'CN index', shortZh: 'A股指数' },
];

type CnSummary = Summary & { excluding: (Win & { excluded?: string[] }) | null };
type CnStudy = {
  registeredAt: string;
  question: string;
  baskets: Record<string, { benchmark: string; tickers: string[]; names: string | null }>;
  hypotheses: Array<{ id: string; primary: boolean; basket: string; expected_sign: string; rationale: string }>;
  robustnessExclude: string[];
  events: Array<{ id: string; cluster: string; instant: string; docs: string; url: string }>;
  summary: Record<string, CnSummary> | null;
  perEvent: Array<{ id: string; basket: string; day: string | null; car01: number | null }> | null;
};

const CN_BASKET_LABEL: Record<string, [string, string]> = {
  CN_STRATEGIC_MATERIALS: ['CN strategic materials (6 names) vs CSI 300', 'A 股战略材料股（6 只）vs 沪深 300'],
  US_RARE_EARTH: ['MP Materials vs SPY', 'MP Materials vs SPY'],
  US_STRATEGIC_METALS_ETF: ['REMX vs SPY', 'REMX vs SPY'],
};

const pct = (v: number | null | undefined, d = 1) => (v == null ? '–' : `${(v * 100).toFixed(d)}%`);
const num = (v: number | null | undefined, d = 2) => (v == null ? '–' : v.toFixed(d));

function carClass(v: number | null | undefined) {
  if (v == null) return 'text-muted';
  if (v <= -0.03) return 'text-red-400 font-medium';
  if (v >= 0.03) return 'text-green-400 font-medium';
  return 'text-foreground';
}

export default async function ResearchPage() {
  const { t } = await getT();
  const cnLabel = (k: string) => (CN_BASKET_LABEL[k] ? t(CN_BASKET_LABEL[k][0], CN_BASKET_LABEL[k][1]) : k);
  const summary = data.summary as Record<string, Summary>;
  const events = data.events as EventRow[];
  const primary = `[${data.primaryWindow.join(',')}]`;
  const cn = data.cn as CnStudy;
  const fut = data.fut as CnStudy;
  const periodSplit = data.periodSplit as Array<{ basket: string; period: string; n: number; mean_car: number; median_car: number; n_negative: number }>;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-14">
      <PlainSummary t={t} usEvents={data.events as never} cnEvents={cn.events} cnPer={cn.perEvent} />

      <details className="group rounded-xl border border-border bg-surface/60 [&_summary::-webkit-details-marker]:hidden">
        <summary className="cursor-pointer list-none px-5 py-4 flex items-center justify-between text-sm font-medium">
          <span>{t('For researchers: method and full statistics', '给研究者：方法与完整统计')}</span>
          <span className="text-muted group-open:rotate-180 transition-transform">⌄</span>
        </summary>
        <div className="px-5 pb-8 pt-2 space-y-10">
          <p className="text-sm text-muted max-w-3xl">
            {t(
              'Pre-registered market-model event studies (registered before any price data was pulled). H1/H2: no support at Bonferroni α = 0.025. China-side study: H7 supported, H6 borderline.',
              '预注册的市场模型事件研究（在拉取任何价格数据之前登记）。H1/H2：在 Bonferroni α = 0.025 下不支持。中国反制研究：H7 得到支持，H6 处于边界。',
            )}
          </p>
      <section>
        <h2 className="text-lg font-semibold mb-3">{t('Cross-event results · primary window', '跨事件结果 · 主窗口')} {primary}</h2>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-surface text-muted text-xs">
              <tr>
                {[t('Basket', '篮子'), t('Hypothesis', '假设'), t('Expected', '预期'), t('Mean CAR', '平均 CAR'), t('Median', '中位数'), 't', 'p (t)', t('Sign hits', '符号命中'), 'p (placebo)'].map((h) => (
                  <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {BASKETS.map((b) => {
                const s = summary[b.key];
                const w = s?.windows[primary];
                if (!s || !w) return null;
                return (
                  <tr key={b.key} className="border-t border-border">
                    <td className="px-3 py-2">{t(b.label, b.zh)}</td>
                    <td className="px-3 py-2 text-muted">{s.hypothesis ?? t('robustness', '稳健性')}</td>
                    <td className="px-3 py-2">{s.expectedSign === 'negative' ? '−' : '+'}</td>
                    <td className={`px-3 py-2 ${carClass(w.mean_car)}`}>{pct(w.mean_car, 2)}</td>
                    <td className="px-3 py-2">{pct(w.median_car, 2)}</td>
                    <td className="px-3 py-2">{num(w.t)}</td>
                    <td className="px-3 py-2">{num(w.p_t_one_sided, 3)}</td>
                    <td className="px-3 py-2">{w.n_expected_sign}/{w.n}</td>
                    <td className="px-3 py-2">{num(s.placebo?.p_placebo, 3)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-1">{t('Per-event abnormal returns · CAR', '逐事件超额收益 · CAR')}{primary}</h2>
        <p className="text-xs text-muted mb-3">
          {t(
            'Event day = first session closing after the Federal Register public-inspection time, per market (so the Oct-2022 rule lands on 10 Oct in China, after Golden Week). Scope: supply chain = technology-wide control rule; entity = named-company Entity List additions.',
            '事件日 = 联邦公报公开预览时间之后、第一个收盘的交易日，两个市场分别计算（因此 2022 年 10 月的规则在 A 股落在国庆后的 10 月 10 日）。范围：产业链 = 针对整类技术的管制规则；实体 = 点名企业的实体清单新增。',
          )}
        </p>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-surface text-muted text-xs">
              <tr>
                <th className="text-left font-medium px-3 py-2">{t('Event', '事件')}</th>
                <th className="text-left font-medium px-3 py-2">{t('Scope', '范围')}</th>
                {BASKETS.map((b) => (
                  <th key={b.key} className="text-right font-medium px-3 py-2 whitespace-nowrap">{t(b.short, b.shortZh)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <a href={e.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      <span className="text-muted mr-2">{e.id}</span>{e.cluster}
                    </a>
                    <div className="text-[11px] text-muted line-clamp-1 max-w-md">{e.title}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded border ${e.scope === 'supply_chain' ? 'border-red-500/30 text-red-400' : 'border-border text-muted'}`}>
                      {e.scope === 'supply_chain' ? t('supply chain', '产业链') : t('entity', '实体')}
                    </span>
                  </td>
                  {BASKETS.map((b) => {
                    const r = e.baskets[b.key];
                    return (
                      <td key={b.key} className={`px-3 py-2 text-right tabular-nums ${carClass(r?.car01)}`} title={r?.day ? `event day ${r.day}, t = ${num(r.t01)}` : undefined}>
                        {pct(r?.car01)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid md:grid-cols-2 gap-6">
        <div className="p-5 rounded-xl bg-surface border border-border">
          <h2 className="text-sm font-semibold mb-2">{t('Exploratory observation (post hoc)', '探索性观察（事后）')}</h2>
          <p className="text-sm text-muted mb-3">
            {t(
              'The CN equipment basket fell sharply on technology-wide rules — the Oct-2022 advanced-computing rule produced −23.9% over two sessions — while entity-level additions showed no consistent sign. The "domestic substitution" hypothesis may pool two opposite mechanisms.',
              'A 股设备篮子在针对整类技术的规则上大跌——2022 年 10 月先进计算规则两个交易日内 −23.9%——而实体清单新增没有一致的方向。"国产替代"假设可能把两种方向相反的机制混在了一起。',
            )}
          </p>
          <table className="w-full text-xs">
            <thead className="text-muted"><tr><th className="text-left py-1">{t('CN equipment', 'A 股设备')}</th><th className="text-right">n</th><th className="text-right">{t('Mean', '均值')}</th><th className="text-right">{t('Median', '中位数')}</th></tr></thead>
            <tbody>
              {data.inSampleSplit.filter((r) => r.basket === 'CN_SEMI_EQUIP_SUBSTITUTE').map((r) => (
                <tr key={r.rule_scope} className="border-t border-border">
                  <td className="py-1">{r.rule_scope === 'supply_chain' ? t('Supply-chain rules', '产业链规则') : t('Entity additions', '实体清单新增')}</td>
                  <td className="text-right">{r.n}</td>
                  <td className="text-right">{pct(r.mean_car)}</td>
                  <td className="text-right">{pct(r.median_car)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-muted mt-3">
            {t('Descriptive only. Registered as hypotheses v2 and tested solely on events after 22 Sep 2026.', '仅作描述。已登记为 v2 假设，只用 2026 年 9 月 22 日之后的新事件检验。')}
          </p>
        </div>
        <div className="p-5 rounded-xl bg-surface border border-border">
          <h2 className="text-sm font-semibold mb-2">{t('Method & limitations', '方法与局限')}</h2>
          <ul className="text-sm text-muted space-y-1.5 list-disc pl-4">
            <li>{t('Events: Federal Register BIS rules, tagged deterministically, human-reviewed, frozen before prices were pulled.', '事件：联邦公报中的 BIS 规则，规则化打标签、人工复核，在拉取价格之前冻结。')}</li>
            <li>{t(`Market model, estimation window [${data.estimationWindow.join(', ')}] sessions; equal-weight baskets; cross-event one-sided t, sign test, 1,000-draw placebo.`, `市场模型，估计窗口 [${data.estimationWindow.join(', ')}] 个交易日；等权篮子；跨事件单侧 t 检验、符号检验、1000 次安慰剂抽样。`)}</li>
            <li>{t('CN basket chosen in 2026 (survivors); names need ≥120 pre-event sessions, plus an index robustness check.', 'A 股篮子是 2026 年选的（存在幸存者偏差）；成分股需在事件前有 ≥120 个交易日，另用指数做稳健性检验。')}</li>
            <li>{t('BIS press releases can precede public inspection (one manual override); no factor adjustment; 16 events.', 'BIS 新闻稿可能早于公开预览（有一处人工修正）；未做因子调整；共 16 个事件。')}</li>
            <li>{t('A policy-risk study, not a trading signal.', '这是政策风险研究，不是交易信号。')}</li>
          </ul>
        </div>
      </section>

      <section className="p-5 rounded-xl bg-surface border border-border">
        <h2 className="text-sm font-semibold mb-2">{t('Appendix · reaction by period (exploratory, descriptive)', '附录 · 分时期反应（探索性、描述性）')}</h2>
        <p className="text-xs text-muted mb-3">
          {t(
            `Mean / median CAR${primary} for events before and after 2022. Not a test and not used to revise the v1 conclusion: US equipment names reacted negatively on average in 2018–2021 but not in 2022–2025.`,
            `2022 年前后事件的 CAR${primary} 均值 / 中位数。这不是检验，也不用来修改 v1 结论：美股设备股在 2018–2021 年平均为负，2022–2025 年则不然。`,
          )}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted">
              <tr><th className="text-left py-1">{t('Basket', '篮子')}</th><th className="text-left">{t('Period', '时期')}</th><th className="text-right">n</th><th className="text-right">{t('Mean', '均值')}</th><th className="text-right">{t('Median', '中位数')}</th><th className="text-right">{t('Negative', '为负')}</th></tr>
            </thead>
            <tbody>
              {periodSplit.map((r) => (
                <tr key={r.basket + r.period} className="border-t border-border">
                  <td className="py-1">{(() => { const b = BASKETS.find((x) => x.key === r.basket); return b ? t(b.short, b.shortZh) : r.basket; })()}</td>
                  <td>{r.period}</td>
                  <td className="text-right">{r.n}</td>
                  <td className={`text-right ${carClass(r.mean_car)}`}>{pct(r.mean_car)}</td>
                  <td className="text-right">{pct(r.median_car)}</td>
                  <td className="text-right">{r.n_negative}/{r.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h2 className="text-lg font-semibold">{t("The other direction: China's critical-mineral export controls", '另一个方向：中国的关键矿产出口管制')}</h2>
            <span className="text-[10px] px-2 py-1 rounded bg-surface border border-border text-muted">{t('pre-registered', '预注册于')} {cn.registeredAt}</span>
          </div>
          <p className="text-sm text-muted max-w-3xl">{t(cn.question, '中国商务部针对关键矿产的物项出口管制（2023-07 → 2025-10），是否让中国战略材料生产商和美国主要的非中国稀土生产商股价上涨？')}</p>
        </div>

        {cn.summary && (
          <div className="p-5 rounded-xl bg-surface border border-green-500/30">
            <h3 className="text-sm font-semibold mb-1">{t('Result: MP Materials supported; Chinese producers borderline', '结论：MP Materials 得到支持；A 股生产商处于边界')}</h3>
            <p className="text-sm text-muted max-w-3xl">
              {t(
                'MP Materials rose about 4.8% relative to the market over the two sessions after each announcement (p = 0.014, placebo p = 0.017). The Chinese producer basket rose 3.2% (placebo p = 0.005, t-test p = 0.029 — just above the 0.025 threshold). No single event drives either result, but after dropping the four announcements that coincided with other US–China escalations the effects stay positive and lose significance (n = 4), so the export controls cannot be separated from escalation in general.',
                '每次公告后两个交易日内，MP Materials 相对大盘上涨约 4.8%（p = 0.014，安慰剂 p = 0.017）。A 股生产商篮子上涨 3.2%（安慰剂 p = 0.005，t 检验 p = 0.029，略高于 0.025 门槛）。两个结果都不是靠单个事件撑起来的；但去掉与其他中美冲突同期的 4 次公告后，效应仍为正却不再显著（n = 4），所以无法把出口管制本身与整体冲突升级区分开。',
              )}
            </p>
          </div>
        )}

        {cn.summary ? (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="bg-surface text-muted text-xs">
                <tr>
                  {[t('Basket', '篮子'), t('Hypothesis', '假设'), t('Expected', '预期'), t('Mean CAR', '平均 CAR'), t('Median', '中位数'), 'p (t)', t('Sign hits', '符号命中'), 'p (placebo)', t(`Excl. ${cn.robustnessExclude.join('/')}`, `剔除 ${cn.robustnessExclude.join('/')}`)].map((h) => (
                    <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(cn.summary).map(([k, s]) => {
                  const w = s.windows[primary];
                  if (!w) return null;
                  return (
                    <tr key={k} className="border-t border-border">
                      <td className="px-3 py-2">{cnLabel(k)}</td>
                      <td className="px-3 py-2 text-muted">{s.hypothesis ?? t('secondary', '次要')}</td>
                      <td className="px-3 py-2">{s.expectedSign === 'negative' ? '−' : '+'}</td>
                      <td className={`px-3 py-2 ${carClass(w.mean_car)}`}>{pct(w.mean_car, 2)}</td>
                      <td className="px-3 py-2">{pct(w.median_car, 2)}</td>
                      <td className="px-3 py-2">{num(w.p_t_one_sided, 3)}</td>
                      <td className="px-3 py-2">{w.n_expected_sign}/{w.n}</td>
                      <td className="px-3 py-2">{num(s.placebo?.p_placebo, 3)}</td>
                      <td className="px-3 py-2 text-muted">{s.excluding ? `${pct(s.excluding.mean_car, 2)} (n=${s.excluding.n})` : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-surface border border-border text-sm text-muted">
            {t('Events, baskets and hypotheses are registered; results will appear here after the first run. No price data for these baskets had been pulled at registration.', '事件、篮子和假设都已登记；首次运行后结果会显示在这里。登记时还没有拉取这些篮子的任何价格数据。')}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-surface border border-border">
            <h3 className="text-xs font-semibold mb-2">{t('Hypotheses', '假设')}</h3>
            <ul className="text-xs text-muted space-y-1.5">
              {cn.hypotheses.map((h) => (
                <li key={h.id}>
                  <span className="text-foreground">{h.id}{h.primary ? '' : t(' (secondary)', '（次要）')}</span> · {cnLabel(h.basket)}{' '}
                  {h.expected_sign === 'negative' ? '↓' : '↑'} — {h.rationale}
                </li>
              ))}
            </ul>
          </div>
          <div className="p-4 rounded-xl bg-surface border border-border">
            <h3 className="text-xs font-semibold mb-2">{t('Events (MOFCOM web timestamps)', '事件（商务部网页时间戳）')}</h3>
            <ul className="text-xs text-muted space-y-1">
              {cn.events.map((e) => (
                <li key={e.id}>
                  <a href={e.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    <span className="text-foreground mr-1">{e.id}</span>{e.cluster}
                  </a>
                  {cn.robustnessExclude.includes(e.id) && <span className="ml-1 text-amber-400">· {t('confounded', '有混杂')}</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Third study: futures. Reported because it is a null, not despite it. */}
      <section className="space-y-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h2 className="text-lg font-semibold">
              {t('A third direction: tariff actions against agricultural futures', '第三个方向：关税行动与农产品期货')}
            </h2>
            <span className="text-[10px] px-2 py-1 rounded bg-surface border border-border text-muted">
              {t('pre-registered', '预注册于')} {fut.registeredAt}
            </span>
          </div>
          <p className="text-sm text-muted max-w-3xl">
            {t(
              'Futures are used here and nowhere else in this work for a reason: the other two studies cover export controls on goods with no liquid contract — there is no tradeable gallium, germanium, antimony or rare earth — so a futures test there would measure instruments the policy does not target. Section 301 retaliation hit US agriculture, where the targeted good is the deliverable of a liquid contract.',
              '期货只用在这里，有其原因：另外两个研究覆盖的受限物没有流动合约——镓、锗、锑、稀土都不可交易——在那里做期货检验等于measuring政策并未指向的标的。而 301 关税引发的报复直接打在美国农产品上，大豆本身就是流动合约的交割物。',
            )}
          </p>
        </div>

        <div className="p-5 rounded-xl bg-surface border border-orange-500/30">
          <h3 className="text-sm font-semibold mb-1">
            {t('Result: no support, and the primary came out with the wrong sign', '结论：不支持，且主假设方向相反')}
          </h3>
          <p className="text-sm text-muted max-w-3xl">
            {t(
              'Soybeans benchmarked on corn — the better-identified test of the retaliation channel — gave +0.14% over the two sessions after each action (p = 0.613, placebo 0.630), the opposite direction to the hypothesis. Soybeans against a commodity benchmark had the predicted sign and missed anyway (-0.31%, p = 0.232). Corn fell more than soybeans (-1.06%), which is the reverse of the ordering the story predicts. A 25-event control arm of Section 301 exclusions moves nothing (p = 0.750), so this is a null rather than a pipeline that cannot see. With n = 10 that is weak evidence of no effect, not evidence of absence.',
              '以玉米为基准的大豆——对报复渠道识别最干净的检验——在每次行动后两个交易日为 +0.14%（p = 0.613，安慰剂 0.630），方向与假设相反。以商品指数为基准的大豆方向正确但同样不显著（-0.31%，p = 0.232）。玉米跌幅（-1.06%）大于大豆，与该故事预测的相对顺序正好相反。由 25 个 301 豁免事件构成的对照臂纹丝不动（p = 0.750），说明这是真 null 而非管线失效。n = 10，这是"无效应的弱证据"，不是"证明无效应"。',
            )}
          </p>
        </div>

        {fut.summary && (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-surface text-muted text-xs">
                <tr>
                  {[t('Basket', '篮子'), t('Expected', '预期'), t('Mean CAR', '平均 CAR'), 'p (t)', 'p (placebo)'].map((h) => (
                    <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(fut.summary).map(([k, v]) => {
                  const w = v.windows[primary];
                  if (!w) return null;
                  return (
                    <tr key={k} className="border-t border-border">
                      <td className="px-3 py-2 whitespace-nowrap">{k}</td>
                      <td className="px-3 py-2 text-muted">{v.expectedSign === 'negative' ? '↓' : v.expectedSign === 'positive' ? '↑' : '—'}</td>
                      <td className={`px-3 py-2 ${carClass(w.mean_car)}`}>{pct(w.mean_car, 2)}</td>
                      <td className="px-3 py-2 text-muted">{num(w.p_t_one_sided, 3)}</td>
                      <td className="px-3 py-2 text-muted">{num(v.placebo?.p_placebo, 3)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
        </div>
      </details>
    </div>
  );
}
