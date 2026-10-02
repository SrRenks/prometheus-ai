# AI-writing tells - human-facing prose (v2026-09-07)

Scope: apply to prose written into files that humans read: README.md, docs/, code comments, commit messages, PR/commit titles, CHANGELOG. Never apply to chat replies to the user and never to .ai/ files (AGENTS.md section 0 rule 8, formatting by audience, governs those).

These are tells that make prose read as template AI output. They are not errors in general; remove them from your own drafts.

## Vocabulary: cut on sight
- delve, furthermore, moreover, notably, pivotal, crucial, comprehensive, robust, seamless, showcase, underscore, leverage (as verb), realm, landscape, tapestry, testament, intricate, multifaceted, vibrant, foster
- "It is important to note", "it is worth noting", "plays a (crucial/key/pivotal) role"
- Promotional adjectives: cutting-edge, world-class, best-in-class, game-changing, innovative (without evidence), elevate, empower
- Prefer the plain verb: uses over utilizes, helps over facilitates, shows over demonstrates, makes over enables

## Sentence patterns: rewrite
- Negative parallelism: "not just X, but Y", "not X, but Y", "X rather than Y". State the fact directly.
- Rule of three: avoid stacking three adjectives or nouns ("fast, efficient, and reliable"). Pick the one that matters.
- Vague attribution: "experts say", "many believe", "widely recognized", "it is said". Name the source or drop the claim.
- Vague connection: "in terms of", "associated with", "linked to". State the actual relation.
- Outline-like closers: "in conclusion, X faces challenges but has promising prospects". End with specifics or stop earlier.

## Formatting: fix
- No bold lead-ins on every bullet (inline-header vertical lists).
- No em dashes joining clauses; prefer periods, commas, or parentheses.
- No emoji as formatting in docs, README, or comments.
- Sentence case for headings; never title case.
- No thematic breaks (---) between every section; use them only at document boundaries.
- No boldface runs inside paragraphs.
- Straight quotes and apostrophes, never curly.
- Tables only for genuine data; never for layout.
- Heading levels: level 1 only for the document title; never skip levels; never a heading that only contains other headings.

## Structure: avoid
- Opening a doc with generic context ("In today's fast-paced world...").
- A significance or legacy paragraph for features ("this paves the way for...").
- Restating the request as the document's first sentence.
- Placeholder text: [TBD], your-username, lorem ipsum (real code TODOs are fine).
- Citation artifacts leaked into text: [cite: 1], contentReference, oaicite, turn0search, +1.
- Procedural self-assurances in commit messages: "preserved", "retained", "avoided", "ensured".

## Procedure
1. Draft the prose.
2. Scan it against the vocabulary list and sentence patterns; fix every hit.
3. One read-through: does this read like a person wrote it, or like a template?
4. Commit messages and PR titles: apply the vocabulary cuts; skip procedural statements.

Source: condensed from https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing (a descriptive Wikipedia essay; reworked here as prescriptive rules with Wikipedia-only items dropped).

Sources: `core/docs/sources.md`, section "Prose and AI writing".
