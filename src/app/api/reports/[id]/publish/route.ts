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
  if (!mod) return [];

  // v4 fast path: module already has structured topTopics — bypass LLM.
  // Each topTopic is our canonical rank/topic/keywords/discussion shape
  // so we only need to map into TopicEntry + LLM-stabilize the label
  // across weeks.
  if (Array.isArray(mod.topTopics) && mod.topTopics.length > 0) {
    return stabilizeLabelsV4(mod.topTopics, existingLabels, apiKey);
  }

  // Legacy path: fall back to reading the first table's rows.
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
      model: 'openrouter/auto',
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

/**
 * v4 path: topTopics already has canonical topic/keywords/seller_discussion.
 * We still call the LLM to stabilize topic_label across weeks (a canonical
 * English short label) so the Dashboard trending chart groups consistently.
 *
 * Input entries come from ReportModule.topTopics. Numeric rank is parsed
 * from the rank string (e.g. "1 ✓" -> 1, "2" -> 2). If parse fails, we
 * fall back to array index.
 */
async function stabilizeLabelsV4(
  topics: NonNullable<ReportContent['modules'][number]['topTopics']>,
  existingLabels: string[],
  apiKey: string
): Promise<TopicEntry[]> {
  const entries = topics.map((t, i) => {
    const parsedRank = parseInt(t.rank, 10);
    return {
      rank: Number.isFinite(parsedRank) ? parsedRank : i + 1,
      topic: t.topic,
      keywords: t.keywords.join('、'),
      discussion: t.seller_discussion,
    };
  });

  const prompt = `You are a topic matching assistant. For each entry below, map its Chinese topic to a standardized English label (max 40 chars). Reuse existing labels when semantically equivalent.

Existing labels: ${JSON.stringify(existingLabels)}

Entries:
${entries.map((e) => `Rank ${e.rank}: Topic="${e.topic}", Keywords="${e.keywords}", Discussion="${e.discussion}"`).join('\n')}

Return ONLY a JSON array: [{ "rank": 1, "topic_label": "Account Association", "raw_reason": "Topic Chinese name", "raw_keywords": "Keywords list" }, ...]`;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'openrouter/auto',
      messages: [
        { role: 'system', content: 'You are a topic classification assistant. Return only valid JSON.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    // If LLM labeling fails, fall back to using the Chinese topic as label.
    // This keeps the Dashboard trending working (less-grouped) rather than
    // silently dropping data.
    return entries.map((e) => ({
      rank: e.rank,
      topic_label: e.topic,
      raw_reason: e.topic,
      raw_keywords: e.keywords,
    }));
  }
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content || '[]';
  try {
    const parsed = JSON.parse(raw);
    const out = Array.isArray(parsed)
      ? parsed
      : parsed.topics || parsed.results || [];
    return out as TopicEntry[];
  } catch {
    return [];
  }
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
            model: 'openrouter/auto',
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
