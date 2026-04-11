import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { ReportContent } from '@/types/report';

type RouteContext = { params: Promise<{ id: string }> };

interface TopicEntry {
  rank: number;
  topic_label: string;
  raw_reason: string;
  raw_keywords: string;
}

async function extractTopicsForModule(
  content: ReportContent,
  moduleIndex: number,
  existingLabels: string[],
  apiKey: string
): Promise<TopicEntry[]> {
  const mod = content.modules?.[moduleIndex];
  const table = mod?.tables?.[0];
  if (!table?.rows?.length) return [];

  const entries = table.rows.map((row, i) => ({
    rank: i + 1,
    reason: row.cells[1]?.text || row.cells[0]?.text || '',
    keywords: row.cells[2]?.text || '',
  }));

  const prompt = `You are a topic matching assistant. Given a list of report entries (each with a reason and keywords) and a list of existing standardized topic labels, your job is to:
1. For each entry, determine if it matches an existing topic label (semantic match, not exact string match)
2. If it matches, use the existing label
3. If it's a new topic, create a short standardized English label (max 40 chars)

Existing labels: ${JSON.stringify(existingLabels)}

Report entries:
${entries.map((e) => `Rank ${e.rank}: Reason="${e.reason}", Keywords="${e.keywords}"`).join('\n')}

Return ONLY a JSON array: [{ "rank": 1, "topic_label": "Account Association", "raw_reason": "Account Relation", "raw_keywords": "Broadband/Second review" }, ...]`;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'qwen/qwen3.6-plus:free',
      messages: [
        { role: 'system', content: 'You are a topic classification assistant. Return only valid JSON.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) return [];

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content || '[]';
  const parsed = JSON.parse(raw);
  // Handle both direct array and { topics: [...] } wrapper
  return Array.isArray(parsed) ? parsed : (parsed.topics || parsed.results || []);
}

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

  // Extract topics using LLM and store in topic_rankings
  try {
    const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
    const reportContent = report.content as ReportContent | null;
    if (OPENROUTER_KEY && reportContent?.modules?.length) {
      // Fetch existing topic labels for this domain
      const { data: existingTopics } = await supabase
        .from('topic_rankings')
        .select('topic_label')
        .eq('domain_id', report.domain_id);

      const existingLabels = [...new Set((existingTopics || []).map((t: { topic_label: string }) => t.topic_label))];

      // Process Module 1 (index 0) and Module 2 (index 1)
      for (const moduleIndex of [0, 1]) {
        if (!reportContent.modules[moduleIndex]) continue;

        const topics = await extractTopicsForModule(
          reportContent,
          moduleIndex,
          existingLabels,
          OPENROUTER_KEY
        );

        if (topics.length > 0) {
          const rows = topics.map((t: TopicEntry) => ({
            report_id: report.id,
            domain_id: report.domain_id,
            module_index: moduleIndex,
            topic_label: t.topic_label,
            rank: t.rank,
            week_label: report.week_label,
            raw_reason: t.raw_reason || null,
            raw_keywords: t.raw_keywords || null,
          }));

          await supabase.from('topic_rankings').insert(rows);

          // Add new labels to the existing set for the next module
          topics.forEach((t: TopicEntry) => {
            if (!existingLabels.includes(t.topic_label)) {
              existingLabels.push(t.topic_label);
            }
          });
        }
      }
    }
  } catch {
    // Topic extraction failure should NOT block publish
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
