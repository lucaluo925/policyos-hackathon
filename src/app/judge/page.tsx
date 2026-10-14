import Link from 'next/link';
import { cookies } from 'next/headers';
import { JUDGE_COOKIE, judgeSessionStatus } from '@/lib/auth/judge';
import JudgeLogin from './JudgeLogin';
export const dynamic = 'force-dynamic';
export default async function JudgePage() {
  const status = judgeSessionStatus((await cookies()).get(JUDGE_COOKIE)?.value);
  let entrance = <JudgeLogin authenticated={status.authenticated} />;
  if (!status.enabled) entrance = <p>Judge access is prepared but not enabled. Activation is waiting for organizer confirmation. The current public live access remains subject to the existing limits.</p>;
  else if (!status.ready) entrance = <p>Judge testing access needs an operator check. No live request is admitted through this entrance.</p>;
  return <main className="mx-auto max-w-xl px-6 py-12 space-y-6">
    <h1 className="text-2xl font-semibold">Judge testing entrance</h1>
    {entrance}
    <p className="text-sm text-muted">A testing code enables live claim verification and country research. It does not provide access to the admin console or private review records. Existing spending and daily limits still apply; signing in does not reserve a run or guarantee completion.</p>
    <div className="flex flex-wrap gap-4 text-sm text-accent underline"><Link href="/verify">Claim verification</Link><Link href="/explore">Country research</Link><Link href="/monitor">Policy events and original sources</Link></div>
  </main>;
}
