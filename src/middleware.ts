import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

function verifySessionToken(token: string, dashPassword: string): boolean {
  const secret = dashPassword + (process.env.META_APP_SECRET || 'kl-dashboard');
  const expected = crypto.createHmac('sha256', secret).update('kl-session').digest('hex');
  if (token.length !== expected.length) return false;
  // Timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  const dashPassword = process.env.DASH_PASSWORD;

  // If no password is set, allow access (local dev)
  if (!dashPassword) return NextResponse.next();

  // Skip auth for the login page itself and its API
  if (request.nextUrl.pathname === '/login' || request.nextUrl.pathname === '/api/auth') {
    return NextResponse.next();
  }

  // Check for auth cookie (HMAC token, not raw password)
  const authCookie = request.cookies.get('kl_auth')?.value;
  if (authCookie && verifySessionToken(authCookie, dashPassword)) {
    return NextResponse.next();
  }

  // Redirect to login
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  matcher: [
    // Match all routes except static files and Next.js internals
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
