---
inclusion: always
---

# Content Design Review Rule

When implementing features that involve user-facing content design, ALWAYS confirm with the user BEFORE writing code. This includes:

- Form fields: what fields to include, which are required vs optional, default values
- Dropdown options: what choices to offer in select menus
- Page structure: what sections to show, their order, and layout
- LLM prompts: what instructions to give AI for content generation/formatting
- Navigation: what links to add and where
- Email templates: what content to include in automated emails
- News/report structure: what modules, categories, or labels to use

## Process
1. Propose the content design (fields, options, structure) to the user
2. Wait for user confirmation or feedback
3. Only then proceed with implementation

This avoids rework from assumptions about domain-specific content that the user knows best.
