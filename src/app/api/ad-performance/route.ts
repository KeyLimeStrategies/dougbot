import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { AdPerformance, CampaignPerformance } from '@/lib/types';

const CAMPAIGN_TYPE_LABELS: Record<string, string> = {
  val: 'Value',
  cap: 'CostCap',
  num: 'Number',
  abx20: 'ABX',
};

function campaignLabel(clientName: string, campaignType: string): string {
  const typeLabel = CAMPAIGN_TYPE_LABELS[campaignType] || campaignType;
  return `${clientName} ${typeLabel}`;
}

function campaignKey(shortCode: string, campaignType: string): string {
  return `${shortCode}:${campaignType}`;
}

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const searchParams = request.nextUrl.searchParams;
    const clientFilter = searchParams.get('client');

    let clientWhere = '';
    const params: string[] = [];
    if (clientFilter) {
      clientWhere = 'AND c.short_code = ?';
      params.push(clientFilter);
    }

    // --- INDIVIDUAL AD DATA (for KILL recommendations) ---
    const ads = db.prepare(`
      SELECT
        a.ad_name,
        c.name as client_name,
        c.short_code,
        c.fee_rate,
        a.campaign_type,
        a.batch,
        a.ad_delivery,
        a.attribution_setting,
        SUM(a.spend) as total_spend,
        SUM(CASE WHEN a.date >= date('now', '-3 days') THEN a.spend ELSE 0 END) as spend_3d,
        SUM(a.results) as total_results,
        SUM(CASE WHEN a.date >= date('now', '-3 days') THEN a.results ELSE 0 END) as results_3d,
        MAX(a.frequency) as frequency,
        MIN(a.date) as first_seen,
        MAX(a.date) as last_seen,
        COUNT(DISTINCT a.date) as days_with_data,
        SUM(CASE WHEN a.date >= date('now', '-1 days') THEN a.spend ELSE 0 END) as spend_24h,
        SUM(CASE WHEN a.date >= date('now', '-2 days') AND a.date < date('now', '-1 days') THEN a.spend ELSE 0 END) as spend_prev_24h,
        SUM(CASE WHEN a.date >= date('now', '-1 days') THEN a.results ELSE 0 END) as results_24h,
        SUM(CASE WHEN a.date >= date('now', '-2 days') AND a.date < date('now', '-1 days') THEN a.results ELSE 0 END) as results_prev_24h
      FROM ad_spend a
      JOIN clients c ON c.id = a.client_id
      WHERE c.active = 1 ${clientWhere}
      GROUP BY a.ad_name, c.name, c.short_code, c.fee_rate, a.campaign_type, a.batch, a.ad_delivery, a.attribution_setting
      ORDER BY total_spend DESC
    `).all(...params) as (AdPerformance & { fee_rate: number; first_seen: string; last_seen: string; days_with_data: number; spend_24h: number; spend_prev_24h: number; results_24h: number; results_prev_24h: number })[];

    // Get ActBlue revenue per refcode (ad name) for KILL decisions
    const revenueRows = db.prepare(`
      SELECT
        r.refcode,
        SUM(r.amount) as total_revenue,
        SUM(CASE WHEN r.date >= date('now', '-3 days') THEN r.amount ELSE 0 END) as revenue_72h,
        SUM(CASE WHEN r.date >= date('now', '-1 days') THEN r.amount ELSE 0 END) as revenue_24h,
        SUM(CASE WHEN r.date >= date('now', '-2 days') AND r.date < date('now', '-1 days') THEN r.amount ELSE 0 END) as revenue_prev_24h
      FROM revenue r
      JOIN clients c ON c.id = r.client_id
      WHERE r.refcode IS NOT NULL AND r.refcode != '' AND c.active = 1
        AND r.fundraising_page LIKE '%fbig%' ${clientWhere}
      GROUP BY r.refcode
    `).all(...params) as { refcode: string; total_revenue: number; revenue_72h: number; revenue_24h: number; revenue_prev_24h: number }[];

    const revenueMap = new Map<string, { total_revenue: number; revenue_72h: number; revenue_24h: number; revenue_prev_24h: number }>();
    for (const r of revenueRows) {
      revenueMap.set(r.refcode, { total_revenue: r.total_revenue, revenue_72h: r.revenue_72h, revenue_24h: r.revenue_24h, revenue_prev_24h: r.revenue_prev_24h });
    }

    // Apply KILL logic at individual ad level (using ActBlue revenue as ground truth)
    const adResults: AdPerformance[] = ads.map(ad => {
      const adExt = ad as AdPerformance & { fee_rate: number; first_seen: string; last_seen: string; days_with_data: number; spend_24h: number; spend_prev_24h: number; results_24h: number; results_prev_24h: number };
      const rev = revenueMap.get(ad.ad_name);
      const actblueRevenue = rev?.total_revenue ?? 0;
      const feeRate = adExt.fee_rate ?? 0.10;
      const spendWithFee = ad.total_spend + (ad.total_spend * feeRate);

      // Ad is "new" if first_seen is within the last 72 hours (calendar time)
      const firstSeenDate = new Date(adExt.first_seen + 'T00:00:00');
      const ageMs = Date.now() - firstSeenDate.getTime();
      const ageHours = ageMs / (1000 * 60 * 60);
      const isNewAd = ageHours < 72;

      // Check if ad is already inactive in Meta
      const isInactive = ad.ad_delivery && ad.ad_delivery.toLowerCase() !== 'active';

      // ROI calculation
      const hasActBlueData = actblueRevenue > 0;
      const adRoi = spendWithFee > 0 ? actblueRevenue / spendWithFee : 0;
      const cpp = ad.total_results > 0 ? ad.total_spend / ad.total_results : Infinity;
      const cpp3d = ad.results_3d > 0 ? ad.spend_3d / ad.results_3d : Infinity;

      // 24h trend: compare last 24h ROI vs previous 24h ROI
      // Use CPP as a proxy when revenue data is sparse
      const rev24h = rev?.revenue_24h ?? 0;
      const revPrev24h = rev?.revenue_prev_24h ?? 0;
      const spend24hWithFee = adExt.spend_24h + (adExt.spend_24h * feeRate);
      const spendPrev24hWithFee = adExt.spend_prev_24h + (adExt.spend_prev_24h * feeRate);
      const roi24h = spend24hWithFee > 0 ? rev24h / spend24hWithFee : 0;
      const roiPrev24h = spendPrev24hWithFee > 0 ? revPrev24h / spendPrev24hWithFee : 0;

      let trend: AdPerformance['trend'] = 'flat';
      if (isNewAd) {
        trend = 'new';
      } else if (adExt.spend_24h > 0 && adExt.spend_prev_24h > 0) {
        // Compare using ROI if we have revenue, otherwise use CPP
        if (rev24h > 0 || revPrev24h > 0) {
          if (roi24h > roiPrev24h * 1.1) trend = 'up';
          else if (roi24h < roiPrev24h * 0.9) trend = 'down';
        } else {
          // No revenue: compare results per dollar
          const eff24h = adExt.spend_24h > 0 ? adExt.results_24h / adExt.spend_24h : 0;
          const effPrev = adExt.spend_prev_24h > 0 ? adExt.results_prev_24h / adExt.spend_prev_24h : 0;
          if (eff24h > effPrev * 1.1) trend = 'up';
          else if (eff24h < effPrev * 0.9) trend = 'down';
        }
      }

      let recommendation: AdPerformance['recommendation'] = 'OK';
      let kill_reason: string | undefined;

      // Skip KILL logic for inactive ads (already off) and new ads (learning phase)
      if (!isInactive && !isNewAd) {
        // Zero results from both Meta AND ActBlue
        if (ad.total_spend > 50 && ad.total_results === 0 && !hasActBlueData) {
          recommendation = 'KILL';
          kill_reason = `$${ad.total_spend.toFixed(0)} spent, 0 results (Meta + ActBlue)`;
        }
        // Has ActBlue data: use ROI as the real measure
        else if (hasActBlueData && adRoi < 0.5 && ad.total_spend > 50) {
          recommendation = 'KILL';
          kill_reason = `ROI ${adRoi.toFixed(2)}x on $${ad.total_spend.toFixed(0)} spend`;
        }
        // No ActBlue data but Meta shows expensive conversions
        else if (!hasActBlueData && ad.total_results >= 3 && cpp > 40) {
          recommendation = 'KILL';
          kill_reason = `CPP $${cpp.toFixed(2)} (Meta), no ActBlue revenue`;
        }
        // Frequency too high (audience exhaustion)
        else if (ad.frequency > 2.0) {
          recommendation = 'KILL';
          kill_reason = `Frequency ${ad.frequency.toFixed(2)} (>2.0)`;
        }
      }

      return {
        ad_name: ad.ad_name,
        client_name: ad.client_name,
        short_code: ad.short_code,
        campaign_type: ad.campaign_type,
        batch: ad.batch,
        ad_delivery: ad.ad_delivery,
        attribution_setting: ad.attribution_setting,
        total_spend: ad.total_spend,
        spend_3d: ad.spend_3d,
        total_results: ad.total_results,
        results_3d: ad.results_3d,
        cpp: cpp === Infinity ? 0 : cpp,
        cpp_3d: cpp3d === Infinity ? 0 : cpp3d,
        frequency: ad.frequency,
        actblue_revenue: actblueRevenue,
        roi: adRoi,
        first_seen: adExt.first_seen,
        is_new: isNewAd,
        trend,
        recommendation,
        kill_reason,
      };
    });

    // --- CAMPAIGN-LEVEL DATA (grouped by client + campaign_type) ---
    const spendRows = db.prepare(`
      SELECT
        a.ad_name,
        c.name as client_name,
        c.short_code,
        c.fee_rate,
        a.campaign_type,
        SUM(a.spend) as total_spend,
        SUM(CASE WHEN a.date >= date('now', '-3 days') THEN a.spend ELSE 0 END) as spend_72h,
        SUM(a.results) as total_results,
        SUM(CASE WHEN a.date >= date('now', '-3 days') THEN a.results ELSE 0 END) as results_72h
      FROM ad_spend a
      JOIN clients c ON c.id = a.client_id
      WHERE c.active = 1 ${clientWhere}
      GROUP BY a.ad_name, c.name, c.short_code, c.fee_rate, a.campaign_type
    `).all(...params) as { ad_name: string; client_name: string; short_code: string; fee_rate: number; campaign_type: string; total_spend: number; spend_72h: number; total_results: number; results_72h: number }[];

    // Aggregate by client + campaign_type (= Meta campaign)
    // (revenueMap already built above for KILL logic)
    const campaignMap = new Map<string, {
      client_name: string;
      short_code: string;
      campaign_type: string;
      fee_rate: number;
      ads: string[];
      total_spend: number;
      spend_72h: number;
      total_revenue: number;
      revenue_72h: number;
      total_results: number;
      results_72h: number;
    }>();

    for (const row of spendRows) {
      const key = campaignKey(row.short_code, row.campaign_type);
      if (!campaignMap.has(key)) {
        campaignMap.set(key, {
          client_name: row.client_name,
          short_code: row.short_code,
          campaign_type: row.campaign_type,
          fee_rate: row.fee_rate ?? 0.10,
          ads: [],
          total_spend: 0,
          spend_72h: 0,
          total_revenue: 0,
          revenue_72h: 0,
          total_results: 0,
          results_72h: 0,
        });
      }
      const c = campaignMap.get(key)!;
      c.ads.push(row.ad_name);
      c.total_spend += row.total_spend;
      c.spend_72h += row.spend_72h;
      c.total_results += row.total_results;
      c.results_72h += row.results_72h;

      const rev = revenueMap.get(row.ad_name);
      if (rev) {
        c.total_revenue += rev.total_revenue;
        c.revenue_72h += rev.revenue_72h;
      }
    }

    // Portfolio-wide average CPP for comparison
    let portfolioResults72h = 0;
    let portfolioSpend72h = 0;
    for (const c of campaignMap.values()) {
      portfolioResults72h += c.results_72h;
      portfolioSpend72h += c.spend_72h;
    }
    const avgCppPortfolio = portfolioResults72h > 0 ? portfolioSpend72h / portfolioResults72h : 0;

    // Build campaign recommendations
    const campaigns: CampaignPerformance[] = [];
    for (const [, c] of campaignMap.entries()) {
      const feeRate = c.fee_rate;
      const spendWithFee72h = c.spend_72h + (c.spend_72h * feeRate);
      const roi72h = spendWithFee72h > 0 ? c.revenue_72h / spendWithFee72h : 0;
      const cpp72h = c.results_72h > 0 ? c.spend_72h / c.results_72h : 0;
      const label = campaignLabel(c.client_name, c.campaign_type);

      let recommendation: CampaignPerformance['recommendation'] = 'HOLD';
      let reason = '';

      // Need minimum spend to evaluate
      if (c.spend_72h >= 20) {
        if (roi72h >= 1.3) {
          recommendation = 'SCALE';
          reason = `72h ROI ${roi72h.toFixed(2)}x (>= 1.3)`;
        } else if (roi72h >= 1.0 && cpp72h > 0 && avgCppPortfolio > 0 && cpp72h < avgCppPortfolio * 0.8) {
          recommendation = 'SCALE';
          reason = `72h CPP $${cpp72h.toFixed(2)} (${((1 - cpp72h / avgCppPortfolio) * 100).toFixed(0)}% below avg $${avgCppPortfolio.toFixed(2)})`;
        } else if (c.revenue_72h > 0 && roi72h < 1.0) {
          recommendation = 'DROP';
          reason = `72h ROI ${roi72h.toFixed(2)}x (< 1.0)`;
        } else if (cpp72h > 0 && avgCppPortfolio > 0 && cpp72h > avgCppPortfolio * 1.5) {
          recommendation = 'DROP';
          reason = `72h CPP $${cpp72h.toFixed(2)} (${((cpp72h / avgCppPortfolio - 1) * 100).toFixed(0)}% above avg $${avgCppPortfolio.toFixed(2)})`;
        } else if (c.results_72h === 0 && c.spend_72h > 50) {
          recommendation = 'DROP';
          reason = `$${c.spend_72h.toFixed(0)} spent in 72h, 0 results`;
        }
      }

      campaigns.push({
        campaign: label,
        client_name: c.client_name,
        short_code: c.short_code,
        ad_count: c.ads.length,
        total_spend: c.total_spend,
        spend_72h: c.spend_72h,
        total_revenue: c.total_revenue,
        revenue_72h: c.revenue_72h,
        total_results: c.total_results,
        results_72h: c.results_72h,
        roi_72h: roi72h,
        cpp_72h: cpp72h,
        avg_cpp_portfolio: avgCppPortfolio,
        recommendation,
        reason,
        ads: c.ads,
      });
    }

    // Sort: SCALE first, then DROP, then HOLD
    const recOrder = { SCALE: 0, DROP: 1, HOLD: 2 };
    campaigns.sort((a, b) => recOrder[a.recommendation] - recOrder[b.recommendation] || b.spend_72h - a.spend_72h);

    const summary = {
      total_ads: adResults.length,
      total_campaigns: campaigns.length,
      kill_count: adResults.filter(r => r.recommendation === 'KILL').length,
      scale_count: campaigns.filter(r => r.recommendation === 'SCALE').length,
      drop_count: campaigns.filter(r => r.recommendation === 'DROP').length,
      hold_count: campaigns.filter(r => r.recommendation === 'HOLD').length,
      total_wasted_spend: adResults.filter(r => r.recommendation === 'KILL' && r.actblue_revenue === 0).reduce((s, r) => s + r.total_spend, 0),
    };

    return NextResponse.json({ ads: adResults, campaigns, summary });
  } catch (error) {
    console.error('Ad performance error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
