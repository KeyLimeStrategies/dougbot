import { NextRequest, NextResponse } from 'next/server';

const GRAPH_API_BASE = 'https://graph.facebook.com/v22.0';

export async function GET(request: NextRequest) {
  try {
    const adAccountId = process.env.META_AD_ACCOUNT_ID;
    const accessToken = process.env.META_ACCESS_TOKEN;
    if (!adAccountId || !accessToken) {
      return NextResponse.json({ error: 'Missing Meta config' }, { status: 400 });
    }

    const searchParams = request.nextUrl.searchParams;
    const days = parseInt(searchParams.get('days') || '7', 10);
    const eventFilter = searchParams.get('event_type') || '';

    const sinceUnix = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);

    const url = `${GRAPH_API_BASE}/${adAccountId}/activities?fields=event_type,event_time,object_name,object_id,extra_data,actor_name&since=${sinceUnix}&limit=50&access_token=${accessToken}`;
    const res = await fetch(url);
    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: errText }, { status: res.status });
    }

    const data = await res.json();

    // Filter by event type if specified
    let events = data.data || [];
    if (eventFilter) {
      events = events.filter((e: { event_type: string }) => e.event_type.includes(eventFilter));
    }

    return NextResponse.json({
      total: events.length,
      events: events.map((e: { event_type: string; event_time: string; object_name: string; extra_data: unknown; actor_name: string }) => ({
        event_type: e.event_type,
        event_time: e.event_time,
        object_name: e.object_name,
        extra_data: e.extra_data,
        actor_name: e.actor_name,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
