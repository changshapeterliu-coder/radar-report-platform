# Requirements Document

## Introduction

The Radar Report platform serves the WWGS Seller Compliance AM team — roughly 20,000 mid- and long-tail sellers supported by internal Account Managers (AMs) who read reports on the platform. When a report is published, the platform already creates an in-app notification automatically. There is no email path. An admin who wants to make sure the AH distribution list actually sees a newly published report has to ping people by hand.

This feature adds a manual, admin-driven email channel that sits alongside (not replacing) the in-app publish notification. The email goes out from the admin's own desktop Outlook as their `@amazon.com` identity — internal Exchange to internal Exchange, so it lands in the inbox. There is no external email service, no domain to verify, and no server-side sending. The default audience is the Account Health distribution list (`radar-report-ah@amazon.com`), addressed by Bcc.

The work splits into two halves:

- **Half 1 — the `send-report-email` Kiro skill (already built).** The skill drives the whole send from inside Kiro: it resolves a published report from Supabase, pulls its content, drafts a bilingual newspaper-style email, shows the draft for approval, opens it in the admin's Outlook through the local `outlook-mcp-server` MCP, and the admin clicks Send. This spec documents the skill; `~/.kiro/skills/send-report-email/SKILL.md` is the source of truth for its internals.
- **Half 2 — the platform trigger button (to be built).** A small admin-only affordance on the report detail page that hands the report to the skill. It is purely frontend: it shows a fixed Chinese instruction string with the report id and title pre-filled and copies it to the clipboard. The admin pastes it into Kiro and the skill takes over.

The two halves are connected by copy-paste, not by full automation. There is no public Kiro entry point that lets a web URL inject an agent prompt and run a skill (see Design and Future Considerations). Copy-paste is the pragmatic MVP: one button, one paste.

Bilingual content is a first-class concern (Principle 3). The email chrome (masthead, dateline, CTA, disclaimer) is English; the news items are bilingual — an English headline and line plus a Chinese line. All copy is rewritten and humanized, never pasted raw from the database.

## Glossary

- **Skill**: The `send-report-email` Kiro skill. Runs inside Kiro, drives the fetch → draft → approval → Outlook-compose → log flow. Defined by `~/.kiro/skills/send-report-email/SKILL.md`.
- **Trigger button**: The "Email this report" button rendered on the report detail page (`/reports/[id]`). Visible only to an admin viewing a published report.
- **Instruction snippet**: The fixed Chinese text string the trigger dialog generates, with `{report_id}` and `{title}` filled in. The admin copies it and pastes it into Kiro to start the skill.
- **Trigger dialog**: The modal opened by the trigger button. Shows the instruction snippet and a copy-to-clipboard button.
- **outlook-mcp-server**: The local Windows MCP server (a win32COM bridge to desktop Outlook, cloned from `marlonluo2018/outlook-mcp-server` to `~/.kiro/mcp-servers/`, configured in `.kiro/settings/mcp.json`). Patched to add an `html=True` default, a `bcc_email` param, and a `send_mode` param. Requires desktop Outlook to be running.
- **Compose window**: The Outlook message window the skill opens, pre-filled with To, Bcc, subject, and HTML body. The admin reviews it and clicks Send.
- **send_mode=display**: The `compose_email_tool` argument the skill always passes. It opens the compose window instead of sending. The admin does the actual send. The other modes (`draft`, `send`) exist but the skill does not use `send` for this flow.
- **AH DL**: The Account Health distribution list, `radar-report-ah@amazon.com`. The default Bcc recipient.
- **Option C template**: The locked, Outlook-safe HTML/VML email layout the skill renders — dark masthead, warm intro, orange numbered items, a VML-rounded CTA button, and a simplified disclaimer.
- **Intent log**: The local append-only file `.kiro/logs/report-email-sends.jsonl`. One line per compose, recording `result: "opened"` (the admin does the actual send).
- **Admin**: A platform user with role `admin`. The only role that sees the trigger button and runs the skill.
- **AM**: Account Manager — an internal WWGS Seller Compliance team member who reads reports. AMs are recipients, not senders.
- **Publish flow**: The existing report publish path that flips a report to `status = published` and creates the in-app notification. This feature never touches it.

## Requirements

### Requirement 1: Trigger button visibility

**User Story:** As an admin, I want an "Email this report" action on a published report's detail page, so that I can hand the report to the skill without leaving the report.

#### Acceptance Criteria

1. WHERE the report's `status` is `published` AND the viewer's role is `admin`, THE report detail page SHALL render the trigger button in the page header.
2. WHERE the report's `status` is not `published`, THE report detail page SHALL NOT render the trigger button.
3. WHERE the viewer's role is not `admin`, THE report detail page SHALL NOT render the trigger button.
4. THE trigger button SHALL reuse the platform's existing role check (`useRole().isAdmin`) and the report row's existing `status` field, and SHALL NOT introduce a new authorization mechanism.
5. WHEN the admin clicks the trigger button, THE feature SHALL open the trigger dialog anchored to the current report.

### Requirement 2: Copy-instruction dialog

**User Story:** As an admin, I want the dialog to give me a ready-to-paste instruction with the report already identified, so that I do not have to remember the report id or how to phrase the request to the skill.

#### Acceptance Criteria

1. WHEN the trigger dialog opens, THE feature SHALL display a fixed Chinese instruction snippet with the current report's `report_id` and `title` substituted in.
2. THE instruction snippet SHALL name the `send-report-email` skill, state the report id and title, and state that the default recipient is `radar-report-ah@amazon.com` with other recipients to be given later, for example: 「用 send-report-email skill 把报告 {report_id}（{title}）发邮件出去，收件人默认 radar-report-ah@amazon.com，其他收件人我待会儿告诉你」.
3. THE trigger dialog SHALL render a "复制" (copy) control.
4. WHEN the admin activates the copy control, THE feature SHALL write the exact rendered instruction snippet to the clipboard and SHALL give a visible confirmation that the text was copied.
5. THE trigger dialog SHALL be dismissable by a close control, by clicking the backdrop, and by the Escape key, consistent with the platform's existing modal behavior.
6. THE feature SHALL follow `ui-design-system.md`: a single primary action, design-system tokens, lucide icons, and all static strings through `t()` so the dialog renders in both Chinese and English.

### Requirement 3: Frontend-only trigger

**User Story:** As the platform owner, I want the trigger to be pure frontend, so that the email channel adds no backend surface, no database, and no new operational dependency to the platform.

#### Acceptance Criteria

1. THE trigger button and dialog SHALL be implemented entirely on the client.
2. THE feature SHALL NOT add a backend route, a database table, a database migration, an Inngest function, or an external email integration to the platform.
3. THE feature's only side effect SHALL be generating the instruction snippet and writing it to the clipboard.

### Requirement 4: Skill resolves a published report

**User Story:** As an admin, I want the skill to act only on a real published report, so that I never email a draft or a report that does not exist.

#### Acceptance Criteria

1. WHEN the skill receives an instruction snippet, THE skill SHALL resolve the report from Supabase by `report_id`.
2. WHERE the resolved report's `status` is not `published`, THE skill SHALL stop and report that the report is not published, and SHALL NOT open a compose window.
3. THE skill SHALL support both report types — `regular` and `topic` — and SHALL choose the matching content layout for each.
4. IF the `report_id` resolves to more than one candidate or to none, THEN THE skill SHALL list what it found and ask the admin to confirm before continuing.

### Requirement 5: Bilingual, rewritten content

**User Story:** As an internal AM, I want the email to read like a short briefing in both languages, so that I get the signal without translating or wading through raw database text.

#### Acceptance Criteria

1. WHEN the skill drafts the email, THE chrome (masthead, dateline, kicker, intro, CTA label, disclaimer) SHALL be in English.
2. WHEN the skill drafts a news item, THE item SHALL be bilingual — a rewritten English headline and line plus a rewritten Chinese line.
3. THE skill SHALL rewrite (humanize) the source content and SHALL NOT paste raw database titles or summaries into the email.
4. WHERE the report is `regular`, THE skill SHALL pull the AI Insight news rows for the report's domain and SHALL deduplicate near-duplicate topics down to roughly three distinct topics, keeping the strongest or most recent item per topic.
5. WHERE the report is `topic`, THE skill SHALL use the Executive Summary opening as the lead and the remaining section titles as the numbered items.
6. WHERE a `regular` report has fewer than three distinct news topics, THE skill SHALL fill the remaining numbered items with the report's section titles so the email stays full.

### Requirement 6: Option C template structure

**User Story:** As an admin, I want every email to use the same locked, Outlook-safe layout, so that it renders correctly in desktop Outlook and looks consistent edition to edition.

#### Acceptance Criteria

1. THE rendered email SHALL follow the Option C structure: a dark masthead bar, a warm intro line, orange numbered items (1 / 2 / 3) each with an English headline, an English line, and a Chinese line, a CTA band, and a simplified disclaimer.
2. THE CTA band SHALL contain a button labelled "Read the full edition" whose link target is the platform report page `https://radar-report-platform.vercel.app/reports/{report_id}`.
3. THE CTA button SHALL use the VML dual-path technique so desktop Outlook (Word engine) renders a rounded orange button, and the document head SHALL include the `xmlns:v` / `xmlns:o` namespaces and the MSO `OfficeDocumentSettings` block required for VML to render.
4. THE template SHALL use inline styles and table-based layout only — no flexbox, no SVG, and no external images — so it survives the Outlook rendering engine.
5. THE disclaimer SHALL state that the content is AI-generated from public sources, for Amazon internal reference only, to be verified before acting on, and not for external sharing.

### Requirement 7: Default Bcc-to-DL semantics

**User Story:** As an admin, I want the default send to be one email Bcc'd to the AH distribution list, so that the list gets the report without exposing a long recipient list or fanning out replies.

#### Acceptance Criteria

1. WHEN the skill prepares the default send, THE `To` field SHALL be the admin's own address (`chenliua@amazon.com`) so the message is not empty-To.
2. WHEN the skill prepares the default send, THE `Bcc` field SHALL be `radar-report-ah@amazon.com` plus any extra addresses the admin supplies, and THE `Cc` field SHALL be empty.
3. WHERE the send uses the default Bcc-to-DL model, THE greeting SHALL be generic ("Hi team") and SHALL NOT include a per-person salutation.
4. THE skill SHALL provide a per-person individual-send mode as an explicit exception, used only when the admin asks for individual named sends; this mode resolves each recipient's address and sends one compose per recipient.

### Requirement 8: The admin clicks Send — the skill never auto-sends

**User Story:** As an admin, I want to review the email in Outlook and click Send myself, so that I stay in control of what actually leaves my mailbox.

#### Acceptance Criteria

1. WHEN the skill is ready to send, THE skill SHALL call the Outlook MCP `compose_email_tool` with `send_mode = "display"`, which opens a pre-filled compose window and does not send.
2. THE skill SHALL NOT call the compose tool with `send_mode = "send"` for this flow, and the compose tool SHALL NOT be auto-approved.
3. WHEN the compose window is open, THE skill SHALL tell the admin that the email is open in Outlook for review and SHALL NOT claim the email has been sent.
4. WHILE awaiting the admin's approval of the draft, THE skill SHALL NOT call the compose tool; the approval gate SHALL precede every compose call.

### Requirement 9: Desktop Outlook prerequisite

**User Story:** As an admin, I want the skill to check that Outlook is running before it tries to compose, so that I get a clear message instead of a confusing failure.

#### Acceptance Criteria

1. BEFORE attempting any compose, THE skill SHALL verify that desktop Outlook is running.
2. IF desktop Outlook is not running, THEN THE skill SHALL stop and tell the admin to open Outlook, and SHALL NOT attempt a compose call.
3. THE skill SHALL depend on the `outlook-mcp-server` MCP being connected, as configured in `.kiro/settings/mcp.json`.

### Requirement 10: Intent log

**User Story:** As an admin, I want a local record of each compose I opened, so that I have a lightweight trail of what was emailed and when.

#### Acceptance Criteria

1. WHEN the skill opens a compose window, THE skill SHALL append one JSON line to `.kiro/logs/report-email-sends.jsonl`.
2. THE log line SHALL include a timestamp, the `report_id`, the report title, the recipient descriptor, the language, and a `result` field.
3. THE `result` field SHALL be `"opened"` when the compose window is shown (since the admin performs the actual send) or `"failed"` with an error when the compose call fails.
4. THE feature SHALL NOT persist send records in any database table; the intent log is the only persistence.

### Requirement 11: Independence from the publish flow

**User Story:** As a publishing admin, I want publishing to stay exactly as it is, so that emailing a report is always a separate, deliberate action and never a side effect of publishing.

#### Acceptance Criteria

1. WHEN a report transitions to `status = published`, THE feature SHALL NOT send, queue, or trigger any email.
2. WHEN a report transitions to `status = published`, THE platform SHALL continue to create the existing in-app notification using the current publish-side logic, unchanged.
3. THE email channel SHALL be reachable only through the admin clicking the trigger button and running the skill; there SHALL be no automatic path from publish to email.

## Future Considerations

Out of scope for the MVP, recorded so future work has a clear starting point:

- **Full-auto deep-link (web → Kiro → skill).** A one-click path where the platform launches Kiro and injects the skill prompt with no copy-paste. Kiro's `kiro://` protocol only exposes the authorities `kiro.oauth`, `kiro.mcp`, `kiro.powers`, `kiro.repo`, and `kiro.resume-session` — none of which inject an agent prompt or run a skill. Achieving this would require building and distributing a custom VS Code extension that every admin installs (a separate software project). The `kiro chat` CLI can run a prompt headlessly, but a browser cannot invoke a local CLI from its sandbox. Revisit if Kiro exposes an agent deep-link or prompt-injection entry point.
- **Per-domain auto-send lists.** A saved distribution list per domain that the skill (or a future automated path) targets without the admin typing recipients each time.
- **Open and click tracking.** Recording who opened the email and who clicked the CTA. The local Outlook send path has no tracking; this would need a different delivery mechanism.
- **External recipients.** Sending to addresses outside Amazon Exchange. The internal-Exchange-to-internal-Exchange deliverability that makes this MVP work does not extend to external recipients.
