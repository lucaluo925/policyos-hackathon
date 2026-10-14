import { Prisma } from '@prisma/client';
import { getPrisma } from '@/lib/db';

const ENTITY_TYPE = 'country_research';
const ACTION_TYPE = 'tavily_search_reserved';
export const COUNTRY_RESEARCH_DAILY_CAP = 60;

export class CountryResearchQuotaExceeded extends Error {}

interface QuotaTransaction {
  count(day: string): Promise<number>;
  reserve(day: string, summary: string): Promise<void>;
}

export type QuotaRunner = (work: (tx: QuotaTransaction) => Promise<void>) => Promise<void>;

async function runPrismaQuotaTransaction(work: (tx: QuotaTransaction) => Promise<void>) {
  await getPrisma().$transaction(async tx => {
    await work({
      count: day => tx.auditLog.count({
        where: { entityType: ENTITY_TYPE, entityId: day, actionType: ACTION_TYPE },
      }),
      reserve: async (day, summary) => {
        await tx.auditLog.create({ data: {
          entityType: ENTITY_TYPE,
          entityId: day,
          actionType: ACTION_TYPE,
          actorType: 'system',
          summary,
        } });
      },
    });
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    timeout: 5_000,
  });
}

/** Reserve before the paid call. A failed search still consumes its reservation. */
export async function reserveSharedCountryResearch(
  day: string,
  summary: string,
  run: QuotaRunner = runPrismaQuotaTransaction,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await run(async tx => {
        const used = await tx.count(day);
        if (used >= COUNTRY_RESEARCH_DAILY_CAP) {
          throw new CountryResearchQuotaExceeded('Shared daily research limit reached. Try again after the daily reset.');
        }
        await tx.reserve(day, summary);
      });
      return;
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2034' && attempt < 2) continue;
      throw error;
    }
  }
}
