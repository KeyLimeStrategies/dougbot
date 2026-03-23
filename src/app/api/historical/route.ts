import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { HistoricalPoint } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const searchParams = request.nextUrl.searchParams;
    const days = parseInt(searchParams.get('days') || '30', 10);
    const excludeRecurring = searchParams.get('exclude_recurring') === 'true';

    // Use Eastern Time for date boundaries
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const nDaysAgo = new Date(nowET);
    nDaysAgo.setDate(nDaysAgo.getDate() - days);
    const nDaysAgoET = nDaysAgo.toISOString().split('T')[0];

    let rows: HistoricalPoint[];

    if (excludeRecurring) {
      rows = db.prepare(`
        SELECT
          a.date,
          c.name as client_name,
          c.short_code,
          CASE WHEN (COALESCE(spend.total_spend, 0) + (COALESCE(spend.total_spend, 0) * c.fee_rate)) > 0
            THEN COALESCE(rev.total_revenue, 0) / (COALESCE(spend.total_spend, 0) + (COALESCE(spend.total_spend, 0) * c.fee_rate))
            ELSE 0 END as true_roas,
          COALESCE(spend.total_spend, 0) as total_spend,
          COALESCE(rev.total_revenue, 0) as total_revenue,
          COALESCE(spend.total_spend, 0) + (COALESCE(spend.total_spend, 0) * c.fee_rate) as spend_with_fee
        FROM (
          SELECT DISTINCT date, client_id FROM ad_spend
          UNION
          SELECT DISTINCT date, client_id FROM revenue WHERE fundraising_page LIKE '%fbig%' AND recurrence_number = 1
        ) a
        JOIN clients c ON c.id = a.client_id
        LEFT JOIN (
          SELECT date, client_id, SUM(spend) as total_spend FROM ad_spend GROUP BY date, client_id
        ) spend ON spend.date = a.date AND spend.client_id = a.client_id
        LEFT JOIN (
          SELECT date, client_id, SUM(amount) as total_revenue
          FROM revenue
          WHERE fundraising_page LIKE '%fbig%' AND recurrence_number = 1
          GROUP BY date, client_id
        ) rev ON rev.date = a.date AND rev.client_id = a.client_id
        WHERE a.date >= ? AND c.active = 1 AND c.is_ad_client = 1
        ORDER BY a.date ASC, c.name ASC
      `).all(nDaysAgoET) as HistoricalPoint[];
    } else {
      rows = db.prepare(`
        SELECT ds.date, c.name as client_name, c.short_code,
               ds.true_roas, ds.total_spend, ds.total_revenue, ds.spend_with_fee
        FROM daily_summary ds
        JOIN clients c ON c.id = ds.client_id
        WHERE ds.date >= ? AND c.active = 1 AND c.is_ad_client = 1
        ORDER BY ds.date ASC, c.name ASC
      `).all(nDaysAgoET) as HistoricalPoint[];
    }

    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error('Historical error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
