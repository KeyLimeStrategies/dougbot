import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// Anomaly detection:
// A contribution is flagged as anomalous if BOTH:
//   1. It's >= MULTIPLIER x the client's 90-day median fbig contribution
//   2. It's >= ABSOLUTE_FLOOR dollars
// Median-based approach is robust to outliers (unlike mean +/- stddev).
// Political fundraising has skewed distributions; median is the right central tendency.

const MULTIPLIER = 10;
const ABSOLUTE_FLOOR = 250;

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const days = parseInt(request.nextUrl.searchParams.get('days') || '30', 10);

    // Use Eastern Time for date boundaries
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const cutoff = new Date(nowET);
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    // Baseline cutoff for computing each client's median (90 days back, ending at anomaly window start)
    const baselineStart = new Date(cutoff);
    baselineStart.setDate(baselineStart.getDate() - 90);
    const baselineStartStr = baselineStart.toISOString().split('T')[0];

    // Compute per-client median of fbig contributions over the baseline window
    // SQLite has no built-in median, so we compute it in JS
    const perClientAmounts = db.prepare(`
      SELECT c.short_code, c.name as client_name, r.amount
      FROM revenue r
      JOIN clients c ON c.id = r.client_id
      WHERE r.fundraising_page LIKE '%fbig%'
        AND r.refunded = 0
        AND r.date >= ? AND r.date < ?
        AND c.active = 1 AND c.is_ad_client = 1
      ORDER BY c.short_code, r.amount
    `).all(baselineStartStr, cutoffStr) as { short_code: string; client_name: string; amount: number }[];

    const medianByClient = new Map<string, number>();
    const currentCode: { code: string; amounts: number[] } = { code: '', amounts: [] };
    const flushMedian = () => {
      if (currentCode.amounts.length > 0) {
        const sorted = currentCode.amounts; // already sorted by SQL
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
        medianByClient.set(currentCode.code, median);
      }
    };
    for (const row of perClientAmounts) {
      if (row.short_code !== currentCode.code) {
        flushMedian();
        currentCode.code = row.short_code;
        currentCode.amounts = [];
      }
      currentCode.amounts.push(row.amount);
    }
    flushMedian();

    // Find anomalous contributions in the analysis window
    const candidates = db.prepare(`
      SELECT r.id, r.date, c.short_code, c.name as client_name,
             r.amount, r.donor_name, r.fundraising_page, r.refcode
      FROM revenue r
      JOIN clients c ON c.id = r.client_id
      WHERE r.fundraising_page LIKE '%fbig%'
        AND r.refunded = 0
        AND r.date >= ?
        AND c.active = 1 AND c.is_ad_client = 1
        AND r.amount >= ?
      ORDER BY r.date DESC, r.amount DESC
    `).all(cutoffStr, ABSOLUTE_FLOOR) as {
      id: number; date: string; short_code: string; client_name: string;
      amount: number; donor_name: string; fundraising_page: string; refcode: string;
    }[];

    const anomalies = candidates
      .map(c => {
        const median = medianByClient.get(c.short_code) || 0;
        const threshold = median > 0 ? median * MULTIPLIER : ABSOLUTE_FLOOR;
        const isAnomaly = c.amount >= threshold && c.amount >= ABSOLUTE_FLOOR;
        return isAnomaly ? {
          date: c.date,
          short_code: c.short_code,
          client_name: c.client_name,
          amount: c.amount,
          donor_name: c.donor_name,
          refcode: c.refcode,
          client_median: median,
          multiple: median > 0 ? +(c.amount / median).toFixed(1) : null,
        } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    // Aggregate per (date, client) for the chart markers
    const byDateClient = new Map<string, { date: string; short_code: string; client_name: string; total: number; count: number }>();
    for (const a of anomalies) {
      const key = `${a.date}|${a.short_code}`;
      if (!byDateClient.has(key)) {
        byDateClient.set(key, {
          date: a.date,
          short_code: a.short_code,
          client_name: a.client_name,
          total: 0,
          count: 0,
        });
      }
      const agg = byDateClient.get(key)!;
      agg.total += a.amount;
      agg.count += 1;
    }

    return NextResponse.json({
      anomalies,
      aggregated: Array.from(byDateClient.values()),
      thresholds: Object.fromEntries(
        Array.from(medianByClient.entries()).map(([code, med]) => [code, {
          median: med,
          threshold: Math.max(med * MULTIPLIER, ABSOLUTE_FLOOR),
        }])
      ),
      config: { multiplier: MULTIPLIER, floor: ABSOLUTE_FLOOR, baseline_days: 90 },
    });
  } catch (error) {
    console.error('Anomalies error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
