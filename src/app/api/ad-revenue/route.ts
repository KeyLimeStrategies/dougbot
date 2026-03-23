import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request: NextRequest) {
  const db = getDb();
  const adName = request.nextUrl.searchParams.get('ad_name');
  const days = parseInt(request.nextUrl.searchParams.get('days') || '14', 10);

  if (!adName) {
    return NextResponse.json({ error: 'ad_name required' }, { status: 400 });
  }

  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const cutoff = new Date(nowET);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  // Daily spend for this ad
  const spendData = db.prepare(`
    SELECT date, spend, results, frequency
    FROM ad_spend
    WHERE ad_name = ? AND date >= ?
    ORDER BY date ASC
  `).all(adName, cutoffStr) as { date: string; spend: number; results: number; frequency: number }[];

  // Daily revenue for this ad (by refcode matching)
  const revenueData = db.prepare(`
    SELECT date, SUM(amount) as revenue, COUNT(*) as contributions
    FROM revenue
    WHERE refcode = ? AND date >= ? AND fundraising_page LIKE '%fbig%'
    GROUP BY date
    ORDER BY date ASC
  `).all(adName, cutoffStr) as { date: string; revenue: number; contributions: number }[];

  const revenueMap = new Map(revenueData.map(r => [r.date, r]));

  // Merge into daily series
  const daily = spendData.map(d => ({
    date: d.date,
    spend: d.spend,
    revenue: revenueMap.get(d.date)?.revenue || 0,
    results: d.results,
    contributions: revenueMap.get(d.date)?.contributions || 0,
    frequency: d.frequency,
  }));

  return NextResponse.json({ ad_name: adName, daily });
}
