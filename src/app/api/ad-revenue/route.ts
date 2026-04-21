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
    SELECT date, spend, results, frequency, impressions, video_3s_views, video_thruplays
    FROM ad_spend
    WHERE ad_name = ? AND date >= ?
    ORDER BY date ASC
  `).all(adName, cutoffStr) as { date: string; spend: number; results: number; frequency: number; impressions: number; video_3s_views: number; video_thruplays: number }[];

  // Aggregate hook rate + retention rate over the window
  let totalImpressions = 0, total3s = 0, totalThru = 0;
  for (const d of spendData) {
    totalImpressions += d.impressions || 0;
    total3s += d.video_3s_views || 0;
    totalThru += d.video_thruplays || 0;
  }
  const hookRate = totalImpressions > 0 ? total3s / totalImpressions : 0;
  const retentionRate = total3s > 0 ? totalThru / total3s : 0;
  const hasVideoData = total3s > 0;

  // Daily revenue for this ad (by refcode matching)
  const revenueData = db.prepare(`
    SELECT date, SUM(amount) as revenue, COUNT(*) as contributions
    FROM revenue
    WHERE refcode = ? AND date >= ? AND fundraising_page LIKE '%fbig%' AND refunded = 0
    GROUP BY date
    ORDER BY date ASC
  `).all(adName, cutoffStr) as { date: string; revenue: number; contributions: number }[];

  const revenueMap = new Map(revenueData.map(r => [r.date, r]));

  // Get fee rate for this ad's client
  const clientRow = db.prepare(`
    SELECT c.fee_rate FROM ad_spend a
    JOIN clients c ON c.id = a.client_id
    WHERE a.ad_name = ? LIMIT 1
  `).get(adName) as { fee_rate: number } | undefined;
  const feeRate = clientRow?.fee_rate ?? 0.10;

  // Merge into daily series with ROI
  const daily = spendData.map(d => {
    const rev = revenueMap.get(d.date)?.revenue || 0;
    const spendWithFee = d.spend + (d.spend * feeRate);
    const roi = spendWithFee > 0 ? rev / spendWithFee : 0;
    return {
      date: d.date,
      spend: d.spend,
      revenue: rev,
      roi: Math.round(roi * 100) / 100,
      results: d.results,
      contributions: revenueMap.get(d.date)?.contributions || 0,
      frequency: d.frequency,
    };
  });

  return NextResponse.json({
    ad_name: adName,
    daily,
    video: {
      has_data: hasVideoData,
      hook_rate: hookRate,
      retention_rate: retentionRate,
      impressions: totalImpressions,
      views_3s: total3s,
      thruplays: totalThru,
    },
  });
}
