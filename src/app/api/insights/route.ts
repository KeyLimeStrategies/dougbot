import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

const CAMPAIGN_TYPE_LABELS: Record<string, string> = {
  val: 'Value', cap: 'CostCap', num: 'Number', abx20: 'ABX',
};

export async function POST(request: NextRequest) {
  try {
    const api_key = process.env.CLAUDE_API_KEY;

    if (!api_key) {
      return NextResponse.json(
        { success: false, error: 'Claude API key not configured. Add CLAUDE_API_KEY to Railway environment variables.' },
        { status: 400 }
      );
    }

    const db = getDb();

    const latestDate = db.prepare(
      "SELECT MAX(date) as d FROM daily_summary"
    ).get() as { d: string } | undefined;

    if (!latestDate?.d) {
      return NextResponse.json(
        { success: false, error: 'No data available to analyze' },
        { status: 400 }
      );
    }

    // === CLIENT DAILY SUMMARIES (last 7 days) ===
    const summaries = db.prepare(`
      SELECT ds.date, c.name, c.short_code,
        ds.total_spend, ds.total_revenue, ds.spend_with_fee,
        ds.true_roas, ds.profit, ds.keylime_cut
      FROM daily_summary ds
      JOIN clients c ON c.id = ds.client_id
      WHERE ds.date >= date(?, '-7 days') AND c.active = 1 AND c.is_ad_client = 1
        AND (ds.total_spend > 0 OR ds.total_revenue > 0)
      ORDER BY ds.date DESC, ds.total_spend DESC
    `).all(latestDate.d) as { date: string; name: string; short_code: string; total_spend: number; total_revenue: number; spend_with_fee: number; true_roas: number; profit: number; keylime_cut: number }[];

    // === AD-LEVEL DATA ===
    const adData = db.prepare(`
      SELECT
        a.ad_name, c.name as client_name, c.short_code, c.fee_rate,
        a.campaign_type,
        SUM(a.spend) as total_spend,
        SUM(CASE WHEN a.date >= date(?, '-3 days') THEN a.spend ELSE 0 END) as spend_3d,
        SUM(a.results) as total_results,
        SUM(CASE WHEN a.date >= date(?, '-3 days') THEN a.results ELSE 0 END) as results_3d,
        MAX(a.frequency) as frequency,
        MIN(a.date) as first_seen
      FROM ad_spend a
      JOIN clients c ON c.id = a.client_id
      WHERE c.active = 1 AND c.is_ad_client = 1
      GROUP BY a.ad_name, c.name, c.short_code, c.fee_rate, a.campaign_type
      HAVING total_spend > 5
      ORDER BY spend_3d DESC
      LIMIT 150
    `).all(latestDate.d, latestDate.d) as { ad_name: string; client_name: string; short_code: string; fee_rate: number; campaign_type: string; total_spend: number; spend_3d: number; total_results: number; results_3d: number; frequency: number; first_seen: string }[];

    // === ACTBLUE REVENUE PER AD (fbig only) ===
    const revData = db.prepare(`
      SELECT r.refcode, SUM(r.amount) as total_revenue,
        SUM(CASE WHEN r.date >= date(?, '-3 days') THEN r.amount ELSE 0 END) as revenue_3d
      FROM revenue r
      JOIN clients c ON c.id = r.client_id
      WHERE r.refcode IS NOT NULL AND r.refcode != '' AND c.active = 1 AND c.is_ad_client = 1
        AND r.fundraising_page LIKE '%fbig%'
      GROUP BY r.refcode
    `).all(latestDate.d) as { refcode: string; total_revenue: number; revenue_3d: number }[];

    const revMap = new Map<string, { total_revenue: number; revenue_3d: number }>();
    for (const r of revData) {
      revMap.set(r.refcode, { total_revenue: r.total_revenue, revenue_3d: r.revenue_3d });
    }

    // === CAMPAIGN-LEVEL AGGREGATION ===
    const campaignMap = new Map<string, {
      label: string; client_name: string; short_code: string; campaign_type: string;
      fee_rate: number; ads: string[]; total_spend: number; spend_72h: number;
      total_revenue: number; revenue_72h: number; total_results: number; results_72h: number;
    }>();

    for (const ad of adData) {
      const key = `${ad.short_code}:${ad.campaign_type}`;
      if (!campaignMap.has(key)) {
        const typeLabel = CAMPAIGN_TYPE_LABELS[ad.campaign_type] || ad.campaign_type;
        campaignMap.set(key, {
          label: `${ad.client_name} ${typeLabel}`,
          client_name: ad.client_name, short_code: ad.short_code,
          campaign_type: ad.campaign_type, fee_rate: ad.fee_rate ?? 0.10,
          ads: [], total_spend: 0, spend_72h: 0,
          total_revenue: 0, revenue_72h: 0, total_results: 0, results_72h: 0,
        });
      }
      const c = campaignMap.get(key)!;
      c.ads.push(ad.ad_name);
      c.total_spend += ad.total_spend;
      c.spend_72h += ad.spend_3d;
      c.total_results += ad.total_results;
      c.results_72h += ad.results_3d;
      const rev = revMap.get(ad.ad_name);
      if (rev) {
        c.total_revenue += rev.total_revenue;
        c.revenue_72h += rev.revenue_3d;
      }
    }

    // Portfolio-wide CPP for comparison
    let portfolioResults72h = 0, portfolioSpend72h = 0;
    for (const c of campaignMap.values()) {
      portfolioResults72h += c.results_72h;
      portfolioSpend72h += c.spend_72h;
    }
    const avgCpp = portfolioResults72h > 0 ? portfolioSpend72h / portfolioResults72h : 0;

    // Build campaign summaries with recommendations
    const campaignLines: string[] = [];
    for (const [, c] of campaignMap.entries()) {
      const spendWithFee72h = c.spend_72h + (c.spend_72h * c.fee_rate);
      const roi72h = spendWithFee72h > 0 ? c.revenue_72h / spendWithFee72h : 0;
      const cpp72h = c.results_72h > 0 ? c.spend_72h / c.results_72h : 0;
      const totalSpendWithFee = c.total_spend + (c.total_spend * c.fee_rate);
      const totalRoi = totalSpendWithFee > 0 ? c.total_revenue / totalSpendWithFee : 0;

      let rec = 'HOLD';
      let reason = 'Insufficient signal';
      if (c.spend_72h >= 20) {
        if (roi72h >= 1.3) { rec = 'SCALE'; reason = `72h ROI ${roi72h.toFixed(2)}x`; }
        else if (roi72h >= 1.0 && cpp72h > 0 && avgCpp > 0 && cpp72h < avgCpp * 0.8) { rec = 'SCALE'; reason = `CPP ${((1 - cpp72h / avgCpp) * 100).toFixed(0)}% below avg`; }
        else if (c.revenue_72h > 0 && roi72h < 1.0) { rec = 'DROP'; reason = `72h ROI ${roi72h.toFixed(2)}x`; }
        else if (cpp72h > 0 && avgCpp > 0 && cpp72h > avgCpp * 1.5) { rec = 'DROP'; reason = `CPP ${((cpp72h / avgCpp - 1) * 100).toFixed(0)}% above avg`; }
        else if (c.results_72h === 0 && c.spend_72h > 50) { rec = 'DROP'; reason = `$${c.spend_72h.toFixed(0)} spent, 0 results`; }
      }

      campaignLines.push(
        `${c.label} [${rec}] | ${c.ads.length} ads | Total: $${c.total_spend.toFixed(0)} spend, $${c.total_revenue.toFixed(0)} rev, ${totalRoi.toFixed(2)}x ROI | 72h: $${c.spend_72h.toFixed(0)} spend, $${c.revenue_72h.toFixed(0)} rev, ${roi72h.toFixed(2)}x ROI, CPP $${cpp72h > 0 ? cpp72h.toFixed(2) : 'N/A'} | Reason: ${reason}`
      );
    }

    // === CAMPAIGN DAILY TRENDS (spend + revenue per campaign per day, last 7 days) ===
    const campaignDailyData = db.prepare(`
      SELECT
        a.date,
        c.name || ' ' || CASE a.campaign_type
          WHEN 'val' THEN 'Value' WHEN 'cap' THEN 'CostCap'
          WHEN 'num' THEN 'Number' WHEN 'abx20' THEN 'ABX'
          ELSE a.campaign_type END as campaign,
        c.short_code, c.fee_rate, a.campaign_type,
        SUM(a.spend) as daily_spend,
        SUM(a.results) as daily_results
      FROM ad_spend a
      JOIN clients c ON c.id = a.client_id
      WHERE a.date >= date(?, '-7 days') AND c.active = 1 AND c.is_ad_client = 1
      GROUP BY a.date, c.short_code, a.campaign_type
      ORDER BY a.date DESC, daily_spend DESC
    `).all(latestDate.d) as { date: string; campaign: string; short_code: string; fee_rate: number; campaign_type: string; daily_spend: number; daily_results: number }[];

    // Get daily revenue per campaign (fbig only)
    const campaignDailyRev = db.prepare(`
      SELECT
        r.date,
        c.short_code,
        CASE
          WHEN LOWER(r.refcode) LIKE '%.val%' THEN 'val'
          WHEN LOWER(r.refcode) LIKE '%.cap%' THEN 'cap'
          WHEN LOWER(r.refcode) LIKE '%.abx20%' THEN 'abx20'
          WHEN LOWER(r.refcode) LIKE '%.num%' THEN 'num'
          ELSE 'val'
        END as campaign_type,
        SUM(r.amount) as daily_revenue
      FROM revenue r
      JOIN clients c ON c.id = r.client_id
      WHERE r.date >= date(?, '-7 days') AND c.active = 1 AND c.is_ad_client = 1
        AND r.fundraising_page LIKE '%fbig%'
        AND r.refcode IS NOT NULL AND r.refcode != ''
      GROUP BY r.date, c.short_code, campaign_type
    `).all(latestDate.d) as { date: string; short_code: string; campaign_type: string; daily_revenue: number }[];

    const dailyRevMap = new Map<string, number>();
    for (const r of campaignDailyRev) {
      dailyRevMap.set(`${r.date}|${r.short_code}:${r.campaign_type}`, r.daily_revenue);
    }

    const campaignTrendLines = campaignDailyData.map(d => {
      const rev = dailyRevMap.get(`${d.date}|${d.short_code}:${d.campaign_type}`) ?? 0;
      const feeRate = d.fee_rate ?? 0.10;
      const swf = d.daily_spend + (d.daily_spend * feeRate);
      const roi = swf > 0 ? rev / swf : 0;
      return `${d.date} | ${d.campaign} | Spend: $${d.daily_spend.toFixed(0)} | Rev: $${rev.toFixed(0)} | ROI: ${roi.toFixed(2)}x | Results: ${d.daily_results}`;
    }).join('\n');

    // Build ad summary with revenue
    const adSummary = adData.map(ad => {
      const rev = revMap.get(ad.ad_name);
      const abRev = rev?.total_revenue ?? 0;
      const feeRate = ad.fee_rate ?? 0.10;
      const spendWithFee = ad.total_spend + (ad.total_spend * feeRate);
      const roi = spendWithFee > 0 ? abRev / spendWithFee : 0;
      const firstSeen = new Date(ad.first_seen + 'T00:00:00');
      const ageHours = (Date.now() - firstSeen.getTime()) / (1000 * 60 * 60);
      const isNew = ageHours < 72;
      return `${ad.ad_name} | ${ad.client_name} ${ad.campaign_type} | Spend: $${ad.total_spend.toFixed(0)} (3d: $${ad.spend_3d.toFixed(0)}) | AB Rev: $${abRev.toFixed(0)} | ROI: ${roi.toFixed(2)}x | Results: ${ad.total_results} (3d: ${ad.results_3d}) | CPP: ${ad.total_results > 0 ? '$' + (ad.total_spend / ad.total_results).toFixed(2) : 'N/A'} | Freq: ${ad.frequency.toFixed(2)} | First: ${ad.first_seen}${isNew ? ' [NEW <72h]' : ''}`;
    }).join('\n');

    // Build client daily summary
    const dailySummary = summaries.map(s =>
      `${s.date} | ${s.name} | Spend: $${s.total_spend.toFixed(0)} | Rev: $${s.total_revenue.toFixed(0)} | ROAS: ${s.true_roas.toFixed(2)}x | Profit: $${s.profit.toFixed(0)} | KL Cut: $${s.keylime_cut.toFixed(0)}`
    ).join('\n');

    // Portfolio totals for latest day
    const todaySummaries = summaries.filter(s => s.date === latestDate.d);
    const totalSpend = todaySummaries.reduce((s, r) => s + r.total_spend, 0);
    const totalRev = todaySummaries.reduce((s, r) => s + r.total_revenue, 0);
    const totalProfit = todaySummaries.reduce((s, r) => s + r.profit, 0);

    const now = new Date();
    const currentTime = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
    const etHour = parseInt(now.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' }));
    const isToday = latestDate.d === now.toISOString().split('T')[0];
    const isEarlyInDay = isToday && etHour < 18; // before 6pm ET

    const prompt = `You are a senior digital advertising analyst for Keylime Strategies, a Democratic political consulting firm managing Meta (Facebook/Instagram) ad campaigns for congressional candidates.

Today's date: ${latestDate.d}, current time: ${currentTime} ET
${isEarlyInDay ? `NOTE: It is still early in the day. Today's (${latestDate.d}) numbers are INCOMPLETE. Do not draw conclusions from today's partial data. Focus your analysis on completed days (yesterday and prior) for reliable evaluation. You can reference today's numbers as directional context only.` : ''}
Portfolio overview for ${isEarlyInDay ? 'today (partial)' : 'latest day'}: $${totalSpend.toFixed(0)} spent, $${totalRev.toFixed(0)} revenue, $${totalProfit.toFixed(0)} profit
Portfolio avg CPP (72h): $${avgCpp.toFixed(2)}

BUSINESS RULES:
- True ROAS = ActBlue Revenue / (Meta Spend + Fee). Fee is typically 10% of spend (5% for Riker).
- A "campaign" = client + campaign type (e.g., "Kinter Value" = all mk*.val ads). This is what we scale/drop budgets on.
- Campaign types and how they work:
  * val (ValueOfConversions): Meta optimizes for highest value conversions. We set a daily budget. We can directly scale/drop budget.
  * cap (CostCap): We tell Meta the max we're willing to pay per conversion (cost cap). Meta decides whether/how much to spend. We CANNOT force Meta to spend more on CostCap. To "scale" a CostCap, we can raise the cost cap or increase the daily budget ceiling, but Meta may still not spend it. To "drop" a CostCap, we lower the cost cap or budget.
  * num (NumberOfConversions): Meta optimizes for maximum number of conversions. Budget directly controllable.
  * abx20 (ABX): Similar to Value, budget directly controllable.
- SCALE: increase campaign budget 20% when 72h ROI >= 1.3x or CPP 20%+ below portfolio avg
- DROP: decrease campaign budget 15% when 72h ROI < 1.0x or CPP 50%+ above avg
- For CostCap campaigns specifically: if ROI is strong but spend is low, recommend raising the cost cap slightly rather than budget. If ROI is poor, recommend lowering cost cap or pausing.
- KILL (ad-level): individual ads with >$50 spent + 0 results, OR ROI < 0.5x on $50+ spend, OR frequency > 2.0
- Ads under 72 hours old are in learning phase, do not recommend killing them
- Revenue only counted from ActBlue "fbig" forms (ad-attributed donations)
- No budget changes within 48hrs of last change

CAMPAIGN SUMMARIES WITH RECOMMENDATIONS (${campaignMap.size} campaigns):
${campaignLines.join('\n')}

CAMPAIGN DAILY TRENDS (last 7 days, spend/rev/ROI per campaign per day):
${campaignTrendLines}

CLIENT DAILY SUMMARIES (last 7 days):
${dailySummary}

TOP ADS BY RECENT SPEND (individual ad performance):
${adSummary}

Please analyze this data and provide a focused, actionable report. The goal is to get every client's ROAS to 1.3x or higher (the breakeven for Keylime profitability with 10% fee + 25% profit share).

1. **Goal Gap Analysis**: For each client, what is their current trajectory? How far are they from 1.3x? What specific changes would close the gap? Prioritize clients that are closest to 1.3x (easiest wins) and clients losing the most money (biggest urgency).

2. **Immediate Budget Actions**: Concrete campaign-level budget changes to make RIGHT NOW. For each recommendation, include the campaign name, current 72h performance, and specific budget action (SCALE 20% / DROP 15% / PAUSE). Calculate the expected impact on portfolio ROAS if these changes are made.

3. **Ad-Level Kills & Winners**: Which specific ads should be killed immediately (cite the kill rule they violate)? Which ads are carrying their campaigns and should be protected/duplicated?

4. **Portfolio Optimization Strategy**: What is the fastest path to getting the overall portfolio above 1.3x? Should budget be reallocated between clients? Between campaign types? What would you do with the next $100 of daily budget?

Be direct. Use actual names and numbers. Every recommendation should include expected ROI impact.`;

    // Call Claude API
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': api_key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-20250514',
        max_tokens: 4000,
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
