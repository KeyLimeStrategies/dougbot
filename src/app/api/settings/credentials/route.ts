import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { saveActBlueCredentials, removeActBlueCredentials, testActBlueCredentials } from '@/lib/actblue';

// GET: List all clients and their credential status
export async function GET() {
  const db = getDb();

  const clients = db.prepare(`
    SELECT c.id, c.short_code, c.name, c.entity_name, c.fee_rate, c.active,
      CASE WHEN ac.id IS NOT NULL THEN 1 ELSE 0 END as has_actblue
    FROM clients c
    LEFT JOIN api_credentials ac ON ac.client_id = c.id AND ac.provider = 'actblue'
    ORDER BY c.active DESC, c.name
  `).all() as { id: number; short_code: string; name: string; entity_name: string; fee_rate: number; active: number; has_actblue: number }[];

  // Also check env vars
  const shortCodes = ['mk', 'rcp', 'ef', 'mc', 'yonce', 'br', 'ko', 'effie', 'yen', 'gv', 'av'];
  const envConfigured = shortCodes.filter(code => {
    return process.env[`ACTBLUE_${code.toUpperCase()}_UUID`] && process.env[`ACTBLUE_${code.toUpperCase()}_SECRET`];
  });

  return NextResponse.json({
    clients: clients.map(c => ({
      ...c,
      fee_rate: c.fee_rate ?? 0.10,
      active: c.active === 1,
      has_actblue: c.has_actblue === 1 || envConfigured.includes(c.short_code),
      source: c.has_actblue === 1 ? 'db' : envConfigured.includes(c.short_code) ? 'env' : null,
    })),
  });
}

// POST: Add or update credentials for a client
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { short_code, client_uuid, client_secret, test_only } = body;

    if (!short_code || !client_uuid || !client_secret) {
      return NextResponse.json(
        { success: false, error: 'short_code, client_uuid, and client_secret are required' },
        { status: 400 }
      );
    }

    // Test credentials first
    const valid = await testActBlueCredentials(client_uuid, client_secret);
    if (!valid) {
      return NextResponse.json(
        { success: false, error: 'Invalid credentials. ActBlue rejected the UUID/secret.' },
        { status: 400 }
      );
    }

    if (test_only) {
      return NextResponse.json({ success: true, message: 'Credentials verified' });
    }

    // Save to DB
    saveActBlueCredentials(short_code, client_uuid, client_secret);

    return NextResponse.json({
      success: true,
      message: `ActBlue credentials saved for ${short_code}`,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to save credentials' },
      { status: 500 }
    );
  }
}

// PATCH: Update client settings (fee rate or active status)
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { short_code, fee_rate, active } = body;

    if (!short_code) {
      return NextResponse.json(
        { success: false, error: 'short_code is required' },
        { status: 400 }
      );
    }

    const db = getDb();

    if (fee_rate !== undefined) {
      const rate = parseFloat(fee_rate);
      if (isNaN(rate) || rate < 0 || rate > 1) {
        return NextResponse.json(
          { success: false, error: 'fee_rate must be between 0 and 1' },
          { status: 400 }
        );
      }
      db.prepare('UPDATE clients SET fee_rate = ? WHERE short_code = ?').run(rate, short_code);
      return NextResponse.json({
        success: true,
        message: `Fee rate updated to ${(rate * 100).toFixed(0)}% for ${short_code}`,
      });
    }

    if (active !== undefined) {
      db.prepare('UPDATE clients SET active = ? WHERE short_code = ?').run(active ? 1 : 0, short_code);
      return NextResponse.json({
        success: true,
        message: `${short_code} ${active ? 'activated' : 'deactivated'}`,
      });
    }

    return NextResponse.json(
      { success: false, error: 'fee_rate or active is required' },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to update' },
      { status: 500 }
    );
  }
}

// DELETE: Remove credentials for a client
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { short_code } = body;

    if (!short_code) {
      return NextResponse.json({ success: false, error: 'short_code is required' }, { status: 400 });
    }

    removeActBlueCredentials(short_code);
    return NextResponse.json({ success: true, message: `Credentials removed for ${short_code}` });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to remove credentials' },
      { status: 500 }
    );
  }
}
