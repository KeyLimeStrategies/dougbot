import { getDb } from './db';

const ACTBLUE_API_BASE = 'https://secure.actblue.com/api/v1';

interface ActBlueCredentials {
  shortCode: string;
  clientUuid: string;
  clientSecret: string;
}

// Load ActBlue credentials from DB, falling back to env vars
export function getActBlueCredentials(): ActBlueCredentials[] {
  const creds: ActBlueCredentials[] = [];
  const seen = new Set<string>();

  // DB credentials first
  const db = getDb();
  const dbCreds = db.prepare(`
    SELECT c.short_code, ac.credential_key, ac.credential_secret
    FROM api_credentials ac
    JOIN clients c ON c.id = ac.client_id
    WHERE ac.provider = 'actblue'
  `).all() as { short_code: string; credential_key: string; credential_secret: string }[];

  for (const row of dbCreds) {
    creds.push({
      shortCode: row.short_code,
      clientUuid: row.credential_key,
      clientSecret: row.credential_secret,
    });
    seen.add(row.short_code);
  }

  // Env var fallback for any not in DB
  const shortCodes = ['mk', 'rcp', 'ef', 'mc', 'yonce', 'br', 'ko', 'effie', 'yen', 'gv', 'av'];
  for (const code of shortCodes) {
    if (seen.has(code)) continue;
    const uuid = process.env[`ACTBLUE_${code.toUpperCase()}_UUID`];
    const secret = process.env[`ACTBLUE_${code.toUpperCase()}_SECRET`];
    if (uuid && secret) {
      creds.push({ shortCode: code, clientUuid: uuid, clientSecret: secret });
    }
  }

  return creds;
}

// Save credentials to DB
export function saveActBlueCredentials(shortCode: string, clientUuid: string, clientSecret: string): void {
  const db = getDb();
  const client = db.prepare('SELECT id FROM clients WHERE short_code = ?').get(shortCode) as { id: number } | undefined;
  if (!client) {
    throw new Error(`Unknown client: ${shortCode}`);
  }

  db.prepare(`
    INSERT INTO api_credentials (client_id, provider, credential_key, credential_secret)
    VALUES (?, 'actblue', ?, ?)
    ON CONFLICT(client_id, provider) DO UPDATE SET
      credential_key = excluded.credential_key,
      credential_secret = excluded.credential_secret
  `).run(client.id, clientUuid, clientSecret);
}

// Remove credentials from DB
export function removeActBlueCredentials(shortCode: string): void {
  const db = getDb();
  const client = db.prepare('SELECT id FROM clients WHERE short_code = ?').get(shortCode) as { id: number } | undefined;
  if (!client) return;
  db.prepare("DELETE FROM api_credentials WHERE client_id = ? AND provider = 'actblue'").run(client.id);
}

// Test credentials by making a small API call
export async function testActBlueCredentials(clientUuid: string, clientSecret: string): Promise<boolean> {
  const auth = Buffer.from(`${clientUuid}:${clientSecret}`).toString('base64');
  const today = new Date().toISOString().split('T')[0];

  const res = await fetch(`${ACTBLUE_API_BASE}/csvs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${auth}`,
    },
    body: JSON.stringify({
      csv_type: 'paid_contributions',
      date_range_start: today,
      date_range_end: today,
    }),
  });

  return res.ok || res.status === 202;
}

// Request a CSV generation from ActBlue
async function requestCsv(
  creds: ActBlueCredentials,
  csvType: string,
  dateStart: string,
  dateEnd: string
): Promise<string> {
  const auth = Buffer.from(`${creds.clientUuid}:${creds.clientSecret}`).toString('base64');

  const res = await fetch(`${ACTBLUE_API_BASE}/csvs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${auth}`,
    },
    body: JSON.stringify({
      csv_type: csvType,
      date_range_start: dateStart,
      date_range_end: dateEnd,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ActBlue CSV request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.id;
}

// Poll for CSV completion and return download URL
async function pollForDownload(
  creds: ActBlueCredentials,
  csvId: string,
  maxAttempts = 30,
  intervalMs = 2000
): Promise<string> {
  const auth = Buffer.from(`${creds.clientUuid}:${creds.clientSecret}`).toString('base64');

  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${ACTBLUE_API_BASE}/csvs/${csvId}`, {
      headers: { 'Authorization': `Basic ${auth}` },
    });

    if (!res.ok) {
      throw new Error(`ActBlue poll failed (${res.status})`);
    }

    const data = await res.json();

    if (data.status === 'complete' && data.download_url) {
      return data.download_url;
    }

    if (data.status === 'failed') {
      throw new Error('ActBlue CSV generation failed');
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error('ActBlue CSV generation timed out');
}

// Download the CSV content
async function downloadCsv(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ActBlue CSV (${res.status})`);
  }
  return res.text();
}

export interface SyncResult {
  shortCode: string;
  success: boolean;
  rowsProcessed?: number;
  error?: string;
}

// Sync a single candidate's ActBlue data for a date range
export async function syncActBlueForCandidate(
  creds: ActBlueCredentials,
  dateStart: string,
  dateEnd: string
): Promise<{ csvText: string; shortCode: string }> {
  const csvId = await requestCsv(creds, 'paid_contributions', dateStart, dateEnd);
  const downloadUrl = await pollForDownload(creds, csvId);
  const csvText = await downloadCsv(downloadUrl);
  return { csvText, shortCode: creds.shortCode };
}

// Sync all configured candidates
export async function syncAllActBlue(
  dateStart: string,
  dateEnd: string
): Promise<{ csvTexts: { csvText: string; shortCode: string }[]; errors: SyncResult[] }> {
  const creds = getActBlueCredentials();

  if (creds.length === 0) {
    throw new Error('No ActBlue credentials configured. Add them via Settings or .env.local');
  }

  const results = await Promise.allSettled(
    creds.map(c => syncActBlueForCandidate(c, dateStart, dateEnd))
  );

  const csvTexts: { csvText: string; shortCode: string }[] = [];
  const errors: SyncResult[] = [];

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      csvTexts.push(result.value);
    } else {
      errors.push({
        shortCode: creds[i].shortCode,
        success: false,
        error: result.reason?.message || 'Unknown error',
      });
    }
  });

  return { csvTexts, errors };
}
