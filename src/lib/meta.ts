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

  // Auto-detect campaign changes by comparing current sync with previous data
  detectCampaignChanges(db, dateStart, dateEnd);

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

function detectCampaignChanges(db: ReturnType<typeof getDb>, dateStart: string, dateEnd: string) {
  try {
    const insertChange = db.prepare(
      'INSERT INTO campaign_changes (date, client_id, change_type, description) VALUES (?, ?, ?, ?)'
    );

    // Prevent duplicate detections: get already-logged auto changes
    const existingChanges = new Set(
      (db.prepare(
        "SELECT date || '|' || client_id || '|' || change_type || '|' || description as key FROM campaign_changes WHERE date >= ? AND date <= ?"
      ).all(dateStart, dateEnd) as { key: string }[]).map(r => r.key)
    );

    const logChange = (date: string, clientId: number, type: string, desc: string) => {
      const key = `${date}|${clientId}|${type}|${desc}`;
      if (!existingChanges.has(key)) {
        insertChange.run(date, clientId, type, desc);
        existingChanges.add(key);
      }
    };

    // 1. Detect new ads (first appearance in ad_spend)
    const newAds = db.prepare(`
      SELECT a.ad_name, a.client_id, MIN(a.date) as first_date, c.name as client_name
      FROM ad_spend a
      JOIN clients c ON c.id = a.client_id
      WHERE a.date >= ? AND a.date <= ?
      GROUP BY a.ad_name, a.client_id
      HAVING first_date >= ? AND first_date = (
        SELECT MIN(date) FROM ad_spend WHERE ad_name = a.ad_name
      )
    `).all(dateStart, dateEnd, dateStart) as { ad_name: string; client_id: number; first_date: string; client_name: string }[];

    for (const ad of newAds) {
      logChange(ad.first_date, ad.client_id, 'ad_launched', `New ad: ${ad.ad_name}`);
    }

    // 2. Detect ads likely toggled off: had spend on 3+ of the last 7 days,
    //    but zero spend for the last 2+ consecutive days in the sync range.
    //    This filters out organic $0 days (CostCap not delivering, etc.)
    const likelyToggled = db.prepare(`
      SELECT a.ad_name, a.client_id, c.name as client_name,
        MAX(a.date) as last_spend_date,
        COUNT(CASE WHEN a.spend > 0 AND a.date >= date(?, '-7 days') AND a.date < ? THEN 1 END) as active_days_prior,
        COUNT(CASE WHEN a.spend = 0 AND a.date >= ? THEN 1 END) as zero_days_in_range,
        COUNT(CASE WHEN a.date >= ? THEN 1 END) as total_days_in_range
      FROM ad_spend a
      JOIN clients c ON c.id = a.client_id
      WHERE a.date >= date(?, '-7 days') AND a.date <= ?
      GROUP BY a.ad_name, a.client_id
      HAVING active_days_prior >= 3
        AND total_days_in_range >= 2
        AND zero_days_in_range = total_days_in_range
    `).all(dateStart, dateStart, dateStart, dateStart, dateStart, dateEnd) as {
      ad_name: string; client_id: number; client_name: string;
      last_spend_date: string; active_days_prior: number;
      zero_days_in_range: number; total_days_in_range: number;
    }[];

    for (const ad of likelyToggled) {
      logChange(dateStart, ad.client_id, 'ad_toggled', `Ad likely turned off: ${ad.ad_name} (was active ${ad.active_days_prior}/7 days, now $0 for ${ad.zero_days_in_range} days)`);
    }

    // 3. Detect significant budget changes (campaign-level daily spend changed >15% day-over-day)
    // Exclude today (partial data would cause false positives)
    const todayET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).toISOString().split('T')[0];
    const dailyCampaignSpend = db.prepare(`
      SELECT a.date, a.client_id, a.campaign_type, SUM(a.spend) as daily_spend
      FROM ad_spend a
      WHERE a.date >= date(?, '-1 day') AND a.date <= ? AND a.date != ?
        AND a.campaign_type != 'cap'
      GROUP BY a.date, a.client_id, a.campaign_type
      HAVING daily_spend > 10
      ORDER BY a.client_id, a.campaign_type, a.date
    `).all(dateStart, dateEnd, todayET) as { date: string; client_id: number; campaign_type: string; daily_spend: number }[];

    // Group by client+campaign_type, compare consecutive days
    const campaignKey = (r: { client_id: number; campaign_type: string }) => `${r.client_id}:${r.campaign_type}`;
    const prevDay = new Map<string, number>();

    for (const row of dailyCampaignSpend) {
      const key = campaignKey(row);
      const prev = prevDay.get(key);
      if (prev !== undefined && prev > 10) {
        const changeRatio = row.daily_spend / prev;
        if (changeRatio > 1.15) {
          const client = db.prepare('SELECT name FROM clients WHERE id = ?').get(row.client_id) as { name: string } | undefined;
          const typeLabel = row.campaign_type === 'val' ? 'Value' : row.campaign_type === 'cap' ? 'CostCap' : row.campaign_type === 'abx20' ? 'ABX' : row.campaign_type;
          logChange(row.date, row.client_id, 'budget_change',
            `${client?.name || ''} ${typeLabel} spend up ${Math.round((changeRatio - 1) * 100)}% ($${prev.toFixed(0)} -> $${row.daily_spend.toFixed(0)})`);
        } else if (changeRatio < 0.85) {
          const client = db.prepare('SELECT name FROM clients WHERE id = ?').get(row.client_id) as { name: string } | undefined;
          const typeLabel = row.campaign_type === 'val' ? 'Value' : row.campaign_type === 'cap' ? 'CostCap' : row.campaign_type === 'abx20' ? 'ABX' : row.campaign_type;
          logChange(row.date, row.client_id, 'budget_change',
            `${client?.name || ''} ${typeLabel} spend down ${Math.round((1 - changeRatio) * 100)}% ($${prev.toFixed(0)} -> $${row.daily_spend.toFixed(0)})`);
        }
      }
      prevDay.set(key, row.daily_spend);
    }
  } catch (err) {
    console.error('Change detection error:', err);
  }
}
