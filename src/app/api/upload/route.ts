import { NextRequest, NextResponse } from 'next/server';
import { parseMetaCsv, parseNumeroCsv, parseActBlueCsv } from '@/lib/parsers';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const fileType = formData.get('type') as string | null;

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }

    if (!fileType || !['meta_ads', 'numero_crm', 'actblue'].includes(fileType)) {
      return NextResponse.json({ success: false, error: 'Invalid file type. Use: meta_ads, numero_crm, or actblue' }, { status: 400 });
    }

    let csvText = await file.text();

    // Handle UTF-16 encoded files (campaign structure exports)
    if (csvText.charCodeAt(0) === 0xFFFE || csvText.charCodeAt(0) === 0xFEFF) {
      // Already decoded by browser, but might have BOM
      csvText = csvText.replace(/^\uFEFF/, '');
    }

    let result;
    switch (fileType) {
      case 'meta_ads':
        result = parseMetaCsv(csvText, file.name);
        break;
      case 'numero_crm':
        result = parseNumeroCsv(csvText, file.name);
        break;
      case 'actblue':
        result = parseActBlueCsv(csvText, file.name);
        break;
      default:
        return NextResponse.json({ success: false, error: 'Unknown file type' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      filename: file.name,
      type: fileType,
      rowsProcessed: result.rowsProcessed,
      errors: result.errors.slice(0, 20), // Cap error output
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
