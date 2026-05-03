# 实施计划：每日热点话题预警 (Daily Hot-Topic Alert)

## 概述 (Plan Metadata)

### Goal

在现有雷达报告平台上新增一条独立的、轻量的、自动发布的每日热点话题预警线 — 与周/双周 Regular Report 并行共存、绝不触碰 `news` 表、支持平台级话题字典 `topic_canonicals`、双语从第一天开始。

### 实施路径（high-level）

1. 预备改动（零迁移、零风险）— 扩 `zai-client.ts` + 小依赖补齐 + 类型文件 + 默认 prompt 常量
2. 数据库迁移 015 → 018（顺序不可颠倒）
3. `src/lib/daily-alert/` 核心业务模块 + 随附 PBT
4. 4 个 Inngest 函数（daily-alert-tick / daily-alert-run / translate-topic / translate-canonical）
5. 11 个 API 路由（admin 7 + user 2 + re-translate 2）
6. 3 个新页面 + 复用组件 + 导航更新
7. 端到端 smoke test（本地 Supabase + Inngest dev server + 手动触发）

### External side-effects summary

- **Inngest**: 新增 4 个函数 — 部署后需在 Inngest Cloud dashboard 手动点 **Resync**。4 个函数的 triggers、idempotency key、concurrency 都是新 config，Resync 不可跳过
- **Supabase**: 4 个迁移文件 015–018 需在 SQL Editor 按序执行；5 张新表 + RLS 策略 + `prompt_templates` CHECK 放开 + 默认 config seed
- **Vercel env vars**: 零新增 — `ZAI_API_KEY` / `SUPABASE_SERVICE_ROLE_KEY` 已由 weekly pipeline 配置
- **npm dependencies**: 新增 `swr`（若 `package.json` 未依赖）
- **Feature flag activation**: `/admin/daily-alert-settings` 手动勾 `Enabled` + 保存 `time_of_day`（默认 `06:00`）

### Rollback plan

按以下顺序可完整回滚：

1. `/admin/daily-alert-settings` → `Enabled` 取消勾 + 保存（瞬时停止 tick 触发）
2. `git revert <commit-sha>` → push → Vercel 自动重部署（代码回到 pre-daily-alert 状态）
3. Supabase SQL Editor 执行 `DROP TABLE daily_hot_topics, daily_hot_topic_alerts, daily_alert_runs, daily_alert_configs, topic_canonicals CASCADE;` 仅在确认数据不需要保留时；否则保留表（表空无风险）
4. Inngest dashboard → Apps → Resync（注销被 revert 的 4 个函数）

### 任务组（执行顺序）

1. 预备代码改动（Preparatory）— 零迁移、零风险
2. 数据库迁移 015–018
3. 核心业务模块 `src/lib/daily-alert/`
4. Property-Based Tests (PBT) — 随附模块编写
5. Inngest 函数（4 个）
6. API 路由（11 个）
7. UI 页面与组件
8. UI Property Tests
9. DB/Integration PBT（需本地 Supabase）
10. E2E 冒烟测试
11. P2 polish（可选，`*` 标记）

标记 `*` 的子任务为 optional：可跳过以加速 MVP 发布，但完整 PBT 覆盖率需要全部执行。核心实现任务（未带 `*` 的）**必须**执行。

## 任务

- [x] 1. 预备代码改动（Preparatory — zero migrations, zero risk）
  - Requirement refs: Design §Open Items 1–4, §TypeScript 类型定义
  
  - [x] 1.1 扩展 `zai-client.ts` 支持 `enableWebSearch` 开关（Open Item 1）
    - 修改 `src/lib/research-engine/engines/zai-client.ts`
    - 在 `ZaiCallParams` 接口加 `enableWebSearch?: boolean`（default `true`，保持向后兼容）
    - 在构造 request body 时，若 `enableWebSearch === false`，省略 `tools` 字段（不传 `tools: [{ type: 'web_search', ... }]`）
    - `searchRecency` / `contentSize` 保持接受但当 web search 关闭时无效（不抛错，忽略即可）
    - 改动目标：≤ 20 行、非破坏性。现有 Engine B 调用方不传 `enableWebSearch` → 默认 `true` → 行为不变
    - `getDiagnostics` on `zai-client.ts` 零错误
    - 不跑 live probe（Daily canonicalize 会是第一个 `enableWebSearch=false` 消费者，probe 在 task 5.2 完整覆盖）
    - _Requirements: Design §Open Items 1, §zai-client 复用_
  
  - [x] 1.2 更新 `zai-client.test.ts` 加 1 个新 unit test（web-search-disabled path）
    - 文件：`src/lib/research-engine/engines/__tests__/zai-client.test.ts`
    - 新增 case 10：`enableWebSearch: false` → outgoing body 不含 `tools` 字段；response 不含 `web_search[]` → `searchReferences` 为空数组
    - 跑 `npx vitest run src/lib/research-engine/engines/__tests__/zai-client.test.ts` → 期望 10/10 通过
    - _Requirements: Open Items 1（校验非破坏性）_
  
  - [x] 1.3 确认并在缺失时安装 `swr`（Open Item 3）
    - `grepSearch` 确认 `"swr"` 不在 `package.json` dependencies（已确认：未安装）
    - 运行 `npm install swr`（不指定版本，取 latest；`package.json` + `package-lock.json` 同步更新）
    - 验证：`grepSearch "\"swr\"" package.json` → 应命中一次
    - 不跑 build（仅增依赖，无代码调用）
    - _Requirements: Design §`/alerts` page structure（SWR 依赖）, Open Items 3_
  
  - [x] 1.4 锁定 `notifications.type` 策略 — 复用 `'news'`（Open Item 4，V1 决策）
    - **决策**：V1 不扩 `notifications.type` enum；daily 失败通知复用 `'news'` 作为 type，`reference_id` = `daily_alert_run.id`
    - 理由：
      - 避免增加一条 `ALTER TABLE ADD CONSTRAINT` 迁移（迁移面最小化）
      - 前端已按 `type='news'` 处理点击 → 本任务会额外处理 `reference_id` 前缀/路由
      - 未来若 breadcrumb 精度不够，P2 polish 任务 11.3 会评估是否扩 enum
    - **行动**：本任务无代码改动，只记录决策。所有后续任务（notify-admins step、前端通知点击路由）按此前提实现
    - _Requirements: Requirement 7.1, Design §失败处理矩阵 note_
  
  - [x] 1.5 锁定 `errorContext.engine` 策略 — 复用 `'kimi'`（Open Item 2，V1 决策）
    - **决策**：V1 `callZai` 的 `errorContext.engine` 传 `'kimi'`；`stage` 字段传 `'daily-scan'` 或 `'daily-canon'` 作为 breadcrumb 精度
    - 理由：
      - `zai-client.ts` 现有 enum 为 `'gemini' | 'kimi' | 'synthesizer'`；扩 enum 触发 3 个 client 文件 + 所有 errorContext usage 的 type 更新
      - `stage` 是自由字符串（design §3 节），完全可以承载 `'daily-scan'` / `'daily-canon'` 的 breadcrumb 语义
      - Inngest 日志中看到 `engine='kimi' stage='daily-scan'` 的语义清晰度可接受
    - **行动**：本任务无代码改动，只记录决策。所有后续任务（scan.ts / canonicalize.ts 中的 callZai 调用）按此前提实现
    - 若未来观察 Inngest trace 可读性不足（P2 polish task 11.4），再扩 enum
    - _Requirements: Design §Open Items 2_
  
  - [x] 1.6 创建类型文件 `src/types/daily-alert.ts`
    - 从 design §TypeScript 类型定义 section 复制以下类型到 `src/types/daily-alert.ts`：
      - DB Row Types：`DailyAlertConfigRow`, `DailyAlertRunRow`, `DailyHotTopicAlertRow`, `DailyHotTopicRow`, `TopicCanonicalRow`
      - Zod schemas：`ScanSampleQuoteSchema`, `ScanSourceLinkSchema`, `ScanTopicSchema`, `ScanResponseSchema`, `CanonicalAssignmentSchema` (discriminated union), `CanonicalizeResponseSchema`
      - 派生 types：`ScanResponse`, `ScanTopic`, `CanonicalAssignment`, `CanonicalizeResponse`
      - API payload types：`AlertsOverviewResponse`, `DayDetailResponse`, `DailyHotTopicFull`
    - 文件顶端注释引用 `requirements.md` § "Daily Hot Topic Schema"
    - `getDiagnostics` on `src/types/daily-alert.ts` 零错误
    - _Requirements: Requirement 5.1, 9.2, Design §TypeScript 类型定义_
  
  - [x] 1.7 扩展 `src/types/database.ts` 加 5 个新表的 Row/Insert/Update 类型
    - 为 `daily_alert_configs`、`daily_alert_runs`、`daily_hot_topic_alerts`、`daily_hot_topics`、`topic_canonicals` 各加三元组类型
    - 字段名与迁移 015 DDL 完全一致（包括枚举字面量 `'scheduled' | 'manual'`、`'queued' | 'running' | 'succeeded' | 'failed'`、`'published'`、`'site' | 'category'`、`'daily_alert'` 等）
    - 与 `src/types/daily-alert.ts` 的 Row 类型保持字段一致（`daily-alert.ts` 是业务层，`database.ts` 是数据层，二者互不取代）
    - `getDiagnostics` on `src/types/database.ts` 零错误
    - _Requirements: Design §新增表 DDL, §TypeScript 类型定义_
  
  - [x] 1.8 创建默认 Prompt 常量文件 `src/lib/daily-alert/prompt-defaults.ts`
    - 新建 `src/lib/daily-alert/prompt-defaults.ts`
    - 导出两个字符串常量：
      - `DEFAULT_DAILY_SCAN_PROMPT` — 完整中文文本来自 design §默认 Prompts § `daily_scan_prompt`（含 `{coverage_window_start}`、`{coverage_window_end}`、`{domain_name}` 占位符）
      - `DEFAULT_DAILY_CANONICALIZATION_PROMPT` — 完整中文文本来自 design §默认 Prompts § `daily_canonicalization_prompt`（含 `{scanned_topics_json}`、`{existing_canonicals_json}`、`{domain_name}` 占位符）
    - 这两个常量将被 (a) `/api/admin/daily-alert-prompts` GET endpoint 的 `defaults` 字段返回；(b) 迁移 017 seed 用（通过 SQL 硬编码同一文本，保持同步；本 spec 不走跨语言引用）
    - 任何改动必须 **同时** 更新此文件 **和** 迁移 017 — 在文件顶部注释里明确标注
    - `getDiagnostics` 零错误
    - _Requirements: Requirement 12.1, 12.5, 12.6, Design §默认 Prompts_


- [x] 2. 数据库迁移（015 → 018，顺序不可颠倒）
  - Requirement refs: 1.1–1.8, 2.4, 2.6, 5.1, 6.1, 6.3, 9.2, 9.11, 9.14, 9.15, 12.1, 16.1
  - Design refs: §新增表 DDL, §RLS 策略, §Migrations
  - **顺序约束**：015 必须先（创建 5 张表，RLS/prompts/seed 都依赖它们）→ 016（RLS 策略）→ 017（扩 `prompt_templates` CHECK；017 要求 011 的 CHECK 已在最新状态，即允许 `engine_a_hot_radar` / `engine_b_hot_radar` / `shared_deep_dive` / `synthesizer_prompt` 这 4 个值）→ 018（seed 默认 config 行；018 要求 005 已 seed Account Health domain）
  - 每个迁移文件顶端都加一段 header 注释：迁移编号、目的、依赖的先前迁移（例如 `-- depends on: 005 (Account Health domain), 015 (new tables)`）、re-run safety（建议全部使用 `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` / `DROP ... IF EXISTS` 以保证幂等重跑）
  
  - [x] 2.1 创建 `supabase/migrations/015_create_daily_alert_tables.sql`
    - 文件路径：`supabase/migrations/015_create_daily_alert_tables.sql`
    - 内容（按序）：
      1. `CREATE TABLE daily_alert_configs` — 完整 DDL 来自 design §新增表 DDL §1，包含 UNIQUE(domain_id)、CHECK on time_of_day、CHECK on timezone、COMMENTs
      2. `CREATE TABLE daily_alert_runs` — design §新增表 DDL §2，包含 CHECK on trigger_type + status、partial unique index `idx_daily_alert_runs_idempotency ON (domain_id, coverage_window_start_date) WHERE status IN ('queued','running','succeeded')`、`idx_daily_alert_runs_domain_triggered`、`idx_daily_alert_runs_status`、COMMENTs
      3. `CREATE TABLE daily_hot_topic_alerts` — design §3，包含 CHECK on status、UNIQUE(domain_id, coverage_window_start_date)、`idx_daily_hot_topic_alerts_domain_date`
      4. `CREATE TABLE topic_canonicals` — **注意**：DDL 必须在 `daily_hot_topics` 之前建（后者复合 FK 引用前者）。design §5。包含 CHECK on canonical_topic_key regex、CHECK on category_slug regex、CHECK on secondary axis 一致性、CHECK on origin (V1 只允许 `'daily_alert'`)、UNIQUE(domain_id, canonical_topic_key)、`idx_topic_canonicals_domain_last_seen`、`idx_topic_canonicals_origin`、COMMENTs
      5. `CREATE TABLE daily_hot_topics` — design §4，复合 FK `FOREIGN KEY (domain_id, canonical_topic_key) REFERENCES topic_canonicals(domain_id, canonical_topic_key)`、CHECK on hot_score + rank + summary_zh 长度、UNIQUE(alert_id, rank)、`idx_daily_hot_topics_alert` / `idx_daily_hot_topics_domain_canonical` / `idx_daily_hot_topics_keywords_gin`、COMMENTs
      6. `CREATE OR REPLACE FUNCTION persist_daily_alert(...)` — PL/pgSQL RPC，签名与内容参见 **Open Item 5 实现（子任务 2.1.1）**
    - 所有 DDL 使用 `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` 保证幂等重跑
    - 手工验证 SQL（部署后在 SQL Editor 跑以确认）：
      ```sql
      SELECT table_name FROM information_schema.tables 
       WHERE table_schema='public' 
         AND table_name IN ('daily_alert_configs','daily_alert_runs','daily_hot_topic_alerts','daily_hot_topics','topic_canonicals');
      -- 期望：5 rows
      
      SELECT indexname FROM pg_indexes 
       WHERE tablename='daily_alert_runs' 
         AND indexname='idx_daily_alert_runs_idempotency';
      -- 期望：1 row
      
      SELECT proname FROM pg_proc WHERE proname='persist_daily_alert';
      -- 期望：1 row
      ```
    - _Requirements: 1.1, 1.2, 2.4, 2.6, 5.1, 6.1, 6.3, 9.11, 9.14, 9.15_
    
    - [x] 2.1.1 实现 `persist_daily_alert` PL/pgSQL RPC（Open Item 5）
      - 放在迁移 015 尾部
      - **签名**：
        ```sql
        CREATE OR REPLACE FUNCTION persist_daily_alert(
          p_run_id UUID,
          p_domain_id UUID,
          p_coverage_window_start_date DATE,
          p_scanned_topics JSONB,         -- array matching ScanTopic shape
          p_canonical_assignments JSONB,  -- array of CanonicalAssignment
          p_existing_canonical_keys TEXT[] -- pre-computed set of already-existing keys
        ) RETURNS JSONB                    -- { alertId, topicIds[], newCanonicalKeys[] }
        LANGUAGE plpgsql
        SECURITY DEFINER
        AS $$
        DECLARE
          v_alert_id UUID;
          v_topic_ids UUID[] := ARRAY[]::UUID[];
          v_new_canonical_keys TEXT[] := ARRAY[]::TEXT[];
          -- ...
        BEGIN
          -- 1. INSERT daily_hot_topic_alerts (status='published')
          -- 2. For each assignment with is_new_canonical=true:
          --      INSERT INTO topic_canonicals (...) ON CONFLICT (domain_id, canonical_topic_key) DO NOTHING
          --      RETURNING canonical_topic_key into tmp; if inserted, append to v_new_canonical_keys
          --    For each existing canonical key referenced this run:
          --      UPDATE topic_canonicals SET last_seen_date=p_coverage_window_start_date, seen_count = seen_count + <count_in_this_run>
          --      WHERE domain_id=p_domain_id AND canonical_topic_key=<key>
          -- 3. For i IN 0..jsonb_array_length(p_scanned_topics)-1:
          --      INSERT daily_hot_topics with canonical_topic_key + is_new_canonical from assignment
          --      RETURNING id -> append to v_topic_ids
          -- 4. UPDATE daily_alert_runs SET produced_alert_id=v_alert_id WHERE id=p_run_id
          RETURN jsonb_build_object(
            'alertId', v_alert_id,
            'topicIds', to_jsonb(v_topic_ids),
            'newCanonicalKeys', to_jsonb(v_new_canonical_keys)
          );
        EXCEPTION WHEN OTHERS THEN
          -- Let caller decide; re-raise with context
          RAISE EXCEPTION 'persist_daily_alert failed: %', SQLERRM;
        END;
        $$;
        ```
      - RPC runs inside an implicit transaction — any `RAISE EXCEPTION` rolls the whole call back, honoring "no half-persist" (Requirement 6.4)
      - Granular grant: `GRANT EXECUTE ON FUNCTION persist_daily_alert(UUID, UUID, DATE, JSONB, JSONB, TEXT[]) TO service_role;` (admin + anon 都不调用；只 Inngest service role 调用)
      - 手工验证 SQL：
        ```sql
        -- 干跑（expected to fail gracefully due to empty inputs but surfaces function visibility + arg types)
        SELECT persist_daily_alert(
          gen_random_uuid(), gen_random_uuid(), CURRENT_DATE,
          '[]'::jsonb, '[]'::jsonb, ARRAY[]::TEXT[]
        );
        ```
      - _Requirements: 6.1, 6.3, 6.4, 9.6, 9.7, Design §persist.ts 接口, §Open Items 5_
  
  - [x] 2.2 创建 `supabase/migrations/016_create_daily_alert_rls.sql`
    - 文件路径：`supabase/migrations/016_create_daily_alert_rls.sql`
    - 内容：design §RLS 策略 完整 SQL — 5 张表 ENABLE RLS + 对应 policies
    - Pattern：
      - `daily_alert_configs` / `daily_alert_runs`：admin only (FOR ALL)
      - `daily_hot_topic_alerts` / `daily_hot_topics` / `topic_canonicals`：authenticated SELECT + admin FOR ALL
    - 所有 policy 使用 `CREATE POLICY` 无 `IF NOT EXISTS`（PostgreSQL 不支持），迁移头部加 `DROP POLICY IF EXISTS "<name>" ON <table>;` 每条策略一次以保幂等
    - Service role key 绕过 RLS（Inngest 写入路径）— 这是设计前提，不需 policy
    - 手工验证：
      ```sql
      SELECT schemaname, tablename, policyname FROM pg_policies 
       WHERE tablename IN ('daily_alert_configs','daily_alert_runs','daily_hot_topic_alerts','daily_hot_topics','topic_canonicals')
       ORDER BY tablename, policyname;
      -- 期望：至少 8 行（5 admin FOR ALL + 3 authenticated SELECT）
      ```
    - _Requirements: 1.7, 3.5, Design §RLS 策略_
  
  - [x] 2.3 创建 `supabase/migrations/017_extend_prompt_templates_for_daily.sql`
    - 文件路径：`supabase/migrations/017_extend_prompt_templates_for_daily.sql`
    - 内容：
      1. `ALTER TABLE prompt_templates DROP CONSTRAINT IF EXISTS prompt_templates_prompt_type_check;`
      2. `ALTER TABLE prompt_templates ADD CONSTRAINT prompt_templates_prompt_type_check CHECK (prompt_type IN ('engine_a_hot_radar','engine_b_hot_radar','shared_deep_dive','synthesizer_prompt','daily_scan_prompt','daily_canonicalization_prompt'));`
      3. `INSERT INTO prompt_templates (domain_id, prompt_type, template_text) VALUES ((SELECT id FROM domains WHERE name='Account Health'), 'daily_scan_prompt', $$<FULL CHINESE TEXT FROM DEFAULT_DAILY_SCAN_PROMPT>$$) ON CONFLICT (domain_id, prompt_type) DO NOTHING;`
      4. 同模式插入 `'daily_canonicalization_prompt'`
    - 使用 PostgreSQL dollar-quoted string `$$...$$` 避免单引号转义噩梦（中文内容可能含单引号和换行）
    - **严格要求**：此处 SQL literal 的文本必须与 `src/lib/daily-alert/prompt-defaults.ts` 中的常量 **逐字节一致**。若后期改动其一，必须同步改另一方（在 2 个文件顶部均加提示注释）
    - 依赖 migration 005 已 seed `domains` 表中的 Account Health domain
    - 手工验证：
      ```sql
      SELECT prompt_type, char_length(template_text) as len 
       FROM prompt_templates 
       WHERE domain_id = (SELECT id FROM domains WHERE name='Account Health')
         AND prompt_type IN ('daily_scan_prompt', 'daily_canonicalization_prompt');
      -- 期望：2 行，len 各 > 500（中文 prompt 应很长）
      ```
    - _Requirements: 12.1, 12.5, 12.6, Design §prompt_templates extension_
  
  - [x] 2.4 创建 `supabase/migrations/018_seed_daily_alert_defaults.sql`
    - 文件路径：`supabase/migrations/018_seed_daily_alert_defaults.sql`
    - 内容：
      ```sql
      INSERT INTO daily_alert_configs (domain_id, enabled, time_of_day, timezone)
      SELECT id, false, '06:00', 'Asia/Shanghai'
        FROM domains WHERE name = 'Account Health'
      ON CONFLICT (domain_id) DO NOTHING;
      ```
    - 依赖 015（表已创建）、005（Account Health domain 已 seed）
    - 手工验证：
      ```sql
      SELECT enabled, time_of_day, timezone 
       FROM daily_alert_configs 
       WHERE domain_id = (SELECT id FROM domains WHERE name='Account Health');
      -- 期望：1 行, enabled=false, time_of_day='06:00', timezone='Asia/Shanghai'
      ```
    - _Requirements: 1.8, Design §新增表 DDL §1_


- [x] 3. 核心业务模块 `src/lib/daily-alert/`
  - Requirement refs: 4.x, 5.x, 6.x, 7.x, 8.x, 9.x, 10.x, 12.x, 16.x
  - Design refs: §组件与接口 §3-§6, §Scan & Canonicalize helper 模块
  - 约定：所有模块放 `src/lib/daily-alert/`。`scan.ts` / `canonicalize.ts` 允许 import `@/lib/research-engine/engines/zai-client`；`persist.ts` / `novelty.ts` 允许 import `@/lib/supabase/server`（service role client）。与 `src/lib/research-engine/` 严格隔离 — 后者不准 import 本目录的任何文件
  - 每个子任务各单独 `getDiagnostics`，零错误后再进下一步
  
  - [x] 3.1 `coverage-window.ts` — 日界计算工具
    - 新建 `src/lib/daily-alert/coverage-window.ts`
    - 导出纯函数：
      - `toShanghai(date: Date): { year: number; month: number; day: number; HHMM: string; dateStr: string }` — 使用 `Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', ... })` 取 Shanghai 本地年月日时分；`dateStr = 'YYYY-MM-DD'`
      - `computeCoverageDate(nowInShanghai: { year, month, day }): string` — 返回 `(year, month, day) - 1 day` 的 `'YYYY-MM-DD'` 字符串；小心月/年 rollover
      - `computeCoverageWindowIso(coverageDate: string): { startIso: string; endIso: string }` — 基于 `coverageDate` 生成 `'${coverageDate}T00:00:00+08:00'` 与 `'${coverageDate}T23:59:59+08:00'`
      - `shouldFire(config: DailyAlertConfigRow, nowUtc: Date): boolean` — `config.enabled && toShanghai(nowUtc).HHMM === config.time_of_day`
    - 纯函数，不 import `@/lib/supabase/*`、`inngest`、`@/lib/daily-alert/*` 其他文件
    - `getDiagnostics` 零错误
    - _Requirements: 1.1, 1.6, 2.1, 2.3, 3.2, Design §组件与接口 §2_
  
  - [x] 3.2 `zod-schemas.ts` — Zod schema re-export + key normalizer
    - 新建 `src/lib/daily-alert/zod-schemas.ts`
    - **职责**：从 `src/types/daily-alert.ts` re-export 所有 Zod schema（`ScanResponseSchema`, `CanonicalizeResponseSchema`, 等），便于业务模块只依赖 `daily-alert/` 命名空间而无需 reach into `types/`
    - 新增一个 helper `normalizeCanonicalKey(raw: string): string` — `trim()` + primary segment `.toLowerCase()` + secondary segment（`::` 后）保留原样。若归一化后仍不匹配 `^[a-z0-9-]+(::[A-Za-z0-9-]+)?$` → 抛 `Error('malformed canonical key: ...')`
    - `getDiagnostics` 零错误
    - _Requirements: 4.3, 5.3, 5.4, 9.10, Design §canonicalize.ts_
  
  - [x] 3.3 `substitute.ts` — 占位符替换 helper
    - 新建 `src/lib/daily-alert/substitute.ts`
    - 导出 `substitute(template: string, vars: Record<string, string>): string`
    - 使用 `String.prototype.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '{' + key + '}')` — 白名单策略：已知 key 替换，未知 key 原样保留
    - 白名单严格限定为：`coverage_window_start`, `coverage_window_end`, `domain_name`, `scanned_topics_json`, `existing_canonicals_json`
    - 不做 eval / Function / 任何动态求值
    - `getDiagnostics` 零错误
    - _Requirements: 4.2, 12.5, 12.6, 13.1, Design §scan.ts / canonicalize.ts_
  
  - [x] 3.4 `scan.ts` — Daily scan engine（runDailyScan）
    - 新建 `src/lib/daily-alert/scan.ts`
    - 接口与实现遵循 design §组件与接口 §4
      - `runDailyScan(input: DailyScanInput): Promise<DailyScanResult>`
      - 内部流程：
        1. `substitute(scanPrompt, { coverage_window_start, coverage_window_end, domain_name })` → resolvedPrompt
        2. `callZai<unknown>({ model: 'glm-4.6', messages: [{role:'user', content: resolvedPrompt}], apiKey: zaiApiKey, timeoutMs: 240_000, jsonMode: true, searchRecency: 'oneDay', contentSize: 'high', enableWebSearch: true, errorContext: { engine: 'kimi', stage: 'daily-scan' } })`（注：engine 借用 `'kimi'` — 见 task 1.5 决策）
        3. 成功 → `ScanResponseSchema.safeParse(result.data)` 严格校验
        4. Per-topic validation：`rank ∈ [1,10]`、`hot_score ∈ [0,100]`、`source_links.length ≥ 3`（先过滤 URL 无效条目：`try { new URL(url) } catch {}`）、`sample_quotes.length ∈ [2,3]`；违规 topic 剔除并记入 debug output
        5. 按 `hot_score` 降序排序，取 top 10，为幸存 topic 重排 `rank = 1..N`
      - 错误类映射至 failure_reason（design §5 错误映射表）：
        - `CreditsExhausted` → `'z.ai credits exhausted'`
        - `TimeoutError` → `'GLM timeout'`
        - `NetworkError` → `'GLM network error'`
        - `ServerError` → `'Daily scan: GLM 5xx'`
        - `MalformedResponse`（Zod 失败 or GLM 返回非 JSON）→ `'Daily alert: MalformedResponse'`
      - 返回 `{ ok: true, topics: [...] }` 或 `{ ok: false, failureReason, rawOutput: truncate(raw, 500) }`
    - `getDiagnostics` 零错误
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.8, 4.9, 4.10, 5.3, 5.4, 7.4, 13.3, Design §scan.ts 接口_
  
  - [x] 3.5 `canonicalize.ts` — Daily canonicalization engine（runDailyCanonicalize）
    - 新建 `src/lib/daily-alert/canonicalize.ts`
    - 接口与实现遵循 design §组件与接口 §5
      - `runDailyCanonicalize(input: DailyCanonicalizeInput): Promise<DailyCanonicalizeResult>`
      - 内部流程：
        1. 构造 `scanned_topics_json` = JSON.stringify scanned topics（每条带 `scanned_topic_index`）、`existing_canonicals_json` = JSON.stringify existing canonicals 子集（仅 `canonical_topic_key`, `canonical_title_zh`, `canonical_description_zh`, `category_slug`, `secondary_axis_type`, `secondary_axis_value`）
        2. `substitute(canonPrompt, { scanned_topics_json, existing_canonicals_json, domain_name })` → resolvedPrompt
        3. `callZai<unknown>({ model: 'glm-4.6', messages: [{role:'user', content: resolvedPrompt}], apiKey: zaiApiKey, timeoutMs: 90_000, jsonMode: true, enableWebSearch: false, errorContext: { engine: 'kimi', stage: 'daily-canon' } })`（`enableWebSearch: false` 是本 spec 对 zai-client 的首次使用点）
        4. 成功 → `CanonicalizeResponseSchema.safeParse(result.data)` 严格校验（discriminated union on `is_new_canonical`）
        5. 对每条 `assignment.canonical_topic_key` 调 `normalizeCanonicalKey(raw)`；归一化失败整 run fail with `'Canonicalization: malformed key (got: ...)'`（raw 截断 80 字）
        6. 一致性校验：`assignments.length === scannedTopics.length`；缺失 index → fail `'Canonicalization: missing assignments'`
    - 错误类映射全部前缀 `'Canonicalization failed: '` 后接 sub-reason（design §失败处理矩阵）
    - `getDiagnostics` 零错误
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.8, 9.9, 9.10, 13.4, Design §canonicalize.ts 接口_
  
  - [x] 3.6 `persist.ts` — 原子事务持久化
    - 新建 `src/lib/daily-alert/persist.ts`
    - 导出：
      - `persistDailyAlertTransaction(input: PersistInput): Promise<PersistOutput>` — 薄 wrapper 调用 `persist_daily_alert` RPC（迁移 015 定义）
      - `persistEmptyDayAlert(input: { runId, domainId, coverageWindowStartDate }): Promise<{ alertId: string }>` — 直接 INSERT `daily_hot_topic_alerts` with `empty_day_message_zh = '本日无显著热点话题，管线已正常完成扫描。'`，`empty_day_message_en = null`（将由 admin 翻译或 P2 多加一个 kind=empty 的 translate event）
    - 使用 `createServiceRoleSupabaseClient()`（复用现有 helper 或按 weekly pipeline 模式新建）绕过 RLS
    - 对 RPC 返回错误：re-throw `new Error('Persistence failed: ' + pgError.message)`
    - `getDiagnostics` 零错误
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 9.6, 9.7, Design §persist.ts 接口_
  
  - [x] 3.7 `novelty.ts` — is_new_canonical 判定 helper
    - 新建 `src/lib/daily-alert/novelty.ts`
    - 导出 `computeIsNewCanonical(assignment: CanonicalAssignment, existingKeys: Set<string>): boolean`
    - 定义：`assignment.is_new_canonical === true ⟺ !existingKeys.has(assignment.canonical_topic_key)`
    - **用途**：在 `persist.ts` 的调用前做 sanity check — 若 AI 返回 `is_new_canonical=true` 但 `canonical_topic_key` 实际在 `existingKeys` 内（或反之），覆写为正确值并 log 警告（Req 9.6 规定真实世界值以 DB 状态为准）
    - `getDiagnostics` 零错误
    - _Requirements: 9.6, Design §novelty.ts_
  
  - [x] 3.8 `i18n-fallback.ts` — 双语回退 helper
    - 新建 `src/lib/daily-alert/i18n-fallback.ts`
    - 导出 `resolveText(zh: string | null | undefined, en: string | null | undefined, lang: 'zh' | 'en'): { text: string; needsFallbackIndicator: boolean }`
    - 实现完全按 design §`/alerts` page structure § Bilingual fallback 逻辑
    - 纯函数，不 import React
    - `getDiagnostics` 零错误
    - _Requirements: 8.11, 10.5, Design §Bilingual fallback_
  
  - [x] 3.9 `require-admin.ts` — 鉴权 helper
    - 新建 `src/lib/daily-alert/require-admin.ts`
    - 签名：`requireAdmin(request: NextRequest): Promise<{ ok: true; userId: string } | { ok: false; status: 401 | 403; error: string }>`
    - 实现完全按 design §API 路由 §共享 admin 鉴权 helper
    - 使用 `createSupabaseServerClient()`（cookie-based SSR client，已存在于 repo）
    - 使用 `.limit(1).maybeSingle()`（避免 `.single()` 对缺失/重复 profile 的抛错）
    - `getDiagnostics` 零错误
    - _Requirements: 1.7, 3.5, 11.x (admin endpoints auth), Design §requireAdmin_


- [ ] 4. Property-Based Tests (PBT) — 跟随模块编写
  - Requirement refs: 47 个 correctness properties (see requirements.md § Correctness Properties)
  - Design refs: §Correctness Properties, §Correctness Properties → Test Fixtures Mapping
  - 目录：`src/lib/daily-alert/__tests__/`（纯/API/DB PBT）+ `src/app/(main)/alerts/__tests__/`（UI PBT，见 task 8）
  - 每个测试文件头部用 design §Correctness Properties 规定的注释格式 `// Feature: daily-hot-topic-alert, Property N: ...`
  - 每个 property test：`fc.assert(..., { numRuns: 100 })`
  - 这些是 **optional** 子任务（`*` 标记）—— 跳过不阻塞功能落地，但完整 PBT 覆盖率是质量门槛
  
  - [ ]* 4.1 `coverage-window.pbt.test.ts` — 时区、日界、幂等 key
    - 文件：`src/lib/daily-alert/__tests__/coverage-window.pbt.test.ts`
    - Properties covered: **1, 2, 37**
      - P1: coverage window spans exactly 24h minus 1s（start = YYYY-MM-DD 00:00:00+08:00, end = YYYY-MM-DD 23:59:59+08:00）
      - P2: trigger idempotency — 同 `(domainId, coverageDate)` 多次 `inngest.send` 只导致一个 run（此处用 spy + set，真正 DB partial unique index 在 task 9.1 测）
      - P37: TZ-independent — 模拟 `process.env.TZ = 'America/Los_Angeles'` / `'UTC'` / `'Asia/Shanghai'` 三种 host TZ，`computeCoverageDate(shanghai trigger)` 输出恒为同一日期
    - Generators: `fc.date()` 转 UTC，`fc.constantFrom('weekly','biweekly')` 不需要（daily only）
    - Mocks: 无（纯函数）
    - _Requirements: 2.1, 2.3, 2.4, 2.6_
  
  - [ ]* 4.2 `empty-day.pbt.test.ts` — 空日语义
    - 文件：`src/lib/daily-alert/__tests__/empty-day.pbt.test.ts`
    - Properties covered: **11, 17**
      - P11: empty-day alert shape — `daily_hot_topic_alerts.status='published'`, `empty_day_message_zh IS NOT NULL`, `daily_hot_topics.count=0`, `daily_alert_runs.topic_count=0`
      - P17: zero publish-notifications on success — 对任意 succeeded run (含 empty-day 与非 empty)，`notifications` 中不新增与 run_id 相关的行
    - Generators: arbitrary scan results → empty topic array path
    - Mocks: `zai-client` mock 返回 `{ topics: [] }`；Supabase test client with seeded profiles (mix of admin + team_member)
    - _Requirements: 6.5, 8.3_
  
  - [ ]* 4.3 `failure-modes.pbt.test.ts` — 失败路径命名与通知
    - 文件：`src/lib/daily-alert/__tests__/failure-modes.pbt.test.ts`
    - Properties covered: **12, 13, 14, 15, 18**
      - P12: failed run → zero `daily_hot_topic_alerts` rows（no half-persist）
      - P13: `failure_reason` 包含 `'z.ai credits exhausted'` 当 errorClass=CreditsExhausted
      - P14: `failure_reason === 'ZAI_API_KEY missing'` 当 env var 缺失
      - P15: `failure_reason` 包含 `'Canonicalization failed'` 当 canonicalize 失败
      - P18: admin 通知计数恰好等于 `profiles WHERE role='admin'` 的行数
    - Generators: `fc.constantFrom('CreditsExhausted','TimeoutError','ServerError','NetworkError','MalformedResponse')` 作为 error class 场景；admin 数量 `fc.integer({ min: 1, max: 5 })`
    - Mocks: `zai-client` mock；Supabase test client；env var stub via `vi.stubEnv`
    - _Requirements: 4.8, 4.9, 4.10, 6.4, 7.1, 7.2, 9.9, 14.2_
  
  - [ ]* 4.4 `schemas.pbt.test.ts` — Zod 往返 & 字段范围
    - 文件：`src/lib/daily-alert/__tests__/schemas.pbt.test.ts`
    - Properties covered: **5, 6, 7, 8, 9, 33, 42, 44**
      - P5: `hot_score ∈ [0,100]` — 范围外 Zod safeParse 失败
      - P6: `ScanResponseSchema` enforces topic cap ≤ 10
      - P7: `sample_quotes[*]` shape — 每条有 `text` + `source_label`，**没有** `url` 字段（若存在额外键应被忽略或拒绝按 Zod config）
      - P8: `source_links` length ∈ [3, 10]，每个 url 是合法 URL
      - P9: Zod → JSONB → re-read 往返保持字段等价
      - P33: 保存前 rank 是连续 1..N（scan.ts 重排后）
      - P42: 表命名 `topic_canonicals` 无 `daily_` 前缀（静态 INFORMATION_SCHEMA 查询）
      - P44: `daily_hot_topics` 的 FK 指向 `topic_canonicals` via 复合列 `(domain_id, canonical_topic_key)`，而不是 `topic_canonical_id` 单列（静态 `information_schema.referential_constraints` + `key_column_usage` 查询）
    - Generators: `fc.record({...})` 构造 ScanTopic；`fc.integer`、`fc.webUrl`、`fc.array`
    - Mocks: P42/P44 需要 Supabase local instance 有迁移 015 应用；其他纯
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 9.15_
  
  - [ ]* 4.5 `canonicalization.pbt.test.ts` — key 规范化 & 共享描述不变量
    - 文件：`src/lib/daily-alert/__tests__/canonicalization.pbt.test.ts`
    - Properties covered: **19, 20, 21, 22, 25, 26, 43**
      - P19: canonical_topic_key 匹配正则 `^[a-z0-9-]+(::[A-Za-z0-9-]+)?$` — 对任意 `normalizeCanonicalKey` 输入，输出要么通过正则，要么抛错
      - P20: `(domain_id, canonical_topic_key)` unique（DB 约束，并发 upsert 场景下只一个成功）
      - P21: 同一天同 canonical_topic_key 的 topic 共享 `canonical_description_zh`（来自 DB join 后渲染）
      - P22: 跨天同 canonical_topic_key 仍共享 description
      - P25: `seen_count` 随每次 run 的 reuse 正确累加（`persist_daily_alert` 后 `seen_count_before + count_in_this_run === seen_count_after`）
      - P26: secondary-axis presence — `is_new=true` 且 `secondary_axis_type !== null` ⟺ `canonical_topic_key` 形如 `a::b`
      - P43: `origin === 'daily_alert'` 对 V1 所有 INSERT 路径都恒定
    - Generators: `fc.record` 构造 CanonicalAssignment；P25 / P20 / P43 需 Supabase local instance
    - _Requirements: 9.3, 9.4, 9.6, 9.11, 9.14, 9.15_
  
  - [ ]* 4.6 `novelty-flag.pbt.test.ts` — is_new_canonical 正确性
    - 文件：`src/lib/daily-alert/__tests__/novelty-flag.pbt.test.ts`
    - Properties covered: **23, 24, 32**
      - P23: `is_new_canonical === true` ⟺ `canonical_topic_key` 不在 `existingKeys` set 内（纯函数测 `computeIsNewCanonical`）
      - P24: 首次 run（existingKeys 为空）→ 所有 topic `is_new_canonical === true`
      - P32: NoveltyBadge 在 preview cell 与 detail pane 中渲染条件一致 —— 给定 `is_new_canonical=true` 的 topic，两个位置都渲染，红色；`false` 都不渲染（此 P 也出现在 UI PBT 文件 4.7，但本文件测纯 resolver 逻辑，UI 层测组件渲染）
    - Generators: `fc.uniqueArray(fc.string().map(s => s.toLowerCase().replace(/[^a-z0-9-]/g, '-')))` 生成 keys
    - Mocks: 无（纯函数层）
    - _Requirements: 8.4, 8.7, 9.5, 9.6_
  
  - [ ]* 4.7 `config.pbt.test.ts` — config 与 prompt 校验路径
    - 文件：`src/lib/daily-alert/__tests__/config.pbt.test.ts`
    - Properties covered: **3, 4, 27, 28, 38, 39**
      - P3: `enabled=false` + scheduled tick → 不 send event（spy `inngest.send` 确认未被调）
      - P4: manual trigger 在 `enabled=false` 仍成功（endpoint 返回 202）
      - P27: `daily_scan_prompt` PUT 校验 — 缺 `{coverage_window_start}` 或 `{coverage_window_end}` 返回 400
      - P28: `daily_canonicalization_prompt` PUT 校验 — 缺 `{scanned_topics_json}` 或 `{existing_canonicals_json}` 返回 400
      - P38: weekly vs daily config 隔离 — 并发 update `daily_alert_configs` 与 `schedule_configs` 不互相影响（SELECT 后对比 snapshot）
      - P39: weekly vs daily run 隔离 — queued `daily_alert_runs` 不阻塞 `scheduled_runs`（或反之）
    - Generators: `fc.string` 作为 prompt 文本 + 白名单 placeholder 注入/剔除
    - Mocks: Supabase local + `inngest.send` spy
    - _Requirements: 1.6, 3.3, 12.5, 12.6, 16.1, 16.4_
  
  - [ ]* 4.8 `auth.pbt.test.ts` — 非 admin 鉴权拒绝
    - 文件：`src/lib/daily-alert/__tests__/auth.pbt.test.ts`
    - Properties covered: **45, 46, 47**
      - P45: `/api/admin/daily-alert-configs` 非 admin session → 403（含 team_member、anon）
      - P46: `/api/admin/daily-alert-runs/trigger` 同上
      - P47: `/api/admin/daily-alert-prompts/[prompt_type]` 同上
    - Generators: `fc.constantFrom('anon', 'team_member', 'admin')` 作为 session role
    - Mocks: cookie-based supabase client，`requireAdmin` 真实执行
    - 用 `describe.each([...])` 参数化三个端点 — 每个端点跑一个 `test.prop`，保留每个 property 数字对应一条测试的 traceability
    - _Requirements: 1.7, 3.5, 12.3_


- [-] 5. Inngest 函数（4 个）
  - Requirement refs: 2.x, 3.x, 4.x, 6.x, 7.x, 10.x
  - Design refs: §组件与接口 §2 (daily-alert-tick / daily-alert-run / translate-topic / translate-canonical)
  - 约定：4 个新函数放 `src/lib/inngest/functions/`，与 weekly 同目录；各自独立文件 + 在 `index.ts` 的 `functions` 数组中导出
  - 使用 `idempotency` + partial unique index 做双保险（DB 层由迁移 015 已保证）
  - 所有函数入口 fail-fast env check `ZAI_API_KEY`；`SUPABASE_SERVICE_ROLE_KEY` 由 `createServiceRoleSupabaseClient()` 内部做 fail-fast（复用 weekly pipeline 模式）
  
  - [x] 5.1 `daily-alert-tick.ts` — 每分钟 cron + 时间匹配
    - 新建 `src/lib/inngest/functions/daily-alert-tick.ts`
    - 完全按 design §组件与接口 §2 §`daily-alert-tick.ts` 代码骨架实现
    - cron: `'TZ=Asia/Shanghai * * * * *'`（每分钟）
    - `step.run('fetch-enabled-daily-configs')` → SELECT `daily_alert_configs WHERE enabled=true`
    - `toShanghai(new Date()).HHMM === config.time_of_day` → `step.sendEvent('enqueue-scheduled-run', { name: 'daily-alert/scheduled-trigger', data: { domainId, triggerType: 'scheduled', coverageWindowStartDate, coverageWindowStartIso, coverageWindowEndIso } })`
    - 使用 service role client
    - `getDiagnostics` 零错误
    - _Requirements: 1.6, 2.1, 2.2, 2.3_
  
  - [x] 5.2 `daily-alert-run.ts` — 主协调器（9 个 step）
    - 新建 `src/lib/inngest/functions/daily-alert-run.ts`
    - 完全按 design §组件与接口 §2 §`daily-alert-run.ts` 代码骨架实现 9 个 step
    - 函数 config：
      ```ts
      {
        id: 'daily-alert-run',
        retries: 0,
        idempotency: 'event.data.domainId + "-" + event.data.coverageWindowStartDate',
        concurrency: { limit: 3 },
      }
      ```
    - Triggers: `[{ event: 'daily-alert/scheduled-trigger' }, { event: 'daily-alert/manual-trigger' }]`
    - Step 序列（完整展开见 design §Step 总览 table）：
      1. `create-run-row-missing-key`（仅当 ZAI_API_KEY 缺）
      2. `notify-admins-missing-key`（同上）
      3. `resolve-config` — load 2 prompts + domain_name
      4. `create-run-row` — INSERT daily_alert_runs status=running；捕获 23505 唯一约束冲突 → 函数直接退出（双重幂等）
      5. `scan` (step timeout `'5m'`, retries 0 — `callZai` 自身重试) — 调 `runDailyScan`
      6. `persist-empty-day` / 或 `load-canonicals` + `canonicalize` + `persist` 分支
      7. `enqueue-translations` — 发送 N × `translate-topic` + M × `translate-canonical` 事件
      8. `mark-succeeded` — UPDATE status=succeeded, topic_count, new_canonical_count
      9. 失败路径：`finalizeRunAsFailed` helper 调用 `step.run('mark-failed')` + `step.run('notify-admins-failure')`
    - **关键**：canonicalize 失败整 run abort，不持久化任何 alert/topic/canonical 行（Req 9.9 / PBT 15）
    - `getDiagnostics` 零错误
    - _Requirements: 2.1, 2.2, 2.4, 2.6, 3.1, 3.4, 4.x, 6.1, 6.3, 6.4, 6.5, 7.1, 7.2, 9.9, 13.3, 13.4_
  
  - [x] 5.3 `daily-alert-translate-topic.ts` — per-topic 异步翻译
    - 新建 `src/lib/inngest/functions/daily-alert-translate-topic.ts`
    - 完全按 design §组件与接口 §2 §`daily-alert-translate-topic.ts` 代码骨架
    - Function config：`{ id: 'daily-alert-translate-topic', retries: 3 }`
    - Trigger: `{ event: 'daily-alert/translate-topic' }`
    - Steps:
      1. `fetch-topic` — SELECT topic; 若不存在或 `topic_name_en IS NOT NULL` → return (idempotent skip)
      2. `translate` — POST `/api/ai/translate-daily` with `kind: 'topic'`, `zh_primary: topic_name_zh`, `zh_secondary: summary_zh`
      3. `write-back` — UPDATE daily_hot_topics SET `topic_name_en`, `summary_en`
    - `getDiagnostics` 零错误
    - _Requirements: 5.6, 10.4, 10.5_
  
  - [x] 5.4 `daily-alert-translate-canonical.ts` — per-new-canonical 异步翻译
    - 新建 `src/lib/inngest/functions/daily-alert-translate-canonical.ts`
    - 完全按 design §组件与接口 §2 §`daily-alert-translate-canonical.ts` 代码骨架
    - Function config 与 trigger 同 5.3，但 event 为 `'daily-alert/translate-canonical'`
    - 幂等性：若 `canonical_title_en IS NOT NULL` → 立即返回（避免重复翻译；admin 的 re-translate endpoint 会先把 `_en` 清 null，再 send event）
    - 只在**新建** canonical 时被 enqueue（`daily-alert-run` step 7 的逻辑保证）—— 已存在的 canonical 不重复翻译
    - `getDiagnostics` 零错误
    - _Requirements: 10.4, 10.5_
  
  - [x] 5.5 注册 4 个新函数到 `src/lib/inngest/functions/index.ts`
    - 打开 `src/lib/inngest/functions/index.ts`
    - 在现有 `export const functions = [...]` 数组尾部追加 4 个新导入：`dailyAlertTick`, `dailyAlertRun`, `dailyAlertTranslateTopic`, `dailyAlertTranslateCanonical`
    - Import 语句按 alpha 顺序插入
    - `getDiagnostics` on `src/lib/inngest/functions/index.ts` 零错误
    - _Requirements: 2.2, Design §§组件与接口 §2_
  
  - [x] 5.6 [用户手动步骤 — CRITICAL] Inngest Resync
    - **本任务无代码改动** —— 仅文档化部署人员动作
    - 部署到 Vercel 后（或本地跑 `npx inngest-cli dev`），访问 Inngest Cloud dashboard → Apps → 本项目 App → 点 **Resync**
    - Resync 目的：让 Inngest 感知 4 个新函数的 triggers (cron / event)、concurrency、idempotency 配置
    - **若 Resync 未执行**：
      - `daily-alert-tick` 不会按 cron 触发
      - `daily-alert/manual-trigger` 事件被 ingest 但无 function 订阅 → `/admin/daily-alert-runs` 不出现新 row（symptom：手动触发 endpoint 返回 202 但没有任何 DB 变化）
    - 在验证阶段（task 10.4）明确提醒用户执行此步
    - _Requirements: 2.2, Design §Deployment & Operational Checklist §2_

- [x] 6. API 路由（11 个）
  - Requirement refs: 1.1–1.7, 3.1–3.5, 7.1, 8.1, 8.10, 11.1–11.5, 12.1–12.6
  - Design refs: §API 路由 §1–§11, §共享 admin 鉴权 helper
  - 所有 admin 路由使用 `requireAdmin()` from `src/lib/daily-alert/require-admin.ts`（task 3.9）
  - 所有路由使用 Next.js 16 pattern：`export async function GET/POST/PUT(request: NextRequest, { params }: { params: Promise<{ ... }> })`
  - 每个子任务的 unit test 文件紧邻路由文件，放 `__tests__/` 子目录
  - Unit tests 使用 `supertest` 风格（直接 invoke route handler with mocked Request）或复用 repo 现有测试模式（见 `src/app/api/reports/__tests__/` 为范本）
  
  - [x] 6.1 `GET/PUT /api/admin/daily-alert-configs`
    - 新建 `src/app/api/admin/daily-alert-configs/route.ts`
    - 导出 `GET` 与 `PUT` 处理器；共享 Zod schema `DailyAlertConfigUpdateSchema = z.object({ enabled: z.boolean(), time_of_day: z.string().regex(/^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/) })`
    - GET：返回 Account Health domain 的 config 行（design §API 路由 §1）
    - PUT：校验 Zod → UPDATE（service role client）→ 返回更新后的行；Zod 失败 → 400 `{ error, details }`
    - 权限：`requireAdmin()`
    - 测试：`src/app/api/admin/daily-alert-configs/__tests__/route.test.ts`
      - 路由级 happy-path
      - 非 admin 403
      - Zod 失败 400（`time_of_day='25:00'`）
    - `getDiagnostics` 零错误
    - _Requirements: 1.3, 1.4, 1.5, 1.7_
  
  - [x] 6.2 `POST /api/admin/daily-alert-runs/trigger`
    - 新建 `src/app/api/admin/daily-alert-runs/trigger/route.ts`
    - 权限：admin
    - Body: `{}`（V1 固定 Account Health domain）
    - Logic（design §API 路由 §3）：
      1. Compute `coverageWindowStartDate` from now
      2. 检查 `daily_alert_runs` 是否存在同 (domain, date) 且 status ∈ {queued, running} → 409
      3. `inngest.send('daily-alert/manual-trigger', { id: domainId + '-' + coverageWindowStartDate, data: { domainId, triggerType: 'manual', coverageWindowStartDate, coverageWindowStartIso, coverageWindowEndIso } })`
      4. Return 202 `{ message, coverageWindowStartDate }`
    - 测试：happy-path 202、409 (existing queued)、403 (non-admin)
    - `getDiagnostics` 零错误
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  
  - [x] 6.3 `GET /api/admin/daily-alert-runs`
    - 新建 `src/app/api/admin/daily-alert-runs/route.ts`
    - 权限：admin
    - Query: `?page=<int>&pageSize=<int, default 20, cap 20>`
    - SELECT `daily_alert_runs ORDER BY triggered_at DESC LIMIT 20 OFFSET (page-1)*20`
    - Response: `{ rows, page, total_count, page_size }`
    - 测试：分页、排序、403
    - `getDiagnostics` 零错误
    - _Requirements: 11.1, 11.2_
  
  - [x] 6.4 `POST /api/admin/daily-alert-runs/[id]/retry`
    - 新建 `src/app/api/admin/daily-alert-runs/[id]/retry/route.ts`
    - 权限：admin
    - Params: `id: Promise<{ id: string }>` → `const { id } = await params`
    - Logic（design §API 路由 §5）：
      1. 加载原 run；必须存在 AND `status = 'failed'` (else 400)
      2. 检查 partial unique index 的 race 情况：若同 (domain, date) 已有 queued/running/succeeded → 409
      3. `inngest.send('daily-alert/manual-trigger', { data: { domainId, triggerType: 'manual', coverageWindowStartDate: <原 run 的 date>, coverageWindowStartIso, coverageWindowEndIso } })`
      4. 原 run **不删除** — 保留为历史
      5. Return 202
    - 测试：retry failed run → 202、retry succeeded run → 400、retry 后撞 queued/running → 409
    - `getDiagnostics` 零错误
    - _Requirements: 11.3_
  
  - [x] 6.5 `GET/PUT /api/admin/daily-alert-prompts/[prompt_type]`
    - 新建两个路由文件：
      - `src/app/api/admin/daily-alert-prompts/route.ts` — GET only：返回 `{ daily_scan_prompt, daily_canonicalization_prompt, defaults: { daily_scan_prompt, daily_canonicalization_prompt } }` — `defaults` 直接 import from `src/lib/daily-alert/prompt-defaults.ts`
      - `src/app/api/admin/daily-alert-prompts/[prompt_type]/route.ts` — PUT only：placeholder 强校验 + upsert
    - 权限：admin
    - Zod: `z.object({ template_text: z.string().min(50) })`
    - Placeholder 强校验（400 + 列出 missing placeholders）：
      - `daily_scan_prompt`: 必须含 `{coverage_window_start}` AND `{coverage_window_end}`
      - `daily_canonicalization_prompt`: 必须含 `{scanned_topics_json}` AND `{existing_canonicals_json}`
    - Upsert into `prompt_templates` keyed on `(domain_id, prompt_type)`
    - 测试：happy-path、placeholder 校验失败 400、403
    - `getDiagnostics` 零错误
    - _Requirements: 12.1, 12.3, 12.5, 12.6_
  
  - [x] 6.6 `GET /api/alerts`
    - 新建 `src/app/api/alerts/route.ts`
    - 权限：any authenticated user（`auth.getUser()` 非 null 即可）
    - Query: `?window_end_date=YYYY-MM-DD`（optional，默认 Asia/Shanghai today - 1 day）
    - 计算 7 天窗口 `[end-6, end]`
    - 单一 SQL query（design §API 路由 §8）：
      - LEFT JOIN `daily_hot_topic_alerts` 与 `generate_series(end_date - 6, end_date, interval '1 day')`
      - Subquery LATERAL JOIN 取 top-3 topics per alert (by rank asc)
      - Status 列从 alert 存在性 + `daily_alert_runs.status` 组合推导（no-run / published / failed）
    - Response shape: `AlertsOverviewResponse`（src/types/daily-alert.ts）
    - 测试：happy-path 7 rows、部分 no-run 的窗口、403/401 anon
    - `getDiagnostics` 零错误
    - _Requirements: 8.1, 8.3, 8.5, 8.10_
  
  - [x] 6.7 `GET /api/alerts/by-date/[date]`
    - 新建 `src/app/api/alerts/by-date/[date]/route.ts`
    - 权限：any authenticated user
    - Params: `date: Promise<{ date: string }>` → `const { date } = await params`
    - Logic：三种 response shape
      - `{ kind: 'no-run' }` — 无 alert 且无 failed run
      - `{ kind: 'empty-day', alert }` — alert 存在但 topics 为 0
      - `{ kind: 'published', alert, topics }` — 含 N topics，每个 topic JOIN `topic_canonicals` via `(domain_id, canonical_topic_key)`
    - Response shape: `DayDetailResponse`（src/types/daily-alert.ts）
    - 测试：三种 kind 各一条、invalid date format 400、anon 401
    - `getDiagnostics` 零错误
    - _Requirements: 8.6, 8.7, 8.8, 8.9, 8.11_
  
  - [x] 6.8 `POST /api/admin/alerts/[topic_id]/re-translate-topic`
    - 新建 `src/app/api/admin/alerts/[topic_id]/re-translate-topic/route.ts`
    - 权限：admin
    - Params: `topic_id`
    - Logic:
      1. 加载 topic 获取 `domain_id`
      2. UPDATE `daily_hot_topics SET topic_name_en=NULL, summary_en=NULL WHERE id=topic_id`
      3. `inngest.send('daily-alert/translate-topic', { data: { topicId: topic_id, domainId } })`
    - Return 202
    - 测试：happy-path 202、topic 不存在 404、非 admin 403
    - `getDiagnostics` 零错误
    - _Requirements: 10.5_
  
  - [x] 6.9 `POST /api/admin/alerts/canonical/[canonical_topic_key]/re-translate`
    - 新建 `src/app/api/admin/alerts/canonical/[canonical_topic_key]/re-translate/route.ts`
    - 权限：admin
    - Params: `canonical_topic_key`（URL-encoded；handler 内部 `decodeURIComponent`）
    - Logic:
      1. 找到对应 `(domain_id, canonical_topic_key)` 的 canonical 行（V1 固定 Account Health domain）
      2. UPDATE `topic_canonicals SET canonical_title_en=NULL, canonical_description_en=NULL`
      3. `inngest.send('daily-alert/translate-canonical', { data: { domainId, canonicalTopicKey: key } })`
    - Return 202
    - 测试：happy-path 202、canonical 不存在 404、非 admin 403
    - `getDiagnostics` 零错误
    - _Requirements: 10.5_
  
  - [x] 6.10 `POST /api/ai/translate-daily` — 新翻译端点
    - 新建 `src/app/api/ai/translate-daily/route.ts`
    - 权限：authenticated user（Inngest 函数调此端点时会带 service role cookie context；实际生产中 Inngest 走 server-side HTTP; 权限可复用 `requireAuthenticated()` 模式）
    - Request Zod: `z.object({ kind: z.enum(['topic', 'canonical']), zh_primary: z.string().min(1), zh_secondary: z.string().min(1) })`
    - Logic（design §Bilingual & Translation Path §POST /api/ai/translate-daily）：
      - 构造 OpenRouter prompt（design 提供的精简 prompt 模板）
      - 调 OpenRouter (复用 `src/lib/research-engine/engines/openrouter-client.ts`) with `response_format: { type: 'json_object' }`
      - Response: `{ en_primary, en_secondary }`
    - 测试：happy-path、OpenRouter 错误 5xx 时返回 502
    - `getDiagnostics` 零错误
    - _Requirements: 10.1, 10.2, 10.3, 10.4_


- [x] 7. UI 页面与组件
  - Requirement refs: 8.1–8.12, 10.4, 10.5, 11.1–11.5, 12.1–12.6
  - Design refs: §UI 组件细化, §`/alerts` 页面组件树, §`/admin/daily-alert-runs` 页面, §`/admin/daily-alert-settings` 页面
  - 约定：
    - `/alerts` = client component（`'use client'`），因为 master-detail 选中态是 UI local state 且"行点击不换路由"是 PBT 31 的硬约束
    - `/admin/daily-alert-*` = server wrapper（admin check）+ client 子组件
    - i18n：所有静态字符串通过 `useTranslation()` + `t('key')`；新 keys 加到 `src/components/I18nProvider.tsx` 或等价 namespace 文件
    - 颜色/spacing 遵循 Tailwind v4 与 repo 现有风格（参考 `/reports/page.tsx` 的排版）
  
  - [x] 7.1 `NoveltyBadge` 组件 + i18n keys
    - 新建 `src/components/alerts/NoveltyBadge.tsx`
    - 内容按 design §UI 组件细化 §`NoveltyBadge` 代码（小红色徽标，Tailwind classes `bg-red-100 text-red-800 border border-red-200`）
    - 新增 i18n keys 到 `src/components/I18nProvider.tsx`：
      - `alerts.novelty.label` → `{ zh: '新', en: 'NEW' }`
      - `alerts.novelty.aria` → `{ zh: '首次出现的话题类别', en: 'First time this topic class appears' }`
    - `aria-label` 使用 `t('alerts.novelty.aria')` 确保屏幕阅读器可用
    - `getDiagnostics` 零错误
    - _Requirements: 8.4, 8.7, 9.5, 9.6_
  
  - [x] 7.2 `FallbackIndicator` + `resolveText` 组件
    - 新建 `src/components/alerts/FallbackIndicator.tsx`
    - 组件内容：小灰字 `(Chinese original)` / `（中文原文）`，按当前 i18n 语言渲染（其实永远 lang='en' 时才显示，所以始终是英文 `(Chinese original)`）
    - 新增 i18n keys：
      - `alerts.fallback.chineseOriginal` → `{ zh: '（中文原文）', en: '(Chinese original)' }`
    - `resolveText` helper from `src/lib/daily-alert/i18n-fallback.ts`（task 3.8 已建）— 本任务只新增 UI consumer
    - `getDiagnostics` 零错误
    - _Requirements: 8.11_
  
  - [x] 7.3 `/alerts` 页面与子组件树
    - 新建 `src/app/(main)/alerts/page.tsx`（`'use client'`）
    - 完全按 design §UI 组件细化 §`AlertsPage` 骨架实现
    - 新建子组件（各自一个文件，放 `src/components/alerts/`）：
      - `SevenDayOverviewTable.tsx` — 主概览表，含 `aria-selected`、`onClick`、可选 `onKeyDown`（`Space`/`Enter` 选中行作为基础键盘支持；非完整 arrow-key 导航，后者留 task 11.1 作 P2 polish）
      - `TopicPreviewList.tsx` — preview cell 的 pill list with NoveltyBadge
      - `DayDetailPane.tsx` — `key={selectedDate}` 强制 remount 以清 SWR cache 污染
      - `TopicCard.tsx` — 按 Req 8.7 完整渲染顺序（rank + name + NoveltyBadge → canonical line → hot_score chip → keywords → summary → sample_quotes → source_links）
      - `CanonicalClassLine.tsx` — design §UI 组件细化 §`CanonicalClassLine`（用 `resolveText` + `FallbackIndicator`）
      - `SampleQuote.tsx` — design §`SampleQuote`（**不含** url，仅 text + source_label）
      - `SourceLinkList.tsx` — design §`SourceLinkList`（外链 `target="_blank"` + `rel="noopener noreferrer"`）
      - `PageShiftControls.tsx` — "View older days" / "Newer →" 按钮，移动 7 天窗口
      - `NoRunPlaceholder.tsx` — 无运行日的 placeholder 文案
      - `EmptyDayDisplay.tsx` — 空日 `empty_day_message_zh`/`_en` 渲染
    - Page 使用 `useSWR('/api/alerts?window_end_date=...', fetcher)` 取 overview；`useSWR('/api/alerts/by-date/${selectedDate}', fetcher)` 取 detail
    - 默认选中：`useEffect` 上 newest row on initial load / window shift
    - i18n keys（新增）：
      - `alerts.title` → `{ zh: '每日热点预警', en: 'Daily Hot-Topic Alerts' }`
      - `alerts.canonical.label` → `{ zh: '类别', en: 'Class' }`
      - `alerts.overview.headers.*`（coverage date / topic count / preview / status — 按 Req 8.3 的列名）
      - `alerts.noRun` → `{ zh: '此日未生成每日预警。', en: 'No daily hot-topic alert was generated for this day.' }`
      - `alerts.viewOlder` / `alerts.viewNewer`
    - 确认 admin-only 控件（re-translate buttons）只在 `profile.role === 'admin'` 时 render（Req 8.12）
    - `getDiagnostics` 零错误
    - _Requirements: 8.1–8.11_
  
  - [x] 7.4 `/admin/daily-alert-settings` 页面
    - 新建 `src/app/(main)/admin/daily-alert-settings/page.tsx`
    - Server wrapper 检 admin role → 非 admin 渲染 `Access denied`
    - Client 子组件结构（design §`/admin/daily-alert-settings` 页面）：
      - `DailyAlertConfigForm.tsx` — `enabled` checkbox + `time_of_day` picker + `Save`；`Trigger Now` 按钮（单独组件见下）
      - `TriggerNowButton.tsx` — 按钮 → confirm modal（展示 coverage date）→ POST `/api/admin/daily-alert-runs/trigger` → toast 成功/409
      - `DailyPromptEditor.tsx` — textarea，受控、monospace；`Reset to default` 用 `defaults` from GET response；`Save` 前客户端再做 placeholder 校验以防服务器 round-trip
    - Page layout：Cadence section → `Trigger Now` button → `daily_scan_prompt` editor → `daily_canonicalization_prompt` editor
    - 加 i18n keys：
      - `adminDailyAlert.cadence.title`、`adminDailyAlert.prompts.scan.title`、`adminDailyAlert.prompts.canonicalization.title`、`adminDailyAlert.triggerNow.button`、`adminDailyAlert.triggerNow.confirm.title`/`description` 等
    - `getDiagnostics` 零错误
    - _Requirements: 1.1, 1.4, 1.5, 3.1, 3.4, 12.1–12.6_
  
  - [x] 7.5 `/admin/daily-alert-runs` 页面
    - 新建 `src/app/(main)/admin/daily-alert-runs/page.tsx`
    - Server wrapper 检 admin role
    - Client 子组件：
      - `DailyAlertRunsTable.tsx` — 20 行分页（Prev/Next + `Page X of Y`），列 Run ID (short 8) / Triggered At (Shanghai) / Trigger Type / Status / Coverage Date / Topic Count / New-Canonical Count / Alert Link / Failure Reason / Actions
      - `RetryButton.tsx` — 对 failed run 显示；点击 → 确认 modal → POST `/api/admin/daily-alert-runs/[id]/retry` → toast
      - `ViewRawOutputModal.tsx` — 显示 `raw_output` 原始文本（截断后的 500 字），带 `<pre>` 格式化
    - i18n keys 按需增加（`adminDailyAlertRuns.*`）
    - `getDiagnostics` 零错误
    - _Requirements: 11.1, 11.2, 11.3, 11.4_
  
  - [x] 7.6 主导航更新（Open Item 6）
    - 找到并修改 main nav 文件（`src/components/MainNav.tsx` 或等价。若不存在单独 nav 文件，就在 `src/app/(main)/layout.tsx` 的导航区域）
    - 新增 3 个链接（每个 wrapped by `role`-gated 可见性）：
      - `/alerts` — 可见给所有 authenticated users（admin + team_member）
      - `/admin/daily-alert-settings` — 仅 admin 可见（已有 admin sub-nav 模式复用）
      - `/admin/daily-alert-runs` — 仅 admin 可见
    - 新增 i18n keys（按 repo 约定命名；若 repo 已有 `nav.*` namespace 则复用）：
      - `nav.alerts` → `{ zh: '每日预警', en: 'Daily Alerts' }`
      - `nav.admin.dailyAlertSettings` → `{ zh: '每日预警设置', en: 'Daily Alert Settings' }`
      - `nav.admin.dailyAlertRuns` → `{ zh: '每日预警历史', en: 'Daily Alert Runs' }`
    - 阅读现有 nav 代码，严格复制 admin-gated 链接的 rendering pattern（不要发明新模式）
    - `getDiagnostics` 零错误
    - _Requirements: 8.1, 12.1, Design §主导航更新, §Open Items 6_

- [ ] 8. UI Property Tests
  - Requirement refs: 8.x, 9.x（UI 渲染相关）
  - Design refs: §Correctness Properties § 29, 30, 31, 32, 34, 35, 36, 40
  - 目录：`src/components/alerts/__tests__/` 与 `src/app/(main)/alerts/__tests__/`
  - 使用 `@testing-library/react` + `jsdom`（已在 devDependencies）
  - SWR mocked via `SWRConfig` provider with `cache: new Map()` 或全局 `vi.mock('swr')`
  
  - [ ]* 8.1 `ui-master-detail.pbt.test.ts` — 7 行 / 默认选中 / 原地切换 / badge / fallback / 权限门
    - 文件：`src/app/(main)/alerts/__tests__/ui-master-detail.pbt.test.ts`
    - Properties covered: **29, 30, 31, 34, 35, 36, 40**
      - P29: 渲染 `AlertsPage` with any 7-day window → overview table 恰好 7 行，顺序为 reverse chron
      - P30: initial render → `[aria-selected="true"]` 指向 overview 第一行（newest）
      - P31: user click row 3 → URL unchanged（`window.location.href` spy），`DayDetailPane` 重渲染为 row 3 对应的 date
      - P34: topic with `topic_name_en=null` → 渲染中文 + `FallbackIndicator`；`topic_name_en='Foo'` → 渲染英文，无 FallbackIndicator
      - P35: canonical title/description 同样 fallback 规则
      - P36: `role='team_member'` session → re-translate buttons 未 render（测 `queryByRole('button', { name: /re-translate/i })` 返回 null）
      - P40: weekly 页面路由 `/reports` / `/admin/scheduled-runs` 仍正常渲染 —— smoke-level render test, no assertion on specific content
    - Generators: `fc.array(fc.record({ is_new_canonical: fc.boolean(), topic_name_en: fc.option(fc.string()), ... }), { minLength: 0, maxLength: 10 })`
    - Mocks: SWR, auth context (role), `navigator.language`
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6, 8.11, 8.12, 16.5_
  
  - [ ]* 8.2 UI 单元测试（非 PBT）
    - 新建 `src/components/alerts/__tests__/NoveltyBadge.test.tsx`、`CanonicalClassLine.test.tsx`、`TopicCard.test.tsx`、`SampleQuote.test.tsx` 等
    - 各 3–5 个 happy-path + edge-case test
    - 不使用 fast-check；简单 snapshot / 断言
    - _Requirements: 8.4, 8.7, 8.11_

- [ ] 9. DB / Integration PBT（需本地 Supabase）
  - Requirement refs: 9.7, 16.6, 16.7
  - Design refs: §Correctness Properties § 10, 16, 41
  - 前置条件：`supabase start` 运行，迁移 015–018 已 apply
  
  - [ ]* 9.1 `isolation.pbt.test.ts` — 与 weekly / news 表隔离
    - 文件：`src/lib/daily-alert/__tests__/isolation.pbt.test.ts`
    - Properties covered: **10, 16, 41**
      - P10: auto-publish 不变量 — 任何 `daily_hot_topic_alerts.status` 只能取 `'published'`（CHECK 约束自动保证；本 PBT 断言在 DB query 结果上）
      - P16: zero news writes — 执行任意 daily run（含成功、empty-day、失败）后 `SELECT COUNT(*) FROM news` 与前后差值为 0
      - P41: weekly Hitting News 不受 daily 部署影响 — 在 daily 跑后触发 weekly run，观察 `news` 表 new rows 为 weekly 独立产生，且无字段来自 daily_hot_topics
    - Generators: `fc.constantFrom('success','empty-day','failed')` 作为 daily run 场景；然后执行对应 mock pipeline
    - Mocks: Supabase local + `zai-client` mocked responses + news table row-count observer
    - _Requirements: 6.2, 16.6, 16.7_

- [ ] 10. End-to-End Smoke Test（手动验证门，非 PBT）
  - Requirement refs: 所有 — 这是 Group 1-9 完成后的 integration gate
  - Design refs: §Deployment & Operational Checklist §冒烟测试
  - **注意**：这些子任务需要用户手动执行。AI 只能执行 10.2（build）与 10.3（单元/属性测试）；其他步骤 AI 向用户展示命令并等待用户反馈
  - 按以下顺序执行，每一步出问题停下并根据 `debugging-discipline.md` rule 1 画出 call chain 定位
  
  - [ ] 10.1 [用户手动步骤] 应用迁移 015–018
    - 打开 Supabase SQL Editor
    - 按顺序粘贴并运行 `015_create_daily_alert_tables.sql` → `016_create_daily_alert_rls.sql` → `017_extend_prompt_templates_for_daily.sql` → `018_seed_daily_alert_defaults.sql`
    - 每个迁移运行后执行 design / task 2 里附带的手工验证 SQL
    - 将验证结果（行数 / 约束 / 索引存在性）粘贴到对话以确认
  
  - [ ] 10.2 运行 `npm run build` — 期望零 TypeScript 错误
    - 在 repo 根目录执行 `npm run build`
    - 若有 error，优先排查 `src/types/database.ts` 与 `src/types/daily-alert.ts` 之间的字段错位
  
  - [ ] 10.3 运行完整测试套件
    - `npm test`（= `vitest --run`）
    - 期望所有 non-starred（必选）测试通过；starred PBT 若已实现也一并跑
    - 失败：若单个 PBT 发现 counterexample，使用 `updatePBTStatus` 记录，然后修复对应模块（tasks 3.x / 5.x / 6.x / 7.x）
  
  - [ ] 10.4 本地 Inngest dev server 端到端手动触发
    - 打开两个终端：
      - 终端 1：`npx inngest-cli dev`（后台运行 Inngest dev server）
      - 终端 2：`npm run dev`（Next.js 开发服务器）
    - 访问 `http://localhost:3000/admin/daily-alert-settings`
    - 登录 admin 账户
    - 点 `Trigger Now` → 确认 modal → 应看到 toast `"Run queued for coverage date YYYY-MM-DD"`
    - 在 Inngest dev UI (`http://localhost:8288`) 确认：
      - `daily-alert/manual-trigger` 事件被 ingested
      - `daily-alert-run` 函数被触发
      - 9 个 step 依次执行（`resolve-config` → `create-run-row` → `scan` → `load-canonicals` → `canonicalize` → `persist` → `enqueue-translations` → `mark-succeeded`）
      - `daily-alert-translate-topic` / `daily-alert-translate-canonical` 事件被 fan-out
  
  - [ ] 10.5 验证 `/alerts` 页面渲染正确
    - 访问 `http://localhost:3000/alerts`
    - 期望：
      - 顶部 7 行表格，最新一行是 coverage date = 今天-1（Shanghai）
      - 新 run 的行 `Topic Count` > 0（或 0 + empty-day 文案）
      - 默认选中最新行，下方 DayDetailPane 渲染 N 张 `TopicCard`
      - 至少有一个 topic 显示 `NoveltyBadge`（首次运行所有 canonical 都是 new）
      - 每个 topic 有 3+ source links, 2-3 sample quotes，keywords，summary，hot_score chip
      - `CanonicalClassLine` 在每个 topic card 中渲染 `类别 · {title}` 格式
  
  - [ ] 10.6 验证 `news` 表 row count UNCHANGED（isolation gate）
    - 在 SQL Editor 跑（task 10.1 之前先记 pre_count）：
      ```sql
      SELECT COUNT(*) FROM news;
      ```
    - 然后跑完 daily run，再次查询
    - 期望：前后完全相等（design §Correctness Properties § P16 / P41 的冒烟验证）
    - **若 COUNT 变化**：立即停下 — daily pipeline 写了 `news` 表，违反 Req 16.6。排查 `daily-alert-run.ts` 的所有 step 是否有意外 SELECT/INSERT 到 news（应为零）
  
  - [ ] 10.7 验证 bilingual fallback
    - 在 `/alerts` 页面等待 ~1 分钟（让 translate job 有时间跑部分但未完成）
    - 切换 i18n 语言到 English（页面右上角语言切换）
    - 期望：已翻译的 topics 显示英文 `topic_name_en` / `summary_en`；未翻译的显示中文 + `(Chinese original)` 灰色 indicator
    - 再等 2-3 分钟，refresh → 所有 topic 都应有英文（translate-topic job 完成所有 topic）
    - 若某些 topic 2 分钟后仍为中文：排查 Inngest dev UI → `daily-alert-translate-topic` 函数是否 fail / retry-exhausted
  
  - [ ] 10.8 部署清单（生产环境激活）
    - [用户手动步骤] 在生产 Supabase 的 SQL Editor 依序执行迁移 015–018
    - [用户手动步骤] `git push origin main` → 等待 Vercel 部署 Ready + Current
    - [用户手动步骤] 访问 Inngest Cloud dashboard → Apps → Production app → 点 **Resync**（**关键** — 见 task 5.6 提示）
    - [用户手动步骤] 访问生产 `/admin/daily-alert-settings` → `Enabled ☑` + `Save` → 功能正式激活
    - [用户手动步骤] 等到明早 `time_of_day`（默认 06:00）观察 `daily_alert_runs` 是否出现一条 scheduled run（或立即再次 `Trigger Now` 验证）
  
  - [ ] 10.9 最终 checkpoint — 如有任何步骤失败，停下并与用户讨论
    - Ensure all tests pass, ask the user if questions arise.


- [ ] 11. P2 Polish（OPTIONAL — 全部带 `*`，不阻塞 V1 发布）
  
  - [ ]* 11.1 `SevenDayOverviewTable` 完整键盘导航
    - 在 task 7.3 的基础 `Space`/`Enter` 之外增加 `ArrowUp`/`ArrowDown` 切换选中行、`Home`/`End` 跳到首末行
    - 保持 `aria-selected`、focus ring 正确
    - 加 UI 单元测试覆盖键盘事件
    - 理由：a11y 完整度，对键盘用户友好；非 blocking V1
    - _Requirements: 8.2（扩展）_
  
  - [ ]* 11.2 Retry 确认 modal + 完整状态反馈
    - 在 task 7.5 的基础 `Retry` 按钮基础上加 `RetryConfirmModal`（展示原 run 的 failure_reason + 新 coverage date），用户确认后才调 API
    - Toast 成功/409/500 状态区分，包含跳转到新 run 详情的链接
    - _Requirements: 11.3_
  
  - [ ]* 11.3 扩 `notifications.type` enum 为 `'daily_alert_failure'`
    - 若 V1 上线后观察到 admin 混淆 `'news'` 类型的 daily 通知与真 news（symptom: admin 点击通知误认为新 news 而不是跳转 runs 页）
    - 新建迁移 `019_extend_notifications_type_enum.sql`：
      ```sql
      ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
      ALTER TABLE notifications ADD CONSTRAINT notifications_type_check 
        CHECK (type IN ('report', 'news', 'daily_alert_failure'));
      ```
    - 修改 `daily-alert-run.ts` 的 `notify-admins` step 使用新类型；前端 NotificationUI 加对应 icon + routing
    - _Requirements: 7.1（breadcrumb 精度升级）_
  
  - [ ]* 11.4 扩 `errorContext.engine` 为 `'daily-scan' | 'daily-canon'`
    - 若 V1 上线后 Inngest trace 里 `engine='kimi' stage='daily-scan'` 语义难读
    - 修改 `src/lib/research-engine/engines/zai-client.ts` / `openrouter-client.ts` / `moonshot-client.ts` 的 `errorContext.engine` union 扩为 `'gemini' | 'kimi' | 'synthesizer' | 'daily-scan' | 'daily-canon'`
    - 修改 `scan.ts` / `canonicalize.ts` 的 callZai 调用 → 传新 engine 值
    - 更新 3 个 client 测试文件的相关 case
    - _Requirements: Design §Open Items 2_

## Verification 执行步骤 — 每次完成一个主任务后跑

按 `.kiro/steering/verification-before-completion.md` 要求，本 spec 的每个主任务（1, 2, 3, …）完成后必须执行以下 verification 序列：

1. `getDiagnostics` on all modified files in that task group — 零错误
2. 若 `package.json` / 新导入发生改动：`npm run build` 零错误
3. 若该任务组有随附 unit/property test：相关测试跑通
4. 若该任务组触及外部系统（Supabase / Inngest / Vercel），在 tasks.md 显式标注用户手动动作（见 task 5.6 / 10.x）

## 手动动作清单（用户在代码落地后必须执行）

以下动作 AI **无法**代做 — 按优先级列出，缺一不可：

- [ ] **Supabase 迁移应用**（task 10.1 / 10.8）— 按序在 SQL Editor 运行 015 → 016 → 017 → 018；每步执行附带的手工验证 SQL 确认成功
- [ ] **Inngest Resync**（task 5.6 / 10.8）— 部署后在 Inngest Cloud dashboard → Apps → 本项目 → **Resync**，让 4 个新函数（`daily-alert-tick` / `daily-alert-run` / `daily-alert-translate-topic` / `daily-alert-translate-canonical`）的 triggers + idempotency 配置被 Inngest 识别。**若跳过**：tick 不会按 cron 触发；manual trigger 事件被 ingest 但无 function 订阅；`/admin/daily-alert-runs` 不出现新行
- [ ] **环境变量**（已具备，验证即可）— 在 Vercel → Settings → Environment Variables 确认：
  - `ZAI_API_KEY`（Production + Preview）— 由 `engine-b-glm-replacement` spec 配置，daily pipeline 复用
  - `SUPABASE_SERVICE_ROLE_KEY`（Production + Preview）— 由 `scheduled-regular-report-generation` spec 配置，daily pipeline 复用
  - **不新增** env vars
- [ ] **功能激活**（task 10.8）— `/admin/daily-alert-settings` 手动勾 `Enabled` + 保存 `time_of_day`（默认 `06:00`）
- [ ] **冒烟测试**（task 10.4–10.7）— 至少一轮完整 `Trigger Now` → DB 验证 → UI 验证 → `news` 表不变验证 → bilingual fallback 验证
- [ ] **回滚准备**（pre-production）— 记录当前 git HEAD 的 commit SHA，以便出问题时 `git revert <sha>` + redeploy + Inngest Resync 做完整回滚

## 备注

- 所有带 `*` 的子任务为 optional — 跳过不阻塞功能落地，但完整 PBT 覆盖率（task 4.x、8.x、9.x）是代码质量的硬门槛
- 顶层任务（1, 2, 3, …）**不得**带 `*` — 它们都是核心实现路径
- 每个主任务在完成后必须跑一次 verification 序列（上节）
- 本 spec 严格只负责生成新功能的 design / tasks 规划 — 不改动 weekly pipeline 任何代码路径；不改动 `news` 表、`scheduled_runs` 表、`reports` 表；不触碰 Hitting News 逻辑
- Principle 1 (time doesn't matter)：scan step timeout 240s、canonicalize step timeout 90s — 给 GLM + web search 足够空间；Principle 2 (prompt engineering 最后手段)：Zod schema 强校验、key regex、placeholder 白名单都是 API / 架构层约束；Principle 3 (bilingual first-class)：`_zh` + `_en` 字段对从 day 1 存在，translation 是独立异步 endpoint，fallback indicator 始终保持用户可见
- 属性测试基于 `fast-check`（已在 devDependencies），每项 `numRuns: 100`；47 个 properties 中 42 个为 PBT，5 个为 smoke / static，0 redundancy — 详见 design §Correctness Properties → Test Fixtures Mapping

