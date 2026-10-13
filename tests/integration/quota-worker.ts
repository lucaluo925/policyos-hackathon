import { getPrisma } from '../../src/lib/db/client';
import { reserveSharedVerificationRun, VerificationRunQuotaExceeded } from '../../src/lib/verify/admission';
import { reserveSharedCountryResearch, CountryResearchQuotaExceeded } from '../../src/lib/research/quota';
import { requireDisposableDatabase } from './disposable-database';

async function main() {
  requireDisposableDatabase();
  const [mode, timestamp] = process.argv.slice(2);
  try {
    if (mode === 'verify') await reserveSharedVerificationRun(new Date(timestamp), 3);
    else if (mode === 'research') await reserveSharedCountryResearch(timestamp, 'isolated CI concurrency test');
    else throw new Error('Unknown worker mode');
    console.log('QUOTA_RESULT:admitted');
  } catch (error) {
    if (error instanceof VerificationRunQuotaExceeded || error instanceof CountryResearchQuotaExceeded) {
      console.log('QUOTA_RESULT:denied');
    } else if ((error as { code?: string })?.code === 'P2034') {
      // Exhausted serialization retries must fail closed, never admit a call.
      console.log('QUOTA_RESULT:conflict');
    } else throw error;
  } finally {
    await getPrisma().$disconnect();
  }
}

main().catch(() => { console.error('Quota worker failed unexpectedly'); process.exitCode = 1; });
