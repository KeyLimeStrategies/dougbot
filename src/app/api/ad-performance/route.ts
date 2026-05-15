import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { AdPerformance, ClientGroup } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const sp = request.nextUrl.searchParams;
    const clientFilter = sp.get('client');
    const customStart = sp.get('date_start');
    const customEnd = sp.get('date_end');

    // Eastern Time date boundaries
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dateSub = (d: number) => {
      const dt = new Date(nowET);
      dt.setDate(dt.getDate() - d);
      return dt.toISOString().split('T')[0];
    };
    const oneDayAgoET = dateSub(1);
    const twoDaysAgoET = dateSub(2);
    const threeDaysAgoET = dateSub(3);
    const sevenDaysAgoET = dateSub(7);
    const fourteenDaysAgoET = dateSub(14);

    let clientWhere = '';
    const filterParams: string[] = [];
    if (clientFilter) {
      clientWhere = 'AND c.short_code = ?';
      filterParams.push(clientFilter);
    }

    // Custom date range columns (optional)
    const hasCustom = !!(customStart && customEnd);
    const customCols = hasCustom ? `
        , SUM(CASE WHEN a.date >= ? AND a.date <= ? THEN a.spend ELSE 0 END) as spend_custom
        , SUM(CASE WHEN a.date >= ? AND a.date <= ? THEN a.results ELSE 0 END) as results_custom
        , SUM(CASE WHEN a.date >= ? AND a.date <= ? THEN a.link_clicks ELSE 0 END) as link_clicks_custom` : '';

    // Build parameter array in exact SQL placeholder order
    const adParams: (string | number)[] = [
      // spend windows: 1d, 3d, 7d, 14d
      oneDayAgoET, threeDaysAgoET, sevenDaysAgoET, fourteenDaysAgoET,
      // results windows: 1d, 3d, 7d, 14d
      oneDayAgoET, threeDaysAgoET, sevenDaysAgoET, fourteenDaysAgoET,
      // link_clicks windows: 1d, 3d, 7d, 14d
      oneDayAgoET, threeDaysAgoET, sevenDaysAgoET, fourteenDaysAgoET,
    ];
    if (hasCustom) {
      // 3 pairs for spend_custom, results_custom, link_clicks_custom
      adParams.push(customStart!, customEnd!, customStart!, customEnd!, customStart!, customEnd!);
    }
    // Trend params
    adParams.push(
      oneDayAgoET,                // spend_24h
      twoDaysAgoET, oneDayAgoET,  // spend_prev_24h
      oneDayAgoET,                // results_24h
      twoDaysAgoET, oneDayAgoET,  // results_prev_24h
    );
    adParams.push(...filterParams);

    // --- INDIVIDUAL AD DATA ---
    const ads = db.prepare(`
      SELECT
        a.ad_name,
        c.name as client_name,
        c.short_code,
        c.fee_rate,
        MAX(a.campaign_type) as campaign_type,
        MAX(a.batch) as batch,
        (SELECT sub.ad_delivery FROM ad_spend sub WHERE sub.ad_name = a.ad_name AND sub.ad_delivery IS NOT NULL AND sub.ad_delivery != '' ORDER BY sub.date DESC LIMIT 1) as ad_delivery,
        MAX(a.attribution_setting) as attribution_setting,
        SUM(a.spend) as total_spend,
        SUM(CASE WHEN a.date >= ? THEN a.spend ELSE 0 END) as spend_1d,
        SUM(CASE WHEN a.date >= ? THEN a.spend ELSE 0 END) as spend_3d,
        SUM(CASE WHEN a.date >= ? THEN a.spend ELSE 0 END) as spend_7d,
        SUM(CASE WHEN a.date >= ? THEN a.spend ELSE 0 END) as spend_14d,
        SUM(a.results) as total_results,
        SUM(CASE WHEN a.date >= ? THEN a.results ELSE 0 END) as results_1d,
        SUM(CASE WHEN a.date >= ? THEN a.results ELSE 0 END) as results_3d,
        SUM(CASE WHEN a.date >= ? THEN a.results ELSE 0 END) as results_7d,
        SUM(CASE WHEN a.date >= ? THEN a.results ELSE 0 END) as results_14d,
        SUM(a.link_clicks) as total_link_clicks,
        SUM(CASE WHEN a.date >= ? THEN a.link_clicks ELSE 0 END) as link_clicks_1d,
        SUM(CASE WHEN a.date >= ? THEN a.link_clicks ELSE 0 END) as link_clicks_3d,
        SUM(CASE WHEN a.date >= ? THEN a.link_clicks ELSE 0 END) as link_clicks_7d,
        SUM(CASE WHEN a.date >= ? THEN a.link_clicks ELSE 0 END) as link_clicks_14d
        ${customCols},
        MAX(a.frequency) as frequency,
        MIN(a.date) as first_seen,
        MAX(a.date) as last_seen,
        COUNT(DISTINCT a.date) as days_with_data,
        SUM(CASE WHEN a.date >= ? THEN a.spend ELSE 0 END) as spend_24h,
        SUM(CASE WHEN a.date >= ? AND a.date < ? THEN a.spend ELSE 0 END) as spend_prev_24h,
        SUM(CASE WHEN a.date >= ? THEN a.results ELSE 0 END) as results_24h,
        SUM(CASE WHEN a.date >= ? AND a.date < ? THEN a.results ELSE 0 END) as results_prev_24h
      FROM ad_spend a
      JOIN clients c ON c.id = a.client_id
      WHERE c.active = 1 AND c.is_ad_client = 1 ${clientWhere}
      GROUP BY a.ad_name, c.name, c.short_code, c.fee_rate
      ORDER BY total_spend DESC
    `).all(...adParams) as any[];

    // --- REVENUE DATA (per refcode/ad) ---
    const customRevCol = hasCustom
      ? `, SUM(CASE WHEN r.date >= ? AND r.date <= ? THEN r.amount ELSE 0 END) as revenue_custom`
      : '';

    const revParams: (string | number)[] = [
      oneDayAgoET,       // revenue_1d
      threeDaysAgoET,    // revenue_3d
      sevenDaysAgoET,    // revenue_7d
      fourteenDaysAgoET, // revenue_14d
    ];
    if (hasCustom) {
      revParams.push(customStart!, customEnd!);
    }
    revParams.push(
      oneDayAgoET,                // revenue_24h
      twoDaysAgoET, oneDayAgoET,  // revenue_prev_24h
    );
    revParams.push(...filterParams);

    const revenueRows = db.prepare(`
      SELECT
        r.refcode,
        SUM(r.amount) as total_revenue,
        SUM(CASE WHEN r.date >= ? THEN r.amount ELSE 0 END) as revenue_1d,
        SUM(CASE WHEN r.date >= ? THEN r.amount ELSE 0 END) as revenue_3d,
        SUM(CASE WHEN r.date >= ? THEN r.amount ELSE 0 END) as revenue_7d,
        SUM(CASE WHEN r.date >= ? THEN r.amount ELSE 0 END) as revenue_14d
        ${customRevCol},
        SUM(CASE WHEN r.date >= ? THEN r.amount ELSE 0 END) as revenue_24h,
        SUM(CASE WHEN r.date >= ? AND r.date < ? THEN r.amount ELSE 0 END) as revenue_prev_24h
      FROM revenue r
      JOIN clients c ON c.id = r.client_id
      WHERE r.refcode IS NOT NULL AND r.refcode != '' AND c.active = 1 AND c.is_ad_client = 1
        AND r.fundraising_page LIKE '%fbig%' AND r.refunded = 0 ${clientWhere}
      GROUP BY r.refcode
    `).all(...revParams) as any[];

    const revenueMap = new Map<string, any>();
    for (const r of revenueRows) {
      revenueMap.set(r.refcode, r);
    }

    // --- PORTFOLIO-LEVEL AVERAGE CPP (for SCALE/DROP benchmarking) ---
    let portfolioResults3d = 0;
    let portfolioSpend3d = 0;
    for (const ad of ads) {
      portfolioResults3d += ad.results_3d ?? 0;
      portfolioSpend3d += ad.spend_3d ?? 0;
    }
    const avgCppPortfolio = portfolioResults3d > 0 ? portfolioSpend3d / portfolioResults3d : 0;

    // --- BUILD AD RESULTS WITH AD-LEVEL RECOMMENDATIONS ---
    const adResults: AdPerformance[] = ads.map((ad: any) => {
      const rev = revenueMap.get(ad.ad_name);
      const feeRate = ad.fee_rate ?? 0.10;

      // Revenue windows
      const actblueRevenue = rev?.total_revenue ?? 0;
      const actblueRevenue1d = rev?.revenue_1d ?? 0;
      const actblueRevenue3d = rev?.revenue_3d ?? 0;
      const actblueRevenue7d = rev?.revenue_7d ?? 0;
      const actblueRevenue14d = rev?.revenue_14d ?? 0;
      const actblueRevenueCustom = rev?.revenue_custom ?? 0;

      // ROI per window
      const roiCalc = (spend: number, revenue: number) => {
        const swf = spend + (spend * feeRate);
        return swf > 0 ? revenue / swf : 0;
      };
      const spendWithFee = ad.total_spend + (ad.total_spend * feeRate);
      const adRoi = spendWithFee > 0 ? actblueRevenue / spendWithFee : 0;
      const adRoi1d = roiCalc(ad.spend_1d, actblueRevenue1d);
      const adRoi3d = roiCalc(ad.spend_3d, actblueRevenue3d);
      const adRoi7d = roiCalc(ad.spend_7d, actblueRevenue7d);
      const adRoi14d = roiCalc(ad.spend_14d, actblueRevenue14d);
      const adRoiCustom = hasCustom ? roiCalc(ad.spend_custom ?? 0, actblueRevenueCustom) : undefined;

      const cpp = ad.total_results > 0 ? ad.total_spend / ad.total_results : Infinity;
      const cpp3d = ad.results_3d > 0 ? ad.spend_3d / ad.results_3d : Infinity;

      // Age + status checks
      const firstSeenDate = new Date(ad.first_seen + 'T00:00:00');
      const ageHours = (Date.now() - firstSeenDate.getTime()) / (1000 * 60 * 60);
      const isNewAd = ageHours < 72;
      const isInactive = (ad.ad_delivery && ad.ad_delivery.toLowerCase() !== 'active')
        || (ad.spend_24h === 0 && ad.spend_3d === 0 && ad.last_seen < sevenDaysAgoET);

      // 24h trend
      const rev24h = rev?.revenue_24h ?? 0;
      const revPrev24h = rev?.revenue_prev_24h ?? 0;
      const roi24h = roiCalc(ad.spend_24h, rev24h);
      const roiPrev24h = roiCalc(ad.spend_prev_24h, revPrev24h);

      let trend: AdPerformance['trend'] = 'flat';
      if (isNewAd) {
        trend = 'new';
      } else if (ad.spend_24h > 0 && ad.spend_prev_24h > 0) {
        if (rev24h > 0 || revPrev24h > 0) {
          if (roi24h > roiPrev24h * 1.1) trend = 'up';
          else if (roi24h < roiPrev24h * 0.9) trend = 'down';
        } else {
          const eff24h = ad.spend_24h > 0 ? ad.results_24h / ad.spend_24h : 0;
          const effPrev = ad.spend_prev_24h > 0 ? ad.results_prev_24h / ad.spend_prev_24h : 0;
          if (eff24h > effPrev * 1.1) trend = 'up';
          else if (eff24h < effPrev * 0.9) trend = 'down';
        }
      }

      // --- AD-LEVEL RECOMMENDATION ---
      let recommendation: AdPerformance['recommendation'] = 'HOLD';
      let rec_reason: string | undefined;
      const hasActBlueData = actblueRevenue > 0;

      if (!isInactive && !isNewAd) {
        // 1. KILL checks (all-time, worst problems)
        if (ad.total_spend > 50 && ad.total_results === 0 && !hasActBlueData) {
          recommendation = 'KILL';
          rec_reason = `$${ad.total_spend.toFixed(0)} spent, 0 results`;
        } else if (hasActBlueData && adRoi < 0.5 && ad.total_spend > 50) {
          recommendation = 'KILL';
          rec_reason = `ROI ${adRoi.toFixed(2)}x on $${ad.total_spend.toFixed(0)} spend`;
        } else if (!hasActBlueData && ad.total_results >= 3 && cpp > 40) {
          recommendation = 'KILL';
          rec_reason = `CPP $${cpp.toFixed(2)}, no ActBlue revenue`;
        } else if (ad.frequency > 2.0) {
          recommendation = 'KILL';
          rec_reason = `Frequency ${ad.frequency.toFixed(2)} (>2.0)`;
        }
        // 2. SCALE checks (3d window)
        else if (ad.spend_3d >= 15 && adRoi3d >= 1.3) {
          recommendation = 'SCALE';
          rec_reason = `3d ROI ${adRoi3d.toFixed(2)}x`;
        } else if (ad.spend_3d >= 15 && adRoi3d >= 1.0 && ad.results_3d >= 2 && avgCppPortfolio > 0 && cpp3d < avgCppPortfolio * 0.7 && cpp3d !== Infinity) {
          recommendation = 'SCALE';
          rec_reason = `3d CPP $${cpp3d.toFixed(2)} (${((1 - cpp3d / avgCppPortfolio) * 100).toFixed(0)}% below avg)`;
        }
        // 3. DROP checks (3d window)
        else if (ad.spend_3d >= 15 && actblueRevenue3d > 0 && adRoi3d < 1.0) {
          recommendation = 'DROP';
          rec_reason = `3d ROI ${adRoi3d.toFixed(2)}x`;
        } else if (ad.spend_3d >= 50 && ad.results_3d === 0) {
          recommendation = 'DROP';
          rec_reason = `$${ad.spend_3d.toFixed(0)} spent in 3d, 0 results`;
        } else if (ad.spend_3d >= 15 && ad.results_3d >= 2 && avgCppPortfolio > 0 && cpp3d > avgCppPortfolio * 1.5 && cpp3d !== Infinity) {
          recommendation = 'DROP';
          rec_reason = `3d CPP $${cpp3d.toFixed(2)} (${((cpp3d / avgCppPortfolio - 1) * 100).toFixed(0)}% above avg)`;
        }
      }

      return {
        ad_name: ad.ad_name,
        client_name: ad.client_name,
        short_code: ad.short_code,
        campaign_type: ad.campaign_type,
        batch: ad.batch,
        ad_delivery: ad.ad_delivery ?? '',
        attribution_setting: ad.attribution_setting ?? '',
        total_spend: ad.total_spend,
        spend_1d: ad.spend_1d ?? 0,
        spend_3d: ad.spend_3d ?? 0,
        spend_7d: ad.spend_7d ?? 0,
        spend_14d: ad.spend_14d ?? 0,
        ...(hasCustom ? { spend_custom: ad.spend_custom ?? 0 } : {}),
        total_results: ad.total_results,
        results_1d: ad.results_1d ?? 0,
        results_3d: ad.results_3d ?? 0,
        results_7d: ad.results_7d ?? 0,
        results_14d: ad.results_14d ?? 0,
        ...(hasCustom ? { results_custom: ad.results_custom ?? 0 } : {}),
        link_clicks: ad.total_link_clicks ?? 0,
        link_clicks_1d: ad.link_clicks_1d ?? 0,
        link_clicks_3d: ad.link_clicks_3d ?? 0,
        link_clicks_7d: ad.link_clicks_7d ?? 0,
        link_clicks_14d: ad.link_clicks_14d ?? 0,
        ...(hasCustom ? { link_clicks_custom: ad.link_clicks_custom ?? 0 } : {}),
        cpp: cpp === Infinity ? 0 : cpp,
        cpp_3d: cpp3d === Infinity ? 0 : cpp3d,
        frequency: ad.frequency ?? 0,
        actblue_revenue: actblueRevenue,
        actblue_revenue_1d: actblueRevenue1d,
        actblue_revenue_3d: actblueRevenue3d,
        actblue_revenue_7d: actblueRevenue7d,
        actblue_revenue_14d: actblueRevenue14d,
        ...(hasCustom ? { actblue_revenue_custom: actblueRevenueCustom } : {}),
        roi: adRoi,
        roi_1d: adRoi1d,
        roi_3d: adRoi3d,
        roi_7d: adRoi7d,
        roi_14d: adRoi14d,
        ...(hasCustom ? { roi_custom: adRoiCustom } : {}),
        first_seen: ad.first_seen,
        is_new: isNewAd,
        trend,
        recommendation,
        rec_reason,
        _inactive: isInactive,
      } as AdPerformance & { _inactive: boolean };
    });

    // Filter out truly dead ads
    const adResultsFinal = adResults.filter(ad => {
      const ext = ad as AdPerformance & { _inactive: boolean };
      if (ext.ad_delivery && ext.ad_delivery !== 'active' && ext.ad_delivery !== '') return true;
      if (ext._inactive && ext.ad_delivery === 'active') return false;
      return true;
    });

    // --- CLIENT-LEVEL GROUPING (replaces campaign-type grouping) ---
    const clientMap = new Map<string, {
      client_name: string;
      short_code: string;
      fee_rate: number;
      ads: string[];
      total_spend: number;
      spend_72h: number;
      total_revenue: number;
      revenue_72h: number;
      total_results: number;
      results_72h: number;
    }>();

    for (const ad of adResultsFinal) {
      const key = ad.short_code;
      if (!clientMap.has(key)) {
        clientMap.set(key, {
          client_name: ad.client_name,
          short_code: ad.short_code,
          fee_rate: (ad as any).fee_rate ?? 0.10,
          ads: [],
          total_spend: 0,
          spend_72h: 0,
          total_revenue: 0,
          revenue_72h: 0,
          total_results: 0,
          results_72h: 0,
        });
      }
      const c = clientMap.get(key)!;
      c.ads.push(ad.ad_name);
      c.total_spend += ad.total_spend;
      c.spend_72h += ad.spend_3d;
      c.total_results += ad.total_results;
      c.results_72h += ad.results_3d;
      c.total_revenue += ad.actblue_revenue;
      c.revenue_72h += ad.actblue_revenue_3d;
    }

    const clients: ClientGroup[] = [];
    for (const [, c] of clientMap.entries()) {
      const feeRate = c.fee_rate;
      const spendWithFee72h = c.spend_72h + (c.spend_72h * feeRate);
      const roi72h = spendWithFee72h > 0 ? c.revenue_72h / spendWithFee72h : 0;
      const cpp72h = c.results_72h > 0 ? c.spend_72h / c.results_72h : 0;

      clients.push({
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
        ads: c.ads,
      });
    }

    // Sort clients alphabetically by name
    clients.sort((a, b) => a.client_name.localeCompare(b.client_name));

    const summary = {
      total_ads: adResultsFinal.filter(a => a.ad_delivery === 'active' || a.ad_delivery === '').length,
      paused_ads: adResultsFinal.filter(a => a.ad_delivery !== 'active' && a.ad_delivery !== '').length,
      total_clients: clients.length,
      scale_count: adResultsFinal.filter(r => r.recommendation === 'SCALE').length,
      drop_count: adResultsFinal.filter(r => r.recommendation === 'DROP').length,
      kill_count: adResultsFinal.filter(r => r.recommendation === 'KILL').length,
      hold_count: adResultsFinal.filter(r => r.recommendation === 'HOLD').length,
      total_wasted_spend: adResultsFinal.filter(r => r.recommendation === 'KILL' && r.actblue_revenue === 0).reduce((s, r) => s + r.total_spend, 0),
    };

    return NextResponse.json({ ads: adResultsFinal, clients, summary });
  } catch (error) {
    console.error('Ad performance error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
