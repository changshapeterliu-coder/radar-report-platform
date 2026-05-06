/**
 * is_new_canonical decision helper.
 *
 * Trust model:
 *   The Canonicalize Engine self-reports `is_new_canonical` on every
 *   assignment, but we must not trust it blindly — the AI might return
 *   `is_new_canonical=true` for a key that is actually already in the
 *   domain's `topic_canonicals` table (e.g. because it proposed a key we
 *   already have). The DB has ground truth via `existingKeys`.
 *
 *   This helper re-derives the correct flag **from DB state** and returns
 *   it. Downstream persistence (persist_daily_alert RPC) treats the
 *   returned value as authoritative.
 *
 * Spec refs:
 *   Requirement 9.6 (Canonical reuse preserves existing title / description
 *   — implies the flag must reflect true DB state, not the engine's guess).
 * Property refs (PBT):
 *   P23 — Novelty flag correctness (true iff key absent from existing set)
 *   P24 — First-ever topic for empty domain is always new
 */

// Note: no longer imports CanonicalAssignment — since migration 021 the
// narrower input shape (just { canonical_topic_key: string }) is clearer
// and avoids tempting callers to pass the drop branch (which has null key).

/**
 * Return `true` iff the assignment's `canonical_topic_key` is NOT present
 * in the existing-keys set — regardless of the engine's self-reported
 * `is_new_canonical` value.
 *
 * Empty `existingKeys` → always returns `true`.
 *
 * Only valid for `decision: 'keep'` assignments — `drop` assignments have
 * `canonical_topic_key: null` and should not be passed through here.
 * Callers are expected to filter the drop branch before invoking.
 */
export function computeIsNewCanonical(
  assignment: { canonical_topic_key: string },
  existingKeys: ReadonlySet<string>
): boolean {
  return !existingKeys.has(assignment.canonical_topic_key);
}
