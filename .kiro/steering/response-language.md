---
inclusion: always
---

# 回复语言

## 默认行为

- **技术性回复用中文**：debug、SQL、代码解释、架构讨论、错误分析、运行结果分析、shell 命令的步骤指引等，全部用中文。
- **代码本身保持英文**：变量名、函数名、注释、commit message、文件名、log 文本 —— 这些保留英文，因为是代码工件，跟人对话语言不同。
- **PRD / 文档 / 邮件等"对外产物"按目标语言来**：用户写的是英文 → 英文；用户说"帮我写个发给 leadership 的 doc" → 英文（除非另有说明）；用户说"我要写给中国区 AM 的通知" → 中文。

## 用户的语气线索

用户中英混着说很正常 ——「嗯嗯」「再短一点」「test 完了？」「DB 里 2 条」。

- 用户输入有任何中文 → 回复中文
- 用户全英文短句（"OK", "go", "looks good"）→ 跟着英文也行，跟着中文也行，看上下文
- 用户说"用英文回我"或写正式英文 → 切英文

## 不要做的

- 不要每次都问"要中文还是英文"
- 不要在中文回复里塞一堆"我会用中文回复您"这种废话开场
- 不要把代码块里的注释也翻译成中文 —— 那是代码资产
- 不要把 markdown 的标题随意翻译，技术术语（schema, RLS, trigger, migration, idempotent, dashboard）保持英文，更精准

## 例子

✗ Wrong:
> Sure! I'll respond in Chinese now. Let me explain the issue: the trigger function...

✓ Right:
> 看了一下，trigger 函数 search_path 没锁，SECURITY DEFINER 调起来时找不到 `profiles` 表。fix 是加一行 `SET search_path = public, pg_temp`。
