import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const searchParams = request.nextUrl.searchParams;
    const days = searchParams.get('days');
    const client = searchParams.get('client') || 'all';
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

    // Use Eastern Time for date boundaries
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

    let dateFilter = '';
    const params: (string | number)[] = [];

    if (startDate && endDate) {
      dateFilter = 'AND r.date >= ? AND r.date <= ?';
      params.push(startDate, endDate);
    } else if (startDate) {
      dateFilter = 'AND r.date >= ?';
      params.push(startDate);
    } else if (days && days !== 'all' && days !== '0') {
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
      WHERE c.active = 1 AND r.refunded = 0 ${dateFilter} ${clientFilter}
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
      WHERE c.active = 1 AND r.refunded = 0 ${dateFilter} ${clientFilter}
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

    // Channel daily aggregation (sms, email, fbig, other) for charts
    // Classify forms by channel based on name patterns
    const channelDailyMap = new Map<string, Map<string, { contributions: number; amount: number }>>();

    for (const row of dailyRows) {
      const page = (row.fundraising_page || '').toLowerCase();
      let channel = 'other';
      if (page.includes('sms')) channel = 'sms';
      else if (page.includes('email') || page.includes('eml')) channel = 'email';
      else if (page.includes('fbig')) channel = 'ads';
      else if (page.includes('web') || page.includes('site')) channel = 'website';

      if (!channelDailyMap.has(row.date)) {
        channelDailyMap.set(row.date, new Map());
      }
      const dayChannels = channelDailyMap.get(row.date)!;
      if (!dayChannels.has(channel)) {
        dayChannels.set(channel, { contributions: 0, amount: 0 });
      }
      const c = dayChannels.get(channel)!;
      c.contributions += row.contribution_count;
      c.amount += row.total_amount;
    }

    // Convert to array sorted by date
    const channelDaily = Array.from(channelDailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, channels]) => {
        const entry: Record<string, number | string> = { date };
        for (const [channel, data] of channels) {
          entry[`${channel}_amount`] = Math.round(data.amount * 100) / 100;
          entry[`${channel}_count`] = data.contributions;
        }
        return entry;
      });

    // Get list of clients for filter dropdown
    const clients = db.prepare(
      'SELECT short_code, name FROM clients WHERE active = 1 ORDER BY name'
    ).all() as { short_code: string; name: string }[];

    // Build response
    const forms = summaryRows.map(row => {
      const key = `${row.fundraising_page || '(none)'}::${row.short_code}`;
      const page = (row.fundraising_page || '').toLowerCase();
      const isFbig = page.includes('fbig');

      let channel = 'other';
      if (page.includes('sms')) channel = 'sms';
      else if (page.includes('email') || page.includes('eml')) channel = 'email';
      else if (isFbig) channel = 'ads';
      else if (page.includes('web') || page.includes('site')) channel = 'website';

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
        channel,
        daily: dailyMap.get(key) || [],
      };
    });

    return NextResponse.json({ forms, clients, channelDaily });
  } catch (error) {
    console.error('Form tracker error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
