# 需求文档：雷达报告平台 (Radar Report Platform)

## 简介

雷达报告平台旨在替代当前基于邮件分发的亚马逊中国卖家账户健康雷达报告流程。该平台将提供一个集中化的 Web 界面，供团队成员浏览热点新闻（Hitting News）、查看历史报告、管理报告发布，从而提升报告的可访问性和团队协作效率。

平台需支持两种报告类型：常规雷达报告（Regular Radar Report，包含4个固定模块）和专题报告（Specific Topic Report，针对 AHA、PRA、CA/BR KYC 等特定主题）。报告内容以英文呈现，平台界面支持中英文切换。

平台首页提供 Dashboard 主视角，汇总展示近期常规报告列表、关键模块总结表及跨期趋势变化。平台采用多 Domain 架构，当前以 Account Health 为首个 Domain，后续可扩展 Compliance 等其他 Domain，每个 Domain 拥有独立的报告和热点新闻。当新报告或新热点新闻发布时，平台将通知相关团队成员。

## 术语表

- **Platform（平台）**: 雷达报告 Web 平台系统
- **Report_Viewer（报告查看器）**: 负责渲染和展示报告内容的前端组件
- **Report_Manager（报告管理器）**: 负责报告上传、编辑、发布的后台管理模块
- **Regular_Report（常规报告）**: 包含4个固定模块的周期性雷达报告（封号趋势分析、下架商品分析、教育方案矩阵、工具反馈）
- **Topic_Report（专题报告）**: 针对特定主题（如 AHA、PRA、CA/BR KYC）的深度分析报告
- **Hitting_News（热点新闻）**: 平台首页展示的行业热点/趋势新闻板块
- **Content_Editor（内容编辑器）**: 供管理员输入和编辑报告结构化内容的表单组件
- **Report_Renderer（报告渲染器）**: 将结构化报告数据渲染为可视化页面的组件
- **Team_Member（团队成员）**: 平台的普通用户，可浏览报告和热点新闻
- **Admin（管理员）**: 拥有报告上传、编辑、发布权限的用户
- **Report_Archive（报告归档）**: 存储和管理历史报告的系统模块
- **Language_Switcher（语言切换器）**: 负责平台界面中英文切换的组件
- **Notification_Service（通知服务）**: 负责在新报告或新热点新闻发布时通知团队成员的服务模块
- **Dashboard（仪表盘）**: 平台首页的主视角，汇总展示近期报告、关键模块总结和趋势变化
- **Domain（领域）**: 平台的业务领域分类单元（如 Account Health、Compliance），每个 Domain 拥有独立的报告和热点新闻
- **Trend_View（趋势视图）**: 展示跨多期报告数据趋势变化的可视化组件

## 需求

### 需求 1：报告浏览与展示

**用户故事：** 作为团队成员，我希望在平台上浏览和阅读雷达报告，以便不再依赖邮件获取报告内容。

#### 验收标准

1. THE Platform SHALL 在首页展示最新发布的报告列表，包含报告标题、类型标签（常规/专题）和发布日期
2. WHEN Team_Member 点击某份报告时，THE Report_Viewer SHALL 以完整页面展示该报告的全部内容
3. THE Report_Viewer SHALL 保留现有报告的 Amazon 品牌样式，包括配色方案（#232f3e 主色、#ff9900 强调色、#146eb4 辅助色）和卡片式布局
4. WHEN 展示 Regular_Report 时，THE Report_Viewer SHALL 按顺序渲染4个模块：封号趋势分析、下架商品分析、教育方案矩阵、工具反馈
5. WHEN 展示 Topic_Report 时，THE Report_Viewer SHALL 根据专题类型渲染对应的分析内容结构
6. THE Report_Viewer SHALL 提供模块间导航标签（tabs），允许 Team_Member 在报告模块之间快速跳转

### 需求 2：历史报告归档与检索

**用户故事：** 作为团队成员，我希望查看和搜索历史报告，以便追踪账户健康趋势的变化。

#### 验收标准

1. THE Report_Archive SHALL 按时间倒序展示所有已发布报告的列表
2. WHEN Team_Member 选择按报告类型筛选时，THE Report_Archive SHALL 仅展示对应类型（常规报告或专题报告）的报告
3. WHEN Team_Member 输入搜索关键词时，THE Report_Archive SHALL 在报告标题和内容中进行匹配并返回结果
4. THE Report_Archive SHALL 为每份报告显示报告时间段（如 "Feb 01 to Mar 03, 2026"）、报告类型和发布日期

### 需求 3：热点新闻板块

**用户故事：** 作为团队成员，我希望在平台上浏览行业热点新闻（Hitting News），以便快速了解当前卖家关注的热门话题。

#### 验收标准

1. THE Platform SHALL 在首页设置独立的 Hitting_News 板块，展示当前热点新闻列表
2. THE Hitting_News 板块 SHALL 为每条新闻显示标题、摘要、来源渠道和发布时间
3. WHEN Team_Member 点击某条新闻时，THE Platform SHALL 展示该新闻的完整内容
4. WHEN Admin 发布新的热点新闻时，THE Hitting_News 板块 SHALL 将新内容置顶显示

### 需求 4：报告管理（内容录入与发布）

**用户故事：** 作为管理员，我希望能够通过结构化表单直接录入报告文字内容并发布，以便团队成员及时获取最新报告。

#### 验收标准

1. WHEN Admin 创建新报告时，THE Report_Manager SHALL 提供结构化内容编辑表单，允许 Admin 按模块逐一录入文字内容（表格数据、分析区块、引用区块、风险指标等）
2. THE Report_Manager SHALL 要求 Admin 为每份报告填写元数据：报告标题、报告类型（常规/专题）、报告时间段、所属 Domain
3. WHEN Admin 点击发布按钮时，THE Report_Manager SHALL 将报告状态设为已发布，并使其在平台前端可见
4. THE Report_Manager SHALL 支持报告的草稿状态，允许 Admin 保存未完成的报告后续继续编辑
5. IF Admin 提交的报告内容缺少必要的模块或字段，THEN THE Report_Manager SHALL 显示校验错误提示并拒绝提交

### 需求 5：报告内容结构化存储与渲染

**用户故事：** 作为团队成员，我希望管理员录入的报告内容能被正确存储和展示，以便在平台上获得美观、一致的阅读体验。

#### 验收标准

1. WHEN Admin 通过内容编辑表单提交报告内容时，THE Platform SHALL 将内容以结构化 JSON 格式存储到数据库中
2. THE Report_Renderer SHALL 将结构化报告 JSON 数据渲染为具有 Amazon 品牌样式的可视化页面
3. THE Report_Renderer SHALL 正确渲染报告中的表格、分析区块、风险指标标签、引用区块和评分组件
4. FOR ALL 有效的结构化报告 JSON 数据，渲染后 SHALL 包含所有录入的文字内容且不丢失任何数据
5. IF 结构化报告 JSON 数据格式不符合预期 schema，THEN THE Platform SHALL 返回描述性错误信息，指明校验失败的字段和原因

### 需求 6：用户认证与权限控制

**用户故事：** 作为管理员，我希望平台具备用户认证和权限控制，以便确保只有授权人员可以管理报告内容。

#### 验收标准

1. THE Platform SHALL 要求用户登录后才能访问平台内容
2. THE Platform SHALL 区分两种角色：Team_Member（只读浏览）和 Admin（报告管理权限）
3. WHEN 未认证用户尝试访问平台页面时，THE Platform SHALL 将用户重定向到登录页面
4. WHEN Team_Member 尝试访问报告管理功能时，THE Platform SHALL 拒绝访问并显示权限不足提示
5. IF 用户连续输入错误密码超过5次，THEN THE Platform SHALL 锁定该账户15分钟

### 需求 7：响应式设计

**用户故事：** 作为团队成员，我希望在不同设备上都能正常浏览报告，以便在移动端也能查看内容。

#### 验收标准

1. THE Platform SHALL 在桌面端（宽度 ≥ 1024px）以完整布局展示所有内容
2. WHILE 在平板设备（宽度 768px 至 1023px）上访问时，THE Platform SHALL 自适应调整布局，保持内容可读性
3. WHILE 在移动设备（宽度 < 768px）上访问时，THE Platform SHALL 将多列布局转为单列，表格支持横向滚动
4. THE Report_Viewer SHALL 在所有支持的设备宽度下正确渲染报告中的表格、卡片和导航标签

### 需求 8：热点新闻管理

**用户故事：** 作为管理员，我希望能够创建、编辑和管理热点新闻，以便保持平台内容的时效性。

#### 验收标准

1. WHEN Admin 创建新的热点新闻时，THE Platform SHALL 要求填写标题、正文内容、来源渠道（如知无不言、抖音、小红书、36氪、AMZ123、义恩网络等）
2. THE Platform SHALL 允许 Admin 编辑已发布的热点新闻内容
3. WHEN Admin 删除某条热点新闻时，THE Platform SHALL 从前端列表中移除该新闻
4. THE Platform SHALL 支持为热点新闻设置置顶状态，置顶新闻始终显示在列表顶部

### 需求 9：中英文语言切换

**用户故事：** 作为团队成员，我希望能够在中文和英文之间切换平台界面语言，以便根据个人偏好使用平台。

#### 验收标准

1. THE Platform SHALL 在页面顶部导航区域提供 Language_Switcher 组件，支持中文和英文两种界面语言
2. WHEN Team_Member 通过 Language_Switcher 选择目标语言时，THE Platform SHALL 将所有界面元素（导航菜单、按钮文字、标签、提示信息）切换为对应语言
3. THE Platform SHALL 在用户切换语言后持久化保存该语言偏好，下次登录时自动应用
4. WHEN 切换界面语言时，THE Platform SHALL 保持当前页面状态和内容不变，仅更新界面文本
5. THE Platform SHALL 默认使用中文作为界面语言

### 需求 10：通知功能

**用户故事：** 作为团队成员，我希望在新报告发布或新热点新闻发布时收到通知，以便及时获取最新信息。

#### 验收标准

1. WHEN Admin 发布新的报告时，THE Notification_Service SHALL 向所有 Team_Member 发送通知，包含报告标题、类型和发布时间
2. WHEN Admin 发布新的热点新闻时，THE Notification_Service SHALL 向所有 Team_Member 发送通知，包含新闻标题和摘要
3. THE Platform SHALL 在页面顶部导航区域显示通知图标，并以未读数量角标标示未读通知数
4. WHEN Team_Member 点击通知图标时，THE Platform SHALL 展示通知列表，按时间倒序排列
5. WHEN Team_Member 点击某条通知时，THE Platform SHALL 跳转到对应的报告详情页或新闻详情页
6. THE Notification_Service SHALL 支持站内通知方式，通知内容在平台内可查阅

### 需求 11：Dashboard 主视角

**用户故事：** 作为团队成员，我希望在首页看到一个 Dashboard 视角，以便快速掌握近期报告概况和关键数据趋势。

#### 验收标准

1. THE Dashboard SHALL 作为平台首页的主视角，展示当前 Domain 下的汇总信息
2. THE Dashboard SHALL 展示过去数周的 Regular_Report 列表，包含报告标题、时间段和发布日期
3. THE Dashboard SHALL 展示最新一期 Regular_Report 中 Module 1（封号趋势分析）的总结表，包含 Top 封号原因、关键词和数量权重
4. THE Dashboard SHALL 展示最新一期 Regular_Report 中 Module 2（下架商品分析）的总结表，包含下架原因类型、触发品类和数量
5. THE Dashboard SHALL 提供 Trend_View 组件，以图表形式展示跨多期报告的关键指标趋势变化（如封号数量趋势、下架数量趋势）
6. WHEN Team_Member 点击 Dashboard 上的某份报告时，THE Platform SHALL 跳转到该报告的详情页
7. WHEN 新的 Regular_Report 发布时，THE Dashboard SHALL 自动更新总结表和趋势图表数据

### 需求 12：多 Domain 支持

**用户故事：** 作为管理员，我希望平台支持多个业务领域（Domain），以便后续扩展 Compliance 等其他领域的报告和新闻管理。

#### 验收标准

1. THE Platform SHALL 支持多个 Domain 的注册和管理，当前默认 Domain 为 "Account Health"
2. THE Platform SHALL 在导航区域提供 Domain 切换入口，允许 Team_Member 在不同 Domain 之间切换
3. WHEN Team_Member 切换到某个 Domain 时，THE Platform SHALL 仅展示该 Domain 下的报告、热点新闻和 Dashboard 数据
4. THE Report_Manager SHALL 要求 Admin 在上传报告时指定该报告所属的 Domain
5. THE Platform SHALL 要求 Admin 在创建热点新闻时指定该新闻所属的 Domain
6. WHEN Admin 创建新的 Domain 时，THE Platform SHALL 为该 Domain 初始化独立的报告列表、热点新闻板块和 Dashboard 视图
7. THE Platform SHALL 确保不同 Domain 之间的数据相互隔离，某个 Domain 下的报告和新闻不会出现在其他 Domain 中
