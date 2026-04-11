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

  // Auto-translate report content in background
  // Detect language and translate to the other
  const content = report.content;
  if (content) {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (OPENROUTER_API_KEY) {
      // Detect if content is mostly English or Chinese, translate to the other
      const titleText = typeof content === 'object' && content !== null && 'title' in content ? String((content as Record<string, unknown>).title) : '';
      const isEnglish = /^[a-zA-Z0-9\s.,!?:;'"()-]+$/.test(titleText.slice(0, 50));
      const targetLang = isEnglish ? 'zh' : 'en';
      const langName = targetLang === 'zh' ? 'Chinese (Simplified)' : 'English';

      try {
        const translateRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'qwen/qwen3.6-plus:free',
            messages: [
              {
                role: 'system',
                content: `Translate the given JSON report content to ${langName}. Keep the exact same JSON structure — only translate text values. Do NOT translate JSON keys. Return ONLY valid JSON.`,
              },
              {
                role: 'user',
                content: `Translate to ${langName}:\n\n${JSON.stringify(content)}`,
              },
            ],
            response_format: { type: 'json_object' },
          }),
        });

        if (translateRes.ok) {
          const translateData = await translateRes.json();
          const translatedContent = JSON.parse(translateData?.choices?.[0]?.message?.content || '{}');
          if (translatedContent.title && Array.isArray(translatedContent.modules)) {
            await supabase
              .from('reports')
              .update({ content_translated: translatedContent })
              .eq('id', id);
          }
        }
      } catch {
        // Translation failed silently — not blocking publish
      }
    }
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
