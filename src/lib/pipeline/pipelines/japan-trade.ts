/**
 * Japan trade pipeline — METI English press index.
 *
 * Source: https://www.meti.go.jp/english/press/index.html
 *
 * METI publishes trade, industry, and economic security announcements
 * here in English.
 */
import { buildIndexPipeline } from '../helpers/factory';

export const japanTradePipeline = buildIndexPipeline({
  key: 'japan-trade',
  label: 'METI Japan — English press releases',
  canonicalSlug: 'meti-english-press',
  defaultTitle: 'METI Japan — English press releases index',
  defaultSummary:
    'Ministry of Economy, Trade and Industry (METI) press release index, covering trade policy, economic security, and industry updates.',
});
