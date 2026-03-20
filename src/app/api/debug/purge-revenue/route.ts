import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST() {
  try {
    const db = getDb();

    // Count before
    const before = db.prepare('SELECT COUNT(*) as count FROM revenue').get() as { count: number };

    // Delete all revenue data
    db.prepare('DELETE FROM revenue').run();

    // Clear daily summaries (will be recalculated on next sync)
    db.prepare('DELETE FROM daily_summary').run();

    return NextResponse.json({
      success: true,
      message: `Purged ${before.count} revenue rows and all daily summaries. Re-sync ActBlue to rebuild.`,
      rows_deleted: before.count,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
