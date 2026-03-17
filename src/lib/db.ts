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
  // Extract prefix from ad name (everything before the first digit-containing batch number)
  // Format: {prefix}{batch}_{creative}_{variant}.{type}
  // Examples: mk4_1_1.val, rcp27_5_1.cap, yonce5_6_1.abx20
  const prefixes = ['effie', 'yonce', 'rcp', 'mk', 'ef', 'mc', 'br', 'ko', 'yen', 'gv', 'av'];

  const lowerAd = adName.toLowerCase();
  for (const prefix of prefixes) {
    if (lowerAd.startsWith(prefix)) {
      return db.prepare('SELECT id, short_code, name FROM clients WHERE short_code = ?').get(prefix) as { id: number; short_code: string; name: string } | undefined ?? null;
    }
  }
  return null;
}

export function getCampaignType(adName: string): string {
  // Extract campaign type from ad name after the underscore pattern
  // Examples: mk4_1_1.val -> val, ef1s_1_1.abx20.26 -> abx20, MC-11_4_1_v2.mp4 -> mp4
  const known = ['val', 'cap', 'abx20', 'num'];
  const lower = adName.toLowerCase();
  for (const type of known) {
    if (lower.includes(`.${type}`)) return type;
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
