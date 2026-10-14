import { getVerificationAvailability } from '@/lib/verify/availability-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET() {
  return Response.json(await getVerificationAvailability(), { headers: { 'Cache-Control': 'no-store' } });
}
