import { NextRequest, NextResponse } from 'next/server';
import { syncMetaAds, checkMetaTokenStatus, getAdAccountInfo } from '@/lib/meta';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date_start, date_end } = body;

    if (!date_start || !date_end) {
      return NextResponse.json(
        { success: false, error: 'date_start and date_end are required (YYYY-MM-DD)' },
        { status: 400 }
      );
    }

    const result = await syncMetaAds(date_start, date_end);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Meta sync error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Meta sync failed' },
      { status: 500 }
    );
  }
}

// GET: Check Meta API status
export async function GET() {
  try {
    const [tokenStatus, accountInfo] = await Promise.all([
      checkMetaTokenStatus(),
      getAdAccountInfo(),
    ]);

    return NextResponse.json({
      configured: !!process.env.META_ACCESS_TOKEN,
      token: tokenStatus,
      account: accountInfo,
    });
  } catch (error) {
    return NextResponse.json({
      configured: false,
      error: error instanceof Error ? error.message : 'Meta API not configured',
    });
  }
}
