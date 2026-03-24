import { getDb, getClientByAdName, getClientByCampaignName, getCampaignType, parseBatch } from './db';

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

// Fetch all ads with their effective_status
async function fetchAdStatuses(config: MetaConfig): Promise<{ id: string; name: string; effective_status: string; campaign_name: string; adset_name: string; campaign_id: string }[]> {
  const results: { id: string; name: string; effective_status: string; campaign_name: string; adset_name: string; campaign_id: string }[] = [];
  let url = `${GRAPH_API_BASE}/${config.adAccountId}/ads?fields=name,effective_status,campaign{name,id},adset{name}&limit=500&access_token=${config.accessToken}`;

  while (url) {
    const res = await fetch(url);
    if (!res.ok) break;
    const data = await res.json();
    for (const ad of data.data || []) {
      results.push({
        id: ad.id,
        name: ad.name,
        effective_status: ad.effective_status,
        campaign_name: ad.campaign?.name || '',
        adset_name: ad.adset?.name || '',
        campaign_id: ad.campaign?.id || '',
      });
    }
    url = data.paging?.next || '';
  }
  return results;
}

// Fetch campaign budgets
async function fetchCampaignBudgets(config: MetaConfig): Promise<{ id: string; name: string; daily_budget: string | null; lifetime_budget: string | null }[]> {
  const results: { id: string; name: string; daily_budget: string | null; lifetime_budget: string | null }[] = [];
  let url = `${GRAPH_API_BASE}/${config.adAccountId}/campaigns?fields=name,daily_budget,lifetime_budget&limit=500&access_token=${config.accessToken}`;

  while (url) {
    const res = await fetch(url);
    if (!res.ok) break;
    const data = await res.json();
    for (const c of data.data || []) {
      results.push({
        id: c.id,
        name: c.name,
        daily_budget: c.daily_budget || null,
        lifetime_budget: c.lifetime_budget || null,
      });
    }
    url = data.paging?.next || '';
  }
  return results;
}

// Sync Meta ad data into the database
export async function syncMetaAds(dateStart: string, dateEnd: string): Promise<MetaSyncResult> {
  const config = getMetaConfig();

  // Fetch insights, ad statuses, and campaign budgets in parallel
  const [ads, adStatuses, campaignBudgets] = await Promise.all([
    fetchAdInsights(config, dateStart, dateEnd),
    fetchAdStatuses(config).catch(() => []),
    fetchCampaignBudgets(config).catch(() => []),
  ]);

  const db = getDb();

  // Build a map of ad_id -> effective_status for use in upsert
  const statusMap = new Map<string, string>();
  for (const s of adStatuses) {
    statusMap.set(s.id, s.effective_status);
  }

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
      // Use real effective_status from API if available
      const delivery = statusMap.get(ad.ad_id) || 'active';

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
        delivery.toLowerCase(),
        '7-day click', // default attribution
        costPerResult,
        getCampaignType(adName),
        parseBatch(adName)
      );
      adsProcessed++;
    }
  });

  insertMany();

  // Detect real changes from API data (status changes, budget changes)
  detectRealChanges(db, adStatuses, campaignBudgets);

  // Sync activity log for real historical changelog
  await syncActivityLog(dateStart).catch(err => console.error('Activity log sync failed:', err));

  // Also detect new ads from insights data
  detectNewAds(db, dateStart, dateEnd);

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

// Fetch and store Meta activity log (real changelog from the API)
export async function syncActivityLog(since?: string): Promise<number> {
  const config = getMetaConfig();
  const db = getDb();

  // Default to 30 days back
  const sinceDate = since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const sinceUnix = Math.floor(new Date(sinceDate + 'T00:00:00').getTime() / 1000);

  let eventsLogged = 0;

  // Purge old activity-log-sourced events in range (will re-import)
  db.prepare("DELETE FROM campaign_changes WHERE source = 'activity_log' AND date >= ?").run(sinceDate);

  const insertChange = db.prepare(
    "INSERT INTO campaign_changes (date, client_id, change_type, description, source) VALUES (?, ?, ?, ?, 'activity_log')"
  );

  // Map Meta event types to our change_type
  const eventTypeMap: Record<string, string> = {
    'update_campaign_budget': 'budget_change',
    'update_adset_budget': 'budget_change',
    'update_campaign_daily_budget': 'budget_change',
    'update_adset_daily_budget': 'budget_change',
    'update_campaign_lifetime_budget': 'budget_change',
    'update_campaign_run_status': 'status_change',
    'update_adset_run_status': 'status_change',
    'update_ad_run_status': 'status_change',
    'create_ad': 'ad_launched',
    'create_adset': 'ad_launched',
    'create_campaign': 'ad_launched',
    'update_ad_creative': 'creative_change',
    'update_campaign_bid_strategy': 'budget_change',
    'update_adset_bid_amount': 'budget_change',
    'update_adset_targeting': 'creative_change',
  };

  try {
    let url = `${GRAPH_API_BASE}/${config.adAccountId}/activities?fields=event_type,event_time,object_name,object_id,extra_data,actor_name&since=${sinceUnix}&limit=500&access_token=${config.accessToken}`;

    while (url) {
      const res = await fetch(url);
      if (!res.ok) {
        const errText = await res.text();
        console.error('Activity log API error:', errText);
        break;
      }

      const data = await res.json();

      for (const event of data.data || []) {
        const changeType = eventTypeMap[event.event_type];
        if (!changeType) continue; // Skip event types we don't care about

        const eventDate = new Date(event.event_time).toISOString().split('T')[0];
        const objectName = event.object_name || '';

        // Try to match to a client (ad name prefix first, then campaign name matching)
        const client = getClientByAdName(objectName) || getClientByCampaignName(objectName);
        if (!client) continue;

        // Build description from extra_data
        let description = objectName;
        try {
          if (event.extra_data) {
            const extra = typeof event.extra_data === 'string' ? JSON.parse(event.extra_data) : event.extra_data;

            if (changeType === 'budget_change') {
              const oldVal = extra.old_value || extra.old_val;
              const newVal = extra.new_value || extra.new_val;
              if (oldVal && newVal) {
                // Budget values from activity log are in cents
                const oldBudget = parseFloat(oldVal) / 100;
                const newBudget = parseFloat(newVal) / 100;
                const dir = newBudget > oldBudget ? 'up' : 'down';
                const pct = oldBudget > 0 ? Math.round(Math.abs(newBudget / oldBudget - 1) * 100) : 0;
                description = `${objectName} budget ${dir} ${pct}% ($${oldBudget.toFixed(0)} → $${newBudget.toFixed(0)})`;
              } else {
                description = `${objectName}: ${event.event_type.replace(/_/g, ' ')}`;
              }
            } else if (changeType === 'status_change') {
              const oldVal = extra.old_value || extra.old_val || '';
              const newVal = extra.new_value || extra.new_val || '';
              description = `${objectName}: ${oldVal.toLowerCase()} → ${newVal.toLowerCase()}`;
            } else if (changeType === 'ad_launched') {
              description = `New: ${objectName}`;
            } else {
              description = `${objectName}: ${event.event_type.replace(/_/g, ' ')}`;
            }
          }
        } catch {
          description = `${objectName}: ${event.event_type.replace(/_/g, ' ')}`;
        }

        insertChange.run(eventDate, client.id, changeType, description);
        eventsLogged++;
      }

      url = data.paging?.next || '';
    }
  } catch (err) {
    console.error('Activity log sync error:', err);
  }

  return eventsLogged;
}

// Detect real changes using Meta API data (effective_status, daily_budget)
function detectRealChanges(
  db: ReturnType<typeof getDb>,
  adStatuses: { id: string; name: string; effective_status: string; campaign_name: string; adset_name: string; campaign_id: string }[],
  campaignBudgets: { id: string; name: string; daily_budget: string | null; lifetime_budget: string | null }[]
) {
  try {
    const todayET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).toISOString().split('T')[0];

    // Clear old inferred events (budget_change, ad_toggled) - we now use real API data
    db.prepare("DELETE FROM campaign_changes WHERE source = 'auto' AND change_type IN ('budget_change', 'ad_toggled', 'status_change')").run();

    const insertChange = db.prepare(
      "INSERT INTO campaign_changes (date, client_id, change_type, description, source) VALUES (?, ?, ?, ?, 'auto')"
    );

    // === 1. Detect ad status changes (active -> paused, etc.) ===
    const upsertStatus = db.prepare(`
      INSERT INTO ad_status_snapshots (ad_id, ad_name, client_id, effective_status, campaign_name, adset_name, snapped_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(ad_id) DO UPDATE SET
        effective_status = excluded.effective_status,
        campaign_name = excluded.campaign_name,
        adset_name = excluded.adset_name,
        snapped_at = excluded.snapped_at
    `);

    const getPrevStatus = db.prepare('SELECT effective_status FROM ad_status_snapshots WHERE ad_id = ?');

    for (const ad of adStatuses) {
      const client = getClientByAdName(ad.name);
      if (!client) continue;

      const prev = getPrevStatus.get(ad.id) as { effective_status: string } | undefined;

      if (prev && prev.effective_status !== ad.effective_status) {
        // Status changed - log it
        const fromLabel = prev.effective_status.replace(/_/g, ' ').toLowerCase();
        const toLabel = ad.effective_status.replace(/_/g, ' ').toLowerCase();
        insertChange.run(todayET, client.id, 'status_change',
          `${ad.name}: ${fromLabel} → ${toLabel}`);
      }

      // Update snapshot
      upsertStatus.run(ad.id, ad.name, client.id, ad.effective_status, ad.campaign_name, ad.adset_name);
    }

    // === 2. Detect campaign budget changes ===
    const upsertBudget = db.prepare(`
      INSERT INTO campaign_budget_snapshots (campaign_id, campaign_name, client_id, daily_budget, lifetime_budget, snapped_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(campaign_id) DO UPDATE SET
        daily_budget = excluded.daily_budget,
        lifetime_budget = excluded.lifetime_budget,
        campaign_name = excluded.campaign_name,
        snapped_at = excluded.snapped_at
    `);

    const getPrevBudget = db.prepare('SELECT daily_budget, lifetime_budget FROM campaign_budget_snapshots WHERE campaign_id = ?');

    for (const campaign of campaignBudgets) {
      // Try to figure out which client this campaign belongs to
      // Campaign names follow pattern: "{Client Name} {CampaignType}"
      const clientMatch = adStatuses.find(a => a.campaign_id === campaign.id);
      const client = clientMatch ? getClientByAdName(clientMatch.name) : null;
      if (!client) continue;

      // Budget is in cents from Meta API
      const currentDaily = campaign.daily_budget ? parseFloat(campaign.daily_budget) / 100 : null;
      const currentLifetime = campaign.lifetime_budget ? parseFloat(campaign.lifetime_budget) / 100 : null;

      const prev = getPrevBudget.get(campaign.id) as { daily_budget: number | null; lifetime_budget: number | null } | undefined;

      if (prev && prev.daily_budget && currentDaily && currentDaily !== prev.daily_budget) {
        const dir = currentDaily > prev.daily_budget ? 'up' : 'down';
        const pct = Math.round(Math.abs(currentDaily / prev.daily_budget - 1) * 100);
        insertChange.run(todayET, client.id, 'budget_change',
          `${campaign.name} daily budget ${dir} ${pct}% ($${prev.daily_budget.toFixed(0)} → $${currentDaily.toFixed(0)})`);
      }

      upsertBudget.run(campaign.id, campaign.name, client.id, currentDaily, currentLifetime);
    }
  } catch (err) {
    console.error('Real change detection error:', err);
  }
}

// Detect new ads (first appearance in ad_spend)
function detectNewAds(db: ReturnType<typeof getDb>, dateStart: string, dateEnd: string) {
  try {
    // Purge old auto-detected ad_launched entries in this range
    db.prepare(
      "DELETE FROM campaign_changes WHERE date >= ? AND date <= ? AND source = 'auto' AND change_type = 'ad_launched'"
    ).run(dateStart, dateEnd);

    const insertChange = db.prepare(
      "INSERT INTO campaign_changes (date, client_id, change_type, description, source) VALUES (?, ?, ?, ?, 'auto')"
    );

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
      insertChange.run(ad.first_date, ad.client_id, 'ad_launched', `New ad: ${ad.ad_name}`);
    }
  } catch (err) {
    console.error('New ad detection error:', err);
  }
}
