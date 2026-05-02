import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// GET: Hourly donation heatmap data from fbig forms
// Query params:
//   days=7 (default 7, how many days back to look)
//   client=ef (optional, filter to one client)
export async function GET(request: NextRequest) {
  const db = getDb();
  const sp = request.nextUrl.searchParams;
  const days = parseInt(sp.get('days') || '7', 10);
  const clientFilter = sp.get('client') || null;

  // Date range: last N days (excluding today since it's incomplete)
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 1);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const dateStart = fmt(startDate);
  const dateEnd = fmt(endDate);

  // Build query for hourly donation counts and amounts from fbig forms
  let whereClause = `
    WHERE r.fundraising_page LIKE '%fbig%'
      AND r.refunded = 0
      AND r.contribution_hour IS NOT NULL
      AND r.date >= ?
      AND r.date <= ?
  `;
  const params: (string | number)[] = [dateStart, dateEnd];

  if (clientFilter) {
    whereClause += ` AND c.short_code = ?`;
    params.push(clientFilter);
  }

  // Only include ad clients
  whereClause += ` AND c.is_ad_client = 1`;

  // Hourly aggregates (across all days in range)
  const hourlyData = db.prepare(`
    SELECT
      r.contribution_hour as hour,
      COUNT(*) as count,
      SUM(r.amount) as total_amount,
      AVG(r.amount) as avg_amount
    FROM revenue r
    JOIN clients c ON c.id = r.client_id
    ${whereClause}
    GROUP BY r.contribution_hour
    ORDER BY r.contribution_hour
  `).all(...params) as { hour: number; count: number; total_amount: number; avg_amount: number }[];

  // Day-of-week x hour breakdown (0=Sunday..6=Saturday)
  // SQLite strftime('%w', date) gives day of week (0=Sunday)
  const dayHourData = db.prepare(`
    SELECT
      CAST(strftime('%w', r.date) AS INTEGER) as day_of_week,
      r.contribution_hour as hour,
      COUNT(*) as count,
      SUM(r.amount) as total_amount
    FROM revenue r
    JOIN clients c ON c.id = r.client_id
    ${whereClause}
    GROUP BY day_of_week, r.contribution_hour
    ORDER BY day_of_week, r.contribution_hour
  `).all(...params) as { day_of_week: number; hour: number; count: number; total_amount: number }[];

  // Per-client hourly breakdown
  const clientHourData = db.prepare(`
    SELECT
      c.short_code as client,
      c.name as client_name,
      r.contribution_hour as hour,
      COUNT(*) as count,
      SUM(r.amount) as total_amount
    FROM revenue r
    JOIN clients c ON c.id = r.client_id
    ${whereClause}
    GROUP BY c.short_code, c.name, r.contribution_hour
    ORDER BY c.short_code, r.contribution_hour
  `).all(...params) as { client: string; client_name: string; hour: number; count: number; total_amount: number }[];

  // Total contributions with hour data vs without (coverage metric)
  const coverage = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN r.contribution_hour IS NOT NULL THEN 1 ELSE 0 END) as with_hour
    FROM revenue r
    JOIN clients c ON c.id = r.client_id
    ${whereClause.replace('AND r.contribution_hour IS NOT NULL', '')}
  `).all(...params) as { total: number; with_hour: number }[];

  // Divide total count by number of days for "average per day"
  const numDays = Math.max(1, days);

  return NextResponse.json({
    date_range: { start: dateStart, end: dateEnd, days },
    hourly: hourlyData.map(h => ({
      ...h,
      avg_per_day: +(h.count / numDays).toFixed(1),
    })),
    day_hour: dayHourData,
    by_client: clientHourData,
    coverage: coverage[0] || { total: 0, with_hour: 0 },
  });
}
