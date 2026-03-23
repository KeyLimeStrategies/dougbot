import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// GET: List campaign changes
export async function GET(request: NextRequest) {
  const db = getDb();
  const searchParams = request.nextUrl.searchParams;
  const client = searchParams.get('client');
  const days = parseInt(searchParams.get('days') || '30', 10);

  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const cutoff = new Date(nowET);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  let query = `
    SELECT cc.date, cc.change_type, cc.description, cc.detected_at,
           c.name as client_name, c.short_code
    FROM campaign_changes cc
    JOIN clients c ON c.id = cc.client_id
    WHERE cc.date >= ?
  `;
  const params: string[] = [cutoffStr];

  if (client && client !== 'all') {
    query += ' AND c.short_code = ?';
    params.push(client);
  }

  query += ' ORDER BY cc.date DESC, cc.detected_at DESC';

  const changes = db.prepare(query).all(...params);

  return NextResponse.json({ changes });
}

// POST: Add a campaign change manually
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { short_code, date, change_type, description } = body;

    if (!short_code || !date || !change_type) {
      return NextResponse.json(
        { success: false, error: 'short_code, date, and change_type are required' },
        { status: 400 }
      );
    }

    const db = getDb();
    const client = db.prepare('SELECT id FROM clients WHERE short_code = ?').get(short_code) as { id: number } | undefined;
    if (!client) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }

    db.prepare(
      'INSERT INTO campaign_changes (date, client_id, change_type, description, source) VALUES (?, ?, ?, ?, ?)'
    ).run(date, client.id, change_type, description || '', 'manual');

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    );
  }
}
