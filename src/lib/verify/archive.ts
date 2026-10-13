import type { Prisma } from '@prisma/client';
import type { VerificationResult } from './types';

/** Complete result and EXACT retained adjudication input, not full source
 * pages or earlier retrieval/screening inputs. Older missing provenance stays
 * missing; it must never be filled from a later web search. */
export function verificationSnapshot(result: VerificationResult): Prisma.InputJsonObject {
  const serialized = JSON.stringify({
    schemaVersion: 1,
    kind: 'saved_verification',
    evidenceScope: 'adjudication_inputs',
    result,
  });
  // Never silently truncate evidence to make a successful save look complete.
  // A failed save leaves the streamed result available for client download.
  if (Buffer.byteLength(serialized, 'utf8') > 1_048_576) {
    throw new Error('Verification evidence exceeds the archive size limit.');
  }
  return JSON.parse(serialized) as Prisma.InputJsonObject;
}
