import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 },
      { status: 401 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: 'INVALID_JSON', message: 'Invalid JSON body', statusCode: 400 },
      { status: 400 }
    );
  }

  const { topic, description, marketplace, sellerOrigin } = body as {
    topic?: string;
    description?: string;
    marketplace?: string;
    sellerOrigin?: string;
  };

  if (!topic || typeof topic !== 'string' || topic.trim() === '') {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'Topic is required', statusCode: 400 },
      { status: 400 }
    );
  }

  // Save request to database
  const { data: newRequest, error: insertError } = await supabase
    .from('report_requests')
    .insert({
      user_id: user.id,
      topic: topic.trim(),
      description: description || null,
      marketplace: marketplace || 'WW',
      seller_origin: sellerOrigin || 'CN',
    })
    .select()
    .single();

  if (insertError) {
    console.error('[Requests] Insert error:', insertError);
    return NextResponse.json(
      { code: 'INSERT_ERROR', message: insertError.message, statusCode: 500 },
      { status: 500 }
    );
  }

  // Send notification to all admins
  try {
    const { data: admins, error: adminError } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'admin');

    console.log('[Requests] Admin query result:', { admins, adminError });

    if (admins && admins.length > 0) {
      // Get first domain for notification reference
      const { data: domain, error: domainError } = await supabase
        .from('domains')
        .select('id')
        .limit(1)
        .single();

      console.log('[Requests] Domain query result:', { domain, domainError });

      if (domain) {
        const notifications = admins.map((admin) => ({
          user_id: admin.id,
          domain_id: domain.id,
          type: 'news' as const,
          title: `📋 New Report Request: ${topic.trim()}`,
          summary: `${user.email || 'A user'} requested a report on "${topic.trim()}"`,
          reference_id: newRequest.id,
        }));

        const { error: notifError } = await supabase.from('notifications').insert(notifications);
        console.log('[Requests] Notification insert result:', { notifError, count: notifications.length });
      }
    }
  } catch (e) {
    console.error('[Requests] Failed to send notifications:', e);
  }

  return NextResponse.json({ message: 'Request submitted successfully', data: newRequest });
}

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 },
      { status: 401 }
    );
  }

  // Check if admin
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  // Admins see all requests, regular users see only their own
  let query = supabase
    .from('report_requests')
    .select('*')
    .order('created_at', { ascending: false });

  if (profile?.role !== 'admin') {
    query = query.eq('user_id', user.id);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      { code: 'QUERY_ERROR', message: error.message, statusCode: 500 },
      { status: 500 }
    );
  }

  return NextResponse.json({ data });
}
