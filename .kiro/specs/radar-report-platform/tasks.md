# 实施计划：雷达报告平台 (Radar Report Platform)

## 概述

本实施计划将雷达报告平台的设计拆解为可执行的编码任务。采用 Vercel + Supabase 全托管 Serverless 架构：前端使用 Next.js (App Router) + React + TypeScript 部署到 Vercel，后端使用 Supabase（托管 PostgreSQL + 内置认证 + Realtime + Edge Functions）。任务按增量方式组织，每个任务在前一个任务基础上构建，确保无孤立代码。

## 任务

- [x] 1. 项目初始化与基础架构搭建
  - [x] 1.1 初始化 Next.js 项目
    - 使用 `create-next-app` 创建 Next.js 项目（App Router, TypeScript, Tailwind CSS）
    - 安装核心依赖：`@supabase/supabase-js`, `@supabase/ssr`, `react-i18next`, `i18next`, `recharts`, `fast-check`, `vitest`, `@testing-library/react`
    - 配置 TypeScript、ESLint、Prettier
    - 配置 Vitest 测试环境（支持 TypeScript 和 fast-check）
    - 创建 `.env.local` 配置 Supabase URL 和 anon key
    - 创建 `lib/supabase/client.ts`（浏览器端 Supabase 客户端）和 `lib/supabase/server.ts`（服务端 Supabase 客户端）
    - _需求: 全局_

  - [x] 1.2 定义共享类型与接口
    - 创建 `types/` 目录，定义 `ReportContent`, `ReportModule`, `ReportTable`, `AnalysisSection`, `Quote`, `KeyPoint`, `HighlightBox`, `TableCell`, `TableRow` 等 TypeScript 接口
    - 定义 Supabase Database 类型（`types/database.ts`），使用 `supabase gen types` 生成或手动定义
    - 定义枚举类型：`UserRole`, `ReportType`, `ReportStatus`, `NotificationType`
    - 定义错误响应格式（`ApiError`, `ContentValidationError`）
    - _需求: 4.1, 5.1, 5.5_

  - [x] 1.3 Supabase 数据库 Schema 配置
    - 在 Supabase Dashboard SQL Editor 中执行建表脚本，创建 `domains`, `profiles`, `reports`, `news`, `notifications` 五张表
    - 配置 UUID 主键（`gen_random_uuid()`）、外键约束、索引（`reports.domain_id`, `reports.status`, `news.domain_id`, `notifications.user_id`）
    - 创建 `reports.search_vector` 的 `tsvector` 列和 GIN 索引
    - 创建触发器：`handle_new_user`（新用户注册时自动创建 profile）、`update_report_search_vector`（自动更新搜索向量）
    - 创建 RPC 函数 `search_reports`（全文搜索）
    - 启用所有表的 Row Level Security (RLS)
    - 创建 RLS 策略（参见设计文档 RLS 策略部分）
    - 插入种子数据：默认 Domain "Account Health"、通过 Supabase Auth 创建初始 Admin 用户
    - 将所有 SQL 脚本保存到 `supabase/migrations/` 目录以便版本管理
    - _需求: 12.1, 12.6, 12.7_

- [x] 2. 用户认证与权限控制（Supabase Auth）
  - [x] 2.1 实现 Supabase Auth 认证流程
    - 使用 `@supabase/ssr` 配置 Next.js 中间件（`middleware.ts`），保护需要认证的路由
    - 实现 `supabase.auth.signInWithPassword()` 登录
    - 实现 `supabase.auth.signOut()` 登出
    - 实现 `supabase.auth.getUser()` 获取当前用户
    - 实现 `supabase.auth.onAuthStateChange()` 监听认证状态变化
    - 创建 AuthContext Provider，管理登录状态、自动重定向未认证用户到登录页
    - 角色信息从 `profiles` 表读取（通过 `auth.uid()` 关联）
    - _需求: 6.1, 6.2, 6.3, 6.4_

  - [x] 2.2 实现角色权限控制
    - RLS 策略已在数据库层面实现权限控制（Admin 可 CRUD，Team_Member 只读）
    - 前端实现 `useRole()` hook，从 profiles 表获取当前用户角色
    - 前端路由守卫：Admin 页面检查角色，Team_Member 显示权限不足提示
    - 账户锁定由 Supabase Auth 内置速率限制机制处理
    - _需求: 6.4, 6.5_

  - [ ]* 2.3 编写认证与权限属性测试
    - **Property 14: 未认证请求拒绝** — 验证所有受保护的 Supabase 查询在无有效 session 时被 RLS 拒绝
    - **验证: 需求 6.1, 6.3**

  - [ ]* 2.4 编写角色权限隔离属性测试
    - **Property 15: 角色权限隔离** — 验证 Team_Member 角色的 Supabase 客户端无法执行 Admin 写操作（RLS 拒绝）
    - **验证: 需求 6.4**

- [x] 3. 检查点 — 确保认证模块测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 4. 报告内容校验与 CRUD
  - [x] 4.1 实现 ContentValidator 服务
    - 创建 `lib/validators/content-validator.ts`，实现 `ReportContent` JSON Schema 校验逻辑
    - 校验 Regular Report 必须包含恰好 4 个模块
    - 校验 Topic Report 至少包含 1 个模块
    - 校验每个模块的必填字段（title, tables, analysisSections）
    - 校验表格行列一致性（每行 cells 数量等于 headers 数量）
    - 校验失败时返回结构化错误信息（`ContentValidationError`），指明字段路径和原因
    - 此逻辑在 Edge Function 和前端共用
    - _需求: 4.5, 5.5_

  - [ ]* 4.2 编写报告内容校验属性测试
    - **Property 11: 无效报告内容拒绝** — 验证不符合 schema 的 JSON 被拒绝并返回描述性错误
    - **验证: 需求 4.5, 5.5**

  - [ ]* 4.3 编写 Regular Report 模块数量校验属性测试
    - **Property 12: Regular Report 模块数量校验** — 验证模块数量不为 4 时被拒绝
    - **验证: 需求 4.5**

  - [x] 4.4 实现报告 CRUD（Supabase Client SDK + Edge Functions）
    - 创建 Supabase Edge Function `create-report`：接收结构化报告 JSON + 元数据，调用 ContentValidator 校验，存储到 reports 表
    - 创建 Supabase Edge Function `publish-report`：更新 status=published + published_at，为 Domain 下所有 Team_Member 创建通知
    - 前端通过 Supabase SDK 直接查询报告列表：`supabase.from('reports').select()`（RLS 自动过滤权限）
    - 前端通过 Supabase SDK 查询报告详情：`supabase.from('reports').select().eq('id', reportId).single()`
    - Admin 更新报告：`supabase.from('reports').update()`（RLS 校验 Admin 权限）
    - Admin 删除报告：`supabase.from('reports').delete()`（RLS 校验 Admin 权限）
    - _需求: 4.1, 4.2, 4.3, 4.4, 5.1_

  - [ ]* 4.5 编写报告内容存储往返一致性属性测试
    - **Property 1: 报告内容存储往返一致性** — 验证 store(content) 后 get 返回的 content 与原始一致
    - **验证: 需求 4.1, 5.1**

  - [ ]* 4.6 编写报告元数据必填校验属性测试
    - **Property 9: 报告元数据必填校验** — 验证缺少标题/类型/时间段/Domain 时请求被拒绝
    - **验证: 需求 4.2, 12.4**

  - [ ]* 4.7 编写报告发布状态转换属性测试
    - **Property 10: 报告发布状态转换** — 验证草稿发布后状态变为 published 且出现在公开列表中
    - **验证: 需求 4.3, 4.4**

- [x] 5. 报告归档与搜索
  - [x] 5.1 实现报告归档列表与搜索功能
    - 前端通过 Supabase SDK 查询已发布报告列表：`.eq('status', 'published').order('published_at', { ascending: false })`
    - 实现类型筛选：`.eq('type', filterType)`
    - 实现全文搜索：通过 `supabase.rpc('search_reports', { search_query, domain_filter })` 调用 PostgreSQL 全文搜索函数
    - 实现分页：`.range(from, to)` 配合 `{ count: 'exact' }` 获取总数
    - _需求: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 5.2 编写报告归档时间排序属性测试
    - **Property 4: 报告归档时间排序** — 验证返回结果按 published_at 严格降序
    - **验证: 需求 2.1**

  - [ ]* 5.3 编写报告类型筛选属性测试
    - **Property 5: 报告类型筛选正确性** — 验证筛选后所有报告 type 与参数匹配
    - **验证: 需求 2.2**

  - [ ]* 5.4 编写报告搜索召回属性测试
    - **Property 6: 报告搜索召回** — 验证标题或内容中包含关键词的报告出现在搜索结果中
    - **验证: 需求 2.3**

  - [ ]* 5.5 编写报告列表数据完整性属性测试
    - **Property 2: 报告列表数据完整性** — 验证每份已发布报告包含 title, type, published_at, date_range 且不为空
    - **验证: 需求 1.1, 2.4**

- [x] 6. 检查点 — 确保报告模块测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 7. 热点新闻管理
  - [x] 7.1 实现新闻 CRUD（Supabase Client SDK + Edge Functions）
    - 创建 Supabase Edge Function `create-news`：校验必填字段（标题、正文、来源渠道、domain_id），存储到 news 表
    - 创建 Supabase Edge Function `publish-news`：为 Domain 下所有 Team_Member 创建通知
    - 前端通过 Supabase SDK 查询新闻列表：`.order('is_pinned', { ascending: false }).order('published_at', { ascending: false })`
    - 前端通过 Supabase SDK 查询新闻详情：`.eq('id', newsId).single()`
    - Admin 编辑新闻：`supabase.from('news').update()`（RLS 校验 Admin 权限）
    - Admin 删除新闻：`supabase.from('news').delete()`（RLS 校验 Admin 权限）
    - Admin 置顶/取消置顶：`supabase.from('news').update({ is_pinned: true/false })`
    - _需求: 8.1, 8.2, 8.3, 8.4, 3.1, 3.2, 3.3, 3.4_

  - [ ]* 7.2 编写新闻列表数据完整性属性测试
    - **Property 7: 新闻列表数据完整性** — 验证每条新闻包含 title, summary, source_channel, published_at 且不为空
    - **验证: 需求 3.2**

  - [ ]* 7.3 编写新闻排序规则属性测试
    - **Property 8: 新闻排序规则** — 验证置顶新闻排在前面，同状态内按时间降序
    - **验证: 需求 3.4, 8.4**

  - [ ]* 7.4 编写新闻必填字段校验属性测试
    - **Property 17: 新闻必填字段校验** — 验证缺少标题/正文/来源渠道/Domain 时请求被拒绝
    - **验证: 需求 8.1, 12.5**

  - [ ]* 7.5 编写新闻删除生效属性测试
    - **Property 18: 新闻删除生效** — 验证删除后的新闻不出现在列表中
    - **验证: 需求 8.3**

  - [ ]* 7.6 编写新闻详情完整性属性测试
    - **Property 30: 新闻详情完整性** — 验证新闻详情返回完整 content 且不为空
    - **验证: 需求 3.3**

- [-] 8. 多 Domain 支持
  - [-] 8.1 实现 Domain 管理
    - 前端通过 Supabase SDK 查询 Domain 列表：`supabase.from('domains').select('*')`
    - Admin 创建新 Domain：`supabase.from('domains').insert()`（RLS 校验 Admin 权限）
    - 确保所有报告和新闻查询均通过 `.eq('domain_id', currentDomainId)` 过滤
    - 前端 Domain 切换组件：更新 Context 中的 currentDomainId，触发数据重新加载
    - _需求: 12.1, 12.2, 12.3, 12.6_

  - [ ]* 8.2 编写跨 Domain 数据隔离属性测试
    - **Property 27: 跨 Domain 数据隔离** — 验证 Domain A 的报告/新闻不出现在 Domain B 的查询结果中
    - **验证: 需求 12.7**

  - [ ]* 8.3 编写新 Domain 初始化属性测试
    - **Property 28: 新 Domain 初始化** — 验证新 Domain 下报告/新闻/Dashboard 均返回空结果
    - **验证: 需求 12.6**

- [ ] 9. 通知系统（Supabase Realtime）
  - [ ] 9.1 实现通知服务与实时订阅
    - 通知创建逻辑在 Edge Functions 中实现（publish-report / publish-news 时批量创建通知记录）
    - 前端通过 Supabase SDK 查询通知列表：`supabase.from('notifications').select().eq('user_id', userId).order('created_at', { ascending: false })`
    - 前端通过 Supabase SDK 查询未读计数：`supabase.from('notifications').select('id', { count: 'exact' }).eq('user_id', userId).eq('is_read', false)`
    - 标记已读：`supabase.from('notifications').update({ is_read: true }).eq('id', notificationId)`
    - 全部标记已读：`supabase.from('notifications').update({ is_read: true }).eq('user_id', userId).eq('is_read', false)`
    - 实时订阅：`supabase.channel('user-notifications').on('postgres_changes', { event: 'INSERT', table: 'notifications', filter: 'user_id=eq.${userId}' }, callback).subscribe()`
    - _需求: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [ ]* 9.2 编写发布事件通知创建属性测试
    - **Property 21: 发布事件通知创建** — 验证发布报告/新闻后为每个 Team_Member 创建通知
    - **验证: 需求 10.1, 10.2**

  - [ ]* 9.3 编写未读通知计数准确性属性测试
    - **Property 22: 未读通知计数准确性** — 验证 unread-count 等于 is_read=false 的记录数
    - **验证: 需求 10.3**

  - [ ]* 9.4 编写通知时间排序属性测试
    - **Property 23: 通知时间排序** — 验证通知列表按 created_at 严格降序
    - **验证: 需求 10.4**

- [ ] 10. 检查点 — 确保后端所有模块测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 11. 前端基础框架与路由（Next.js App Router）
  - [x] 11.1 搭建 Next.js 应用骨架
    - 配置 App Router 路由结构：
      - `app/(auth)/login/page.tsx` — 登录页
      - `app/(main)/layout.tsx` — 主布局（含导航栏）
      - `app/(main)/dashboard/page.tsx` — Dashboard
      - `app/(main)/reports/page.tsx` — 报告归档
      - `app/(main)/reports/[id]/page.tsx` — 报告详情
      - `app/(main)/news/page.tsx` — 热点新闻
      - `app/(main)/news/[id]/page.tsx` — 新闻详情
      - `app/(main)/admin/page.tsx` — Admin 管理面板
      - `app/(main)/admin/reports/new/page.tsx` — 创建报告
      - `app/(main)/admin/news/new/page.tsx` — 创建新闻
    - 实现全局布局组件：顶部导航栏（含 Domain 切换、语言切换、通知图标、用户菜单）
    - 实现 `middleware.ts`：使用 `@supabase/ssr` 保护路由，未认证用户重定向到登录页
    - _需求: 6.1, 6.3, 12.2_

  - [x] 11.2 实现登录页面
    - 邮箱/密码表单
    - 调用 `supabase.auth.signInWithPassword()`
    - 显示登录错误信息（密码错误、速率限制等）
    - 登录成功后跳转到 Dashboard
    - _需求: 6.1, 6.5_

- [x] 12. 国际化（i18n）
  - [x] 12.1 配置 react-i18next 与语言包
    - 配置 `react-i18next`，创建 `public/locales/zh.json` 和 `public/locales/en.json` 语言包
    - 覆盖所有界面文本：导航菜单、按钮、标签、提示信息、错误消息
    - 实现 LanguageSwitcher 组件：切换语言并持久化到 localStorage + 更新 profiles 表 `language_preference`
    - 默认语言为中文
    - _需求: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [ ]* 12.2 编写语言包完整性属性测试
    - **Property 19: 语言包完整性** — 验证 zh 和 en 语言包中所有翻译键都存在且不为空
    - **验证: 需求 9.2**

  - [ ]* 12.3 编写语言偏好持久化往返属性测试
    - **Property 20: 语言偏好持久化往返** — 验证保存语言偏好后重新获取返回相同值
    - **验证: 需求 9.3**

- [x] 13. 报告渲染器与查看器
  - [x] 13.1 实现 ReportRenderer 组件
    - 将 `ReportContent` 结构化 JSON 渲染为 React 组件
    - 实现表格渲染组件（含 badge 风险标签：high/medium/low 颜色区分）
    - 实现分析区块渲染组件（引用区块、关键要点、影响标签）
    - 实现高亮框渲染组件
    - 应用 Amazon 品牌样式：CSS 变量 `--amazon-primary: #232f3e`, `--amazon-accent: #ff9900`, `--amazon-secondary: #146eb4`
    - 卡片式布局
    - _需求: 1.3, 5.2, 5.3, 5.4_

  - [x] 13.2 实现 ReportViewer 页面
    - 通过 Supabase SDK 获取报告数据：`supabase.from('reports').select().eq('id', params.id).single()`
    - Tab 导航对应 `modules` 数组，Tab 数量等于模块数量
    - Regular Report 固定渲染 4 个模块 Tab
    - Topic Report 动态渲染模块 Tab
    - 渲染失败时显示降级视图（格式化 JSON 文本）
    - _需求: 1.2, 1.4, 1.5, 1.6_

  - [ ]* 13.3 编写报告模块结构正确性属性测试
    - **Property 3: 报告模块结构正确性** — 验证 regular 报告渲染 4 个模块，topic 报告渲染所有模块
    - **验证: 需求 1.4, 1.5**

  - [ ]* 13.4 编写渲染器内容完整性属性测试
    - **Property 13: 渲染器内容完整性** — 验证渲染输出包含输入数据中的所有文字内容
    - **验证: 需求 5.2, 5.3, 5.4**

  - [ ]* 13.5 编写报告详情完整性属性测试
    - **Property 29: 报告详情完整性** — 验证详情返回完整 content 且 Tab 数量等于模块数量
    - **验证: 需求 1.2, 1.6**

- [x] 14. 报告归档前端页面
  - [x] 14.1 实现 ReportArchive 页面
    - 报告列表（时间倒序），显示标题、类型标签、时间段、发布日期
    - 类型筛选下拉框（全部/常规/专题）
    - 搜索输入框（通过 `supabase.rpc('search_reports')` 调用全文搜索）
    - 分页组件（使用 Supabase `.range()` 分页）
    - 点击报告跳转到 ReportViewer 详情页
    - _需求: 2.1, 2.2, 2.3, 2.4_

- [x] 15. 热点新闻前端页面
  - [x] 15.1 实现 HittingNews 页面
    - 新闻列表（置顶优先 + 时间倒序），显示标题、摘要、来源渠道标签、发布时间
    - 新闻详情页：展示完整正文内容
    - 点击新闻跳转到详情页
    - _需求: 3.1, 3.2, 3.3, 3.4_

- [x] 16. Admin 管理面板
  - [x] 16.1 实现 ContentEditor 组件
    - 按模块提供结构化输入表单：表格编辑器（支持行列动态增减）、分析区块编辑器、引用区块编辑器、风险指标编辑器、高亮框编辑器
    - 支持动态添加/删除模块
    - 实时预览功能：调用 ReportRenderer 渲染当前编辑内容
    - 提交前客户端校验必填字段（复用 ContentValidator）
    - _需求: 4.1, 4.5_

  - [x] 16.2 实现 AdminPanel 页面
    - 报告管理：创建报告（选择类型、填写元数据、通过 ContentEditor 录入内容）、草稿列表、发布操作（调用 Edge Function `publish-report`）
    - 新闻管理：创建/编辑/删除新闻、置顶操作
    - Domain 管理：查看 Domain 列表、创建新 Domain
    - 路由守卫：仅 Admin 角色可访问，Team_Member 显示权限不足提示
    - _需求: 4.1, 4.2, 4.3, 4.4, 8.1, 8.2, 8.3, 8.4, 12.1, 6.4_

- [x] 17. 检查点 — 确保前端核心页面功能正常
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 18. 通知前端组件
  - [x] 18.1 实现 NotificationUI 组件
    - 导航栏通知图标 + 未读数量角标
    - 点击展开通知下拉列表（按时间倒序）
    - 点击通知跳转到对应报告详情页或新闻详情页
    - 支持"全部标记已读"操作
    - 基于 Supabase Realtime 订阅实时更新未读角标（替代轮询）
    - _需求: 10.3, 10.4, 10.5, 10.6_

- [x] 19. Dashboard 主视角
  - [x] 19.1 实现 Dashboard 数据查询
    - 通过 Supabase SDK 查询当前 Domain 下近期 Regular Report 列表
    - 从最新 Regular Report 的 `content` JSONB 中提取 Module 1/Module 2 总结表数据
    - 通过 Supabase SDK 查询跨多期 Regular Report 的关键指标趋势数据点
    - 新报告发布后 Dashboard 数据自动反映最新内容（前端重新查询）
    - _需求: 11.1, 11.2, 11.3, 11.4, 11.5, 11.7_

  - [x] 19.2 实现 Dashboard 前端页面
    - 近期 Regular Report 列表（标题、时间段、发布日期），点击跳转详情页
    - 最新一期 Module 1 总结表（Top 封号原因、关键词、数量权重）
    - 最新一期 Module 2 总结表（下架原因类型、触发品类、数量）
    - Trend_View 图表组件（使用 Recharts 渲染折线图/柱状图）
    - _需求: 11.2, 11.3, 11.4, 11.5, 11.6_

  - [ ]* 19.3 编写 Dashboard 模块总结表提取属性测试
    - **Property 24: Dashboard 模块总结表提取** — 验证 Dashboard 返回最新报告 Module 1/2 总结表且数据一致
    - **验证: 需求 11.3, 11.4**

  - [ ]* 19.4 编写趋势数据跨期覆盖属性测试
    - **Property 25: 趋势数据跨期覆盖** — 验证趋势数据覆盖指定范围内所有已发布 Regular Report
    - **验证: 需求 11.5**

  - [ ]* 19.5 编写 Dashboard 自动更新属性测试
    - **Property 26: Dashboard 自动更新** — 验证新报告发布后 Dashboard 数据立即反映新内容
    - **验证: 需求 11.7**

- [x] 20. 响应式设计
  - [x] 20.1 实现响应式布局
    - 桌面端（≥ 1024px）：完整多列布局
    - 平板端（768px - 1023px）：自适应调整布局，保持可读性
    - 移动端（< 768px）：单列布局，表格支持横向滚动
    - 确保 ReportViewer 中的表格、卡片、Tab 导航在所有断点下正确渲染
    - 使用 Tailwind CSS 响应式工具类（`sm:`, `md:`, `lg:`）
    - _需求: 7.1, 7.2, 7.3, 7.4_

- [ ] 21. Vercel 部署配置
  - [ ] 21.1 配置 Vercel 部署
    - 连接 Git 仓库到 Vercel，配置自动部署（`git push` 触发）
    - 在 Vercel 环境变量中配置 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_ANON_KEY`
    - 验证所有页面和 Supabase 连接在生产环境正常工作
    - 确保错误处理链路完整：Supabase 错误 → 前端 Toast 通知
    - 确保认证流程完整：登录 → session 存储 → 自动附加 → 过期重定向
    - _需求: 全局_

- [ ] 22. 最终检查点 — 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

## 备注

- 标记 `*` 的任务为可选任务，可跳过以加速 MVP 交付
- 每个任务引用了具体的需求编号，确保可追溯性
- 检查点任务用于增量验证，确保每个阶段的代码质量
- 属性测试验证通用正确性属性，单元测试验证具体示例和边界情况
- 技术栈：Next.js (App Router) + React + TypeScript + Tailwind CSS，部署到 Vercel
- 后端：Supabase（托管 PostgreSQL + Auth + Realtime + Edge Functions），无需独立服务器
- 测试框架：Vitest + fast-check（属性测试）+ @testing-library/react
- Supabase 免费层：500MB 数据库、无限 API 请求、50,000 月活用户认证
