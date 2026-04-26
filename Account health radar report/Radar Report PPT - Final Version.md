# Radar Report PPT — Final Version

---

## Slide 1 — What is Radar Report?

**Definition**

Radar Report is a bi-weekly seller intelligence product that listens to external seller voice — forums, media, and KOLs — to surface emerging Account Health & Appeals risks before they escalate internally.

**Core Attributes**

| Dimension | Radar Report |
|---|---|
| Source | Seller communities, forums, social media |
| Captures | What sellers say publicly, panic signals, viral complaints |
| Value | Early warning, sentiment trends, prioritized topic ranking |
| Scope | CN sellers (Account Health & Appeals domain) |

**Voice Volume Calculation — Regular Radar Report Example**

Different channels carry different credibility and reach, so each is weighted accordingly:

| Information Source | Weight Coefficient | Count Basis |
|---|---|---|
| Seller Forums | 1.0 | Post & Reply Count |
| Service Provider Articles | 2.0 | Article Count |
| Cross-border E-commerce Media | 4.0 | Article Count |
| Cross-border E-commerce KOLs | 5.0 | Video / Article Count |

**Formula**

Total Sentiment Volume = (Seller Forum Posts × 1.0) + (Service Provider Articles × 2.0) + (Cross-border Media Articles × 4.0) + (KOL Videos/Articles × 5.0)

**Logic**: higher-reach, higher-influence channels (KOLs, media) weighted heavier than individual forum posts — ensuring topic ranking reflects true amplification, not just raw post count.

---

## Slide 2 — How to Generate

- **Step 1 – Signal collection**: scrape target channels on a rolling 14-day window
- **Step 2 – Topic clustering**: LLM groups raw posts into distinct enforcement themes (e.g., 5H hold, IP takedowns, PRA violations)
- **Step 3 – Scoring & ranking**: apply voice weighting formula to rank topics by severity
- **Step 4 – Deep analysis**: for Top 5 topics, analyst adds background, root cause, seller reactions, and recommended actions
- **Step 5 – Expert review**: compliance / Policy / PM teams validate findings
- **Step 6 – Publish**: release bi-weekly on the platform with English + Chinese versions

---

## Slide 3 — How to Share: Radar Report Platform

- **Centralized access**: single URL replaces fragmented email distribution, accessible to all internal stakeholders
- **Real-time trend dashboard**: tracks how enforcement topics shift in ranking across weeks, not just static snapshots
- **AI-powered features**:
  - Smart Paste — paste raw report text, AI auto-structures it
  - Auto-translation — EN↔ZH switches instantly, pre-translated on publish
  - Topic Ranking Extraction — LLM normalizes topics across reports for trend tracking
  - Auto-Generated Hot News — AI flags significant ranking shifts as news highlights
- **Two-way engagement**:
  - In-app notifications for new reports & news
  - Intake form for stakeholders to request specific analysis topics
- **Role-based access**: Admin manages content, team members consume & request
- **Export ready**: one-click PDF export for offline/email sharing

---

## Slide 4 — Current Account Health Radar Report Structure

**Type 1 – Regular Bi-Weekly Report**

- **Module 1 – Account Suspension Trends**: Top 5 suspension categories, frequency, severity, seller pain points
- **Module 2 – Listing Takedown Trends**: Top 5 takedown reasons, category impact, appeal recovery rates
- **Module 3 – Account Health Tool Feedback**: seller sentiment on AHA, Seller Assistant, appeal dashboard; usability complaints, broken flows, requested enhancements
- **Module 4 – Education Opportunities**: knowledge gaps detected in seller discourse; misinformation to correct; content format preferences (video vs. email vs. Seller U); topics ripe for proactive education

**Type 2 – Topic-Specific Deep-Dive**

- Single-subject report triggered by acute events (e.g., US 5H customs hold, CA/BR KYC, PRA bad actor campaign)
- Structure: Background → Workflow → Top pain points → Failure reasons → Category risk ranking → Compliance guide → Action checklist
- Typically produced ad-hoc when a topic's weighted score spikes 3x+ in one cycle

---

## Slide 5 — Why Radar Report? Proven Impact

Traditional enforcement data tells us what went wrong *after* sellers are impacted. Radar Report flips this — listening externally to detect signals *before* they spike internally.

**Case 1 — NA KYC Early Warning**

- Detected documentation confusion in seller communities **ahead of any contact volume spike**
- Enabled timely co-escalation and proactive seller education before the issue intensified
- Shifted Policy team from reactive firefighting → near real-time friction detection

**Case 2 — PRA Policy Deep-Dive (3 Reports)**

Mapped CN public discourse across 4 dimensions — surfacing insights no internal data source could provide:

- **Awareness gap**: only 15% of CN public show deep PRA comprehension, 50%+ inadequate
- **Format sentiment**: official emails rated "vague, scary"; WeChat posts only 38% completion
- **Systemic appeal pain**: 78% appeals fail, 9.3% dispute success rate, 81% negative sentiment on seller support
- **Gray market intelligence**: mapped 6 review manipulation service models (80–8,000 RMB) — impossible to collect internally
- **15 misinformation claims identified** circulating as "authentic seller experiences" → drives 2026 corrective education content

**Radar Report's unique power**: captures what sellers say when Amazon isn't listening — unfiltered signals, gray-market realities, and misinformation that shape behavior invisibly.

---

## Slide 6 — Future Roadmap

**1. Deeper Partnership with AHS VOS Report** *(primary focus)*

Radar Report + AHS VOS together form a complete seller intelligence loop — external social listening meets internal voice-of-seller data.

- **Geographic expansion**: scale Radar coverage from CN-only to **WW sellers** (EU, US, JP, BR, IN) — matching AHS VOS's global footprint
- **Higher cadence**: move from **bi-weekly → weekly** publishing to enable faster policy friction detection and intervention
- **Two-way collaboration model**:
  - AGS → AHS: Radar surfaces external panic signals, misinformation, and emerging enforcement pain points for AHS to validate and action
  - AHS → AGS: AHS provides customized compliance VOS analysis (ticket themes, appeal drivers, specialist feedback) back to AGS for seller migration & risk mitigation planning
- **Joint outcome**: unified intelligence stream that pairs "what sellers say externally" with "what sellers say through official channels" — closing the insight gap between perception and reality

**2. End-to-End Automation**

- Automate the full pipeline: intake → signal collection → topic clustering → LLM drafting → publish
- Target: full user self-service — from topic request to auto-generated Radar Report with zero analyst intervention
- Shift analyst role from writer → reviewer

**3. Multi-Domain Expansion on Radar Platform**

- Current: Account Health only
- Next: **Compliance** (regulatory changes, PRA, safety incidents), **FBA** (logistics, inventory, inbound friction)
- Future: Brand & IP, Payment, International Selling
- One platform, many radars — unified stakeholder experience

---

## Slide 7 — From Insight to Action: Introducing Video Forge

**The Bridge**

Radar Report identifies *what* sellers are confused about and *where* education gaps exist — but creating scaled, high-quality educational content has always been a bottleneck.

**The Solution — Video Forge**

An advanced AI-driven content generation system that transforms **text, PDF documents, and PowerPoint presentations** into professional, engaging educational assets — with minimal human intervention.

**The Closed Loop**

Radar Report surfaces education opportunity → Video Forge produces corrective content at scale → sellers consume in their preferred format → Radar measures sentiment shift in next cycle

**Example — Account Health Topic Education**

- **Radar insight**: Past Radar Reports flagged seller confusion around account health warnings and appeal documentation — a recurring top pain point
- **AHS existing asset**: AHS team developed structured education materials (PPT / PDF) explaining warning types, appeal steps, and documentation requirements
- **Video Forge transformation**: AHS education PPT → AI-generated narrated video in minutes, ready for WeChat, Seller University, and localized channels
- **Outcome**: Education reaches sellers in a format they actually engage with — closing the loop from "confusion detected" to "sellers educated"

**Next → Live Demo of Video Forge**
