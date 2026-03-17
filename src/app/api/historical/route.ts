import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { HistoricalPoint } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const searchParams = request.nextUrl.searchParams;
    const days = parseInt(searchParams.get('days') || '30', 10);

    const rows = db.prepare(`
      SELECT ds.date, c.name as client_name, c.short_code,
             ds.true_roas, ds.total_spend, ds.total_revenue, ds.spend_with_fee
      FROM daily_summary ds
      JOIN clients c ON c.id = ds.client_id
      WHERE ds.date >= date((SELECT MAX(date) FROM daily_summary), '-' || ? || ' days') AND c.active = 1
      ORDER BY ds.date ASC, c.name ASC
    `).all(days) as HistoricalPoint[];

    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error('Historical error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
