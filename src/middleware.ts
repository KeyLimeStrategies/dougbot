import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const dashPassword = process.env.DASH_PASSWORD;

  // If no password is set, allow access (local dev)
  if (!dashPassword) return NextResponse.next();

  // Skip auth for the login page itself and its API
  if (request.nextUrl.pathname === '/login' || request.nextUrl.pathname === '/api/auth') {
    return NextResponse.next();
  }

  // Check for auth cookie
  const authCookie = request.cookies.get('kl_auth')?.value;
  if (authCookie === dashPassword) {
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
