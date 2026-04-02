import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST() {
  try {
    const db = getDb();

    // Find all rows where meta_ad_id IS NULL that have a matching row
    // with the same (date, ad_name) but WITH a meta_ad_id
    const dupes = db.prepare(`
      SELECT a.id
      FROM ad_spend a
      WHERE a.meta_ad_id IS NULL
        AND EXISTS (
          SELECT 1 FROM ad_spend b
          WHERE b.date = a.date
            AND b.ad_name = a.ad_name
            AND b.meta_ad_id IS NOT NULL
        )
    `).all() as { id: number }[];

    const deleteStmt = db.prepare('DELETE FROM ad_spend WHERE id = ?');
    const deleteMany = db.transaction(() => {
      for (const dupe of dupes) {
        deleteStmt.run(dupe.id);
      }
    });
    deleteMany();

    // Recalculate all daily summaries
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
    });
    updateAll();

    return NextResponse.json({
      success: true,
      duplicates_removed: dupes.length,
      summaries_recalculated: spendData.length,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
