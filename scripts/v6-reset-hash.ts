/**
 * Reset lastHash on V6 priority pipelines so the next run re-enters the
 * firstSight path and calls deepItems. Dedup on (sourceUrl, sourceHash)
 * in the runner means no duplicate PolicyVersion rows.
 */
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const keys = ['us-immigration', 'eu-trade', 'germany-climate', 'uk-climate'];
  for (const k of keys) {
    const r = await p.monitoredSource.updateMany({
      where: { pipelineKey: k },
      data: { lastHash: null },
    });
    console.log(`reset lastHash for ${k}: ${r.count} row(s)`);
  }
}
main().finally(() => p.$disconnect());
