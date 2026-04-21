import Papa from 'papaparse';
import { getDb, getClientByAdName, getCampaignType, parseBatch } from './db';

export interface MetaAdRow {
  'Reporting starts': string;
  'Reporting ends': string;
  'Ad name': string;
  'Ad delivery': string;
  'Attribution setting': string;
  Results: string;
  'Result indicator': string;
  Reach: string;
  Frequency: string;
  'Cost per results': string;
  'Amount spent (USD)': string;
  Impressions: string;
  'CPM (cost per 1,000 impressions) (USD)': string;
  'Link clicks': string;
  'CTR (link click-through rate)': string;
  'Landing page views': string;
  // Day column if daily breakdown is present
  Day?: string;
}

export interface NumeroRow {
  'Last Contribution Amount': string;
  'Last Contribution Date': string;
  'Last Contribution Reference Codes': string;
  'Last Contribution Member Code': string;
  'First Name': string;
  'Last Name': string;
  'This Cycle Contributed': string;
  'All Time Contributed': string;
}

export function parseMetaCsv(csvText: string, filename: string): { rowsProcessed: number; errors: string[] } {
  const db = getDb();
  const errors: string[] = [];

  const parsed = Papa.parse<MetaAdRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  if (parsed.errors.length > 0) {
    errors.push(...parsed.errors.map(e => `Row ${e.row}: ${e.message}`));
  }

  // CSV imports don't have meta_ad_id, so check-then-update/insert by (date, ad_name)
  const findByNameCsv = db.prepare('SELECT id FROM ad_spend WHERE date = ? AND ad_name = ? AND meta_ad_id IS NULL LIMIT 1');
  const updateByNameCsv = db.prepare(`
    UPDATE ad_spend SET
      spend = ?, results = ?, reach = ?, frequency = ?,
      impressions = ?, cpm = ?, link_clicks = ?, ctr = ?,
      ad_delivery = ?, attribution_setting = ?, cost_per_result = ?, campaign_type = ?, batch = ?
    WHERE id = ?
  `);
  const insertByNameCsv = db.prepare(`
    INSERT INTO ad_spend (date, client_id, ad_name, spend, results, reach, frequency, impressions, cpm, link_clicks, ctr, ad_delivery, attribution_setting, cost_per_result, campaign_type, batch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let rowsProcessed = 0;

  // Check if this export has daily breakdown (look for "Day" column or date range = 1 day)
  const hasDayColumn = parsed.data.length > 0 && 'Day' in parsed.data[0];

  const insertMany = db.transaction(() => {
    for (const row of parsed.data) {
      const adName = row['Ad name'];
      if (!adName) continue;

      const client = getClientByAdName(adName);
      if (!client) {
        errors.push(`Unknown client prefix for ad: ${adName}`);
        continue;
      }

      const totalSpend = parseFloat(row['Amount spent (USD)'] || '0');
      const totalResults = parseInt(row.Results || '0', 10) || 0;
      const reach = parseInt(row.Reach || '0', 10) || 0;
      const frequency = parseFloat(row.Frequency || '0') || 0;
      const impressions = parseInt(row.Impressions || '0', 10) || 0;
      const cpm = parseFloat(row['CPM (cost per 1,000 impressions) (USD)'] || '0') || 0;
      const linkClicks = parseInt(row['Link clicks'] || '0', 10) || 0;
      const ctr = parseFloat(row['CTR (link click-through rate)'] || '0') || 0;
      const costPerResult = parseFloat(row['Cost per results'] || '0') || 0;

      // Determine dates: use Day column if available, otherwise check date range
      const dates: string[] = [];
      if (hasDayColumn && row.Day) {
        dates.push(normalizeDate(row.Day));
      } else {
        const start = row['Reporting starts'];
        const end = row['Reporting ends'];
        if (start === end) {
          dates.push(normalizeDate(start));
        } else {
          // Aggregated data: distribute evenly across each day in the range
          // Use UTC to avoid timezone issues
          const startDate = new Date(start + 'T12:00:00Z');
          const endDate = new Date(end + 'T12:00:00Z');
          const current = new Date(startDate);
          while (current <= endDate) {
            const y = current.getUTCFullYear();
            const m = String(current.getUTCMonth() + 1).padStart(2, '0');
            const d = String(current.getUTCDate()).padStart(2, '0');
            dates.push(`${y}-${m}-${d}`);
            current.setUTCDate(current.getUTCDate() + 1);
          }
        }
      }

      const numDays = dates.length;
      const dailySpend = totalSpend / numDays;
      const dailyResults = Math.round(totalResults / numDays);
      const dailyImpressions = Math.round(impressions / numDays);
      const dailyLinkClicks = Math.round(linkClicks / numDays);

      for (const date of dates) {
        const existingCsv = findByNameCsv.get(date, adName) as { id: number } | undefined;
        if (existingCsv) {
          updateByNameCsv.run(
            dailySpend, dailyResults, Math.round(reach / numDays), frequency,
            dailyImpressions, cpm, dailyLinkClicks, ctr,
            row['Ad delivery'] || '', row['Attribution setting'] || '',
            costPerResult, getCampaignType(adName), parseBatch(adName),
            existingCsv.id
          );
        } else {
          insertByNameCsv.run(
            date, client.id, adName,
            dailySpend, dailyResults, Math.round(reach / numDays), frequency,
            dailyImpressions, cpm, dailyLinkClicks, ctr,
            row['Ad delivery'] || '', row['Attribution setting'] || '',
            costPerResult, getCampaignType(adName), parseBatch(adName)
          );
        }
      }
      rowsProcessed++;
    }
  });

  insertMany();

  // Record upload
  db.prepare('INSERT INTO uploads (filename, upload_type, rows_processed) VALUES (?, ?, ?)').run(
    filename, 'meta_ads', rowsProcessed
  );

  // Recalculate daily summaries for affected dates
  recalculateSummaries();

  return { rowsProcessed, errors };
}

export function parseNumeroCsv(csvText: string, filename: string): { rowsProcessed: number; errors: string[] } {
  const db = getDb();
  const errors: string[] = [];

  const parsed = Papa.parse<NumeroRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  if (parsed.errors.length > 0) {
    errors.push(...parsed.errors.map(e => `Row ${e.row}: ${e.message}`));
  }

  // Clear existing revenue for re-import
  // (Numero exports are snapshot-based, not incremental)

  const insertRevenue = db.prepare(`
    INSERT INTO revenue (date, client_id, refcode, amount, donor_name, member_code)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let rowsProcessed = 0;

  const insertMany = db.transaction(() => {
    for (const row of parsed.data) {
      const refcode = row['Last Contribution Reference Codes'] || '';
      const amount = parseFloat(row['Last Contribution Amount'] || '0');
      const dateStr = row['Last Contribution Date'] || '';
      const memberCode = row['Last Contribution Member Code'] || '';
      const donorName = `${row['First Name'] || ''} ${row['Last Name'] || ''}`.trim();

      if (!dateStr || amount <= 0) continue;

      // Parse date from "MM/DD/YYYY HH:MM AM/PM" format
      const date = normalizeNumeroDate(dateStr);
      if (!date) {
        errors.push(`Invalid date: ${dateStr}`);
        continue;
      }

      // Try to match client by refcode first, then by member code
      let clientId: number | null = null;

      if (refcode) {
        const client = getClientByAdName(refcode);
        if (client) clientId = client.id;
      }

      if (!clientId && memberCode) {
        // Try matching by member code / entity name
        const client = db.prepare(
          "SELECT id FROM clients WHERE entity_name LIKE ? OR name LIKE ?"
        ).get(`%${memberCode}%`, `%${memberCode}%`) as { id: number } | undefined;
        if (client) clientId = client.id;
      }

      if (!clientId) {
        // Skip non-matched revenue (could be from non-Meta sources)
        continue;
      }

      insertRevenue.run(date, clientId, refcode, amount, donorName, memberCode);
      rowsProcessed++;
    }
  });

  insertMany();

  db.prepare('INSERT INTO uploads (filename, upload_type, rows_processed) VALUES (?, ?, ?)').run(
    filename, 'numero_crm', rowsProcessed
  );

  recalculateSummaries();

  return { rowsProcessed, errors };
}

export function parseActBlueCsv(csvText: string, filename: string, knownShortCode?: string): { rowsProcessed: number; errors: string[] } {
  const db = getDb();
  const errors: string[] = [];

  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  if (parsed.errors.length > 0) {
    errors.push(...parsed.errors.map(e => `Row ${e.row}: ${e.message}`));
  }

  const insertRevenue = db.prepare(`
    INSERT INTO revenue (date, client_id, refcode, amount, donor_name, member_code, receipt_id, fundraising_page, recurrence_number, refunded)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(receipt_id) DO UPDATE SET
      amount = excluded.amount,
      refcode = excluded.refcode,
      fundraising_page = excluded.fundraising_page,
      recurrence_number = excluded.recurrence_number,
      refunded = excluded.refunded
  `);

  // Fallback for rows without receipt_id (manual uploads)
  const insertRevenueNoReceipt = db.prepare(`
    INSERT INTO revenue (date, client_id, refcode, amount, donor_name, member_code, fundraising_page, recurrence_number, refunded)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let rowsProcessed = 0;

  // Log column headers for debugging
  const firstRow = (parsed.data as Record<string, string>[])[0];
  if (firstRow) {
    const cols = Object.keys(firstRow);
    console.log(`[ActBlue CSV] Columns (${cols.length}): ${cols.join(', ')}`);
    const hasLineitem = cols.some(c => c.toLowerCase().includes('lineitem'));
    const hasReceipt = cols.some(c => c.toLowerCase().includes('receipt'));
    const hasRecurrence = cols.some(c => c.toLowerCase().includes('recurrence'));
    const hasRefund = cols.some(c => c.toLowerCase().includes('refund') || c.toLowerCase() === 'disposition');
    console.log(`[ActBlue CSV] Has Lineitem ID: ${hasLineitem}, Has Receipt ID: ${hasReceipt}, Has Recurrence: ${hasRecurrence}, Has Refund indicator: ${hasRefund}`);
  }

  // Helper: check if row is a refund across multiple possible column names
  const isRefundRow = (row: Record<string, string>): boolean => {
    // Explicit "Refunded" column (Yes/No/true/false/1/0)
    const refundedVal = (row['Refunded'] || row['refunded'] || '').toString().toLowerCase().trim();
    if (refundedVal === 'yes' || refundedVal === 'true' || refundedVal === '1') return true;

    // "Refunded At" timestamp means it was refunded
    const refundedAt = (row['Refunded At'] || row['refunded_at'] || row['Refund Date'] || '').toString().trim();
    if (refundedAt && refundedAt !== '0' && refundedAt.toLowerCase() !== 'null') return true;

    // Disposition column (ActBlue uses "refunded" as a disposition value)
    const disposition = (row['Disposition'] || row['disposition'] || '').toString().toLowerCase().trim();
    if (disposition === 'refunded' || disposition === 'refund' || disposition === 'voided') return true;

    // Status column
    const status = (row['Status'] || row['status'] || '').toString().toLowerCase().trim();
    if (status === 'refunded' || status === 'refund' || status === 'voided' || status === 'chargeback') return true;

    return false;
  };

  let refundedCount = 0;

  const insertMany = db.transaction(() => {
    for (const row of parsed.data as Record<string, string>[]) {
      const rawAmount = parseFloat(row['Amount'] || row['amount'] || '0');
      const dateStr = row['Date'] || row['date'] || row['Payment Date'] || '';
      const refcode = row['Refcode'] || row['refcode'] || row['Reference Code'] || '';
      const recipient = row['Recipient'] || row['recipient'] || '';
      const receiptId = row['Lineitem ID'] || row['Receipt ID'] || '';
      const donorName = `${row['First Name'] || row['Donor First Name'] || ''} ${row['Last Name'] || row['Donor Last Name'] || ''}`.trim();
      const fundraisingPage = row['Fundraising Page'] || '';
      const recurrenceNumber = parseInt(row['Recurrence Number'] || '1', 10) || 1;

      if (!dateStr) continue;

      // Detect refund: either explicit refund flag, or negative amount
      const refunded = isRefundRow(row) || rawAmount < 0;
      const amount = Math.abs(rawAmount); // store absolute value; flag indicates refund

      // Skip zero-amount rows (not useful)
      if (amount === 0) continue;

      if (refunded) refundedCount++;

      const date = normalizeDate(dateStr.split(' ')[0]); // strip time

      let clientId: number | null = null;

      // If we know the client from the API sync, use that directly
      if (knownShortCode) {
        const client = db.prepare('SELECT id FROM clients WHERE short_code = ?').get(knownShortCode) as { id: number } | undefined;
        if (client) clientId = client.id;
      }

      // Otherwise try matching by refcode (ad name prefix), then by recipient
      if (!clientId && refcode) {
        const client = getClientByAdName(refcode);
        if (client) clientId = client.id;
      }
      if (!clientId && recipient) {
        const client = db.prepare(
          "SELECT id FROM clients WHERE entity_name LIKE ? OR name LIKE ?"
        ).get(`%${recipient}%`, `%${recipient}%`) as { id: number } | undefined;
        if (client) clientId = client.id;
      }

      if (!clientId) continue;

      const refundedFlag = refunded ? 1 : 0;
      if (receiptId) {
        insertRevenue.run(date, clientId, refcode, amount, donorName, recipient, receiptId, fundraisingPage, recurrenceNumber, refundedFlag);
      } else {
        insertRevenueNoReceipt.run(date, clientId, refcode, amount, donorName, recipient, fundraisingPage, recurrenceNumber, refundedFlag);
      }
      rowsProcessed++;
    }
  });

  insertMany();

  if (refundedCount > 0) {
    console.log(`[ActBlue CSV] Flagged ${refundedCount} refunded rows in ${filename}`);
  }

  // Post-import: for every refunded row, find and flag the matching ORIGINAL
  // positive row (same client/amount/donor/refcode within 30 days) as refunded.
  // Handles ActBlue's pattern of emitting a separate refund row without updating
  // the original charge. Matches one-for-one by id so duplicate donations aren't
  // all flagged when only one was refunded.
  const findOriginal = db.prepare(`
    SELECT id FROM revenue
    WHERE refunded = 0
      AND client_id = ?
      AND amount = ?
      AND donor_name = ?
      AND refcode = ?
      AND date <= ?
      AND date >= date(?, '-30 days')
    ORDER BY date DESC
    LIMIT 1
  `);
  const flagById = db.prepare('UPDATE revenue SET refunded = 1 WHERE id = ?');
  let matchedOriginals = 0;

  const matchRefunds = db.transaction(() => {
    const refundedRows = db.prepare(`
      SELECT id, client_id, refcode, donor_name, amount, date
      FROM revenue WHERE refunded = 1
    `).all() as { id: number; client_id: number; refcode: string; donor_name: string; amount: number; date: string }[];

    for (const r of refundedRows) {
      // Skip matching to itself (the refund row is already flagged)
      const original = findOriginal.get(r.client_id, r.amount, r.donor_name, r.refcode, r.date, r.date) as { id: number } | undefined;
      if (original && original.id !== r.id) {
        flagById.run(original.id);
        matchedOriginals++;
      }
    }
  });
  matchRefunds();

  if (matchedOriginals > 0) {
    console.log(`[ActBlue CSV] Matched and flagged ${matchedOriginals} original donations as refunded`);
  }

  db.prepare('INSERT INTO uploads (filename, upload_type, rows_processed) VALUES (?, ?, ?)').run(
    filename, 'actblue', rowsProcessed
  );

  recalculateSummaries();

  return { rowsProcessed, errors };
}

function normalizeDate(dateStr: string): string {
  // Handle various date formats and normalize to YYYY-MM-DD
  if (!dateStr) return '';

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  // MM/DD/YYYY
  const mdyMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    return `${mdyMatch[3]}-${mdyMatch[1].padStart(2, '0')}-${mdyMatch[2].padStart(2, '0')}`;
  }

  // Try parsing as date
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }

  return dateStr;
}

function normalizeNumeroDate(dateStr: string): string {
  // Format: "MM/DD/YYYY HH:MM AM/PM" or "MM/DD/YYYY HH:MM:SS AM"
  const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  }
  return normalizeDate(dateStr);
}

function recalculateSummaries() {
  const db = getDb();

  // Load per-client fee rates
  const feeRates = new Map<number, number>();
  const allClients = db.prepare('SELECT id, fee_rate FROM clients').all() as { id: number; fee_rate: number }[];
  for (const c of allClients) {
    feeRates.set(c.id, c.fee_rate ?? 0.10);
  }

  // Get all unique date/client combinations from ad_spend
  const spendData = db.prepare(`
    SELECT date, client_id, SUM(spend) as total_spend
    FROM ad_spend
    GROUP BY date, client_id
  `).all() as { date: string; client_id: number; total_spend: number }[];

  // Get revenue data grouped by date and client
  // Only count fbig forms (ad-attributed). Include legacy rows (no fundraising_page) until re-synced.
  const revenueData = db.prepare(`
    SELECT date, client_id, SUM(amount) as total_revenue
    FROM revenue
    WHERE fundraising_page LIKE '%fbig%' AND refunded = 0
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
