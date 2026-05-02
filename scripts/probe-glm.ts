/**
 * Live-API probe for Zhipu GLM (glm-4.6) via z.ai.
 *
 * Purpose: the Qwen debugging cycle proved that unit tests (8/8 green) did
 * NOT catch the production 400 error because the mock envelope matched a
 * shape the real API rejects. This probe hits api.z.ai with a real key and
 * a minimal fixture prompt to confirm the request body is accepted
 * end-to-end before any code gets pushed.
 *
 * Run:
 *   $env:ZAI_API_KEY = "sk-..."
 *   npx --yes tsx scripts/probe-glm.ts
 *
 * (First run will auto-install tsx via npx; subsequent runs are instant.)
 *
 * Exit codes:
 *   0 — PROBE PASS (search returned refs, data parsed as object)
 *   1 — PROBE FAIL (missing key, network error, API error, shape mismatch)
 *
 * Alternate runner (if `tsx` not available):
 *   npx --yes ts-node --transpile-only scripts/probe-glm.ts
 */

import { callZai } from '../src/lib/research-engine/engines/zai-client';

async function main(): Promise<void> {
  const apiKey = process.env.ZAI_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    console.error('PROBE FAIL: ZAI_API_KEY not set');
    process.exit(1);
    return;
  }

  const result = await callZai<{ topics?: unknown[] }>({
    model: 'glm-4.6',
    messages: [
      {
        role: 'user',
        content:
          '搜索最近一周中国跨境电商合规政策热点，返回 JSON 形如 {topics: [{topic, keywords, voice_volume}]}，最多 3 条。',
      },
    ],
    apiKey,
    timeoutMs: 60_000,
    jsonMode: true,
    searchRecency: 'oneWeek',
    contentSize: 'medium',
    errorContext: { engine: 'kimi', stage: 'hot-radar-scan' },
  });

  if (!result.ok) {
    console.error(`PROBE FAIL: ${result.error.errorClass}: ${result.error.message}`);
    process.exit(1);
    return;
  }

  if (result.searchReferences.length < 1) {
    console.error(
      `PROBE FAIL: search returned 0 refs — tool may not have fired. raw content length=${result.rawContent.length}`
    );
    process.exit(1);
    return;
  }

  if (typeof result.data !== 'object' || result.data === null) {
    console.error(
      `PROBE FAIL: data is not an object (got ${typeof result.data})`
    );
    process.exit(1);
    return;
  }

  console.log(
    `PROBE PASS: glm-4.6 single-call web_search + json_object works; got ${result.searchReferences.length} refs`
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(
    `PROBE FAIL: unhandled error: ${err instanceof Error ? err.message : String(err)}`
  );
  process.exit(1);
});
