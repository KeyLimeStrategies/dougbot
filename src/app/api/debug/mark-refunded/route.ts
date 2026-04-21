import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// Manually mark revenue rows as refunded.
// Supports multiple modes:
//   1. ?id=123              — flag a single revenue row by its primary key
//   2. ?ids=1,2,3            — flag multiple rows by id
//   3. ?client=ef&date=2026-04-14&min_amount=3000 — flag rows matching criteria
//        (optional: donor=Name, refcode=xxx)
//   4. ?unmark=true&id=123   — UN-mark (set refunded=0)
// POST or GET both work; recalculates daily summaries after modifying rows.
export async function POST(request: NextRequest) {
  return handle(request);
}
export async function GET(request: NextRequest) {
  return handle(request);
}

async function handle(request: NextRequest) {
  try {
    const db = getDb();
    const sp = request.nextUrl.searchParams;
    const unmark = sp.get('unmark') === 'true';
    const newValue = unmark ? 0 : 1;

    let ids: number[] = [];

    // Mode 1/2: by id(s)
    const singleId = sp.get('id');
    const idList = sp.get('ids');
    if (singleId) ids.push(parseInt(singleId, 10));
    if (idList) ids.push(...idList.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)));

    // Mode 3: by criteria
    const clientCode = sp.get('client');
    const date = sp.get('date');
    const minAmount = sp.get('min_amount');
    const exactAmount = sp.get('amount');
    const donor = sp.get('donor');
    const refcode = sp.get('refcode');

    if (!ids.length && (clientCode || date || minAmount || exactAmount || donor || refcode)) {
      const where: string[] = [];
      const params: (string | number)[] = [];
      if (clientCode) {
        where.push('c.short_code = ?');
        params.push(clientCode);
      }
      if (date) { where.push('r.date = ?'); params.push(date); }
      if (minAmount) { where.push('r.amount >= ?'); params.push(parseFloat(minAmount)); }
      if (exactAmount) { where.push('r.amount = ?'); params.push(parseFloat(exactAmount)); }
      if (donor) { where.push('r.donor_name LIKE ?'); params.push(`%${donor}%`); }
      if (refcode) { where.push('r.refcode = ?'); params.push(refcode); }
      const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const matches = db.prepare(`
        SELECT r.id FROM revenue r
        JOIN clients c ON c.id = r.client_id
        ${whereClause}
      `).all(...params) as { id: number }[];
      ids = matches.map(m => m.id);
    }

    if (ids.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No matching rows. Use ?id=N, ?ids=a,b,c, or criteria (client/date/amount/donor/refcode).',
      }, { status: 400 });
    }

    // Apply the flag
    const update = db.prepare('UPDATE revenue SET refunded = ? WHERE id = ?');
    const updateAll = db.transaction(() => {
      for (const id of ids) update.run(newValue, id);
    });
    updateAll();

    // Collect the affected rows for the response
    const placeholders = ids.map(() => '?').join(',');
    const affected = db.prepare(`
      SELECT r.id, r.date, r.amount, r.refcode, r.donor_name, r.fundraising_page, r.refunded, c.short_code
      FROM revenue r JOIN clients c ON c.id = r.client_id
      WHERE r.id IN (${placeholders})
    `).all(...ids) as Array<{ id: number; date: string; amount: number; refcode: string; donor_name: string; fundraising_page: string; refunded: number; short_code: string }>;

    // Recalculate daily summaries for all affected (date, client) pairs
    const affectedDates = new Set<string>();
    for (const r of affected) affectedDates.add(`${r.date}|${r.short_code}`);

    const feeRates = new Map<number, number>();
    const allClients = db.prepare('SELECT id, short_code, fee_rate FROM clients').all() as { id: number; short_code: string; fee_rate: number }[];
    const codeToId = new Map<string, number>();
    for (const c of allClients) {
      feeRates.set(c.id, c.fee_rate ?? 0.10);
      codeToId.set(c.short_code, c.id);
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

    const recalc = db.transaction(() => {
      for (const key of affectedDates) {
        const [d, code] = key.split('|');
        const clientId = codeToId.get(code);
        if (!clientId) continue;
        const feeRate = feeRates.get(clientId) ?? 0.10;

        const spendRow = db.prepare(`
          SELECT COALESCE(SUM(spend), 0) as total_spend
          FROM ad_spend
          WHERE date = ? AND client_id = ?
        `).get(d, clientId) as { total_spend: number };

        const revRow = db.prepare(`
          SELECT COALESCE(SUM(amount), 0) as total_revenue
          FROM revenue
          WHERE date = ? AND client_id = ? AND fundraising_page LIKE '%fbig%' AND refunded = 0
        `).get(d, clientId) as { total_revenue: number };

        const totalSpend = spendRow.total_spend;
        const revenue = revRow.total_revenue;
        const feeAmount = totalSpend * feeRate;
        const spendWithFee = totalSpend + feeAmount;
        const trueRoas = spendWithFee > 0 ? revenue / spendWithFee : 0;
        const profit = revenue - spendWithFee;
        const profitShare = profit > 0 ? profit * 0.25 : 0;
        const keylimeCut = feeAmount + profitShare;

        upsertSummary.run(d, clientId, totalSpend, revenue, spendWithFee, trueRoas, profit, keylimeCut);
      }
    });
    recalc();

    return NextResponse.json({
      success: true,
      action: unmark ? 'unmarked' : 'marked as refunded',
      rows_updated: ids.length,
      affected_summaries: affectedDates.size,
      rows: affected,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
