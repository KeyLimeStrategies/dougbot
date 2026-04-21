import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// POST: Force recalculate daily summaries (applies fbig filter, fee rates, etc.)
export async function POST() {
  try {
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

    // Get revenue data - ONLY fbig forms (ad-attributed)
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

    let updated = 0;

    const updateAll = db.transaction(() => {
      // Clear existing summaries to remove stale data
      db.prepare('DELETE FROM daily_summary').run();

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
        updated++;
      }

      // Revenue-only days (no spend)
      for (const r of revenueData) {
        const hasSpend = spendData.some(s => s.date === r.date && s.client_id === r.client_id);
        if (!hasSpend) {
          const profitShare = r.total_revenue > 0 ? r.total_revenue * 0.25 : 0;
          upsertSummary.run(
            r.date, r.client_id, 0, r.total_revenue,
            0, 0, r.total_revenue, profitShare
          );
          updated++;
        }
      }
    });

    updateAll();

    return NextResponse.json({
      success: true,
      message: `Recalculated ${updated} daily summaries with fbig filter`,
      updated,
    });
  } catch (error) {
    console.error('Recalculate error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Recalculation failed' },
      { status: 500 }
    );
  }
}
