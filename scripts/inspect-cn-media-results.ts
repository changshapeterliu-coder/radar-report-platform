/**
 * Inspector v2: shows ALL dated articles per site, not just W21.
 * Helps diagnose why some sites returned 0 W21 articles — date
 * distribution issue or extraction issue.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dump = JSON.parse(
  readFileSync(resolve(process.cwd(), '.cn-media-probe-results.json'), 'utf-8')
) as {
  results: Array<{
    id: string;
    name: string;
    articlesInW21: Array<{ title: string; url: string; date: string | null; matchedKeywords: string[] }>;
    articlesInTwoWeeks: Array<{ title: string; url: string; date: string | null; matchedKeywords: string[] }>;
    articlesInFourWeeks: Array<{ title: string; url: string; date: string | null; matchedKeywords: string[] }>;
  }>;
};

for (const r of dump.results) {
  console.log(`\n══ [${r.id}] ${r.name}`);
  console.log(`   W21: ${r.articlesInW21.length} | 2-week: ${r.articlesInTwoWeeks.length} | 4-week: ${r.articlesInFourWeeks.length}`);
  if (r.articlesInFourWeeks.length === 0) continue;
  // Date distribution
  const byDate = new Map<string, number>();
  for (const a of r.articlesInFourWeeks) {
    const d = a.date ?? '?';
    byDate.set(d, (byDate.get(d) ?? 0) + 1);
  }
  const sorted = [...byDate.entries()].sort();
  sorted.forEach(([d, n]) => console.log(`   ${d}: ${n}`));
  // First 3 article titles to verify content
  console.log(`   sample 4-week titles:`);
  r.articlesInFourWeeks.slice(0, 3).forEach((a) =>
    console.log(`     - [${a.date}] ${a.title.slice(0, 80)}`)
  );
}
