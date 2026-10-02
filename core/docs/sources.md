# Sources and evidence (v2026-09-15)

Purpose: where each behavior rule, design choice, and numeric threshold in this config comes from.
How to read it: entries are grouped by domain. Each one names the source, the URL or DOI, the retrieval date, and the config files it justifies.
Policy: a new behavioral rule or numeric threshold ships with its entry here, in the same commit (core/docs/agent-config-authoring.md, wiring checklist). A claim with no citable source is labeled repo design or community practice, never left silent.

## Prose and AI writing
- Wikipedia, Signs of AI writing (WikiProject AI Cleanup): https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing (retrieved 2026-09-15). Used in: core/docs/ai-writing.md, the vocabulary, sentence-pattern, formatting, and structure lists.
- Google, developer documentation style guide: https://developers.google.com/style (retrieved 2026-09-15). Used in: plain register and second person in core/docs/ai-writing.md, human-facing sections of core/docs/project-docs.md.

## Agent behavior, context, and instructions
- Andrej Karpathy, llm-rigor principles (think before coding, surgical changes, minimum viable code, pushback scales with certainty): https://github.com/luiscrsilveira/llm-rigor (retrieved 2026-09-15). Used in: core/principles.md.
- Anthropic, Claude's Character (anti-sycophancy, honesty, stopping when confused): https://www.anthropic.com/research/claude-character (retrieved 2026-09-15). Used in: AGENTS.md section 0 items 1 to 5.
- Sharma et al. (Anthropic), Towards Understanding Sycophancy in Language Models, arXiv:2310.13548: https://arxiv.org/abs/2310.13548 (retrieved 2026-09-15). Used in: the no-flattery rule.
- Anthropic engineering, Effective context engineering for AI agents (context rot, smallest set of high-signal tokens): https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents (retrieved 2026-09-15). Used in: lean injection policy, preset comments, README.
- Chroma, Context Rot (performance degrades as input grows, before the window is full): https://www.trychroma.com/research/context-rot (retrieved 2026-09-15). Used in: the lean-injection stance behind the preset patch, core/docs/evals.md cost reasoning.
- HumanLayer, Evolving AI Coding Agent Workflows from Research-Plan-Implement to CRISPY, ZenML LLMOps Database: https://www.zenml.io/llmops-database/evolving-ai-coding-agent-workflows-from-research-plan-implement-to-crispy (retrieved 2026-09-15). Used in: the CRISPY name and the phase structure in AGENTS.md section 2, and the argument that always-on prompt budget is scarce.
- Anthropic, prompt caching docs: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching (retrieved 2026-09-15). Used in: CLAUDE.md prompt-caching-friendly structure.
- Anthropic, Claude Code skills (the tool-search pattern that skill_search and skill_load mirror): https://docs.anthropic.com/en/docs/claude-code/skills (retrieved 2026-09-15). Used in: skill-search.mjs, skills/ layout.
- Anthropic, Building Effective Agents (Schluntz and Zhang), the canonical text on workflow versus agent and on keeping the architecture simple: https://www.anthropic.com/engineering/building-effective-agents (retrieved 2026-09-15). Used in: the preset philosophy, the skills-as-procedures design, and the decision not to mount a skill catalog.
- Liu et al., Lost in the Middle: How Language Models Use Long Contexts, TACL (2024): https://aclanthology.org/2024.tacl-1.9/ (retrieved 2026-09-15). Used in: front-loading the hard rules in AGENTS.md and the ordering rules in core/docs/ai-writing.md.
- Manus, Context Engineering for Production AI Agents at Scale, ZenML LLMOps Database: https://www.zenml.io/llmops-database/context-engineering-for-production-ai-agents-at-scale (retrieved 2026-09-15). Used in: .ai/ as memory in files, on-demand skill loading, and the compaction policy in the dsh preset.
- Gloaguen, Muendler, Mueller, Raychev and Vechev (ETH Zurich), Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?, arXiv:2602.11988: https://arxiv.org/abs/2602.11988 (retrieved 2026-10-02). 138 tasks from 12 repositories on AGENTbench plus SWE-bench Lite, four agent and model pairs. Developer-written context files improve resolution by about 4 percent on average; LLM-generated ones reduce it by about 3 percent; both raise inference cost by more than 20 percent, and reasoning tokens by 10 to 22 percent. Two details drive this repo's design. (i) The absence of improvement is NOT a failure of instruction-following: when a context file mentions a tool, the agent uses it 1.6 to 2.5 times per instance against under 0.05 when it does not. (ii) Removing all documentation makes LLM-generated context files outperform developer-written ones by 2.7 percent, so a context file is largely redundant with existing docs. Recommendation the authors draw: describe only minimal requirements and non-inferable specifics such as tooling. Used in: the mandatory doc set being gated by path rather than expanded, the decision to add no new standing rules, and the lean-injection stance in the preset patch and README.
- Yang, He and Zhou, A First Look at Coding Agents' Compliance with AI Contribution Rules in Open-Source Communities, arXiv:2607.26819: https://arxiv.org/abs/2607.26819 (retrieved 2026-10-02). 106 issues from 49 repositories, four frontier agent and model pairs. The focal policy file was opened in 12 of 347 unaided runs, 3.5 percent, and 242 of 248 violations happened without the policy ever being opened. Agents pick up disclosure and verification once reminded, quoted or corrected, but never refuse to contribute under any condition tested. Used in: the reason `docs-gate` exists at all. If the policy file is opened in 3.5 percent of runs, discovery is the binding constraint, not instruction wording. Also the basis for keeping the gate's job to POINT AT paths rather than to add rules.
- Zhang, Wang, Cui, Qiu, Li, Zhu and He, Guardrails Beat Guidance: A Large-Scale Study of Rules, Skills, and Persistent Configuration for Coding Agents, arXiv:2604.11088: https://arxiv.org/abs/2604.11088 (retrieved 2026-10-02). 679 rule files and 25,532 rules scraped from GitHub, more than 5,000 Claude Code runs on SWE-bench Verified. Every individually beneficial rule is a negative constraint; every individually harmful one is a positive directive. Random and mismatched-domain rules match curated ones, which points to context priming rather than rule content. Pass rates stay stable from 0 to 50 rules. Used in: rewriting AGENTS.md section 0 rule 7 as a negative constraint with the file paths moved into section 3, in the existing negative phrasing of section 5, and as the reason the gate, not more prose, carries the requirement.
- Anand and Chattaraj, Instruction Stacking Collapse: A Benchmark and the Capability-Dependent Value of Prompt Compilation, arXiv:2608.02639: https://arxiv.org/abs/2608.02639 (retrieved 2026-10-02). 22 verifier-checked instructions stacked one to twenty, three production models. Follow rate falls from about 96 percent at one instruction to 20 percent at twenty for the weakest model tested, non-linearly, with the inflection between 8 and 12. About 12 percent of satisfiable instruction pairs conflict, and one format constraint suppresses nine others. The authors' repair is an instruction compiler that merges and declares precedence. Used in: the decision to audit AGENTS.md for COUNT and CONFLICT rather than to add rules, and in the commit-time trigger for `git-workflow.md`. Bounded: the instructions are synthetic format constraints, a different regime from domain rules, which is why this is not read as licence to cap rule count.
- McMillan, Configuration File Structure Does Not Drive Compliance, arXiv:2605.10039: https://arxiv.org/abs/2605.10039 (retrieved 2026-10-02). Factorial study, 1,650 Claude Code sessions and 16,050 observations. File size, instruction position, file architecture and adjacent-file contradictions produced no detectable compliance contrast; size and contradiction are affirmative nulls by Bayes factor. The largest effect measured was within-session: compliance odds fall about 5.6 percent per additional generated function. Used in: the decision NOT to restructure AGENTS.md, split it, or reorder it. Reorganising is not a compliance lever. The within-session decay is the basis for gating the commit docs at the commit rather than requiring them up front.
- He, Zhao, Wang and Chen, Is Progressive Disclosure All You Need for Long-Context Agents?, arXiv:2607.17598: https://arxiv.org/abs/2607.17598 (retrieved 2026-10-02). Controlled comparison of raw-document navigation, Agent Skills packs, and a hybrid retriever across three harnesses and three model families on InfiniteBench. On a single document the gain depends on the harness; as the corpus grows, raw navigation collapses while ONE level of progressive disclosure degrades more slowly and pulls ahead. A second routing level never helps and sometimes breaks accuracy outright. Used in: the two-level design of the doc set, where a tier and one language guide are selected and no deeper routing is introduced, and in the refusal to chain task-type to doc mappings.

## Enforcement surfaces (hooks, gates, CI)
- Restraint rules - "do not do X" - measured 0 percent unaided compliance across four frontier agent and model pairs, and 0 to 10 percent even when the exact clause is pasted into the workspace. Rules that ADD work recover to 90 to 100 percent with a harness message naming the violation. Synthesis: an instruction asks, a hook requires; restraint belongs on a surface that gates on an artifact rather than in prose. Source: Yang, He and Zhou, arXiv:2607.26819 - https://arxiv.org/abs/2607.26819 (retrieved 2026-10-02), already cited above for the discoverability measurement. Used in: `docs-gate` denying the tool call instead of asking for a read, and in the choice to keep `validation-checklist.md` as the review surface rather than adding prose.
- Audit of 481 public CLAUDE.md files against Claude Code's built-in controls: only 4.4 percent of extracted security rules matched under the strictest standard, 4 to 16 percent under looser matching. A written rule with no control behind it is not enforcement. Reported in agentpatterns-ai, Restraint Rules Need External Enforcement: https://github.com/agentpatterns-ai/website/blob/main/instructions/restraint-rules-need-external-enforcement.md (retrieved 2026-10-02), which cites arXiv:2608.23550. Used in: the standing preference for a control over a sentence when a rule must not fail.

## Complexity, design, and maintainability
- T. J. McCabe, A Complexity Measure, IEEE Transactions on Software Engineering SE-2(4) (1976): https://doi.org/10.1109/TSE.1976.233837 (retrieved 2026-09-15). Used in: the cyclomatic budget in core/docs/complexity.md, 10 per function.
- G. A. Campbell, Cognitive Complexity: An Overview and Evaluation, ICPC (2018): https://doi.org/10.1145/3194164.3194186 (retrieved 2026-09-15). Used in: the cognitive budget in core/docs/complexity.md, 15 per function.
- Wily: High-Performance Complexity Gated-Feedback for AI Coding Agents, ACM Conference on AI and Agentic Systems (2026): https://doi.org/10.1145/3786335.3813220 (retrieved 2026-09-15). Used in: gating agent output on complexity metrics, core/docs/complexity.md and the review phase.
- zj-karina/complexity-budget, evidence-based complexity budgets: https://github.com/zj-karina/complexity-budget (retrieved 2026-09-15). Used in: the numeric budgets, 60 lines per function, 500 per file, 4 parameters, nesting 3; core/docs/complexity.md, core/principles.md.
- Robert C. Martin, Clean Code, chapters 1 and 3 (small functions, one thing per function, one level of abstraction, few arguments), ISBN 978-0132350884. Used in: the function-size, parameter, and nesting budgets, and the comment stance in core/docs/coding-standards.md.
- Martin Fowler, Refactoring, second edition, chapter 3 Bad Smells in Code, ISBN 978-0134757599: https://martinfowler.com/books/refactoring.html (retrieved 2026-09-15). Used in: the smell list in core/docs/maintainability.md.
- D. L. Parnas, On the Criteria To Be Used in Decomposing Systems into Modules, Communications of the ACM 15(12) (1972): https://doi.org/10.1145/361598.361623 (retrieved 2026-09-15). Used in: module boundaries and information hiding in core/docs/coupling.md and core/docs/architecture.md.
- E. Yourdon and L. Constantine, Structured Design (1978), ISBN 978-0138544713. Used in: coupling and cohesion criteria in core/docs/coupling.md and core/docs/maintainability.md.
- Robert C. Martin, Clean Architecture (2017), ISBN 978-0134494166. Used in: dependency direction rules in core/docs/coupling.md and core/docs/architecture.md.
- Early Career Developers' Perceptions of Code Understandability: A Study of Complexity Metrics, arXiv:2303.07722: https://arxiv.org/abs/2303.07722 (retrieved 2026-09-15). Used in: tracking two complexity metrics instead of one, core/docs/complexity.md.
- Microsoft, code metrics values (maintainability index): https://learn.microsoft.com/en-us/visualstudio/code-quality/code-metrics-values (retrieved 2026-09-15). Used in: the maintidx target in core/docs/languages/go.md and the measurement section of core/docs/maintainability.md.
- Wikipedia, Cyclomatic complexity (structure of the metric and its limits): https://en.wikipedia.org/wiki/Cyclomatic_complexity (retrieved 2026-09-15). Used in: the explanation of what the metric counts in core/docs/complexity.md.
- D. Knuth, Structured Programming with go to Statements, ACM Computing Surveys 6(4) (1974), the origin of measuring before optimizing: https://doi.org/10.1145/356635.356640 (retrieved 2026-09-15). Used in: the optimization rule in core/docs/performance.md.

## Process, operations, and debugging
- Geoffrey Huntley, Ralph (spec-driven loops with state in files rather than long conversations): https://ghuntley.com/ralph/ (retrieved 2026-09-15). Used in: the plan skill and the spec-first flow; the harness ralph tool follows this technique.
- GitHub, Spec Kit (specification before code, with templates and gates): https://github.com/github/spec-kit (retrieved 2026-09-15). Used in: the plan skill and the approval gate in AGENTS.md section 2.
- Google, Site Reliability Engineering, Postmortem Culture: https://sre.google/sre-book/postmortem-culture/ (retrieved 2026-09-15). Used in: the post-mortem section of core/docs/debugging.md and the review rules in AGENTS.md section 2.

## Testing
- Martin Fowler, The Practical Test Pyramid: https://martinfowler.com/articles/practical-test-pyramid.html (retrieved 2026-09-15). Used in: the unit, integration, and end-to-end split in core/docs/testing.md.
- Martin Fowler, Self-Testing Code: https://martinfowler.com/bliki/SelfTestingCode.html (retrieved 2026-09-15). Used in: tests as the precondition for refactoring, core/docs/testing.md.
- Kent Beck, Test-Driven Development: By Example (2002), ISBN 978-0321146533. Used in: test-first in AGENTS.md section 2 and core/docs/development-workflow.md.
- Michael Feathers, Working Effectively with Legacy Code (2004), ISBN 978-0131177055. Used in: characterization tests before changing untested code, core/docs/testing.md and core/docs/debugging.md.

## Security
- OWASP, Application Security Verification Standard: https://github.com/OWASP/ASVS (retrieved 2026-09-15). Used in: the verification requirements behind core/docs/security.md.
- OWASP, Top 10: https://owasp.org/www-project-top-ten/ (retrieved 2026-09-15). Used in: the risk list in core/docs/security.md.
- The Twelve-Factor App, factor III Config: https://12factor.net/config (retrieved 2026-09-15). Used in: secrets kept out of code and out of the repository, core/docs/security.md.
- OWASP, Dependency-Check: https://owasp.org/www-project-dependency-check/ (retrieved 2026-09-15). Used in: dependency scanning in the ci skill and core/docs/dependency-policy.md.

## Agent security
- Simon Willison, The Lethal Trifecta (private data plus untrusted content plus the ability to exfiltrate, in one agent): https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/ (retrieved 2026-09-15). Used in: the reason claudeignore, the permission lists, and the block-danger hook exist.
- OWASP, Top 10 for LLM Applications, incident-weighted edition: https://genai.owasp.org/llm-top-10/ (retrieved 2026-09-15). Used in: the agent-side counterpart to core/docs/security.md; excessive agency is the risk the permission lists answer.

## Dependencies
- OpenSSF, Scorecard: https://github.com/ossf/scorecard (retrieved 2026-09-15). Used in: the health signals weighed before adopting a dependency, core/docs/dependency-policy.md.

## Git, commits, and releases
- Conventional Commits 1.0.0: https://www.conventionalcommits.org/en/v1.0.0/ (retrieved 2026-09-15). Used in: commit types in core/docs/git-workflow.md, AGENTS.md section 2, and the ship skill.
- Trunk Based Development: https://trunkbaseddevelopment.com/ (retrieved 2026-09-15). Used in: short-lived branches off main, core/docs/git-workflow.md.
- Google, Engineering Practices (code review): https://google.github.io/eng-practices/ (retrieved 2026-09-15). Used in: the review rules in AGENTS.md section 2 and the review skill.
- Michael Nygard, Documenting Architecture Decisions (2011): https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions (retrieved 2026-09-15). Used in: core/docs/decisions/ADR-template.md and the ADR conventions in core/docs/project-docs.md.
- Keep a Changelog 1.1.0: https://keepachangelog.com/en/1.1.0/ (retrieved 2026-09-15). Used in: core/templates/CHANGELOG.md and the changelog section of core/docs/project-docs.md.
- Semantic Versioning 2.0.0: https://semver.org/ (retrieved 2026-09-15). Used in: release tags in core/docs/git-workflow.md.
- No agent, model, or tool attribution in commit messages: REPO DESIGN, with no external source, and deliberately against a trend. The Linux kernel requires an `Assisted-by:` trailer and the Apache Software Foundation a `Generated-by:` line, and some open-source policies exist only to compel that disclosure; those communities want the mark. This repo does not, so the rule here is the inverse of theirs. Basis: a commit message is a description of a change, and an agent naming itself adds a line that is wrong the moment the reader checks the author, which invites weighing the author instead of the diff. The commit metadata already carries identity, and the evidence for what changed is in the diff and in the repository's own provenance sections. Used in: core/docs/git-workflow.md, section "Commits - conventional and atomic". Recorded as a positive choice rather than an omission so it cannot drift.

## Documentation standards
- Diataxis (Daniele Procida): https://diataxis.fr/ (retrieved 2026-09-15). Used in: the tutorial, how-to, reference, and explanation categories in core/docs/project-docs.md.
- Write the Docs, Docs as Code: https://www.writethedocs.org/guide/docs-as-code/ (retrieved 2026-09-15). Used in: the docs-as-code principle in core/docs/project-docs.md.

## Skill format and distribution
- Agent Skills standard, the specification behind skills/<name>/SKILL.md: https://agentskills.io and https://github.com/anthropics/skills/blob/main/spec/agent-skills-spec.md (retrieved 2026-09-15). Used in: the skills/ layout and the frontmatter fields in core/docs/agent-config-authoring.md.
- Anthropic, skill-creator (how to write and improve a skill, including optimizing its description for triggering accuracy): https://github.com/anthropics/skills/tree/main/skills/skill-creator (retrieved 2026-09-15). Used in: the decision to keep the triggers in the single description field.
- Jesse Vincent, superpowers (MIT; one plugin manifest per harness, flat promoted-only skills directory): https://github.com/obra/superpowers (retrieved 2026-09-15). Used in: the reference architecture for multi-harness distribution, if this config ever ships as a plugin.
- skills.sh, the cross-harness skill installer: https://skills.sh (retrieved 2026-09-15). Used in: the evaluation of distribution options; not adopted, the symlink model covers the five tools.

## Measurement and evidence
- METR, Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity (randomized trial: experienced developers were slower with AI while believing they were faster): https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/ (retrieved 2026-09-15). Used in: core/docs/evals.md, the case for measuring instead of trusting the impression.
- DORA, Balancing AI tensions: from AI adoption to effective SDLC use (AI as an amplifier of existing practice, with low reported trust): https://dora.dev/insights/balancing-ai-tensions/ (retrieved 2026-09-15). Used in: the argument that shared config and process matter more than the model.

## Practitioner sources (stance and corroboration)
Writing by people who ship code with agents. These inform the posture of the config (review standards, discipline in tooling, memory as files) rather than backing a specific rule or number.
- Fabio Akita (akitaonrails), RANT: Did Akita Bend Over for AI? (2026): https://akitaonrails.com/en/2026/02/24/rant-akita-caved-to-ai/ (retrieved 2026-09-15). Stance the review rules follow: AI-assisted work carries the same standard as any other code.
- Fabio Akita, ai-memory: https://github.com/akitaonrails/ai-memory (retrieved 2026-09-15). Independent build of the same idea behind .ai/: agent memory as git-versioned markdown, with writes gated by evaluation.
- Robert C. Martin and Justin Martin, Clean AI: Agentic Discipline (2026): https://cleancoders.com/episode/agentic-discipline-6 (retrieved 2026-09-15). Corroborates the guardrails principle: discipline an agent cannot be trusted to remember belongs in the tooling.
- Armin Ronacher, Agentic Coding Recommendations: https://lucumr.pocoo.org/2025/6/12/agentic-coding/ (retrieved 2026-09-15). Corroborates the lean injection stance and the tool-usage rules in AGENTS.md section 6.
- Matt Pocock, skills: https://github.com/mattpocock/skills (retrieved 2026-09-15). Reference implementation for a skills directory and its frontmatter.
- Simon Willison, weblog: https://simonwillison.net/ (retrieved 2026-09-15). Public record of what agent tooling does in practice, failure modes included.
- Martin Fowler, Exploring Generative AI: https://martinfowler.com/articles/exploring-gen-ai.html (retrieved 2026-09-15). Corroborates the review phase and the fresh-context idea.
- Kent Beck, Augmented Coding (Honeycomb episode 80): https://www.honeycomb.io/resources/podcasts/ep-80-augmented-coding-with-kent-beck (retrieved 2026-09-15). Corroborates test-first and small steps under AI assistance.

## AI usability
- Jakob Nielsen (UX Tigers), Intent by Discovery: Designing the AI User Experience, and A New AI: Creation as Exploration and Discovery: https://www.uxtigers.com/post/intent-ux (retrieved 2026-09-15). Used in: the ask-before-acting rules (AGENTS.md section 0 item 5, the plan skill) and how .ai/project.md is written to be read by a human and an agent.

## Internal, measured
- Retained eval set (anchor checks plus task set): core/docs/evals.md. Anchor evidence: liangshen issue 6, 0/9 first-request anchoring with the skill catalog injected versus about 81 percent without. Used in: preset design decisions.
- The 2026-09 config review that drove the two preset swaps: summarized in the preset patch comments and core/docs/evals.md.
- Skill delivery scale policy: search and load stays the default while the catalog is small, and catalog injection is not reintroduced past roughly three to five skills. Basis: the anchor measurement above plus the instruction-budget entry.
- Standing instruction injection, measured 2026-09-16 with tiktoken on o200k_base and cl100k_base: AGENTS.md reads 2283 and 2292 tokens, and with the Claude Code layer (agents/claude-code/CLAUDE.md) the first request carries 2460 and 2470. Used in: the injection-budget anchor check in core/docs/evals.md.
- Instruction-read compliance, measured 2026-10-02 by decompressing every transcript under `$DSH_HOME/sessions` and matching each recorded tool call against the instruction and doc paths. At the first run, 96 sessions with at least one read, grep, glob or bash call: 32 of 96 (33 percent) read AGENTS.md, CLAUDE.md or a `.ai/*.md` file, and 8 of 96 (8 percent) read any core behavioural doc (principles, complexity, maintainability, git-workflow, development-workflow, coding-standards, validation-checklist, coupling, testing, architecture). A later run over 99 sessions gives 34 percent and 10 percent, so treat these as a moving measurement rather than a fixed fact. The `instruction-hint` plugin delivered its hint in 30 sessions and 17 of those still never opened an instruction file; among sessions where the hint did land, the median delay before the first instruction-file read was two tool calls. Reproduce with `node tools/audit-instruction-reads.mjs`. Used in: the decision to enforce by denial rather than by hint, and the README's "Why the gate exists". Independent corroboration for the 3.5 percent policy-open rate in the Yang, He and Zhou entry above.
- Replay of those same transcripts against the `docs-gate` classifier (2026-10-02): of the 84 sessions that mutated anything, 83 (99%) made their FIRST mutation before reading the full doc set; for those, the first mutation arrived at a median of 3 tool calls in (min 0, max 122), and 51 of them mutated within the first 5 calls. Basis: the gate has to be enforced by the tool call, not by a message, because the window in which a hint could plausibly work is routinely zero to three calls. Used in: the `docs-gate` design in `agents/dsh/presets/renks/docs-gate.mjs`, its denial message, and the gate rule in AGENTS.md section 0. Method is reproducible from the recorded sessions; no external source applies.

## Repo design decisions
Decisions made here, with no external source. They are open to revision when evidence appears.
- Per-project .ai/ memory directory (ai-init, ai-context): this repo's own design.
- .ai/ holds agent memory, the committed docs/ holds documentation for humans; .ai/docs/ only carries genuine deviations from this config.
- AGENTS.md stays under 150 lines and points to core/docs/ for depth.
- A docs subdirectory appears once three files of the same type accumulate.
- Tool catalog injection is replaced by search and load, per the measurement above.
- Never git add -A; stage explicit files. Stated in AGENTS.md section 2 and enforced by the Claude Code hook.
- Skill triggers live in `description`, the only skill frontmatter field both harnesses read (Anthropic Claude Code skills; the dsh skill index). The separate `whenToUse` field was dropped as redundant, and the dsh search tolerates its absence.
- Skill and preset descriptions are single-quoted in frontmatter when they contain a colon. An unquoted colon followed by a space ends the scalar, the YAML fails to parse, and the loader drops the skill with no error: seven of ten skills were invisible this way until 2026-09-16.
- The ~2.5K token ceiling for standing instructions (core/docs/evals.md, anchor check A): repo design, sized from the lean-injection sources above rather than from a published number. The measurement above sits at 2460, so it is a ceiling with roughly 40 tokens of slack: adding to AGENTS.md means removing something first.

## Community practice, uncited
- AGENTS.md / CLAUDE.md / cursorrules layering and project-root placement: 2026 consensus guides and widely used repos such as steipete/agent-rules (https://github.com/steipete/agent-rules, retrieved 2026-09-15). Standard practice; no single canonical paper.
- Dual frontmatter (description plus globs for Cursor; paths for Claude Code): the two vendors' own documentation.
- Language-specific rules and docs (go, python, rust, kotlin): distilled from those languages' official style guides and common practice.
- One assertion per test when practical (core/docs/testing.md).
- Time-box of three attempts or five minutes per simple issue (core/principles.md rule 9).
- Permission lists and pre-tool hooks as the enforcement layer for agent limits (README guardrails, agents/claude-code/settings.json).

## Repo provenance
When each file type entered the repository. Full history: git log --follow --diff-filter=A -- <path>.
- core/principles.md, core/docs/complexity.md, core/docs/testing.md, core/docs/security.md, core/docs/development-workflow.md, core/docs/project-docs.md, core/docs/ai-directory.md, core/docs/validation-checklist.md: 767d20e, 2026-08-03, initial commit.
- core/docs/sources.md: e028423, 2026-09-07, docs(sources): provenance for every rule, design choice, and threshold.
- core/docs/agent-config-authoring.md: d52217e, 2026-09-07, authoring spec plus the extend-config skill.
- core/docs/ai-writing.md: b29ae89, 2026-09-07, AI-writing tells checklist.
- core/docs/evals.md: 5b00a63, 2026-09-07, project docs refresh with the evals guide.
- The whole tree was regrouped under core/ and agents/ by the restructure of 2026-09-07, which is why the paths above differ from the original ones.

## Rule for future edits
- Every new behavioral rule or numeric threshold: add its source to this file in the same commit. If no source exists, label it repo design or community practice.
- Every web source carries a retrieval date.
- Cite the specific claim: name what the source justifies inside the file.
