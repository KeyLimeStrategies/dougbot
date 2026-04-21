import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { HistoricalPoint } from '@/lib/types';

const ANOMALY_MULTIPLIER = 10;
const ANOMALY_FLOOR = 250;

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const searchParams = request.nextUrl.searchParams;
    const days = parseInt(searchParams.get('days') || '30', 10);
    const excludeRecurring = searchParams.get('exclude_recurring') === 'true';
    const excludeAnomalies = searchParams.get('exclude_anomalies') === 'true';

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
          SELECT DISTINCT date, client_id FROM revenue WHERE fundraising_page LIKE '%fbig%' AND recurrence_number = 1 AND refunded = 0
        ) a
        JOIN clients c ON c.id = a.client_id
        LEFT JOIN (
          SELECT date, client_id, SUM(spend) as total_spend FROM ad_spend GROUP BY date, client_id
        ) spend ON spend.date = a.date AND spend.client_id = a.client_id
        LEFT JOIN (
          SELECT date, client_id, SUM(amount) as total_revenue
          FROM revenue
          WHERE fundraising_page LIKE '%fbig%' AND recurrence_number = 1 AND refunded = 0
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

    // If exclude_anomalies, subtract anomalous fbig contributions from each (date, client)
    if (excludeAnomalies && rows.length > 0) {
      // Compute per-client median over 90-day baseline
      const baseStart = new Date(nDaysAgo);
      baseStart.setDate(baseStart.getDate() - 90);
      const baseStartStr = baseStart.toISOString().split('T')[0];

      const baseline = db.prepare(`
        SELECT c.short_code, r.amount
        FROM revenue r
        JOIN clients c ON c.id = r.client_id
        WHERE r.fundraising_page LIKE '%fbig%' AND r.refunded = 0
          AND r.date >= ? AND r.date < ?
          AND c.active = 1 AND c.is_ad_client = 1
        ORDER BY c.short_code, r.amount
      `).all(baseStartStr, nDaysAgoET) as { short_code: string; amount: number }[];

      const medianBy = new Map<string, number>();
      const buf: { code: string; arr: number[] } = { code: '', arr: [] };
      const flush = () => {
        if (buf.arr.length > 0) {
          const mid = Math.floor(buf.arr.length / 2);
          medianBy.set(buf.code, buf.arr.length % 2 === 0 ? (buf.arr[mid - 1] + buf.arr[mid]) / 2 : buf.arr[mid]);
        }
      };
      for (const b of baseline) {
        if (b.short_code !== buf.code) { flush(); buf.code = b.short_code; buf.arr = []; }
        buf.arr.push(b.amount);
      }
      flush();

      // Fetch anomalous contributions in window
      const recurrenceFilter = excludeRecurring ? 'AND r.recurrence_number = 1' : '';
      const anomalyRows = db.prepare(`
        SELECT r.date, c.short_code, r.amount
        FROM revenue r
        JOIN clients c ON c.id = r.client_id
        WHERE r.fundraising_page LIKE '%fbig%' AND r.refunded = 0
          AND r.date >= ? AND r.amount >= ?
          AND c.active = 1 AND c.is_ad_client = 1 ${recurrenceFilter}
      `).all(nDaysAgoET, ANOMALY_FLOOR) as { date: string; short_code: string; amount: number }[];

      const subtractMap = new Map<string, number>();
      for (const a of anomalyRows) {
        const med = medianBy.get(a.short_code) || 0;
        const threshold = Math.max(med * ANOMALY_MULTIPLIER, ANOMALY_FLOOR);
        if (a.amount >= threshold) {
          const k = `${a.date}|${a.short_code}`;
          subtractMap.set(k, (subtractMap.get(k) || 0) + a.amount);
        }
      }

      rows = rows.map(r => {
        const k = `${r.date}|${r.short_code}`;
        const sub = subtractMap.get(k) || 0;
        if (sub === 0) return r;
        const newRev = Math.max(0, r.total_revenue - sub);
        const newRoas = r.spend_with_fee > 0 ? newRev / r.spend_with_fee : 0;
        return { ...r, total_revenue: newRev, true_roas: newRoas };
      });
    }

    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error('Historical error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
