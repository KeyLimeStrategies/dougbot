import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { password } = body;
  const dashPassword = process.env.DASH_PASSWORD;

  if (!dashPassword) {
    return NextResponse.json({ success: false, error: 'No password configured' }, { status: 500 });
  }

  if (password === dashPassword) {
    const response = NextResponse.json({ success: true });
    response.cookies.set('kl_auth', dashPassword, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/',
    });
    return response;
  }

  return NextResponse.json({ success: false, error: 'Invalid password' }, { status: 401 });
}
