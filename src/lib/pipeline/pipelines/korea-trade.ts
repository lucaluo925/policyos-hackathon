/**
 * Korea trade/industry pipeline — MOTIE English press releases.
 *
 * Source: http://english.motie.go.kr/en/news/newsstandard/announce.jsp
 *
 * MOTIE (Ministry of Trade, Industry and Energy) is the Korean government
 * body responsible for trade and industrial policy.
 */
import { buildIndexPipeline } from '../helpers/factory';

export const koreaTradePipeline = buildIndexPipeline({
  key: 'korea-trade',
  label: 'MOTIE Korea — Press releases',
  canonicalSlug: 'motie-press-releases',
  defaultTitle: 'MOTIE Korea — Press releases index',
  defaultSummary:
    'Ministry of Trade, Industry and Energy (MOTIE) English press releases covering Korean trade and industrial policy.',
});
