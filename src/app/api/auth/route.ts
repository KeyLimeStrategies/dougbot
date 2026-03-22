import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// In-memory rate limiting (persists across requests within same process)
const failedAttempts = new Map<string, { count: number; lastAttempt: number; lockedUntil: number }>();

// Clean up old entries every 10 minutes
const CLEANUP_INTERVAL = 10 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [ip, data] of failedAttempts) {
    // Remove entries that haven't had activity in 1 hour
    if (now - data.lastAttempt > 60 * 60 * 1000) {
      failedAttempts.delete(ip);
    }
  }
}

function getClientIP(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
}

function createSessionToken(password: string): string {
  // HMAC the password with itself as key + a fixed app secret
  // This way the cookie never contains the raw password
  const secret = password + (process.env.META_APP_SECRET || 'kl-dashboard');
  return crypto.createHmac('sha256', secret).update('kl-session').digest('hex');
}

export function verifySessionToken(token: string): boolean {
  const dashPassword = process.env.DASH_PASSWORD;
  if (!dashPassword) return false;
  const expected = createSessionToken(dashPassword);
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

export async function POST(request: NextRequest) {
  cleanup();

  const ip = getClientIP(request);
  const now = Date.now();

  // Check if IP is locked out
  const record = failedAttempts.get(ip);
  if (record && record.lockedUntil > now) {
    const waitSeconds = Math.ceil((record.lockedUntil - now) / 1000);
    return NextResponse.json(
      { success: false, error: `Too many attempts. Try again in ${waitSeconds}s.` },
      { status: 429 }
    );
  }

  const body = await request.json();
  const { password } = body;
  const dashPassword = process.env.DASH_PASSWORD;

  if (!dashPassword) {
    return NextResponse.json({ success: false, error: 'No password configured' }, { status: 500 });
  }

  if (password === dashPassword) {
    // Success: clear failed attempts for this IP
    failedAttempts.delete(ip);

    const token = createSessionToken(dashPassword);
    const response = NextResponse.json({ success: true });
    response.cookies.set('kl_auth', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days (reduced from 30)
      path: '/',
    });
    return response;
  }

  // Failed attempt: increment counter and calculate lockout
  const current = failedAttempts.get(ip) || { count: 0, lastAttempt: 0, lockedUntil: 0 };

  // Reset count if last attempt was over 1 hour ago
  if (now - current.lastAttempt > 60 * 60 * 1000) {
    current.count = 0;
  }

  current.count += 1;
  current.lastAttempt = now;

  // Escalating lockout:
  // 1-3 failures: no lockout
  // 4-5 failures: 30 second lockout
  // 6-8 failures: 5 minute lockout
  // 9+ failures: 30 minute lockout
  if (current.count >= 9) {
    current.lockedUntil = now + 30 * 60 * 1000;
  } else if (current.count >= 6) {
    current.lockedUntil = now + 5 * 60 * 1000;
  } else if (current.count >= 4) {
    current.lockedUntil = now + 30 * 1000;
  }

  failedAttempts.set(ip, current);

  // Generic error message (don't reveal lockout thresholds)
  return NextResponse.json({ success: false, error: 'Invalid password' }, { status: 401 });
}
