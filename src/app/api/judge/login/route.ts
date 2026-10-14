import { NextResponse } from 'next/server';
import { createJudgeSession, JUDGE_COOKIE, JUDGE_HEADERS, judgeAccessEnabled, judgeSessionStatus, sameOrigin } from '@/lib/auth/judge';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  if (!judgeAccessEnabled() || !judgeSessionStatus(null).ready) return NextResponse.json({ error: 'Judge testing access is not enabled.' }, { status: 503, headers: JUDGE_HEADERS });
  if (!sameOrigin(request, true)) return NextResponse.json({ error: 'Open the judge entrance on this website.' }, { status: 403, headers: JUDGE_HEADERS });
  if (Number(request.headers.get('content-length')) > 2048) return NextResponse.json({ error: 'Invalid request.' }, { status: 413, headers: JUDGE_HEADERS });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: JUDGE_HEADERS }); }
  const session = createJudgeSession(body && typeof body === 'object' ? (body as Record<string, unknown>).code : undefined);
  if (!session) return NextResponse.json({ error: 'The testing code was not accepted.' }, { status: 401, headers: JUDGE_HEADERS });
  const res = NextResponse.json({ ok: true }, { headers: JUDGE_HEADERS });
  res.cookies.set({ name: JUDGE_COOKIE, value: session.value, httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', expires: new Date(session.expiresAt) });
  return res;
}
