import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { saveActBlueCredentials, removeActBlueCredentials, testActBlueCredentials } from '@/lib/actblue';

// GET: List all clients and their credential status
export async function GET() {
  const db = getDb();

  const clients = db.prepare(`
    SELECT c.id, c.short_code, c.name, c.entity_name, c.fee_rate, c.active, c.is_ad_client,
      CASE WHEN ac.id IS NOT NULL THEN 1 ELSE 0 END as has_actblue
    FROM clients c
    LEFT JOIN api_credentials ac ON ac.client_id = c.id AND ac.provider = 'actblue'
    ORDER BY c.active DESC, c.name
  `).all() as { id: number; short_code: string; name: string; entity_name: string; fee_rate: number; active: number; is_ad_client: number; has_actblue: number }[];

  // Also check env vars
  const shortCodes = ['mk', 'rcp', 'ef', 'mc', 'yonce', 'br', 'ko', 'effie', 'yen', 'gv', 'av'];
  const envConfigured = shortCodes.filter(code => {
    return process.env[`ACTBLUE_${code.toUpperCase()}_UUID`] && process.env[`ACTBLUE_${code.toUpperCase()}_SECRET`];
  });

  // Get last sync timestamps
  const lastActBlueSync = db.prepare(
    "SELECT uploaded_at FROM uploads WHERE upload_type LIKE '%actblue%' ORDER BY uploaded_at DESC LIMIT 1"
  ).get() as { uploaded_at: string } | undefined;
  const lastMetaSync = db.prepare(
    "SELECT uploaded_at FROM uploads WHERE upload_type LIKE '%meta%' ORDER BY uploaded_at DESC LIMIT 1"
  ).get() as { uploaded_at: string } | undefined;

  return NextResponse.json({
    clients: clients.map(c => ({
      ...c,
      fee_rate: c.fee_rate ?? 0.10,
      active: c.active === 1,
      is_ad_client: (c.is_ad_client ?? 1) === 1,
      has_actblue: c.has_actblue === 1 || envConfigured.includes(c.short_code),
      source: c.has_actblue === 1 ? 'db' : envConfigured.includes(c.short_code) ? 'env' : null,
    })),
    last_actblue_sync: lastActBlueSync?.uploaded_at || null,
    last_meta_sync: lastMetaSync?.uploaded_at || null,
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

// PUT: Create a new client
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { short_code, name, entity_name, is_ad_client, fee_rate } = body;

    if (!short_code || !name) {
      return NextResponse.json(
        { success: false, error: 'short_code and name are required' },
        { status: 400 }
      );
    }

    // Validate short_code: lowercase, no spaces, alphanumeric
    const cleanCode = short_code.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanCode.length === 0 || cleanCode.length > 20) {
      return NextResponse.json(
        { success: false, error: 'Short code must be 1-20 alphanumeric characters' },
        { status: 400 }
      );
    }

    const db = getDb();

    // Check if short_code already exists
    const existing = db.prepare('SELECT id FROM clients WHERE short_code = ?').get(cleanCode);
    if (existing) {
      return NextResponse.json(
        { success: false, error: `Client with short code "${cleanCode}" already exists` },
        { status: 400 }
      );
    }

    const rate = fee_rate !== undefined ? parseFloat(fee_rate) / 100 : 0.10;

    db.prepare(
      'INSERT INTO clients (short_code, name, entity_name, fee_rate, is_ad_client, active) VALUES (?, ?, ?, ?, ?, 1)'
    ).run(cleanCode, name, entity_name || name, rate, is_ad_client === false ? 0 : 1);

    return NextResponse.json({
      success: true,
      message: `Client "${name}" (${cleanCode}) created`,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to create client' },
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

    if (body.is_ad_client !== undefined) {
      db.prepare('UPDATE clients SET is_ad_client = ? WHERE short_code = ?').run(body.is_ad_client ? 1 : 0, short_code);
      return NextResponse.json({
        success: true,
        message: `${short_code} ${body.is_ad_client ? 'marked as ad client' : 'marked as non-ad client'}`,
      });
    }

    return NextResponse.json(
      { success: false, error: 'fee_rate, active, or is_ad_client is required' },
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
