import { getVerificationAvailability } from '@/lib/verify/availability-server';
import { judgeAccessFailure } from '@/lib/auth/judge';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;
export async function GET(request: Request) {
  const failure = judgeAccessFailure(request);
  if (failure) return Response.json({ status: failure.code === 'judge_required' ? 'judge_required' : 'unavailable', checkedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store', Vary: 'Cookie' } });
  return Response.json(await getVerificationAvailability(), { headers: { 'Cache-Control': 'no-store', Vary: 'Cookie' } });
}
