import { NextRequest, NextResponse } from 'next/server';
import { syncAllActBlue, getActBlueCredentials, syncActBlueForCandidate, SyncResult } from '@/lib/actblue';
import { parseActBlueCsv } from '@/lib/parsers';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date_start, date_end, short_code } = body;

    if (!date_start || !date_end) {
      return NextResponse.json(
        { success: false, error: 'date_start and date_end are required (YYYY-MM-DD)' },
        { status: 400 }
      );
    }

    // ActBlue date_range_end is exclusive, so add 1 day to include the end date
    const endDate = new Date(date_end + 'T00:00:00');
    endDate.setDate(endDate.getDate() + 1);
    const actblue_date_end = endDate.toISOString().split('T')[0];

    const results: SyncResult[] = [];

    if (short_code) {
      // Sync a single candidate
      const creds = getActBlueCredentials().find(c => c.shortCode === short_code);
      if (!creds) {
        return NextResponse.json(
          { success: false, error: `No ActBlue credentials configured for ${short_code}` },
          { status: 400 }
        );
      }

      try {
        const { csvText, shortCode } = await syncActBlueForCandidate(creds, date_start, actblue_date_end);
        const parsed = parseActBlueCsv(csvText, `actblue_${shortCode}_${date_start}_${date_end}.csv`);
        results.push({
          shortCode,
          success: true,
          rowsProcessed: parsed.rowsProcessed,
        });
      } catch (err) {
        results.push({
          shortCode: short_code,
          success: false,
          error: err instanceof Error ? err.message : 'Sync failed',
        });
      }
    } else {
      // Sync all configured candidates
      const { csvTexts, errors } = await syncAllActBlue(date_start, actblue_date_end);

      // Parse and store each CSV
      for (const { csvText, shortCode } of csvTexts) {
        try {
          const parsed = parseActBlueCsv(csvText, `actblue_${shortCode}_${date_start}_${date_end}.csv`);
          results.push({
            shortCode,
            success: true,
            rowsProcessed: parsed.rowsProcessed,
          });
        } catch (err) {
          results.push({
            shortCode,
            success: false,
            error: err instanceof Error ? err.message : 'Parse failed',
          });
        }
      }

      results.push(...errors);
    }

    const totalProcessed = results.filter(r => r.success).reduce((sum, r) => sum + (r.rowsProcessed || 0), 0);
    const allSuccess = results.every(r => r.success);

    return NextResponse.json({
      success: allSuccess,
      total_rows_processed: totalProcessed,
      candidates: results,
      configured_candidates: getActBlueCredentials().map(c => c.shortCode),
    });
  } catch (error) {
    console.error('ActBlue sync error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    );
  }
}

// GET: Check which candidates have credentials configured
export async function GET() {
  const creds = getActBlueCredentials();
  return NextResponse.json({
    configured: creds.map(c => c.shortCode),
    all_candidates: ['mk', 'rcp', 'ef', 'mc', 'yonce', 'br', 'ko', 'effie', 'yen', 'gv', 'av'],
  });
}
