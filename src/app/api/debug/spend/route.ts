import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const searchParams = request.nextUrl.searchParams;
    const client = searchParams.get('client') || 'yonce';
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];

    // Get all ad_spend rows for this client on this date
    const rows = db.prepare(`
      SELECT a.date, a.ad_name, a.meta_ad_id, a.spend, a.results, a.frequency, a.ad_delivery,
             a.campaign_type, a.batch, a.attribution_setting,
             c.name as client_name, c.short_code
      FROM ad_spend a
      JOIN clients c ON c.id = a.client_id
      WHERE c.short_code = ? AND a.date = ?
      ORDER BY a.spend DESC
    `).all(client, date);

    const totalSpend = (rows as { spend: number }[]).reduce((s, r) => s + r.spend, 0);

    // Also show all dates we have for this client (to check for date format issues)
    const dates = db.prepare(`
      SELECT DISTINCT a.date, COUNT(*) as ad_count, SUM(a.spend) as total_spend
      FROM ad_spend a
      JOIN clients c ON c.id = a.client_id
      WHERE c.short_code = ?
      GROUP BY a.date
      ORDER BY a.date DESC
      LIMIT 10
    `).all(client);

    return NextResponse.json({
      query: { client, date },
      total_spend: totalSpend,
      row_count: rows.length,
      rows,
      recent_dates: dates,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
