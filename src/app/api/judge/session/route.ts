import { JUDGE_HEADERS, judgeCookie, judgeSessionStatus } from '@/lib/auth/judge';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return Response.json(judgeSessionStatus(judgeCookie(request)), { headers: JUDGE_HEADERS });
}
