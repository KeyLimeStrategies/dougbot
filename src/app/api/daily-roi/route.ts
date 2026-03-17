import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { DailySummary } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get('date');
    const days = parseInt(searchParams.get('days') || '7', 10);

    let query: string;
    let params: (string | number)[];

    if (date) {
      query = `
        SELECT ds.date, ds.client_id, c.name as client_name, c.short_code,
               ds.total_spend, ds.total_revenue, ds.spend_with_fee,
               ds.true_roas, ds.profit, ds.keylime_cut
        FROM daily_summary ds
        JOIN clients c ON c.id = ds.client_id
        WHERE ds.date = ? AND c.active = 1
        ORDER BY ds.true_roas DESC
      `;
      params = [date];
    } else {
      // Use today's date as reference so buttons mean "last N days from today"
      query = `
        SELECT ds.date, ds.client_id, c.name as client_name, c.short_code,
               ds.total_spend, ds.total_revenue, ds.spend_with_fee,
               ds.true_roas, ds.profit, ds.keylime_cut
        FROM daily_summary ds
        JOIN clients c ON c.id = ds.client_id
        WHERE ds.date >= date('now', '-' || ? || ' days') AND c.active = 1
        ORDER BY ds.date DESC, ds.true_roas DESC
      `;
      params = [days];
    }

    const rows = db.prepare(query).all(...params) as DailySummary[];

    // Calculate 3-day rolling ROAS for each client
    const clientDates = new Map<number, { date: string; revenue: number; spendWithFee: number }[]>();
    for (const row of rows) {
      if (!clientDates.has(row.client_id)) {
        clientDates.set(row.client_id, []);
      }
      clientDates.get(row.client_id)!.push({
        date: row.date,
        revenue: row.total_revenue,
        spendWithFee: row.spend_with_fee,
      });
    }

    // Add rolling 3-day ROAS
    for (const row of rows) {
      const entries = clientDates.get(row.client_id)!;
      const idx = entries.findIndex(e => e.date === row.date);
      const window = entries.slice(idx, idx + 3); // sorted DESC, so this gets current + 2 prior
      if (window.length > 0) {
        const totalRev = window.reduce((s, e) => s + e.revenue, 0);
        const totalSpend = window.reduce((s, e) => s + e.spendWithFee, 0);
        row.rolling_3d_roas = totalSpend > 0 ? totalRev / totalSpend : 0;
      }
    }

    // Calculate portfolio totals per date
    const dateMap = new Map<string, { spend: number; revenue: number; spendWithFee: number; profit: number; keylimeCut: number }>();
    for (const row of rows) {
      if (!dateMap.has(row.date)) {
        dateMap.set(row.date, { spend: 0, revenue: 0, spendWithFee: 0, profit: 0, keylimeCut: 0 });
      }
      const d = dateMap.get(row.date)!;
      d.spend += row.total_spend;
      d.revenue += row.total_revenue;
      d.spendWithFee += row.spend_with_fee;
      d.profit += row.profit;
      d.keylimeCut += row.keylime_cut;
    }

    const portfolioTotals = Array.from(dateMap.entries()).map(([date, d]) => ({
      date,
      total_spend: d.spend,
      total_revenue: d.revenue,
      spend_with_fee: d.spendWithFee,
      true_roas: d.spendWithFee > 0 ? d.revenue / d.spendWithFee : 0,
      profit: d.profit,
      keylime_cut: d.keylimeCut,
    }));

    return NextResponse.json({ rows, portfolioTotals });
  } catch (error) {
    console.error('Daily ROI error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
