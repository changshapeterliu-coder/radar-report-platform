import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { inngest } from '@/lib/inngest/client';
import { extractAndPersistTopicRankings } from '@/lib/topic-rankings/persist';
import type { ReportContent } from '@/types/report';

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

  // Enqueue async translation via Inngest. The `report-translate` function
  // reads the row, calls OpenRouter with retry, and writes `content_translated`
  // back. Non-blocking — publish returns immediately; failures are retried by
  // Inngest and recoverable via the admin "Re-translate" button.
  if (report.content) {
    try {
      await inngest.send({
        name: 'report/translate',
        data: { reportId: id },
      });
    } catch {
      // Inngest enqueue failure should NOT block publish.
    }
  }

  // Extract topics + persist to topic_rankings — powers the Dashboard
  // trend chart. Non-blocking: a failure here must NOT roll back the
  // publish itself.  We log loudly so silent skips become visible in
  // Vercel logs and we don't end up with empty `topic_rankings` again.
  try {
    const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
    const reportContent = report.content as ReportContent | null;

    if (!OPENROUTER_KEY) {
      console.warn(
        `[publish ${id}] OPENROUTER_API_KEY missing — skipping topic_rankings extraction (Dashboard trend will not update)`
      );
    } else if (!reportContent?.modules?.length) {
      console.warn(
        `[publish ${id}] report.content has no modules — skipping topic_rankings extraction`
      );
    } else {
      const result = await extractAndPersistTopicRankings({
        supabase,
        reportId: report.id,
        domainId: report.domain_id,
        weekLabel: report.week_label,
        content: reportContent,
        apiKey: OPENROUTER_KEY,
      });
      console.log(
        `[publish ${id}] topic_rankings inserted=${result.inserted} perModule=${JSON.stringify(result.perModule)} newLabels=${result.newLabels.length}`
      );
    }
  } catch (err) {
    console.error(
      `[publish ${id}] topic_rankings extraction failed (non-blocking):`,
      err
    );
  }

  // AI-generated Hitting News based on topic ranking changes
  try {
    const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
    if (OPENROUTER_KEY) {
      // Fetch current + historical topic rankings for this domain
      const { data: allRankings } = await supabase
        .from('topic_rankings')
        .select('*')
        .eq('domain_id', report.domain_id)
        .eq('module_index', 0)
        .order('created_at', { ascending: false })
        .limit(50);

      if (allRankings && allRankings.length > 0) {
        // Group by week
        const byWeek = new Map<string, Array<{ topic_label: string; rank: number }>>();
        allRankings.forEach((r: { week_label: string | null; topic_label: string; rank: number }) => {
          const w = r.week_label || 'Unknown';
          if (!byWeek.has(w)) byWeek.set(w, []);
          byWeek.get(w)!.push({ topic_label: r.topic_label, rank: r.rank });
        });

        const weeksData = Array.from(byWeek.entries()).map(([week, topics]) => ({ week, topics }));

        const newsPrompt = `You are a professional news editor for an Amazon seller account health intelligence platform. Analyze the topic ranking changes across weeks and generate newsworthy items.

Topic rankings by week (most recent first):
${JSON.stringify(weeksData.slice(0, 5), null, 2)}

Generate 1-3 news items about noteworthy changes. Focus on:
- New topics entering the rankings
- Topics with significant rank increases
- Topics that have stayed at #1 for multiple weeks

Write each news item in a professional but engaging news style. Each item should have a compelling headline and a 1-2 sentence summary.

Return JSON: { "news": [{ "title": "headline", "summary": "1-2 sentence summary", "content": "fuller 2-3 paragraph news article" }] }

If there are no noteworthy changes (e.g., only 1 week of data), return { "news": [] }.
Return ONLY valid JSON.`;

        const newsRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENROUTER_KEY}`,
          },
          body: JSON.stringify({
            model: 'openrouter/auto',
            messages: [
              { role: 'system', content: 'You are a news editor. Return only valid JSON.' },
              { role: 'user', content: newsPrompt },
            ],
            response_format: { type: 'json_object' },
          }),
        });

        if (newsRes.ok) {
          const newsData = await newsRes.json();
          const parsed = JSON.parse(newsData?.choices?.[0]?.message?.content || '{}');
          const newsItems = parsed.news || [];

          for (const item of newsItems) {
            if (item.title && item.content) {
              await supabase.from('news').insert({
                domain_id: report.domain_id,
                created_by: user.id,
                title: item.title,
                summary: item.summary || null,
                content: item.content,
                source_channel: 'AI Insight',
                is_pinned: false,
              });
            }
          }
        }
      }
    }
  } catch {
    // AI news generation failure should NOT block publish
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
