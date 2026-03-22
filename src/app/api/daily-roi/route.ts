import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { DailySummary } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get('date');
    const startDate = searchParams.get('start_date');
    const days = parseInt(searchParams.get('days') || '7', 10);
    const excludeRecurring = searchParams.get('exclude_recurring') === 'true';

    // Use Eastern Time for date boundaries
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const nDaysAgo = new Date(nowET);
    nDaysAgo.setDate(nDaysAgo.getDate() - days);
    const nDaysAgoET = startDate || nDaysAgo.toISOString().split('T')[0];

    let rows: DailySummary[];

    if (excludeRecurring) {
      // Recalculate on the fly using only first-time contributions
      const dateWhere = date
        ? `AND a.date = ?`
        : `AND a.date >= ?`;
      const queryParams = date ? [date] : [nDaysAgoET];

      rows = db.prepare(`
        SELECT
          a.date,
          a.client_id,
          c.name as client_name,
          c.short_code,
          COALESCE(spend.total_spend, 0) as total_spend,
          COALESCE(rev.total_revenue, 0) as total_revenue,
          COALESCE(spend.total_spend, 0) + (COALESCE(spend.total_spend, 0) * c.fee_rate) as spend_with_fee,
          CASE WHEN (COALESCE(spend.total_spend, 0) + (COALESCE(spend.total_spend, 0) * c.fee_rate)) > 0
            THEN COALESCE(rev.total_revenue, 0) / (COALESCE(spend.total_spend, 0) + (COALESCE(spend.total_spend, 0) * c.fee_rate))
            ELSE 0 END as true_roas,
          COALESCE(rev.total_revenue, 0) - (COALESCE(spend.total_spend, 0) + (COALESCE(spend.total_spend, 0) * c.fee_rate)) as profit,
          (COALESCE(spend.total_spend, 0) * c.fee_rate) +
            CASE WHEN COALESCE(rev.total_revenue, 0) - (COALESCE(spend.total_spend, 0) + (COALESCE(spend.total_spend, 0) * c.fee_rate)) > 0
              THEN (COALESCE(rev.total_revenue, 0) - (COALESCE(spend.total_spend, 0) + (COALESCE(spend.total_spend, 0) * c.fee_rate))) * 0.25
              ELSE 0 END as keylime_cut
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
        WHERE c.active = 1 ${dateWhere}
        ORDER BY a.date DESC, true_roas DESC
      `).all(...queryParams) as DailySummary[];
    } else {
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
        query = `
          SELECT ds.date, ds.client_id, c.name as client_name, c.short_code,
                 ds.total_spend, ds.total_revenue, ds.spend_with_fee,
                 ds.true_roas, ds.profit, ds.keylime_cut
          FROM daily_summary ds
          JOIN clients c ON c.id = ds.client_id
          WHERE ds.date >= ? AND c.active = 1
          ORDER BY ds.date DESC, ds.true_roas DESC
        `;
        params = [nDaysAgoET];
      }

      rows = db.prepare(query).all(...params) as DailySummary[];
    }

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
