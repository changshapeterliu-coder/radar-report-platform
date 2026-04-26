/**
 * Deterministic idempotency key for Inngest events and DB unique-index checks.
 *
 * Pure function: same inputs → same output. No clock, no randomness, no env reads.
 * This is intentional — the key must be reconstructible from domain + window alone
 * so that scheduler tick + manual trigger + retry all map to the same key and
 * DB partial unique index can dedupe correctly.
 */
export function buildIdempotencyKey(
  domainId: string,
  coverageWindowStartIso: string
): string {
  return `report-gen:${domainId}:${coverageWindowStartIso}`;
}
