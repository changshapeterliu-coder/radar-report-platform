# Implementation Plan: Report Publish Email Distribution

## Overview

Only Half 2 — the platform trigger button — remains to build. Half 1 (the `send-report-email` skill and the patched `outlook-mcp-server` MCP) is already built and validated; it is context, not work. The remaining change is purely frontend: an admin-only button on the report detail page that opens a dialog showing a fixed Chinese instruction snippet and copies it to the clipboard. No backend, no database, no migration, no Inngest, no Resend. Implementation language is TypeScript (Next.js 16 / React client components), styled per `ui-design-system.md`, strings through `t()`.

## Already-done context (not tasks)

- **`send-report-email` skill** — `~/.kiro/skills/send-report-email/SKILL.md`. Resolves the report, pulls + dedups + rewrites content, drafts Option C HTML, gates on approval, opens Outlook via the MCP with `send_mode="display"`, appends the intent log. Source of truth; do not modify in this spec.
- **`outlook-mcp-server` MCP** — cloned to `~/.kiro/mcp-servers/`, configured in `.kiro/settings/mcp.json`, patched for `html=True` default, `bcc_email`, and `send_mode`. Requires desktop Outlook running. Do not modify in this spec.
- **Report detail page** — `src/app/(main)/reports/[id]/` already loads the full report row (so `report.status` is available) and the viewer client (`ReportViewerClient.tsx`) can read `useRole().isAdmin`. The header already hosts an actions row (the print button) to drop the new button beside.

## Tasks

- [x] 1. Add i18n strings for the email-report trigger
  - [x] 1.1 Add a `reports.emailReport.*` key group to `src/locales/en.ts` and `src/locales/zh.ts`
    - Keys: `button` ("Email this report" / "邮件发送此报告"), `dialogTitle`, `dialogHint` (one line explaining paste-into-Kiro), `copy` ("Copy" / "复制"), `copied` ("Copied" / "已复制"), `close`
    - The instruction snippet body itself stays a fixed Chinese string in the dialog component (it is an instruction to the skill, not UI chrome); only the dialog chrome goes through `t()`
    - _Requirements: 2.6_

- [x] 2. Build the copy-instruction dialog
  - [x] 2.1 Create `src/components/report/EmailInstructionDialog.tsx`
    - Client component following the existing modal pattern in `src/components/admin/ViewRawOutputModal.tsx`: fixed overlay, backdrop click + Escape close, body-scroll lock, `role="dialog"` + `aria-modal`
    - Props: `{ reportId: string; title: string; onClose: () => void }`
    - Build the instruction snippet: `用 send-report-email skill 把报告 {reportId}（{title}）发邮件出去，收件人默认 radar-report-ah@amazon.com，其他收件人我待会儿告诉你`
    - Render the snippet in a read-only block; one primary "复制" button using `navigator.clipboard.writeText(snippet)` with a 2s "已复制" confirmation (mirror the copied-state pattern in `ViewRawOutputModal`)
    - Tokens only (`bg-card`, `border-border`, `text-foreground`), lucide icons (`Copy` / `Check`), `shadow-md` for the elevated modal per `ui-design-system.md`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.3_

- [x] 3. Build the trigger button with admin + published gating
  - [x] 3.1 Create `src/components/report/EmailReportButton.tsx`
    - Client component. Props: `{ reportId: string; title: string; status: string }`
    - Read `useRole()`; render nothing unless `isAdmin === true` AND `status === 'published'` (Req 1.1–1.4) — reuse the existing role hook and the passed-in status; no new auth
    - `outline`/`sm` button matching the adjacent "Export PDF" button, lucide `Mail` icon, label via `t('reports.emailReport.button')`
    - Local `open` state; clicking opens `EmailInstructionDialog`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.1_

- [x] 4. Wire the button into the report detail header
  - [x] 4.1 Add `<EmailReportButton>` to the header actions row in `src/app/(main)/reports/[id]/ReportViewerClient.tsx`
    - Place it beside the existing "Export PDF" button in the `flex … items-center gap-2` actions div
    - Pass `reportId={report.id}`, `title={report.title}`, `status={report.status}`
    - No change to `page.tsx` or `loaders.ts` — the loaded report row already carries `id`, `title`, and `status`
    - _Requirements: 1.1, 1.5, 3.1_

- [ ] 5. Verify build, diagnostics, and gating
  - [x] 5.1 Run `getDiagnostics` on the three touched/created files; resolve any errors
    - `EmailInstructionDialog.tsx`, `EmailReportButton.tsx`, `ReportViewerClient.tsx`
  - [x] 5.2 Run `npm run build`; confirm it passes
  - [ ] 5.3 Manual smoke test of the gating and clipboard
    - As admin on a published report: button visible; click → dialog shows snippet with correct `report_id` + title; "复制" copies the exact string and shows "已复制"
    - As admin on a non-published report: button hidden (Req 1.2)
    - As a non-admin (team_member) on a published report: button hidden (Req 1.3)
    - Backdrop click, Esc, and close all dismiss the dialog (Req 2.5)
    - Toggle language; dialog chrome switches zh/en (Req 2.6)
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.4, 2.5, 2.6_

## Notes

- Half 1 (skill + MCP) is already built and validated; this plan covers only Half 2 (the platform button). No tasks touch the skill, the MCP, or any backend.
- There is no migration, no Inngest resync, and no new env var for this work — it is a frontend-only change. The only platform side effect is a normal deploy (Vercel picks up the commit).
- No property-based tests: the change is small and frontend-only. Verification is build + diagnostics + the manual gating/clipboard smoke test in task 5.3.
- The skill's own prerequisites (desktop Outlook running, MCP connected, `.env.local` keys) are documented in the design's Manual Activation Steps and are not part of this build.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["3.1"] },
    { "id": 2, "tasks": ["4.1"] },
    { "id": 3, "tasks": ["5.1", "5.2", "5.3"] }
  ]
}
```

i18n strings (1.1) and the dialog (2.1) are independent and can land together. The button (3.1) depends on the dialog. Wiring (4.1) depends on the button. Verification (5.x) runs last.
