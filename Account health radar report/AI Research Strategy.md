# Radar Report AI Research Strategy

## 最强质量方案（不计成本）

### 多 AI 并行 + 交叉验证架构

**流程**：
```
用户提交 topic
    ↓
并行调用 4 个 AI 各自做 research：
  - Gemini 2.5 Pro Deep Research  → 覆盖 Google 索引中文+英文
  - Kimi Explore / 通义千问 Qwen  → 覆盖小红书/抖音/知乎/微博深层
  - OpenAI Deep Research (o3)     → 深度推理 + Reddit + 英文
  - Perplexity Pro Deep Research  → fact-check + 引用链接
    ↓
各自返回 raw findings + 引用源
    ↓
GPT-4o / Claude Opus 做最终综合：
  - 去重
  - 识别共识与冲突
  - 按 radar report structure 填充
  - 标注每个 finding 的来源置信度
    ↓
生成 draft report
```

### AI Research Engine 对比

| 引擎 | 知无不言/卖家之家 | 小红书 | 抖音 | 跨境媒体 | Reddit | 推理能力 |
|---|---|---|---|---|---|---|
| **Gemini 2.5 Pro Deep Research** | 🟢 好 | 🟡 中 | 🔴 差 | 🟢 好 | 🟢 好 | ⭐⭐⭐⭐ |
| **Kimi Explore** | 🟢🟢 极好 | 🟢 好 | 🟡 中 | 🟢 好 | 🔴 差 | ⭐⭐⭐ |
| **OpenAI Deep Research (o3)** | 🟡 中 | 🔴 差 | 🔴 差 | 🟢 好 | 🟢🟢 极好 | ⭐⭐⭐⭐⭐ |
| **Perplexity Sonar Pro** | 🟡 中 | 🔴 差 | 🔴 差 | 🟢 好 | 🟢 好 | ⭐⭐⭐ |
| **通义千问 Qwen-Max** | 🟢 好 | 🟢 好 | 🟡 中 | 🟢 好 | 🔴 差 | ⭐⭐⭐ |
| **DeepSeek V3 + 联网** | 🟢 好 | 🟡 中 | 🔴 差 | 🟢 好 | 🟡 中 | ⭐⭐⭐⭐ |

### 关键价值
- 每个 AI 覆盖的盲区不同，合起来接近全网
- 交叉验证可以标记 "3 个 AI 都提到的高置信度信号" vs "只 1 个 AI 提到的需验证"
- 引用来源透明，admin 可以追溯
- 预计 radar report 质量比单一工具提升 30-50%

### 渠道盲区 fallback
- 小红书登录内容、抖音视频：任何 API 方案都有限
- 解决方案：保留 Admin 手动粘贴入口补充

### 单引擎退回方案
如果必须选一个：**Gemini 2.5 Pro Deep Research**
- 中文内容覆盖最全
- 推理质量接近 OpenAI
- Grounding 引用最清晰
- 对跨境电商这种中文垂直领域，Google 索引深度 > Bing / 百度
