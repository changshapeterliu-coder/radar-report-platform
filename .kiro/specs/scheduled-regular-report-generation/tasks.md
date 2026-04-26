# 实施计划：定时自动生成常规雷达报告 (Scheduled Regular Report Generation)

## 概述

本实施计划把"定时自动生成常规雷达报告"功能拆解为可执行编码任务。采用 Inngest Cloud + Vercel + Supabase 架构：Vercel 只承担 API 路由与事件入队，长耗时的双引擎 3 轮 agentic 研究循环 (Gemini + Kimi) + Synthesizer 合并都在 Inngest Cloud 执行，绕开 Vercel Hobby tier 的 10 秒限制。复用平台已有的 `supabase` 客户端、`profiles.role='admin'` 授权模式、`notifications` 通知表、`reports` 草稿表与 `ReportContent` 类型。

任务按依赖顺序组织：

1. 包 + 环境变量 → 2. 数据库迁移 → 3. 共享 TS 类型 → 4. Research_Engine 模块 (纯、零 DB/Inngest 依赖) → 5. Inngest 纯工具 + client + functions → 6. Vercel API 路由 → 7. Admin UI。

每个任务都可以独立验证，检查点任务在关键边界验证累积结果。

## 任务

- [x] 1. 依赖与环境变量配置
  - [x] 1.1 安装 Inngest SDK 与开发 CLI
    - `npm install inngest` (运行时依赖)
    - `npm install --save-dev inngest-cli` (本地开发依赖)
    - 验证 `package.json` 的 `dependencies.inngest` 与 `devDependencies.inngest-cli` 均被登记
    - _需求: 10.1, 10.2_

  - [x] 1.2 确认并补充 Vercel 环境变量
    - 确认 `INNGEST_EVENT_KEY`、`INNGEST_SIGNING_KEY` 已由 Vercel ↔ Inngest 集成自动注入 Production + Preview 环境（无需手动添加）
    - 确认 `OPENROUTER_API_KEY` 已在 Vercel env 中（本功能复用，不新增）
    - **需要用户手动添加**：`SUPABASE_SERVICE_ROLE_KEY` — 在 Vercel Dashboard → Project Settings → Environment Variables 中添加，Scope 选 Production + Preview。该 key 供 Inngest 函数 server-side 写 `scheduled_runs` / `reports` / `notifications` 时绕过 RLS 使用，**严禁**在任何客户端代码或 `NEXT_PUBLIC_*` 前缀变量中出现
    - 在 `src/lib/inngest/client.ts` 与所有 Inngest functions 内通过 `process.env.SUPABASE_SERVICE_ROLE_KEY` 读取
    - _需求: 10.1, 13.1_

- [x] 2. 数据库迁移与 RLS
  - [x] 2.1 创建 `schedule_configs` 表迁移
    - 新建 `supabase/migrations/006_create_schedule_configs.sql`
    - 字段：`id`, `domain_id UNIQUE`, `enabled`, `cadence`, `day_of_week`, `time_of_day` (含 regex CHECK), `timezone`, `report_type`, `created_at`, `updated_at`
    - 对 `domain_id` 加 UNIQUE 约束保证每 domain 1 行
    - 对 `time_of_day` 加 `CHECK (time_of_day ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$')`
    - _需求: 1.1, 1.2, 1.5_

  - [x] 2.2 创建 `prompt_templates` 表迁移
    - 新建 `supabase/migrations/007_create_prompt_templates.sql`
    - 字段：`id`, `domain_id`, `prompt_type`, `template_text`, `created_at`, `updated_at`
    - `prompt_type` CHECK 约束为 `('gemini_prompt', 'kimi_prompt', 'synthesizer_prompt')`
    - UNIQUE `(domain_id, prompt_type)` 保证每 domain × 每 type 恰好 1 行
    - _需求: 2.1_

  - [x] 2.3 创建 `scheduled_runs` 表迁移
    - 新建 `supabase/migrations/008_create_scheduled_runs.sql`
    - 字段参见设计文档 DDL：`id`, `domain_id`, `trigger_type`, `status`, `coverage_window_start`, `coverage_window_end`, `week_label`, `draft_report_id` (nullable FK → reports), `failure_reason`, `gemini_output`, `kimi_output`, `synthesizer_output`, `duration_ms`, `triggered_at`, `completed_at`
    - 建立 **partial** UNIQUE INDEX：`CREATE UNIQUE INDEX idx_scheduled_runs_idempotency ON scheduled_runs (domain_id, coverage_window_start) WHERE status IN ('queued', 'running', 'succeeded')` — 幂等性双保险。`failed` / `partial` 状态行**不占**唯一槽位，允许 retry 场景同窗口插入新 run 的同时保留原 failure log
    - 建立 `idx_scheduled_runs_domain_triggered`, `idx_scheduled_runs_status`
    - `draft_report_id` 外键 ON DELETE SET NULL (不级联删除)
    - _需求: 3.5, 6.2, 9.5, 11.1, 11.2_

  - [x] 2.4 创建 RLS 策略迁移
    - 新建 `supabase/migrations/009_scheduled_runs_rls.sql`
    - 三张新表均 `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
    - 为 `schedule_configs` / `prompt_templates` / `scheduled_runs` 各创建一条 `FOR ALL` 策略：`USING` 与 `WITH CHECK` 皆为 `EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')`
    - Service role key 在 Inngest 服务端代码中绕过 RLS 写入（不需要策略）
    - _需求: 1.4, 2.6, 9.6_

  - [x] 2.5 Seed 默认 prompt 模板迁移
    - 新建 `supabase/migrations/010_seed_prompt_templates.sql`
    - 为 Account Health domain 插入 3 条记录：`gemini_prompt`、`kimi_prompt`、`synthesizer_prompt`
    - 内容取自设计文档附录 A.1（Account Health 领域已 approved 的 seed 文本，每条 ≈ 50 行）
    - 使用 `ON CONFLICT (domain_id, prompt_type) DO NOTHING` 保证重跑迁移不会覆盖 Admin 已手改的内容
    - 同时为 Account Health domain 插入 1 条 `schedule_configs` 默认行：`enabled=false`, `cadence='biweekly'`, `day_of_week='monday'`, `time_of_day='09:00'`, `timezone='Asia/Shanghai'`, `report_type='regular'`
    - _需求: 2.2_

  - [ ]* 2.6 编写 schedule_configs 存储往返一致属性测试
    - **Property 1: Schedule_Config 存储往返一致**
    - **验证: 需求 1.1, 1.3**

  - [ ]* 2.7 编写 schedule_configs 每 domain 唯一属性测试
    - **Property 2: Schedule_Config 每域唯一**
    - **验证: 需求 1.2**

  - [ ]* 2.8 编写 time_of_day 校验属性测试
    - **Property 3: time_of_day 校验**
    - **验证: 需求 1.5**

  - [ ]* 2.9 编写 scheduled_runs 幂等性属性测试
    - **Property 7: 幂等性 (双触发去重)** — 对同 `(domain_id, coverage_window_start)` 且存在状态 ∈ `{queued, running, succeeded}` 的 run 时，后续 insert 抛 23505；若存在的 run 状态 ∈ `{failed, partial}`，retry 插入新 run 成功且原 run 保留
    - **验证: 需求 3.5, 4.4, 9.5, 11.1, 11.2**

  - [ ]* 2.10 编写 Non-admin RLS 拒绝属性测试
    - **Property 9: Non-admin 访问拒绝** — 对三张新表的任意 SELECT/INSERT/UPDATE/DELETE 使用 anon 客户端均被 RLS 拒绝
    - **验证: 需求 1.4, 2.6, 4.3, 9.6**

- [x] 3. 共享 TypeScript 类型
  - [x] 3.1 扩展 `src/types/database.ts`
    - 新增 `schedule_configs`、`prompt_templates`、`scheduled_runs` 三张表的 `Row`/`Insert`/`Update` 类型
    - 与 migrations 字段严格保持一致（特别是枚举字面量 `'weekly' | 'biweekly'`、`'monday' | ... | 'sunday'`、`'gemini_prompt' | 'kimi_prompt' | 'synthesizer_prompt'`、`'queued' | 'running' | 'succeeded' | 'failed' | 'partial'`、`'scheduled' | 'manual'`）
    - _需求: 1.1, 2.1, 3.1, 6.1_

  - [x] 3.2 新建 `src/types/scheduled-runs.ts`
    - `CoverageWindow { startIso, endIso, weekLabel }`
    - `ResearchEngineInput` / `ResearchEngineOutput` / `EngineError` / `EngineErrorClass` / `LoopStage` / `EngineLoopTrace` — 与设计文档签名完全一致
    - `ScheduleConfigInput` / `PromptTemplateInput` (API 请求体类型)
    - `InngestGenerateReportEvent` (`{ domainId, triggerType, coverageWindowStart, coverageWindowEnd, weekLabel }`)
    - 不引用 `@/lib/supabase/*` 或 `inngest` — 仅类型
    - _需求: 5.7, 14.1_

- [x] 4. 检查点 — 确认迁移可执行、类型可编译
  - 在本地 Supabase（或 Dashboard SQL Editor）依序执行 006~010 迁移，确认无错误
  - `npm run build` 通过（仅类型检查层面）
  - 如有问题请向用户确认。

- [x] 5. Research_Engine 模块（纯，零 DB/Inngest 依赖）
  - [x] 5.1 定义 Research_Engine 类型文件
    - 新建 `src/lib/research-engine/types.ts`
    - 从 `src/types/scheduled-runs.ts` 重新导出或镜像 `ResearchEngineInput`、`ResearchEngineOutput`、`EngineError`、`EngineErrorClass`、`LoopStage`、`EngineLoopTrace`
    - 仅允许 import `@/types/report`（取 `ReportContent`）与 Node 内置 —— 不得 import `@/lib/supabase/*`、`@/types/database`、`inngest`
    - _需求: 5.7, 14.1, 14.2_

  - [x] 5.2 实现 `substitute.ts` 占位符替换
    - 新建 `src/lib/research-engine/substitute.ts`
    - 导出 `substitute(template: string, vars: Record<string, string>): string`
    - 使用 `String.prototype.replace(/\{(\w+)\}/g, (_, key) => ...)` 函数形式 + 白名单 `['start_date', 'end_date', 'week_label', 'domain_name', 'gemini_output', 'kimi_output', 'subquestion', 'channel_profile']`
    - 未在白名单的 `{key}` 原样保留；不做 eval / Function / 动态求值
    - _需求: 5.2, 13.1_

  - [ ]* 5.3 编写 substitute 占位符替换属性测试
    - **Property 11: 占位符替换安全性** — (a) 白名单 key 的 value 出现为子串；(b) 不留裸白名单 `{key}`；(c) 无动态求值
    - **验证: 需求 5.2, 13.1**

  - [x] 5.4 实现 `system-prompts.ts` 系统 owned 模板
    - 新建 `src/lib/research-engine/system-prompts.ts`
    - 导出三个字符串常量 `PLANNER_PROMPT`、`GAP_ANALYZER_PROMPT`、`ENGINE_SUMMARIZER_PROMPT`
    - 内容取自设计文档附录 A.2，均含 `{channel_profile}` 占位符
    - 硬性 JSON schema 约束：planner 输出 `subquestions.length ∈ [5, 8]`；gap-analyzer 输出 `gaps.length ≤ maxGapSubquestions`
    - 导出常量 `GEMINI_CHANNEL_PROFILE`、`KIMI_CHANNEL_PROFILE` （设计附录 A.2 定义的两段渠道描述文本）
    - _需求: 5.2, 14.2_

  - [x] 5.5 实现 OpenRouter HTTP client + 错误分类
    - 新建 `src/lib/research-engine/engines/openrouter-client.ts`
    - 导出 `callOpenRouter({ model, messages, apiKey, timeoutMs, jsonMode })` 返回 `{ ok: true, data } | { ok: false, error: EngineError }`
    - 统一错误分类：HTTP 402 → `CreditsExhausted` (message 含字面量 `"OpenRouter credits exhausted"`)；429 → `RateLimited`；5xx → `ServerError`；AbortError → `TimeoutError`；JSON parse 失败 → `MalformedResponse`；其他 → `NetworkError`
    - 超时使用 `AbortController` + `setTimeout`
    - 响应中处理 markdown code fence（`json` 代码块）以容忍不严格 JSON 模式的模型
    - 允许 import `fetch` 与 `./types`，不得 import `@/lib/supabase/*` 或 `inngest`
    - _需求: 7.3, 7.4, 7.5_

  - [ ]* 5.6 编写 OpenRouter 错误分类属性测试
    - **Property 18: 失败原因字符串映射** — 对任意 HTTP 响应状态/错误，分类后构造的 failure_reason 包含要求的子串（"OpenRouter credits exhausted" / "Gemini" / "Kimi" + errorClass）
    - **验证: 需求 7.3, 7.4, 7.5**

  - [x] 5.7 实现 Gemini_Research_Loop
    - 新建 `src/lib/research-engine/engines/gemini.ts`
    - 导出 `runGeminiLoop(input, stageRunner)`，`stageRunner` 签名为 `<T>(stageName: string, fn: () => Promise<T>) => Promise<T>`
    - 5 阶段编排（Stage 1/3/5 单次 LLM；Stage 2/4 用 `Promise.all(subquestions.map(q => stageRunner('stage2-research-' + n, ...)))` 并行）
    - 注入 `GEMINI_CHANNEL_PROFILE` 到三个系统 prompt 的 `{channel_profile}` 占位
    - 默认 model `google/gemini-2.5-pro`
    - Stage 2/4 某个 researcher 子调用失败不让整路 loop 失败 —— 该子问题 findings 记录为 null 进入 errors 数组
    - Stage 1 planner 输出 subquestions 数不在 `[5, maxSubquestionsPerRound]` 闭区间则触发 stage 重试（retries: 2 由 Inngest stageRunner 实现；在 stub 测试模式下自主模拟）
    - Stage 3 gap-analyzer 失败时降级为 "sufficient=true" 跳过 Stage 4
    - 产出 `EngineLoopTrace` + errors 数组 + 最终 summary
    - 不得 import `@/lib/supabase/*`、`inngest`
    - _需求: 5.1, 5.2, 14.2, 14.3_

  - [x] 5.8 实现 Kimi_Research_Loop
    - 新建 `src/lib/research-engine/engines/kimi.ts`
    - 与 `gemini.ts` 结构完全对称，差异：注入 `KIMI_CHANNEL_PROFILE`、默认 model `moonshotai/kimi-k2`、使用 `kimiPrompt` 作为 researcher prompt
    - 其他行为不变（5 阶段、部分失败策略、循环终止上界）
    - _需求: 5.1, 5.2, 14.2, 14.3_

  - [ ]* 5.9 编写 Planner sub-question 数量上下界属性测试
    - **Property 26: Planner sub-question 数量上下界** — 合法 planner 输出满足 `[5, 8]`；超界触发重试，重试仍超界整路退出
    - **验证: 设计不变量（支持 Requirements 5.1 的 3 轮 loop 质量保障）**

  - [ ]* 5.10 编写循环终止保障属性测试
    - **Property 27: 循环终止保障（调用数上界）** — 任一 loop 的 researcher 调用总数 ≤ `maxSubquestionsPerRound + maxGapSubquestions`；gap-analyzer 调用 ≤ 1
    - **验证: 设计不变量（有界计算、无死循环）**

  - [ ]* 5.11 编写 Gap-analyzer 输出上界属性测试
    - **Property 30: Gap-analyzer 输出上界** — 任意 LLM 返回的 gaps 数量被截断至 ≤ `maxGapSubquestions`，保留 stable order 前 N 个
    - **验证: 支持 Property 27 上界证明**

  - [ ]* 5.12 编写 Citation 保留贯通属性测试
    - **Property 29: Citation 保留贯通** — Stage 2/4 findings 中出现的 URL 在 Stage 5 summary 的 all_citations 中完整保留
    - **验证: 可追溯性，支持 Confidence_Tag 来源可验证**

  - [x] 5.13 实现 Synthesizer
    - 新建 `src/lib/research-engine/synthesizer.ts`
    - 导出 `synthesize({ geminiSummary, kimiSummary, synthesizerPrompt, coverageWindow, apiKey, timeoutMs })` → `{ ok: true, content: ReportContent } | { ok: false, error: EngineError }`
    - 通过 `substitute` 将 `{gemini_output}`、`{kimi_output}`、`{week_label}`、`{start_date}`、`{end_date}` 代入 prompt
    - 若某路 summary 为 null → 代入字符串 `"null (engine failed)"`；单路模式下所有 block 的 `label` 强制为 `"Needs Verification · 1/2 sources"`
    - 双路模式下根据两侧 findings 对齐情况由 Synthesizer 自行打 `"High Confidence · 2/2 sources"` 或 `"Needs Verification · 1/2 sources"`
    - Synthesizer 输出 JSON 复用 `src/app/api/ai/format-report/route.ts` 的 8-block-type 分类指令文本（作为 prompt 内置说明）
    - 强制输出 `modules.length === 4` 且 title 顺序为 `["Account Suspension Trends", "Listing Takedown Trends", "Account Health Tool Feedback", "Education Opportunities"]`
    - 返回内容必须通过 `src/lib/validators/content-validator.ts` 的 `validateReportContent(_, 'regular')` 校验，否则分类为 `MalformedResponse`
    - 默认 model `anthropic/claude-sonnet-4`
    - _需求: 5.3, 5.4, 5.5, 5.6_

  - [ ]* 5.14 编写 Confidence 标签完整性属性测试
    - **Property 14: Confidence 标签完整性（双引擎成功）** — 双路成功时每个 ContentBlock 的 label 属于 `{"High Confidence · 2/2 sources", "Needs Verification · 1/2 sources"}`
    - **验证: 需求 5.5**

  - [ ]* 5.15 编写 Confidence 标签单引擎降级属性测试
    - **Property 15: Confidence 标签单引擎降级** — 仅一路成功时所有 label 恒为 `"Needs Verification · 1/2 sources"`
    - **验证: 需求 5.6**

  - [x] 5.16 实现 Research_Engine 入口 `run()`
    - 新建 `src/lib/research-engine/index.ts`
    - 导出 `run(input: ResearchEngineInput): Promise<ResearchEngineOutput>`
    - 顶层 `Promise.allSettled([runGeminiLoop(input, stageRunner), runKimiLoop(input, stageRunner)])`
    - `stageRunner` 默认实现为 passthrough（`(name, fn) => fn()`）—— Inngest 调用方可注入 `step.run` 版本
    - 根据两路 summary 非空情况：两路成功 → 调 synthesizer；一路成功 → 调 synthesizer 并传 "null (engine failed)"；两路失败 → `content: null`
    - 聚合两路 errors + synth error 到 `errors` 字段
    - 聚合两路 trace 到 `engineOutputs.gemini / kimi / synthesizer`
    - 仅 import `@/types/report`、`./types`、`./substitute`、`./system-prompts`、`./engines/*`、`./synthesizer`
    - _需求: 5.1, 5.3, 5.6, 5.7, 14.1, 14.3_

  - [ ]* 5.17 编写 Research_Engine 确定性属性测试
    - **Property 12: Research_Engine 确定性（mocked）** — 固定 mock 响应，`run(input)` 两次调用输出结构深度相等
    - **验证: 需求 5.7, 14.3**

  - [ ]* 5.18 编写 Research_Engine 导入隔离属性测试
    - **Property 13: Research_Engine 导入隔离** — 使用 AST 遍历 `src/lib/research-engine/` 所有 `.ts` 文件，断言不含 `@/lib/supabase/*`、`@/types/database`、`inngest`、`inngest/next`、`scheduled_runs`/`notifications`/`schedule_configs`/`prompt_templates` 业务模块
    - **验证: 需求 14.2**

  - [ ]* 5.19 编写 Stage prompt 隔离属性测试
    - **Property 28: Stage prompt 隔离（DB vs 代码）** — planner / gap-analyzer / engine-summarizer prompt 文本来自 `system-prompts.ts` 的编译期 import，不得来自运行期 DB 查询
    - **验证: 需求 14.2（扩展）**

- [x] 6. 检查点 — 确保 Research_Engine 独立可用
  - 运行所有 Research_Engine 层单元/属性测试
  - 确认导入隔离属性测试通过
  - 如有问题请向用户确认。

- [x] 7. Inngest 纯工具函数（无 DB/Inngest 依赖，可独立测试）
  - [x] 7.1 实现 Coverage_Window 工具
    - 新建 `src/lib/inngest/coverage-window.ts`
    - 导出 `computeCoverageWindow(triggerUtc: Date, cadence: 'weekly' | 'biweekly'): CoverageWindow`
    - 导出 `computeWeekLabel(startShanghai: Date, endShanghai: Date): string`（格式 `"MMDD to MMDD"`）
    - 导出 `shouldFire(config: ScheduleConfigRow, nowUtc: Date): boolean`
    - 所有计算基于 `Asia/Shanghai` —— 使用 `Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', ... })` 或等价 pure TS 实现；不依赖服务器本地时区
    - weekly：start = 前一个周一 00:00 Shanghai，end = 前一个周日 23:59 Shanghai；biweekly：start = end 前 14 天（end 相同）
    - 纯函数，不 import `@/lib/supabase/*` 或 `inngest`
    - _需求: 3.1, 3.3, 3.4, 12.1, 12.2_

  - [ ]* 7.2 编写 shouldFire 纯函数属性测试
    - **Property 4: shouldFire 纯函数正确性** — 对任意 config + time，返回真当且仅当 `enabled && toShanghai(t).dayOfWeek === config.day_of_week && HH:MM === config.time_of_day`
    - **验证: 需求 1.6, 3.1, 12.1**

  - [ ]* 7.3 编写 Coverage_Window 边界属性测试
    - **Property 5: Coverage_Window 时区边界正确** — 周一 09:00 Shanghai 触发 → weekly 窗口 `[前周一 00:00, 前周日 23:59]`；biweekly 窗口 `[end - 14天 + 1分钟, end]`
    - **验证: 需求 3.3, 12.1, 12.2**

  - [ ]* 7.4 编写 Week_Label 格式与反向解析属性测试
    - **Property 6: Week_Label 格式与反向解析一致** — 格式 `^\d{4} to \d{4}$`；解析回日期差等于 6 天 (weekly) / 13 天 (biweekly)
    - **验证: 需求 3.4, 12.2**

  - [x] 7.5 实现幂等性 key 生成
    - 新建 `src/lib/inngest/idempotency.ts`
    - 导出 `buildIdempotencyKey(domainId: string, coverageWindowStartIso: string): string`
    - 返回 `"report-gen:${domainId}:${coverageWindowStartIso}"` —— 纯确定性字符串拼接
    - _需求: 3.5, 11.1, 11.2_

  - [ ]* 7.6 编写幂等性 key 确定性属性测试
    - **Property 8: 幂等性 key 确定性** — 相同输入恒返回相同字符串，不依赖时钟/随机性/env
    - **验证: 支持需求 3.5, 11.1**

- [x] 8. Inngest client 与 functions
  - [x] 8.1 创建 Inngest client
    - 新建 `src/lib/inngest/client.ts`
    - 导出 `export const inngest = new Inngest({ id: 'radar-report-platform' })`
    - 仅在该文件及 functions 中使用 Inngest SDK — 不让 research-engine 触碰
    - _需求: 10.1_

  - [x] 8.2 实现 `scheduleTick` Inngest function
    - 新建 `src/lib/inngest/functions/schedule-tick.ts`
    - cron: `'TZ=Asia/Shanghai * * * * *'`（每分钟）
    - `step.run('fetch-enabled-configs')`：用 service role 客户端查 `schedule_configs WHERE enabled = true`
    - 对每条 config：用 `shouldFire(config, new Date())` 判断；匹配则 `computeCoverageWindow` → `step.sendEvent('report/generate.requested', { data: { domainId, triggerType: 'scheduled', coverageWindowStart/End, weekLabel } })`
    - 使用 `buildIdempotencyKey` 作为事件 `id` 字段 —— Inngest 会去重
    - _需求: 3.1, 3.3, 3.4, 11.1_

  - [x] 8.3 实现 `generateReport` Inngest function（骨架）
    - 新建 `src/lib/inngest/functions/generate-report.ts`
    - 配置：`retries: 0`（步骤级重试）, `idempotency: 'event.data.domainId + "-" + event.data.coverageWindowStart'`, `concurrency: { limit: 5 }`, 触发 event `report/generate.requested`
    - Step 顺序（先搭骨架不填完整逻辑，后续任务逐步填充）：
      - `insert-run-row`（占位，8.4 完成）
      - `fetch-config`（占位，8.4 完成）
      - engine loops（占位，8.5 完成）
      - `synthesize`（占位，8.6 完成）
      - `create-draft`（占位，8.7 完成）
      - `finalize-run`（占位，8.8 完成）
      - `notify-admins`（占位，8.9 完成）
    - _需求: 3.2, 10.1, 10.3_

  - [x] 8.4 实现 `insert-run-row` + `fetch-config` steps
    - `insert-run-row`：用 service role 客户端 INSERT `scheduled_runs`，`status='running'`；捕获 23505（唯一约束冲突）→ 函数直接退出，不重复工作
    - `fetch-config`：SELECT domain_name from domains + 3 条 prompt_templates（按 prompt_type 索引）
    - 返回 `{ runId, domainName, geminiPrompt, kimiPrompt, synthesizerPrompt }` 供后续 step 使用
    - _需求: 3.5, 5.2, 6.2, 11.1, 11.2_

  - [x] 8.5 桥接 Research_Engine 与 Inngest stageRunner
    - 在 `generate-report.ts` 中构造 `makeStageRunner = (engine) => <T>(stage, fn) => step.run(\`engine-\${engine}-\${stage}\`, fn)`
    - 顶层 `await Promise.all([runGeminiLoop(input, makeStageRunner('gemini')), runKimiLoop(input, makeStageRunner('kimi'))])`
    - 传入 `openRouterApiKey: process.env.OPENROUTER_API_KEY!`、`maxSubquestionsPerRound: 8`、`maxGapSubquestions: 4`
    - 产出两路 `EngineLoopTrace` + errors 供后续 step 写入 DB
    - _需求: 5.1, 5.7, 10.1, 14.2_

  - [x] 8.6 实现 `synthesize` step
    - 仅在 `geminiLoop.summary || kimiLoop.summary` 非空时调用
    - `step.run('synthesize', { timeout: '3m', retries: 1 }, ...)` 调 `synthesize` from `@/lib/research-engine/synthesizer`
    - 捕获 EngineError 保留到局部变量 `synthError`
    - _需求: 5.3, 5.4, 5.5, 5.6_

  - [x] 8.7 实现 `create-draft` step
    - 无论成功失败都创建 draft（失败时用 skeleton）
    - 辅助函数 `buildSkeletonDraft(weekLabel, startIso, endIso): ReportContent` — 4 个模块 title 固定为 `["Account Suspension Trends", "Listing Takedown Trends", "Account Health Tool Feedback", "Education Opportunities"]`，每个 `blocks: []`、`tables: []`、`analysisSections: []`、`highlightBoxes: []`
    - 使用 service role 客户端 INSERT `reports` 表：`status='draft'`, `type='regular'`, `domain_id`, `week_label`, `date_range = \`${start} ~ ${end}\``, `title`（设计文档已 approved 标题模板 —— 例如 "Account Health Radar Report - {weekLabel}"）, `content`, `created_by` = 从 `schedule_configs.created_by` 或指定系统 admin uid
    - 返回 `draftId`
    - **严禁**调用 `/api/reports/[id]/publish` 或 translate / topic-extract / hot-news 逻辑
    - _需求: 6.1, 6.3, 7.1, 7.2_

  - [ ]* 8.8 编写 Skeleton_Draft 模块结构属性测试
    - **Property 16: 模块结构不变量** — 无论成功或失败创建的 reports 行 content.modules.length === 4 且 title 顺序固定
    - **Property 17: Skeleton_Draft 空 blocks 不变量** — 失败路径的 Skeleton_Draft 四个模块 blocks 均为 `[]`
    - **验证: 需求 5.4, 7.1, 7.2**

  - [x] 8.9 实现 `finalize-run` step + 状态决策
    - 辅助纯函数 `determineStatus(geminiOk: boolean, kimiOk: boolean, synthOk: boolean): 'succeeded' | 'partial' | 'failed'` 放在 `src/lib/inngest/functions/generate-report.ts` 内或独立 `determine-status.ts`（推荐独立以便测试）
    - 状态表：`(false, false, _)` → `failed`；至少一路引擎成功且 `synthOk=true` → `succeeded`；至少一路引擎成功但 `synthOk=false` → `partial`
    - 辅助纯函数 `buildFailureReason(geminiErrors, kimiErrors, synthError): string | null`，按设计 "错误处理" 章节的字符串映射规则组装（包含 "OpenRouter credits exhausted" / "Gemini" / "Kimi" / stage 后缀）
    - `step.run('finalize-run')`：UPDATE `scheduled_runs` 设置 status、draft_report_id、failure_reason、gemini_output=trace、kimi_output=trace、synthesizer_output=content、duration_ms、completed_at
    - _需求: 7.3, 7.4, 7.5, 7.6_

  - [ ]* 8.10 编写 Scheduled_Run 状态决策属性测试
    - **Property 19: Scheduled_Run 状态分配正确** — 对 `(geminiOk, kimiOk, synthOk)` 所有 8 种组合 determineStatus 返回值符合设计状态表
    - **验证: 需求 7.6**

  - [x] 8.11 实现 `notify-admins` step
    - `step.run('notify-admins')`：用 service role 客户端查 `profiles WHERE role = 'admin'`，为每人插入 `notifications` 行
    - 成功：`type='report'`, `reference_id=draftId`, `title="Scheduled draft ready: <week_label>"`, `summary="Review and publish"`
    - 失败/部分：`type='report'`, `reference_id=runId`, `title="Scheduled run failed: <week_label>"`, `summary=failureReason`
    - **严禁**对 `role='team_member'` 用户创建通知
    - _需求: 8.1, 8.2, 8.3_

  - [ ]* 8.12 编写 Admin 通知计数属性测试
    - **Property 20: Admin 通知计数准确** — 通知行数恰好等于 admin 用户数
    - **验证: 需求 8.1, 8.2**

  - [ ]* 8.13 编写 Team_member 零通知属性测试
    - **Property 21: Team_member 零通知** — 通知中 `user_id` 对应 team_member 数恒为 0
    - **验证: 需求 8.3**

  - [ ]* 8.14 编写不触发 publish 下游属性测试
    - **Property 22: 不触发 publish 下游逻辑** — 用 spy / import graph 校验 `src/lib/inngest/functions/generate-report.ts` 不引用 `/api/reports/[id]/publish`、translate、topic-extract、hot-news 相关模块
    - **验证: 需求 6.3**

  - [x] 8.15 导出 functions 聚合
    - 新建 `src/lib/inngest/functions/index.ts`
    - `export const functions = [scheduleTick, generateReport]`
    - _需求: 10.1_

- [x] 9. Vercel API 路由
  - [x] 9.1 Inngest webhook 路由
    - 新建 `src/app/api/inngest/route.ts`
    - `export const { GET, POST, PUT } = serve({ client: inngest, functions })`
    - 从 `@/lib/inngest/client` 和 `@/lib/inngest/functions` 导入
    - _需求: 10.1, 10.2_

  - [x] 9.2 `GET/POST /api/admin/schedule-config`
    - 新建 `src/app/api/admin/schedule-config/route.ts`
    - 使用 `createServerSupabaseClient()` + 读 `profiles.role='admin'` 授权；非 admin → 403
    - GET：返回当前 domain（Account Health）的 schedule_configs 行
    - POST：校验 payload（`enabled`, `cadence`, `day_of_week`, `time_of_day` 正则匹配）；upsert 到 `schedule_configs`（`ON CONFLICT (domain_id) DO UPDATE`）
    - 校验失败 → 400 + 字段级错误
    - _需求: 1.1, 1.3, 1.4, 1.5, 1.6_

  - [x] 9.3 `GET/POST /api/admin/prompt-templates`
    - 新建 `src/app/api/admin/prompt-templates/route.ts`
    - 授权同上
    - GET：返回指定 domain 的 3 条 prompt_templates（按 prompt_type 组装对象）
    - POST：入参 `{ prompt_type, template_text }`
    - 若 `prompt_type === 'synthesizer_prompt'` 且文本未同时包含 `{gemini_output}` 与 `{kimi_output}` → 400 + 说明
    - Upsert `(domain_id, prompt_type)`
    - _需求: 2.1, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 9.4 编写 synthesizer_prompt 占位符强制属性测试
    - **Property 10: Synthesizer prompt 占位符强制校验** — 缺 `{gemini_output}` 或 `{kimi_output}` 的保存恒被拒绝，现有值保持不变
    - **验证: 需求 2.4**

  - [x] 9.5 `POST /api/admin/scheduled-runs/trigger` 手动触发
    - 新建 `src/app/api/admin/scheduled-runs/trigger/route.ts`
    - 授权：admin only
    - 流程：load domain 的 schedule_configs（**不要求** `enabled=true`）→ `computeCoverageWindow(new Date(), cadence)` → 检查 `scheduled_runs` 是否已有 `status IN ('queued', 'running')` 且同 `(domain_id, coverage_window_start)` → 冲突则 409 `{ error: 'A run is already in progress' }`
    - 否则 `inngest.send('report/generate.requested', { id: buildIdempotencyKey(...), data: { domainId, triggerType: 'manual', ... } })`
    - 返回 `{ runId: null, queuedAt: timestamp }`（runId 由 generateReport step 1 创建，不提前占位）
    - _需求: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 9.6 `GET /api/admin/scheduled-runs` 列表
    - 新建 `src/app/api/admin/scheduled-runs/route.ts`
    - 授权：admin only
    - 查询参数 `?page=1&pageSize=20`（pageSize 默认 20，上限 20 — 超出视为 20）
    - `SELECT ... FROM scheduled_runs ORDER BY triggered_at DESC LIMIT 20 OFFSET (page-1)*20`
    - 返回 `{ rows, totalCount, page, pageSize }`
    - _需求: 9.1, 9.2, 9.3_

  - [ ]* 9.7 编写分页与时间倒序属性测试
    - **Property 23: 分页数量上限** — rows ≤ 20 且 p=1..N 并集等于全量倒序
    - **Property 24: Scheduled_Runs 列表时间倒序** — 相邻行 `triggered_at` 非递增
    - **验证: 需求 9.1, 9.3**

  - [x] 9.8 `GET /api/admin/scheduled-runs/[id]` 详情
    - 新建 `src/app/api/admin/scheduled-runs/[id]/route.ts`
    - 授权：admin only
    - Next.js 16 动态 params：`params: Promise<{ id: string }>` 后 `const { id } = await params`
    - 返回完整行（含 `gemini_output`、`kimi_output`、`synthesizer_output`、`failure_reason`）
    - _需求: 9.4_

  - [x] 9.9 `POST /api/admin/scheduled-runs/[id]/retry`
    - 新建 `src/app/api/admin/scheduled-runs/[id]/retry/route.ts`
    - 授权：admin only
    - 加载原 run；若 `status NOT IN ('failed', 'partial')` → 400
    - 校验同 `(domain_id, coverage_window_start)` 当前无 queued/running/succeeded run（partial unique index 自动保证）→ 冲突时 `inngest.send` 会触发 DB 23505 → 返回 409
    - `inngest.send('report/generate.requested', { id: buildIdempotencyKey(domainId, newStartIso), data: { domainId, triggerType: 'manual', coverageWindowStart: 原 run 的 start, coverageWindowEnd: 原 run 的 end, weekLabel: 原 run 的 label } })`
    - **不**删除原 run —— 原 failed/partial run 保留完整 failure_reason / engine outputs 作为历史，新 run 以新 UUID 插入 scheduled_runs 表。partial unique index `WHERE status IN ('queued','running','succeeded')` 保证原 failed/partial 行不占槽位，新 run 可正常插入
    - Inngest idempotency key 与原 run 相同（`buildIdempotencyKey(domainId, startIso)`）—— **但** Inngest 事件去重仅在短时间窗口内生效，原 failed run 的事件早已过去，这里不会撞 Inngest 层去重；DB 层由 partial unique index 约束
    - 返回 `{ queuedAt: timestamp }`
    - _需求: 9.5_

  - [ ]* 9.10 编写 Retry 产生 manual run + 保留原 run 属性测试
    - **Property 25: Retry 产生新 manual run（保留原 run 作为历史）** — retry failed/partial run 后 (a) 新 run trigger_type === 'manual' 且 coverage window 与原 run 相同；(b) 原 run 行仍存在于 scheduled_runs 表，failure_reason / engine outputs 保持不变；(c) 同 `(domain_id, coverage_window_start)` 下 status NOT IN ('failed','partial') 的行数 ≤ 1
    - **验证: 需求 9.5**

- [x] 10. 检查点 — API 路由层完整、授权正确、Inngest webhook 可达
  - 本地用 `npx inngest-cli dev` 启动 Inngest 开发服务器，确认 `http://localhost:3000/api/inngest` 能被注册
  - 运行所有 API 层单元/属性测试
  - 如有问题请向用户确认。

- [x] 11. Admin UI 页面与组件
  - [x] 11.1 `ScheduleConfigForm` 组件
    - 新建 `src/components/admin/ScheduleConfigForm.tsx`
    - 字段：`enabled` checkbox, `cadence` radio (Weekly/Biweekly), `day_of_week` select, `time_of_day` time input (受控 `HH:MM`)
    - 提交调 `POST /api/admin/schedule-config`
    - 提交按钮 "Save Cadence"
    - 展示 "Next scheduled run: <computed>" 辅助文本（基于当前 config 推算）
    - 表单级校验：`time_of_day` 正则 `^(0\d|1\d|2[0-3]):[0-5]\d$`
    - _需求: 1.1, 1.3, 1.5, 1.6_

  - [x] 11.2 `PromptTemplateEditor` 组件
    - 新建 `src/components/admin/PromptTemplateEditor.tsx`
    - props：`promptType: 'gemini_prompt' | 'kimi_prompt' | 'synthesizer_prompt'`, `defaultText`, `currentText`
    - 大 textarea（monospace，约 30 行可见；synthesizer 约 40 行）
    - "Reset to Default" 按钮：重置到 prop 传入的 defaultText（不直接提交 —— 需点 Save 才生效）
    - "Save" 按钮调 `POST /api/admin/prompt-templates`
    - 若 `promptType === 'synthesizer_prompt'`，实时提示必需占位符 `{gemini_output}`、`{kimi_output}` 并在缺失时禁用 Save
    - 显示支持的占位符列表（每个 promptType 不同）
    - 不显示任何 API key / model id / endpoint URL
    - _需求: 2.1, 2.3, 2.4, 2.5, 13.1, 13.2_

  - [x] 11.3 `TriggerNowButton` 组件
    - 新建 `src/components/admin/TriggerNowButton.tsx`
    - 点击弹出确认 modal（含当前计算得到的 coverage_window 展示）
    - 确认后调 `POST /api/admin/scheduled-runs/trigger`
    - 成功 → toast "Run queued. View on the runs page →"（含链接到 `/admin/scheduled-runs`）
    - 409 冲突 → toast 错误
    - _需求: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 11.4 `/admin/schedule-settings` 页面
    - 新建 `src/app/(main)/admin/schedule-settings/page.tsx`
    - 顶部右上角固定 `TriggerNowButton`
    - 向下依次：`ScheduleConfigForm`、三个 `PromptTemplateEditor`（Gemini / Kimi / Synthesizer）
    - 路由守卫：`profiles.role !== 'admin'` 显示 "Access denied"
    - 服务端组件：调 `createServerSupabaseClient()` 加载初始数据 → pass to 客户端子组件
    - _需求: 1.1, 2.1, 4.1_

  - [x] 11.5 `ScheduledRunsTable` 组件
    - 新建 `src/components/admin/ScheduledRunsTable.tsx`
    - 列：Run ID (短 8 位 UUID 前缀)、Triggered At (Asia/Shanghai with tz indicator)、Trigger Type、Status、Duration、Draft Link、Failure Reason (truncated)、Actions (`View Logs` + conditional `Retry`)
    - Pagination：Prev / Next + "Page X of Y"
    - 点击 Run ID 或 View Logs 触发 `onOpenDrawer(runId)` 回调
    - _需求: 9.1, 9.2, 9.3, 12.3_

  - [x] 11.6 `ScheduledRunDrawer` 组件
    - 新建 `src/components/admin/ScheduledRunDrawer.tsx`
    - 右侧 slide-in drawer（关闭按钮、标题含 short runId）
    - 展示：Triggered At (CST)、Trigger Type、Status、Coverage Window、Week Label、Duration、Draft 链接（"Open draft in new tab ↗"）
    - 三个可展开 section：`Gemini Output`、`Kimi Output`、`Synthesizer Output` — 默认折叠，展开后 JSON pretty-print
    - Errors section：列出 `errors` 数组（stage / subquestionIndex / errorClass / message）
    - 数据来源：`GET /api/admin/scheduled-runs/[id]`
    - _需求: 9.4_

  - [x] 11.7 `/admin/scheduled-runs` 页面
    - 新建 `src/app/(main)/admin/scheduled-runs/page.tsx`
    - 路由守卫：admin only
    - 首屏加载调 `GET /api/admin/scheduled-runs?page=1`
    - 渲染 `ScheduledRunsTable` + drawer state
    - "Retry" 按钮调 `POST /api/admin/scheduled-runs/[id]/retry`
    - _需求: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 11.8 Admin 导航增加入口
    - 修改 `src/app/(main)/admin/page.tsx`（或全局 layout，遵循现有 admin 面板模式）
    - 新增两个导航项：`Schedule Settings` → `/admin/schedule-settings`、`Scheduled Runs` → `/admin/scheduled-runs`
    - 不在 Dashboard 添加 Trigger Now 入口（保持 dashboard 中性）
    - _需求: 9.1_

- [x] 12. 检查点 — Admin UI 页面可访问、表单校验正确、drawer 可展开
  - 本地 `npm run dev` 手动点一遍 admin 流程
  - 运行所有 UI 层单元测试
  - 如有问题请向用户确认。

- [ ] 13. E2E 烟雾测试
  - [ ] 13.1 手动触发端到端验证
    - 本地启动：`npx inngest-cli dev`（Inngest 开发服务器）+ `npm run dev`（Next.js）
    - 登录 admin 账户 → 访问 `/admin/schedule-settings` → 点击 "Trigger Now"
    - 验证 Inngest dev UI 显示 `generateReport` 函数触发 + 各 step 依次执行
    - 验证 `reports` 表新出现一行 `status='draft'`, `type='regular'`, content.modules.length === 4，title 顺序固定
    - 验证 `scheduled_runs` 表新出现一行，status 为 succeeded / partial / failed 之一
    - 验证 `notifications` 表为所有 admin 用户各新增一行，team_member 零新增
    - 访问 `/admin/scheduled-runs` → 列表展示该 run → 点击 View Logs → drawer 展示 engine outputs
    - _需求: 3.1~3.5, 4.1~4.5, 5.1~5.7, 6.1~6.4, 8.1~8.3, 9.1~9.6_

  - [ ] 13.2 失败路径烟雾测试
    - 临时将 `OPENROUTER_API_KEY` 设为无效值（或网络中断）
    - 手动触发 → 验证 `scheduled_runs.failure_reason` 含 "OpenRouter" 或相应错误子串
    - 验证 Skeleton_Draft 被创建（4 个模块 title 正确、blocks 为空数组）
    - 验证失败通知发给所有 admin
    - _需求: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.2_

- [x] 14. 最终检查点 — 所有测试通过 + 所有需求被覆盖
  - 运行 `npm test`，确认全部单元测试 + 已选中的属性测试通过
  - 对照需求文档 1.1~14.3，逐条确认由具体任务覆盖
  - 对照设计文档 Property 1~30，确认每个属性对应的 `*` 任务已定义
  - 如有问题请向用户确认。

## 备注

- 标记 `*` 的任务为可选属性测试任务，可在 MVP 阶段跳过
- 每个任务都引用了具体的需求编号或设计属性编号，确保可追溯性
- 检查点任务用于增量验证，避免在最后才发现集成问题
- Research_Engine 模块（任务 5）是设计的核心复用单元 —— 其纯函数性 + 零依赖隔离由 Property 12/13/28 保护
- Inngest 免费层额度按设计约 43K + 120 steps/月，刚好在 50K 以内；若开启更高频或 multi-domain 需要评估升级
- 技术栈：Next.js 16 (App Router, Turbopack) + React 19 + TypeScript + Tailwind CSS v4 + Supabase + Inngest Cloud + OpenRouter
- 新增依赖：`inngest`（运行时）, `inngest-cli`（开发）
- 新增环境变量：`SUPABASE_SERVICE_ROLE_KEY`（用户需手动在 Vercel 添加）；`INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` 已由 Vercel ↔ Inngest 集成自动注入
