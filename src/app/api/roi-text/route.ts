import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get('date');

    if (!date) {
      return NextResponse.json({ error: 'Date parameter required' }, { status: 400 });
    }

    const rows = db.prepare(`
      SELECT c.name as client_name, ds.total_revenue, ds.spend_with_fee, ds.true_roas
      FROM daily_summary ds
      JOIN clients c ON c.id = ds.client_id
      WHERE ds.date = ? AND (ds.total_spend > 0 OR ds.total_revenue > 0) AND c.active = 1 AND c.is_ad_client = 1
      ORDER BY ds.true_roas DESC
    `).all(date) as { client_name: string; total_revenue: number; spend_with_fee: number; true_roas: number }[];

    if (rows.length === 0) {
      return NextResponse.json({ text: `No data for ${date}` });
    }

    // Format date as M/D
    const [year, month, day] = date.split('-');
    const shortDate = `${parseInt(month)}/${parseInt(day)}`;

    let text = `${shortDate} ROI (with fee):\n`;
    for (const row of rows) {
      const rev = Math.round(row.total_revenue ?? 0);
      const spend = Math.round(row.spend_with_fee ?? 0);
      const roas = row.true_roas ?? 0;
      const roasStr = isFinite(roas) && roas > 0 ? roas.toFixed(3) : (spend === 0 ? 'N/A' : '0.000');
      text += `${row.client_name} ${rev}/${spend}= ${roasStr}\n`;
    }

    return NextResponse.json({ text, date });
  } catch (error) {
    console.error('ROI text error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
