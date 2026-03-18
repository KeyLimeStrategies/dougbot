import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { api_key } = body;

    if (!api_key) {
      return NextResponse.json(
        { success: false, error: 'Claude API key is required' },
        { status: 400 }
      );
    }

    const db = getDb();

    // Gather portfolio data for Claude to analyze
    const latestDate = db.prepare(
      "SELECT MAX(date) as d FROM daily_summary"
    ).get() as { d: string } | undefined;

    if (!latestDate?.d) {
      return NextResponse.json(
        { success: false, error: 'No data available to analyze' },
        { status: 400 }
      );
    }

    // Daily summaries for last 7 days
    const summaries = db.prepare(`
      SELECT ds.date, c.name, c.short_code,
        ds.total_spend, ds.total_revenue, ds.spend_with_fee,
        ds.true_roas, ds.profit, ds.keylime_cut
      FROM daily_summary ds
      JOIN clients c ON c.id = ds.client_id
      WHERE ds.date >= date(?, '-7 days') AND c.active = 1
        AND (ds.total_spend > 0 OR ds.total_revenue > 0)
      ORDER BY ds.date DESC, ds.total_spend DESC
    `).all(latestDate.d) as { date: string; name: string; short_code: string; total_spend: number; total_revenue: number; spend_with_fee: number; true_roas: number; profit: number; keylime_cut: number }[];

    // Ad-level performance with ActBlue revenue
    const adData = db.prepare(`
      SELECT
        a.ad_name, c.name as client_name, c.short_code, c.fee_rate,
        a.campaign_type,
        SUM(a.spend) as total_spend,
        SUM(CASE WHEN a.date >= date(?, '-3 days') THEN a.spend ELSE 0 END) as spend_3d,
        SUM(CASE WHEN a.date >= date(?, '-1 days') THEN a.spend ELSE 0 END) as spend_24h,
        SUM(a.results) as total_results,
        SUM(CASE WHEN a.date >= date(?, '-3 days') THEN a.results ELSE 0 END) as results_3d,
        MAX(a.frequency) as frequency,
        MIN(a.date) as first_seen,
        COUNT(DISTINCT a.date) as days_with_data
      FROM ad_spend a
      JOIN clients c ON c.id = a.client_id
      WHERE c.active = 1
      GROUP BY a.ad_name, c.name, c.short_code, c.fee_rate, a.campaign_type
      HAVING total_spend > 5
      ORDER BY spend_3d DESC
      LIMIT 100
    `).all(latestDate.d, latestDate.d, latestDate.d) as { ad_name: string; client_name: string; short_code: string; fee_rate: number; campaign_type: string; total_spend: number; spend_3d: number; spend_24h: number; total_results: number; results_3d: number; frequency: number; first_seen: string; days_with_data: number }[];

    // Get ActBlue revenue per ad (fbig only)
    const revData = db.prepare(`
      SELECT r.refcode, SUM(r.amount) as total_revenue,
        SUM(CASE WHEN r.date >= date(?, '-3 days') THEN r.amount ELSE 0 END) as revenue_3d
      FROM revenue r
      JOIN clients c ON c.id = r.client_id
      WHERE r.refcode IS NOT NULL AND r.refcode != '' AND c.active = 1
        AND r.fundraising_page LIKE '%fbig%'
      GROUP BY r.refcode
    `).all(latestDate.d) as { refcode: string; total_revenue: number; revenue_3d: number }[];

    const revMap = new Map<string, { total_revenue: number; revenue_3d: number }>();
    for (const r of revData) {
      revMap.set(r.refcode, { total_revenue: r.total_revenue, revenue_3d: r.revenue_3d });
    }

    // Build ad summary with revenue
    const adSummary = adData.map(ad => {
      const rev = revMap.get(ad.ad_name);
      const abRev = rev?.total_revenue ?? 0;
      const feeRate = ad.fee_rate ?? 0.10;
      const spendWithFee = ad.total_spend + (ad.total_spend * feeRate);
      const roi = spendWithFee > 0 ? abRev / spendWithFee : 0;
      const isNew = ad.days_with_data < 3;
      return `${ad.ad_name} | ${ad.client_name} ${ad.campaign_type} | Spend: $${ad.total_spend.toFixed(0)} (3d: $${ad.spend_3d.toFixed(0)}) | AB Rev: $${abRev.toFixed(0)} | ROI: ${roi.toFixed(2)}x | Results: ${ad.total_results} (3d: ${ad.results_3d}) | CPP: ${ad.total_results > 0 ? '$' + (ad.total_spend / ad.total_results).toFixed(2) : 'N/A'} | Freq: ${ad.frequency.toFixed(2)} | First: ${ad.first_seen}${isNew ? ' [NEW]' : ''}`;
    }).join('\n');

    // Build daily summary
    const dailySummary = summaries.map(s =>
      `${s.date} | ${s.name} | Spend: $${s.total_spend.toFixed(0)} | Rev: $${s.total_revenue.toFixed(0)} | ROAS: ${s.true_roas.toFixed(2)}x | Profit: $${s.profit.toFixed(0)} | KL Cut: $${s.keylime_cut.toFixed(0)}`
    ).join('\n');

    // Portfolio totals for latest day
    const todaySummaries = summaries.filter(s => s.date === latestDate.d);
    const totalSpend = todaySummaries.reduce((s, r) => s + r.total_spend, 0);
    const totalRev = todaySummaries.reduce((s, r) => s + r.total_revenue, 0);
    const totalProfit = todaySummaries.reduce((s, r) => s + r.profit, 0);

    const prompt = `You are a senior digital advertising analyst for Keylime Strategies, a Democratic political consulting firm that manages Meta (Facebook/Instagram) ad campaigns for congressional candidates.

Today's date: ${latestDate.d}
Portfolio overview for today: $${totalSpend.toFixed(0)} spent, $${totalRev.toFixed(0)} revenue, $${totalProfit.toFixed(0)} profit

BUSINESS RULES:
- True ROAS = ActBlue Revenue / (Meta Spend + Fee). Fee is typically 10% of spend.
- An ad is "new" if it has fewer than 3 days of data (learning phase, don't recommend killing)
- KILL criteria: >$50 spent + 0 results, OR ROI < 0.5x on $50+ spend, OR frequency > 2.0
- Revenue is only counted from ActBlue forms marked "fbig" (ad-attributed donations)
- Campaign types: val (Value), cap (CostCap), num (Number), abx20 (ABX)

DAILY SUMMARIES (last 7 days):
${dailySummary}

TOP ADS BY RECENT SPEND (with ActBlue revenue):
${adSummary}

Please analyze this data and provide a concise, actionable report answering:

1. **Top Performers & Problem Ads**: Which specific ads are doing particularly well or poorly? Call out any new ads showing early promise or concern.

2. **Immediate Actions**: What specific actions should be taken RIGHT NOW to improve portfolio ROI? Be concrete (e.g., "Kill mk5_2_1.val, $65 spent with $0 revenue" or "Scale br30_7_1.val, strong 3d performance").

3. **Portfolio Insights**: Any patterns, trends, or notable observations about the overall portfolio performance today vs recent days.

Keep the response direct and practical. No fluff. Use the actual ad names and numbers.`;

    // Call Claude API
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': api_key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      return NextResponse.json(
        { success: false, error: `Claude API error (${claudeRes.status}): ${errText}` },
        { status: 400 }
      );
    }

    const claudeData = await claudeRes.json();
    const report = claudeData.content?.[0]?.text || 'No response generated';

    return NextResponse.json({
      success: true,
      report,
      date: latestDate.d,
      portfolio: {
        spend: totalSpend,
        revenue: totalRev,
        profit: totalProfit,
        clients: todaySummaries.length,
      },
    });
  } catch (error) {
    console.error('Insights error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to generate insights' },
      { status: 500 }
    );
  }
}
