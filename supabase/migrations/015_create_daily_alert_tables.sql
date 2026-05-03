-- ============================================================
-- 015_create_daily_alert_tables.sql
--
-- Daily Hot-Topic Alert feature — create 5 new tables + 1 PL/pgSQL
-- persistence RPC. Platform-level `topic_canonicals` dictionary included.
--
-- Spec: .kiro/specs/daily-hot-topic-alert/
--   Requirements: 1.x, 2.x, 3.x, 5.1, 6.x, 9.x, 11.1–11.5, 12.x, 16.x
--   Design:       §数据模型 / §新增表 DDL / §persist.ts 接口
--
-- Depends on:
--   - 001 (profiles + domains + notifications exist)
--   - 005 (Account Health domain seeded — referenced by migration 018)
--
-- Runs BEFORE:
--   - 016 (RLS policies attach to these tables)
--   - 017 (extends prompt_templates.prompt_type CHECK)
--   - 018 (seeds default daily_alert_configs row)
--
-- Re-run safety:
--   All DDL uses `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` /
--   `CREATE OR REPLACE FUNCTION`. Re-running the migration is a no-op on a
--   fully-applied environment.
--
-- Manual verification (run in SQL Editor after applying):
--
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema='public'
--      AND table_name IN ('daily_alert_configs','daily_alert_runs',
--                         'daily_hot_topic_alerts','daily_hot_topics',
--                         'topic_canonicals');
--   -- Expected: 5 rows.
--
--   SELECT indexname FROM pg_indexes
--    WHERE tablename='daily_alert_runs'
--      AND indexname='idx_daily_alert_runs_idempotency';
--   -- Expected: 1 row.
--
--   SELECT proname FROM pg_proc WHERE proname='persist_daily_alert';
--   -- Expected: 1 row.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. daily_alert_configs — one enabled/disabled schedule per domain.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_alert_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id UUID NOT NULL UNIQUE REFERENCES domains(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  time_of_day VARCHAR(5) NOT NULL DEFAULT '06:00'
    CHECK (time_of_day ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'),
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai'
    CHECK (timezone = 'Asia/Shanghai'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE daily_alert_configs IS
  'Daily hot-topic alert schedule configuration. Separate from schedule_configs '
  'so daily + weekly schedules can coexist per domain (Requirement 16.1).';
COMMENT ON COLUMN daily_alert_configs.timezone IS
  'V1 pinned to Asia/Shanghai. Widen via migration if multi-region support becomes needed.';


-- ────────────────────────────────────────────────────────────
-- 2. topic_canonicals — PLATFORM-LEVEL topic class dictionary.
--
-- Named without any `daily_` prefix. V1 has one writer (daily-alert pipeline),
-- but the table is positioned for future weekly-integration (Req 9.14/9.15).
-- The `origin` column is narrowed to `'daily_alert'` in V1 but its comment
-- documents the reserved `'weekly_report'` value for a follow-up spec.
--
-- Must be created BEFORE daily_hot_topics because the latter has a composite
-- FK (domain_id, canonical_topic_key) that targets this table.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS topic_canonicals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  canonical_topic_key VARCHAR(120) NOT NULL
    CHECK (canonical_topic_key ~ '^[a-z0-9-]+(::[A-Za-z0-9-]+)?$'),
  canonical_title_zh TEXT NOT NULL
    CHECK (char_length(canonical_title_zh) BETWEEN 1 AND 30),
  canonical_title_en TEXT,
  canonical_description_zh TEXT NOT NULL
    CHECK (char_length(canonical_description_zh) BETWEEN 30 AND 400),
  canonical_description_en TEXT,
  category_slug TEXT NOT NULL
    CHECK (category_slug ~ '^[a-z0-9-]+$'),
  secondary_axis_type TEXT
    CHECK (secondary_axis_type IS NULL OR secondary_axis_type IN ('site', 'category')),
  secondary_axis_value TEXT,
  first_seen_date DATE NOT NULL,
  last_seen_date DATE NOT NULL,
  seen_count INTEGER NOT NULL DEFAULT 1 CHECK (seen_count >= 1),
  origin VARCHAR(16) NOT NULL DEFAULT 'daily_alert'
    CHECK (origin IN ('daily_alert')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (domain_id, canonical_topic_key),
  -- Axis consistency: either both null or both non-null.
  CHECK ((secondary_axis_type IS NULL AND secondary_axis_value IS NULL)
      OR (secondary_axis_type IS NOT NULL AND secondary_axis_value IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_topic_canonicals_domain_last_seen
  ON topic_canonicals (domain_id, last_seen_date DESC);
CREATE INDEX IF NOT EXISTS idx_topic_canonicals_origin
  ON topic_canonicals (origin);

COMMENT ON TABLE topic_canonicals IS
  'Platform-level topic canonical dictionary. Named without "daily_" prefix '
  'intentionally — in V1 only the daily-alert pipeline writes here, but the '
  'table is positioned for future weekly-report integration (Requirement 9.14, 9.15). '
  'Future integration will add rows with origin=''weekly_report'' by widening '
  'the CHECK constraint on origin (ALTER TABLE, no schema rebuild needed).';
COMMENT ON COLUMN topic_canonicals.canonical_topic_key IS
  'Format: {category_slug} or {category_slug}::{secondary_axis_value}. '
  'The primary discriminator of a canonical class within a domain. '
  'Immutable once created — reused across days via INSERT ... ON CONFLICT DO NOTHING.';
COMMENT ON COLUMN topic_canonicals.origin IS
  'Which platform product first created this canonical. V1 emits only ''daily_alert''. '
  'Reserved future value: ''weekly_report'' — will be enabled by a follow-up spec that '
  'integrates the weekly-report pipeline with this dictionary. The CHECK constraint '
  'must be widened at that time via an ALTER TABLE migration.';
COMMENT ON COLUMN topic_canonicals.secondary_axis_type IS
  '"site" for marketplace-specific canonicals (e.g. ::BR, ::CA). '
  '"category" for product-category-specific canonicals (e.g. ::toys-battery). '
  'NULL for topics with no obvious sub-axis.';


-- ────────────────────────────────────────────────────────────
-- 3. daily_hot_topic_alerts — one published alert row per (domain, day).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_hot_topic_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  run_id UUID NOT NULL,                        -- FK added below after daily_alert_runs exists
  coverage_window_start_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status = 'published'),
  empty_day_message_zh TEXT,
  empty_day_message_en TEXT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (domain_id, coverage_window_start_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_hot_topic_alerts_domain_date
  ON daily_hot_topic_alerts (domain_id, coverage_window_start_date DESC);

COMMENT ON TABLE daily_hot_topic_alerts IS
  'One published alert per (domain, day). Status is always published — never draft. '
  'Empty-day alerts carry an empty_day_message_* and have zero child daily_hot_topics.';
COMMENT ON COLUMN daily_hot_topic_alerts.status IS
  'Invariant: always "published". CHECK enforces this. Auto-publish-on-success '
  'is a hard product decision (Requirement 6.2). No draft stage, no review gate.';


-- ────────────────────────────────────────────────────────────
-- 4. daily_alert_runs — execution history with forward-idempotency guard.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_alert_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL
    CHECK (trigger_type IN ('scheduled', 'manual')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  coverage_window_start_date DATE NOT NULL,
  coverage_window_start TIMESTAMPTZ NOT NULL,
  coverage_window_end TIMESTAMPTZ NOT NULL,
  produced_alert_id UUID REFERENCES daily_hot_topic_alerts(id) ON DELETE SET NULL,
  topic_count INTEGER,                          -- populated on succeeded (0 for empty-day)
  new_canonical_count INTEGER,                  -- populated on succeeded
  failure_reason TEXT,
  raw_output TEXT,                              -- truncated to ~500 chars for failures
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Idempotency: at most ONE active run per (domain, coverage_date).
-- A failed run leaves the "slot" free so a retry can insert a new row;
-- a succeeded run permanently occupies the slot (re-trigger rejected).
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_alert_runs_idempotency
  ON daily_alert_runs (domain_id, coverage_window_start_date)
  WHERE status IN ('queued', 'running', 'succeeded');

CREATE INDEX IF NOT EXISTS idx_daily_alert_runs_domain_triggered
  ON daily_alert_runs (domain_id, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_daily_alert_runs_status
  ON daily_alert_runs (status);

COMMENT ON TABLE daily_alert_runs IS
  'Execution history of the daily-alert pipeline. Independent from scheduled_runs '
  '(weekly report). Partial unique index on (domain_id, coverage_window_start_date) '
  'WHERE status IN (queued/running/succeeded) enforces one active run per date.';
COMMENT ON COLUMN daily_alert_runs.coverage_window_start_date IS
  'The previous Asia/Shanghai calendar day (YYYY-MM-DD). The dedup key paired with domain_id.';
COMMENT ON COLUMN daily_alert_runs.raw_output IS
  'Truncated to ~500 chars on failure; retained for 10 most recent failures indefinitely, '
  'may be shortened for older rows (Requirement 7.5).';

-- Now that daily_alert_runs exists, attach the run_id FK on daily_hot_topic_alerts.
-- Deferred to post-create because both tables reference each other (circular dependency).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'daily_hot_topic_alerts_run_id_fkey'
  ) THEN
    ALTER TABLE daily_hot_topic_alerts
      ADD CONSTRAINT daily_hot_topic_alerts_run_id_fkey
      FOREIGN KEY (run_id) REFERENCES daily_alert_runs(id) ON DELETE CASCADE;
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 5. daily_hot_topics — per-day topic rows with composite FK to topic_canonicals.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_hot_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES daily_hot_topic_alerts(id) ON DELETE CASCADE,
  domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  topic_name_zh TEXT NOT NULL
    CHECK (char_length(topic_name_zh) BETWEEN 1 AND 40),
  topic_name_en TEXT,
  keywords JSONB NOT NULL,                      -- array of 1-5 Chinese strings
  sample_quotes JSONB NOT NULL,                 -- array of 2-3 {text, source_label}
  source_links JSONB NOT NULL,                  -- array of 3-10 {title, url, source_label, published_date}
  hot_score INTEGER NOT NULL
    CHECK (hot_score BETWEEN 0 AND 100),
  summary_zh TEXT NOT NULL
    CHECK (char_length(summary_zh) BETWEEN 1 AND 400),
  summary_en TEXT,
  rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 10),
  canonical_topic_key VARCHAR(120) NOT NULL,
  is_new_canonical BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Composite FK — enforces Req 9.15: reference topic_canonicals by TUPLE
  -- (domain_id, canonical_topic_key), NOT by a daily-owned row id.
  FOREIGN KEY (domain_id, canonical_topic_key)
    REFERENCES topic_canonicals (domain_id, canonical_topic_key)
    ON DELETE RESTRICT,
  UNIQUE (alert_id, rank)                       -- rank is contiguous per alert (PBT 33)
);

CREATE INDEX IF NOT EXISTS idx_daily_hot_topics_alert
  ON daily_hot_topics (alert_id);
CREATE INDEX IF NOT EXISTS idx_daily_hot_topics_domain_canonical
  ON daily_hot_topics (domain_id, canonical_topic_key);
CREATE INDEX IF NOT EXISTS idx_daily_hot_topics_keywords_gin
  ON daily_hot_topics USING GIN (keywords);

COMMENT ON TABLE daily_hot_topics IS
  'One topic row within a Daily_Hot_Topic_Alert. References topic_canonicals via '
  'the composite (domain_id, canonical_topic_key) FK tuple — not via a direct UUID '
  'because topic_canonicals is platform-level and not daily-owned (Requirement 9.15).';
COMMENT ON COLUMN daily_hot_topics.sample_quotes IS
  'Array of 2-3 {text, source_label}. No per-quote URL — topic-level source_links '
  'is the single authoritative evidence list (Requirement 5.2 / PBT 7).';


-- ────────────────────────────────────────────────────────────
-- 6. persist_daily_alert — atomic persistence RPC (Open Item 5).
--
-- Transactional: any RAISE EXCEPTION rolls back all INSERTs/UPDATEs in the
-- call, honoring "no half-persist" semantics on downstream DB errors
-- (Requirement 6.4, Req 9.9 enforced at Inngest layer via canonicalize-
-- failure-aborts-run).
--
-- Idempotent against canonical re-proposal: new canonical INSERT uses
-- ON CONFLICT DO NOTHING; if another concurrent run created the row first,
-- this run's "is_new_canonical" flag should also be coerced to false
-- (handled by the Node-side novelty helper, NOT this RPC — the RPC trusts
-- the caller-supplied p_canonical_assignments shape).
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION persist_daily_alert(
  p_run_id UUID,
  p_domain_id UUID,
  p_coverage_window_start_date DATE,
  p_scanned_topics JSONB,         -- array of objects matching ScanTopic shape
  p_canonical_assignments JSONB,  -- array of objects matching CanonicalAssignment shape
  p_existing_canonical_keys TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS JSONB                      -- { alertId, topicIds[], newCanonicalKeys[] }
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  v_alert_id UUID;
  v_topic_ids UUID[] := ARRAY[]::UUID[];
  v_new_canonical_keys TEXT[] := ARRAY[]::TEXT[];
  v_topic_count INT;
  v_assignment_count INT;
  i INT;
  v_assignment JSONB;
  v_topic JSONB;
  v_inserted_key TEXT;
  v_topic_id UUID;
  v_reuse_counts JSONB := '{}'::JSONB;           -- { key: count_in_this_run }
  v_existing_set TEXT[];
BEGIN
  -- Basic input validation
  v_topic_count := jsonb_array_length(p_scanned_topics);
  v_assignment_count := jsonb_array_length(p_canonical_assignments);
  IF v_topic_count <> v_assignment_count THEN
    RAISE EXCEPTION 'persist_daily_alert: assignments (%) != topics (%)',
                    v_assignment_count, v_topic_count;
  END IF;

  v_existing_set := COALESCE(p_existing_canonical_keys, ARRAY[]::TEXT[]);

  -- 1. Insert the alert row (status='published').
  INSERT INTO daily_hot_topic_alerts
    (domain_id, run_id, coverage_window_start_date, status, published_at)
  VALUES
    (p_domain_id, p_run_id, p_coverage_window_start_date, 'published', now())
  RETURNING id INTO v_alert_id;

  -- 2a. Insert new canonicals (ON CONFLICT DO NOTHING to handle races).
  FOR i IN 0 .. v_assignment_count - 1 LOOP
    v_assignment := p_canonical_assignments -> i;

    IF (v_assignment ->> 'is_new_canonical')::BOOLEAN = true
       AND NOT (v_assignment ->> 'canonical_topic_key' = ANY(v_existing_set))
    THEN
      INSERT INTO topic_canonicals (
        domain_id,
        canonical_topic_key,
        canonical_title_zh,
        canonical_description_zh,
        category_slug,
        secondary_axis_type,
        secondary_axis_value,
        first_seen_date,
        last_seen_date,
        seen_count,
        origin
      )
      VALUES (
        p_domain_id,
        v_assignment ->> 'canonical_topic_key',
        v_assignment ->> 'canonical_title_zh',
        v_assignment ->> 'canonical_description_zh',
        v_assignment ->> 'category_slug',
        v_assignment ->> 'secondary_axis_type',    -- NULL if JSON key missing
        v_assignment ->> 'secondary_axis_value',
        p_coverage_window_start_date,
        p_coverage_window_start_date,
        1,
        'daily_alert'
      )
      ON CONFLICT (domain_id, canonical_topic_key) DO NOTHING
      RETURNING canonical_topic_key INTO v_inserted_key;

      -- Only accumulate keys that were actually inserted (not race-losers).
      IF v_inserted_key IS NOT NULL THEN
        v_new_canonical_keys := array_append(v_new_canonical_keys, v_inserted_key);
      END IF;
    END IF;

    -- 2b. Tally reuse counts per key (used for UPDATE below).
    v_reuse_counts := jsonb_set(
      v_reuse_counts,
      ARRAY[v_assignment ->> 'canonical_topic_key'],
      to_jsonb(
        COALESCE(
          (v_reuse_counts ->> (v_assignment ->> 'canonical_topic_key'))::INT,
          0
        ) + 1
      )
    );
  END LOOP;

  -- 2c. Bulk update last_seen_date + seen_count for canonicals seen this run.
  --     Includes new canonicals (seen_count started at 1, now bumped to n).
  --     Also includes reused canonicals from v_existing_set.
  UPDATE topic_canonicals tc
     SET last_seen_date = p_coverage_window_start_date,
         seen_count = tc.seen_count
                    + GREATEST(
                        ((v_reuse_counts ->> tc.canonical_topic_key)::INT) - 1,
                        0
                      ),
         updated_at = now()
   WHERE tc.domain_id = p_domain_id
     AND tc.canonical_topic_key IN (SELECT jsonb_object_keys(v_reuse_counts));

  -- 3. Insert per-topic rows.
  FOR i IN 0 .. v_topic_count - 1 LOOP
    v_topic := p_scanned_topics -> i;
    v_assignment := p_canonical_assignments -> i;

    INSERT INTO daily_hot_topics (
      alert_id,
      domain_id,
      topic_name_zh,
      keywords,
      sample_quotes,
      source_links,
      hot_score,
      summary_zh,
      rank,
      canonical_topic_key,
      is_new_canonical
    )
    VALUES (
      v_alert_id,
      p_domain_id,
      v_topic ->> 'topic_name_zh',
      v_topic -> 'keywords',
      v_topic -> 'sample_quotes',
      v_topic -> 'source_links',
      (v_topic ->> 'hot_score')::INT,
      v_topic ->> 'summary_zh',
      (v_topic ->> 'rank')::INT,
      v_assignment ->> 'canonical_topic_key',
      (v_assignment ->> 'is_new_canonical')::BOOLEAN
    )
    RETURNING id INTO v_topic_id;

    v_topic_ids := array_append(v_topic_ids, v_topic_id);
  END LOOP;

  -- 4. Link the run to the produced alert.
  UPDATE daily_alert_runs
     SET produced_alert_id = v_alert_id
   WHERE id = p_run_id;

  RETURN jsonb_build_object(
    'alertId', v_alert_id,
    'topicIds', to_jsonb(v_topic_ids),
    'newCanonicalKeys', to_jsonb(v_new_canonical_keys)
  );
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'persist_daily_alert failed: %', SQLERRM
    USING HINT = 'The transaction has rolled back. No alert or topic rows persisted.';
END;
$fn$;

-- Only the service role (Inngest function server-side) should call this.
-- Admin / anon / authenticated users have no direct need; UI reads via
-- standard SELECTs gated by RLS.
REVOKE ALL ON FUNCTION persist_daily_alert(UUID, UUID, DATE, JSONB, JSONB, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION persist_daily_alert(UUID, UUID, DATE, JSONB, JSONB, TEXT[]) TO service_role;

COMMENT ON FUNCTION persist_daily_alert(UUID, UUID, DATE, JSONB, JSONB, TEXT[]) IS
  'Atomically persists a daily hot-topic alert: INSERT alert row, UPSERT new '
  'topic_canonicals, UPDATE seen_count/last_seen_date for reused, INSERT N '
  'daily_hot_topics, UPDATE run.produced_alert_id. Any error rolls back the '
  'whole transaction (Requirement 6.4). Returns { alertId, topicIds, newCanonicalKeys }.';
