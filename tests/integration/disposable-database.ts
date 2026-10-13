/** Guard every integration entry point, including independently run workers. */
export function requireDisposableDatabase() {
  const target = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid');
  if (process.env.TEST_DATABASE_DISPOSABLE !== '1' ||
      !['127.0.0.1', 'localhost'].includes(target.hostname) ||
      target.pathname !== '/policyos_ci') {
    throw new Error('Use an empty local policyos_ci database and TEST_DATABASE_DISPOSABLE=1');
  }
}
