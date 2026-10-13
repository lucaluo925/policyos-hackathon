import { PrismaClient } from '@prisma/client';
import { requireDisposableDatabase } from './disposable-database';

async function main() {
  requireDisposableDatabase();
  const db = new PrismaClient();
  try {
    const row = await db.verificationRun.findUniqueOrThrow({ where: { id: process.argv[2] } });
    console.log(`ARCHIVE_RESULT:${JSON.stringify(row.snapshot)}`);
  } finally { await db.$disconnect(); }
}

main().catch(() => { console.error('Evidence read worker failed'); process.exitCode = 1; });
