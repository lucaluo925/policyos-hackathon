/**
 * Admin gate — single shared-password protection for /admin and admin APIs.
 *
 * Still not a full auth system, but no longer trivially bypassable:
 *   - The password comes only from ADMIN_PASSWORD. In production there is no
 *     fallback: if it is unset, admin login is disabled. A dev-only fallback
 *     exists for local work.
 *   - The session cookie holds HMAC-SHA256(password, "policyos-admin-v1"),
 *     not a fixed string, so it cannot be forged without the password and
 *     rotating ADMIN_PASSWORD invalidates every existing session.
 *
 * Uses Web Crypto so the same code runs in the proxy (edge) and routes.
 */

export const ADMIN_COOKIE = 'admin_auth';

const DEV_FALLBACK_PASSWORD = 'dev-only-change-me';

/** Configured admin password, or null when admin is disabled. Never exposed to client. */
export function getAdminPassword(): string | null {
  const p = process.env.ADMIN_PASSWORD;
  if (p) return p;
  return process.env.NODE_ENV === 'production' ? null : DEV_FALLBACK_PASSWORD;
}

/** Constant-time-ish equality; a length mismatch fails immediately. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function passwordMatches(input: unknown): boolean {
  const expected = getAdminPassword();
  if (!expected || typeof input !== 'string') return false;
  return safeEqual(input, expected);
}

/** Expected cookie value for the current password, or null if admin is disabled. */
export async function adminCookieValue(): Promise<string | null> {
  const password = getAdminPassword();
  if (!password) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('policyos-admin-v1'));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function isValidAdminCookie(value: string | undefined | null): Promise<boolean> {
  if (!value) return false;
  const expected = await adminCookieValue();
  return expected != null && safeEqual(value, expected);
}

/** Read the admin cookie from a raw Request (API routes). */
export async function isAdminRequest(request: Request): Promise<boolean> {
  const header = request.headers.get('cookie') ?? '';
  const m = header.split(/;\s*/).find((c) => c.startsWith(`${ADMIN_COOKIE}=`));
  if (!m) return false;
  let value: string;
  try { value = decodeURIComponent(m.slice(ADMIN_COOKIE.length + 1)); }
  catch { return false; } // A malformed cookie is not an authenticated session.
  return isValidAdminCookie(value);
}

/**
 * For endpoints that Vercel Cron calls *and* the admin UI can trigger
 * (pipeline runs, auto-resolve). Accepts `Authorization: Bearer <CRON_SECRET>`
 * or a valid admin cookie. Production requires a valid secret or admin cookie. The open fallback
 * when CRON_SECRET is unset is limited to non-production local work.
 */
export async function isCronOrAdmin(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production' || isAdminRequest(request);
  if (request.headers.get('authorization') === `Bearer ${secret}`) return true;
  return isAdminRequest(request);
}
