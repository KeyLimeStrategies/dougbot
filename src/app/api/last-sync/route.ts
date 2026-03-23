import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  const db = getDb();

  const lastActBlue = db.prepare(
    "SELECT uploaded_at FROM uploads WHERE upload_type LIKE '%actblue%' ORDER BY uploaded_at DESC LIMIT 1"
  ).get() as { uploaded_at: string } | undefined;

  const lastMeta = db.prepare(
    "SELECT uploaded_at FROM uploads WHERE upload_type LIKE '%meta%' ORDER BY uploaded_at DESC LIMIT 1"
  ).get() as { uploaded_at: string } | undefined;

  return NextResponse.json({
    actblue: lastActBlue?.uploaded_at || null,
    meta: lastMeta?.uploaded_at || null,
  });
}
