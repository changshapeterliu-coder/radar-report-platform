/**
 * Daily-alert translation helper.
 *
 * Translates a (zh_primary, zh_secondary) pair to English using OpenRouter.
 * Consumed by:
 *   - `daily-alert-translate-topic` Inngest function → (topic_name_zh, summary_zh)
 *   - `daily-alert-translate-canonical` Inngest function → (canonical_title_zh,
 *     canonical_description_zh)
 *   - `POST /api/ai/translate-daily` HTTP endpoint (task 6.10) will expose
 *     this as a thin HTTP wrapper for the admin "re-translate" button.
 *
 * Direct fetch to OpenRouter (no intermediate Vercel route) — the Inngest
 * functions already run server-side with env vars; going through the HTTP
 * endpoint would double the latency without adding value. The dedicated
 * /api/ai/translate-daily endpoint in Group 6 is kept as a thin wrapper
 * over this same function for UI-invoked re-translation.
 *
 * Spec refs:
 *   Requirements: 10.3, 10.4, 10.5
 *   Design:       §Bilingual & Translation Path §POST /api/ai/translate-daily
 */

export interface TranslateDailyInput {
  kind: 'topic' | 'canonical';
  zh_primary: string; // topic_name_zh or canonical_title_zh
  zh_secondary: string; // summary_zh or canonical_description_zh
}

export interface TranslateDailyOutput {
  en_primary: string;
  en_secondary: string;
}

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'openrouter/auto';
const TIMEOUT_MS = 60_000;

/**
 * Translate a Chinese pair to English with a short, focused prompt.
 *
 * Keeps Amazon domain terminology consistent (账户健康 → Account Health etc.);
 * does not translate marketplace codes (BR / CA / US / UK stay as-is).
 */
export async function translateDailyPair(input: TranslateDailyInput): Promise<TranslateDailyOutput> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }

  const systemPrompt = `You are translating content for a Chinese seller account-health daily alert platform.

Input:
  - kind = ${input.kind}
  - zh_primary (shorter: a topic title or category title)
  - zh_secondary (longer: a summary or description)

Translate both fields to English. Preserve domain terminology exactly:
  - 账户健康 = "Account Health"
  - Listing 下架 / 下架 = "Listing takedown"
  - 申诉 = "appeal"
  - 卖家 = "seller"
  - KYC / VAT / EPR stay as-is (already English abbreviations).
  - Amazon marketplace codes (BR, CA, US, UK, DE, JP, FR, IT, ES, MX, AU, AE, SG, NL, SE, PL, TR, EG) stay uppercase as-is.

Return JSON exactly of the form:
{
  "en_primary":   <English translation of zh_primary>,
  "en_secondary": <English translation of zh_secondary>
}

Do not return markdown code fences. Do not return any other keys.`;

  const userPrompt = JSON.stringify({
    kind: input.kind,
    zh_primary: input.zh_primary,
    zh_secondary: input.zh_secondary,
  });

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw new Error(
        `translateDailyPair: OpenRouter returned ${res.status} ${res.statusText}: ${bodyText.slice(0, 200)}`
      );
    }

    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error('translateDailyPair: OpenRouter returned empty content');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripCodeFences(content));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`translateDailyPair: response was not valid JSON: ${message}`);
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('translateDailyPair: response is not an object');
    }
    const { en_primary, en_secondary } = parsed as Record<string, unknown>;
    if (typeof en_primary !== 'string' || en_primary.trim().length === 0) {
      throw new Error('translateDailyPair: en_primary missing or empty');
    }
    if (typeof en_secondary !== 'string' || en_secondary.trim().length === 0) {
      throw new Error('translateDailyPair: en_secondary missing or empty');
    }

    return { en_primary, en_secondary };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function stripCodeFences(s: string): string {
  const trimmed = s.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : trimmed;
}
