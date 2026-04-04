import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
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

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Admin access required', statusCode: 403 },
      { status: 403 }
    );
  }

  // Update report status to published
  const now = new Date().toISOString();
  const { data: report, error: updateError } = await supabase
    .from('reports')
    .update({ status: 'published', published_at: now })
    .eq('id', id)
    .select()
    .single();

  if (updateError) {
    if (updateError.code === 'PGRST116') {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'Report not found', statusCode: 404 },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { code: 'UPDATE_ERROR', message: updateError.message, statusCode: 500 },
      { status: 500 }
    );
  }

  // Create notifications for all team_members in this domain
  const { data: teamMembers, error: membersError } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'team_member');

  if (membersError) {
    // Report was published but notifications failed — return success with warning
    return NextResponse.json({
      data: report,
      warning: 'Report published but failed to create notifications',
    });
  }

  if (teamMembers && teamMembers.length > 0) {
    const notifications = teamMembers.map((member) => ({
      user_id: member.id,
      domain_id: report.domain_id,
      type: 'report' as const,
      title: report.title,
      reference_id: report.id,
    }));

    const { error: notifError } = await supabase
      .from('notifications')
      .insert(notifications);

    if (notifError) {
      return NextResponse.json({
        data: report,
        warning: 'Report published but failed to create some notifications',
      });
    }
  }

  return NextResponse.json({ data: report });
}
