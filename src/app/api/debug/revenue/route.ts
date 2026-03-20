import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request: NextRequest) {
  const db = getDb();
  const searchParams = request.nextUrl.searchParams;
  const client = searchParams.get('client') || 'rcp';
  const date = searchParams.get('date') || new Date().toISOString().split('T')[0];

  // Get all revenue rows for this client on this date
  const rows = db.prepare(`
    SELECT r.date, r.refcode, r.amount, r.fundraising_page, r.receipt_id, r.donor_name
    FROM revenue r
    JOIN clients c ON c.id = r.client_id
    WHERE c.short_code = ? AND r.date = ?
    ORDER BY r.amount DESC
  `).all(client, date) as { date: string; refcode: string; amount: number; fundraising_page: string; receipt_id: string; donor_name: string }[];

  const fbigRows = rows.filter(r => r.fundraising_page && r.fundraising_page.includes('fbig'));
  const nonFbigRows = rows.filter(r => !r.fundraising_page || !r.fundraising_page.includes('fbig'));

  return NextResponse.json({
    client,
    date,
    total_rows: rows.length,
    total_amount: rows.reduce((s, r) => s + r.amount, 0),
    fbig_count: fbigRows.length,
    fbig_amount: fbigRows.reduce((s, r) => s + r.amount, 0),
    non_fbig_count: nonFbigRows.length,
    non_fbig_amount: nonFbigRows.reduce((s, r) => s + r.amount, 0),
    fbig_rows: fbigRows.map(r => ({ amount: r.amount, page: r.fundraising_page, refcode: r.refcode, donor: r.donor_name })),
    non_fbig_rows: nonFbigRows.map(r => ({ amount: r.amount, page: r.fundraising_page, refcode: r.refcode, donor: r.donor_name })),
  });
}
