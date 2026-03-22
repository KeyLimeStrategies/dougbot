import { NextRequest, NextResponse } from 'next/server';

async function verifySessionToken(token: string, dashPassword: string): Promise<boolean> {
  // Support legacy raw-password cookies for backward compatibility
  if (token === dashPassword) return true;

  // HMAC verification using Web Crypto API (Edge Runtime compatible)
  const secret = dashPassword + (process.env.META_APP_SECRET || 'kl-dashboard');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode('kl-session'));
  const expected = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time comparison
  if (token.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function middleware(request: NextRequest) {
  const dashPassword = process.env.DASH_PASSWORD;

  // If no password is set, allow access (local dev)
  if (!dashPassword) return NextResponse.next();

  // Skip auth for the login page itself and its API
  if (request.nextUrl.pathname === '/login' || request.nextUrl.pathname === '/api/auth') {
    return NextResponse.next();
  }

  // Check for auth cookie (HMAC token or legacy raw password)
  const authCookie = request.cookies.get('kl_auth')?.value;
  if (authCookie && await verifySessionToken(authCookie, dashPassword)) {
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
