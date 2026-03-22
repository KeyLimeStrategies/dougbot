import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const searchParams = request.nextUrl.searchParams;
    const days = searchParams.get('days');
    const client = searchParams.get('client') || 'all';

    // Use Eastern Time for date boundaries
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

    let dateFilter = '';
    const params: (string | number)[] = [];

    if (days && days !== 'all' && days !== '0') {
      const d = parseInt(days, 10) || 30;
      const cutoff = new Date(nowET);
      cutoff.setDate(cutoff.getDate() - d);
      const cutoffStr = cutoff.toISOString().split('T')[0];
      dateFilter = 'AND r.date >= ?';
      params.push(cutoffStr);
    } else if (!days) {
      // Default to 30 days
      const cutoff = new Date(nowET);
      cutoff.setDate(cutoff.getDate() - 30);
      const cutoffStr = cutoff.toISOString().split('T')[0];
      dateFilter = 'AND r.date >= ?';
      params.push(cutoffStr);
    }
    // days === '0' or 'all' means no date filter (all time)

    let clientFilter = '';
    if (client && client !== 'all') {
      clientFilter = 'AND c.short_code = ?';
      params.push(client);
    }

    // Main summary query
    const summaryRows = db.prepare(`
      SELECT
        r.fundraising_page,
        c.name as client_name,
        c.short_code,
        COUNT(*) as contribution_count,
        SUM(r.amount) as total_amount,
        MIN(r.date) as first_contribution,
        MAX(r.date) as last_contribution,
        COUNT(DISTINCT r.date) as days_active
      FROM revenue r
      JOIN clients c ON c.id = r.client_id
      WHERE c.active = 1 ${dateFilter} ${clientFilter}
      GROUP BY r.fundraising_page, c.short_code
      ORDER BY total_amount DESC
    `).all(...params) as {
      fundraising_page: string | null;
      client_name: string;
      short_code: string;
      contribution_count: number;
      total_amount: number;
      first_contribution: string;
      last_contribution: string;
      days_active: number;
    }[];

    // Daily breakdown query
    const dailyRows = db.prepare(`
      SELECT
        r.fundraising_page,
        c.short_code,
        r.date,
        COUNT(*) as contribution_count,
        SUM(r.amount) as total_amount
      FROM revenue r
      JOIN clients c ON c.id = r.client_id
      WHERE c.active = 1 ${dateFilter} ${clientFilter}
      GROUP BY r.fundraising_page, c.short_code, r.date
      ORDER BY r.date DESC
    `).all(...params) as {
      fundraising_page: string | null;
      short_code: string;
      date: string;
      contribution_count: number;
      total_amount: number;
    }[];

    // Build daily breakdown map keyed by fundraising_page + short_code
    const dailyMap = new Map<string, { date: string; contributions: number; amount: number }[]>();
    for (const row of dailyRows) {
      const key = `${row.fundraising_page || '(none)'}::${row.short_code}`;
      if (!dailyMap.has(key)) {
        dailyMap.set(key, []);
      }
      dailyMap.get(key)!.push({
        date: row.date,
        contributions: row.contribution_count,
        amount: row.total_amount,
      });
    }

    // Get list of clients for filter dropdown
    const clients = db.prepare(
      'SELECT short_code, name FROM clients WHERE active = 1 ORDER BY name'
    ).all() as { short_code: string; name: string }[];

    // Build response
    const forms = summaryRows.map(row => {
      const key = `${row.fundraising_page || '(none)'}::${row.short_code}`;
      const isFbig = (row.fundraising_page || '').toLowerCase().includes('fbig');
      return {
        fundraising_page: row.fundraising_page || '(none)',
        client_name: row.client_name,
        short_code: row.short_code,
        contribution_count: row.contribution_count,
        total_amount: row.total_amount,
        first_contribution: row.first_contribution,
        last_contribution: row.last_contribution,
        days_active: row.days_active,
        avg_per_day: row.days_active > 0 ? row.total_amount / row.days_active : row.total_amount,
        is_ad: isFbig,
        daily: dailyMap.get(key) || [],
      };
    });

    return NextResponse.json({ forms, clients });
  } catch (error) {
    console.error('Form tracker error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
