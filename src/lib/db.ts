import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = process.env.DB_DIR || path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'keylime.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(DB_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initializeSchema(db);
  }
  return db;
}

function initializeSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      short_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      entity_name TEXT
    );

    CREATE TABLE IF NOT EXISTS ad_spend (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      client_id INTEGER NOT NULL,
      ad_name TEXT NOT NULL,
      spend REAL NOT NULL DEFAULT 0,
      results INTEGER NOT NULL DEFAULT 0,
      reach INTEGER NOT NULL DEFAULT 0,
      frequency REAL NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      cpm REAL NOT NULL DEFAULT 0,
      link_clicks INTEGER NOT NULL DEFAULT 0,
      ctr REAL NOT NULL DEFAULT 0,
      ad_delivery TEXT,
      attribution_setting TEXT,
      cost_per_result REAL,
      campaign_type TEXT,
      batch TEXT,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      UNIQUE(date, ad_name)
    );

    CREATE TABLE IF NOT EXISTS revenue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      client_id INTEGER NOT NULL,
      refcode TEXT,
      amount REAL NOT NULL DEFAULT 0,
      donor_name TEXT,
      member_code TEXT,
      receipt_id TEXT UNIQUE,
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );

    CREATE TABLE IF NOT EXISTS daily_summary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      client_id INTEGER NOT NULL,
      total_spend REAL NOT NULL DEFAULT 0,
      total_revenue REAL NOT NULL DEFAULT 0,
      spend_with_fee REAL NOT NULL DEFAULT 0,
      true_roas REAL,
      profit REAL,
      keylime_cut REAL,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      UNIQUE(date, client_id)
    );

    CREATE TABLE IF NOT EXISTS uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      upload_type TEXT NOT NULL,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      rows_processed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS api_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      credential_key TEXT NOT NULL,
      credential_secret TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (client_id) REFERENCES clients(id),
      UNIQUE(client_id, provider)
    );
  `);

  // Add fee_rate column if it doesn't exist
  try {
    db.exec(`ALTER TABLE clients ADD COLUMN fee_rate REAL NOT NULL DEFAULT 0.10`);
  } catch {
    // Column already exists
  }

  // Add active column if it doesn't exist
  try {
    db.exec(`ALTER TABLE clients ADD COLUMN active INTEGER NOT NULL DEFAULT 1`);
  } catch {
    // Column already exists
  }

  // Add fundraising_page column to revenue if it doesn't exist
  try {
    db.exec(`ALTER TABLE revenue ADD COLUMN fundraising_page TEXT`);
  } catch {
    // Column already exists
  }

  // Add recurrence_number column to revenue (1 = first-time, >1 = recurring)
  try {
    db.exec(`ALTER TABLE revenue ADD COLUMN recurrence_number INTEGER NOT NULL DEFAULT 1`);
  } catch {
    // Column already exists
  }

  // Add meta_ad_id to ad_spend for proper dedup across campaigns
  try {
    db.exec(`ALTER TABLE ad_spend ADD COLUMN meta_ad_id TEXT`);
  } catch {
    // Column already exists
  }

  // Index for fast lookups by (date, meta_ad_id)
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ad_spend_date_meta_id ON ad_spend(date, meta_ad_id)`);
  } catch {
    // Index already exists
  }

  // Add is_ad_client column (1 = runs ads, 0 = non-ad client like text/email only)
  try {
    db.exec(`ALTER TABLE clients ADD COLUMN is_ad_client INTEGER NOT NULL DEFAULT 1`);
  } catch {
    // Column already exists
  }

  // Campaign changes tracking table (budget changes, ad toggles, etc.)
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      client_id INTEGER NOT NULL,
      change_type TEXT NOT NULL,
      description TEXT,
      detected_at TEXT NOT NULL DEFAULT (datetime('now')),
      source TEXT NOT NULL DEFAULT 'auto',
      FOREIGN KEY (client_id) REFERENCES clients(id)
    )
  `);

  // Add source column if missing (existing DBs)
  try {
    db.exec(`ALTER TABLE campaign_changes ADD COLUMN source TEXT NOT NULL DEFAULT 'auto'`);
  } catch {
    // Column already exists
  }

  // Snapshot tables for tracking real Meta API status/budget changes
  db.exec(`
    CREATE TABLE IF NOT EXISTS ad_status_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ad_id TEXT NOT NULL,
      ad_name TEXT NOT NULL,
      client_id INTEGER NOT NULL,
      effective_status TEXT NOT NULL,
      campaign_name TEXT,
      adset_name TEXT,
      snapped_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (client_id) REFERENCES clients(id),
      UNIQUE(ad_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_budget_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id TEXT NOT NULL,
      campaign_name TEXT NOT NULL,
      client_id INTEGER NOT NULL,
      daily_budget REAL,
      lifetime_budget REAL,
      snapped_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (client_id) REFERENCES clients(id),
      UNIQUE(campaign_id)
    )
  `);

  // Seed clients
  const insertClient = db.prepare(
    'INSERT OR IGNORE INTO clients (short_code, name, entity_name) VALUES (?, ?, ?)'
  );
  const clients = [
    ['mk', 'Kinter', 'Marialana Kinter For Congress'],
    ['rcp', 'RevChange', 'Revolutionary Change PAC'],
    ['ef', 'Ford', 'Earle Ford for Congress'],
    ['mc', 'Cortese', 'Mike for Tennessee'],
    ['yonce', 'Yonce', 'Eric Yonce for US House of Representatives'],
    ['br', 'Riker', 'Brandon Riker for Congress'],
    ['ko', 'Overman', 'Kimberly Overman for Congress'],
    ['effie', 'Effie', 'Effie for Congress'],
    ['yen', 'Yen', 'Yen Bailey for Congress'],
    ['gv', 'Gay', 'Gay Valimont for Congress'],
    ['av', 'Antonio', 'Antonio Villaraigosa'],
  ];
  const insertMany = db.transaction(() => {
    for (const [code, name, entity] of clients) {
      insertClient.run(code, name, entity);
    }
  });
  insertMany();

  // Set custom fee rates
  db.prepare("UPDATE clients SET fee_rate = 0.05 WHERE short_code = 'br'").run();
}

export function getClientFeeRate(clientId: number): number {
  const db = getDb();
  const row = db.prepare('SELECT fee_rate FROM clients WHERE id = ?').get(clientId) as { fee_rate: number } | undefined;
  return row?.fee_rate ?? 0.10;
}

export function getClientByAdName(adName: string): { id: number; short_code: string; name: string } | null {
  const db = getDb();
  // Dynamically load all client short_codes, sorted longest-first to avoid prefix collisions
  const clients = db.prepare('SELECT id, short_code, name FROM clients ORDER BY LENGTH(short_code) DESC').all() as { id: number; short_code: string; name: string }[];

  const lowerAd = adName.toLowerCase();
  for (const client of clients) {
    if (lowerAd.startsWith(client.short_code)) {
      return client;
    }
  }
  return null;
}

// Match a Meta campaign/adset name to a client (e.g. "Earle Ford ValueOfConversions" → Ford)
export function getClientByCampaignName(campaignName: string): { id: number; short_code: string; name: string } | null {
  const db = getDb();
  const clients = db.prepare('SELECT id, short_code, name, entity_name FROM clients').all() as { id: number; short_code: string; name: string; entity_name: string | null }[];

  const lower = campaignName.toLowerCase();
  for (const client of clients) {
    // Check if campaign name contains the client's display name (e.g. "Ford", "Kinter")
    if (lower.includes(client.name.toLowerCase())) return client;
    // Check entity name words (e.g. "Earle Ford" from "Earle Ford for Congress")
    if (client.entity_name) {
      const entityWords = client.entity_name.toLowerCase().split(/\s+/);
      // Match on first+last name or just last name (skip common words)
      const skip = new Set(['for', 'congress', 'pac', 'of', 'the', 'us', 'house', 'representatives']);
      const nameWords = entityWords.filter(w => !skip.has(w) && w.length > 2);
      if (nameWords.length > 0 && nameWords.some(w => lower.includes(w))) return client;
    }
  }
  return null;
}

export function getCampaignType(adName: string, campaignName?: string): string {
  // Extract campaign type from ad name after the underscore pattern
  // Examples: mk4_1_1.val -> val, ef1s_1_1.abx20.26 -> abx20, MC-11_4_1_v2.mp4 -> mp4
  const known = ['val', 'cap', 'abx20', 'num'];
  const lower = adName.toLowerCase();
  for (const type of known) {
    if (lower.includes(`.${type}`)) return type;
  }
  // Fallback: infer from Meta campaign name (e.g. "Gay ValueOfConversions" -> val)
  if (campaignName) {
    const cLower = campaignName.toLowerCase();
    if (cLower.includes('numberofconversions')) return 'num';
    if (cLower.includes('valueofconversions')) return 'val';
    if (cLower.includes('costcap')) return 'cap';
    if (cLower.includes('abx')) return 'abx20';
  }
  // No recognized type, default to val (most common campaign type)
  return 'val';
}

export function parseBatch(adName: string): string {
  // Extract batch number: mk4_1_1.val -> "4"
  const prefixes = ['effie', 'yonce', 'rcp', 'mk', 'ef', 'mc', 'br', 'ko', 'yen', 'gv', 'av'];
  const lowerAd = adName.toLowerCase();
  for (const prefix of prefixes) {
    if (lowerAd.startsWith(prefix)) {
      const rest = adName.substring(prefix.length);
      const match = rest.match(/^(\d+)/);
      return match ? match[1] : '';
    }
  }
  return '';
}
