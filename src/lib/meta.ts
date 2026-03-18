import { getDb, getClientByAdName, getCampaignType, parseBatch } from './db';

const GRAPH_API_BASE = 'https://graph.facebook.com/v22.0';

interface MetaConfig {
  accessToken: string;
  adAccountId: string;
  appId: string;
  appSecret: string;
}

function getMetaConfig(): MetaConfig {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  if (!accessToken || !adAccountId) {
    throw new Error('META_ACCESS_TOKEN and META_AD_ACCOUNT_ID must be set in .env.local');
  }

  return { accessToken, adAccountId, appId: appId || '', appSecret: appSecret || '' };
}

interface MetaAdInsight {
  ad_name: string;
  ad_id: string;
  campaign_name?: string;
  adset_name?: string;
  spend: string;
  actions?: { action_type: string; value: string }[];
  reach: string;
  frequency: string;
  impressions: string;
  cpm: string;
  inline_link_clicks: string;
  ctr: string;
  date_start: string;
  date_stop: string;
}

// Fetch all ad-level insights for a date range with daily breakdown
async function fetchAdInsights(
  config: MetaConfig,
  dateStart: string,
  dateEnd: string
): Promise<MetaAdInsight[]> {
  const allAds: MetaAdInsight[] = [];
  const fields = 'ad_name,ad_id,campaign_name,adset_name,spend,actions,reach,frequency,impressions,cpm,inline_link_clicks,ctr';
  const timeRange = JSON.stringify({ since: dateStart, until: dateEnd });

  let url = `${GRAPH_API_BASE}/${config.adAccountId}/insights?level=ad&fields=${fields}&time_range=${encodeURIComponent(timeRange)}&time_increment=1&limit=500&access_token=${config.accessToken}`;

  while (url) {
    const res = await fetch(url);

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Meta API error (${res.status}): ${errorText}`);
    }

    const data = await res.json();
    allAds.push(...data.data);

    url = data.paging?.next || '';
  }

  return allAds;
}

// Extract purchase count from actions array
function getPurchases(actions?: { action_type: string; value: string }[]): number {
  if (!actions) return 0;
  const purchase = actions.find(a => a.action_type === 'offsite_conversion.fb_pixel_purchase');
  return purchase ? parseInt(purchase.value, 10) : 0;
}

export interface MetaSyncResult {
  success: boolean;
  adsProcessed: number;
  dateRange: string;
  error?: string;
}

// Sync Meta ad data into the database
export async function syncMetaAds(dateStart: string, dateEnd: string): Promise<MetaSyncResult> {
  const config = getMetaConfig();
  const ads = await fetchAdInsights(config, dateStart, dateEnd);

  const db = getDb();

  const upsertAdSpend = db.prepare(`
    INSERT INTO ad_spend (date, client_id, ad_name, spend, results, reach, frequency, impressions, cpm, link_clicks, ctr, ad_delivery, attribution_setting, cost_per_result, campaign_type, batch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, ad_name) DO UPDATE SET
      spend = excluded.spend,
      results = excluded.results,
      reach = excluded.reach,
      frequency = excluded.frequency,
      impressions = excluded.impressions,
      cpm = excluded.cpm,
      link_clicks = excluded.link_clicks,
      ctr = excluded.ctr,
      ad_delivery = excluded.ad_delivery,
      cost_per_result = excluded.cost_per_result,
      campaign_type = excluded.campaign_type,
      batch = excluded.batch
  `);

  let adsProcessed = 0;

  const insertMany = db.transaction(() => {
    for (const ad of ads) {
      const adName = ad.ad_name;
      if (!adName) continue;

      const client = getClientByAdName(adName);
      if (!client) continue;

      const spend = parseFloat(ad.spend || '0');
      const purchases = getPurchases(ad.actions);
      const reach = parseInt(ad.reach || '0', 10);
      const frequency = parseFloat(ad.frequency || '0');
      const impressions = parseInt(ad.impressions || '0', 10);
      const cpm = parseFloat(ad.cpm || '0');
      const linkClicks = parseInt(ad.inline_link_clicks || '0', 10);
      const ctr = parseFloat(ad.ctr || '0');
      const costPerResult = purchases > 0 ? spend / purchases : 0;

      const date = ad.date_start;

      upsertAdSpend.run(
        date,
        client.id,
        adName,
        spend,
        purchases,
        reach,
        frequency,
        impressions,
        cpm,
        linkClicks,
        ctr,
        'active', // API only returns ads that had delivery
        '7-day click', // default attribution
        costPerResult,
        getCampaignType(adName),
        parseBatch(adName)
      );
      adsProcessed++;
    }
  });

  insertMany();

  // Record upload
  db.prepare('INSERT INTO uploads (filename, upload_type, rows_processed) VALUES (?, ?, ?)').run(
    `meta_api_${dateStart}_${dateEnd}`, 'meta_api', adsProcessed
  );

  // Recalculate summaries
  recalculateSummaries();

  return {
    success: true,
    adsProcessed,
    dateRange: `${dateStart} to ${dateEnd}`,
  };
}

// Check token status
export async function checkMetaTokenStatus(): Promise<{
  valid: boolean;
  expiresAt?: string;
  scopes?: string[];
  error?: string;
}> {
  try {
    const config = getMetaConfig();
    const res = await fetch(
      `${GRAPH_API_BASE}/debug_token?input_token=${config.accessToken}&access_token=${config.appId}|${config.appSecret}`
    );
    const data = await res.json();

    if (data.data) {
      const expiresAt = data.data.expires_at
        ? new Date(data.data.expires_at * 1000).toISOString()
        : 'never';
      return {
        valid: data.data.is_valid,
        expiresAt,
        scopes: data.data.scopes,
      };
    }
    return { valid: false, error: 'Could not debug token' };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// Get ad account info
export async function getAdAccountInfo(): Promise<{ name: string; id: string; status: number } | null> {
  try {
    const config = getMetaConfig();
    const res = await fetch(
      `${GRAPH_API_BASE}/${config.adAccountId}?fields=name,account_status,currency&access_token=${config.accessToken}`
    );
    const data = await res.json();
    return { name: data.name, id: data.id, status: data.account_status };
  } catch {
    return null;
  }
}

function recalculateSummaries() {
  const db = getDb();

  // Load per-client fee rates
  const feeRates = new Map<number, number>();
  const allClients = db.prepare('SELECT id, fee_rate FROM clients').all() as { id: number; fee_rate: number }[];
  for (const c of allClients) {
    feeRates.set(c.id, c.fee_rate ?? 0.10);
  }

  const spendData = db.prepare(`
    SELECT date, client_id, SUM(spend) as total_spend
    FROM ad_spend
    GROUP BY date, client_id
  `).all() as { date: string; client_id: number; total_spend: number }[];

  const revenueData = db.prepare(`
    SELECT date, client_id, SUM(amount) as total_revenue
    FROM revenue
    WHERE fundraising_page LIKE '%fbig%'
    GROUP BY date, client_id
  `).all() as { date: string; client_id: number; total_revenue: number }[];

  const revenueMap = new Map<string, number>();
  for (const r of revenueData) {
    revenueMap.set(`${r.date}|${r.client_id}`, r.total_revenue);
  }

  const upsertSummary = db.prepare(`
    INSERT INTO daily_summary (date, client_id, total_spend, total_revenue, spend_with_fee, true_roas, profit, keylime_cut)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, client_id) DO UPDATE SET
      total_spend = excluded.total_spend,
      total_revenue = excluded.total_revenue,
      spend_with_fee = excluded.spend_with_fee,
      true_roas = excluded.true_roas,
      profit = excluded.profit,
      keylime_cut = excluded.keylime_cut
  `);

  const updateAll = db.transaction(() => {
    for (const s of spendData) {
      const feeRate = feeRates.get(s.client_id) ?? 0.10;
      const revenue = revenueMap.get(`${s.date}|${s.client_id}`) || 0;
      const feeAmount = s.total_spend * feeRate;
      const spendWithFee = s.total_spend + feeAmount;
      const trueRoas = spendWithFee > 0 ? revenue / spendWithFee : 0;
      const profit = revenue - spendWithFee;
      const profitShare = profit > 0 ? profit * 0.25 : 0;
      const keylimeCut = feeAmount + profitShare;

      upsertSummary.run(
        s.date, s.client_id, s.total_spend, revenue,
        spendWithFee, trueRoas, profit, keylimeCut
      );
    }

    for (const r of revenueData) {
      const hasSpend = spendData.some(s => s.date === r.date && s.client_id === r.client_id);
      if (!hasSpend) {
        const profitShare = r.total_revenue > 0 ? r.total_revenue * 0.25 : 0;
        upsertSummary.run(
          r.date, r.client_id, 0, r.total_revenue,
          0, 0, r.total_revenue, profitShare
        );
      }
    }
  });

  updateAll();
}
