import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const all = await p.policy.findMany({
    select: { id: true, slug: true, title: true, country: { select: { iso2: true } }, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  for (const r of all) {
    console.log(r.createdAt.toISOString(), r.country.iso2, r.slug, '->', r.title.slice(0, 60));
  }
  console.log('---');
  const byVersion = await p.policyVersion.findMany({
    where: { extractionMethod: { not: null } },
    select: { id: true, policyId: true, extractionMethod: true, guidanceType: true, changeType: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  console.log('versions with extractionMethod set:', byVersion.length);
  for (const v of byVersion) {
    console.log(v.createdAt.toISOString(), v.policyId, v.changeType, v.extractionMethod, v.guidanceType);
  }
}
main().catch(console.error).finally(() => p.$disconnect());
