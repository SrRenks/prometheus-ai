# prometheus-ai

One set of instructions, skills, and reference docs for coding agents, shared by
Claude Code, Codex, Gemini CLI, Cursor, and dsh (DeepSeek Harness).

Every tool keeps its own config directory, and that is where agent setups drift
apart: the same rule gets written three times, updated twice, and contradicted
once. This repo holds the canonical copy and hands it to each tool through
symlinks, so `git pull` updates every tool and every project. The dsh preset is
the one exception, because its installer copies files into `~/.dsh/`.

The config is read-only for agents. Anything project-specific belongs in that
project's `.ai/` directory; shared rules stay project-agnostic.

## Supported tools

| Tool | Source in this repo | Bridge installed by `setup.sh` |
|---|---|---|
| Claude Code | `agents/claude-code/` (CLAUDE.md, settings.json, hooks, rules, commands, claudeignore) plus `skills/` | `~/.claude/` |
| Codex | `AGENTS.md` | `~/.codex/AGENTS.md` |
| Gemini CLI | `agents/gemini/GEMINI.md` | `~/.gemini/GEMINI.md` |
| Cursor | `agents/claude-code/rules/` (combined frontmatter) | `~/.cursor/rules` |
| Any AGENTS.md tool | `AGENTS.md` | `~/.agents/AGENTS.md` |
| dsh | `agents/dsh/` preset plus `skills/` | not by `setup.sh`: run `agents/dsh/install.sh`, which writes `~/.dsh/` |

## Requirements

- `bash` and `git`.
- `node` only for the preset YAML check inside `agents/dsh/install.sh`.
- dsh itself, if you want the dsh preset; the rest of the config works without it.

## Install

```bash
git clone git@github.com:SrRenks/prometheus-ai.git ~/.config/agent-config
cd ~/.config/agent-config
./setup.sh                    # tool bridges and the git identity include
bash agents/dsh/install.sh    # dsh preset and shared skills (optional)
```

`setup.sh` derives every path from its own location and is safe to re-run. A real
file sitting where a symlink will go is copied to `backups/<timestamp>/` first, so
nothing is lost.

Keep the clone at `~/.config/agent-config`. The paths written inside `AGENTS.md`
and the skills name that location, and `ai-init` / `ai-context` point every project
they touch at it, so a clone somewhere else leaves agent instructions referencing
files that are not there. `setup.sh` warns when it runs from another path, and
`ai-init` / `ai-context` accept `AGENT_CONFIG_DIR` if you relocate the config on
purpose.

### Bringing up a machine from nothing

Five steps, and only the last two are manual. Two of them are separate
repositories, because this config is not the whole system.

| # | Step | What it produces |
|---|---|---|
| 1 | install dsh itself | the runtime, and the stock recipe `install.sh` reads |
| 2 | clone this repo, run `setup.sh` | harness bridges, git identity include |
| 3 | `bash agents/dsh/install.sh` | the `renks` preset, and the 0.2.0 bundle at `~/dsh-user-presets` |
| 4 | clone `dsh-unrestricted-renks`, edit the profile's `package.json` | the toggleable unrestricted plugin, mounted |
| 5 | `pnpm install` in the profile, start a new session | the profile reads both bundles |

`dsh-unrestricted-renks` is its own repository and nothing here installs it. Its
version and the dsh version this recipe was merged against are the two facts to
match on another machine:

```
dsh                      0.2.0-rc.2
dsh-unrestricted-renks   de422de   0.2.1-renks.1
prometheus-ai            this commit
```

`install.sh` completes step 4 for you when a profile already names
`dsh-unrestricted`, which is the marker that separates this setup's profiles from
any other on the machine. A profile without that marker is left alone and named in
the output, because adding a preset to somebody else's profile is not this
repository's edit to make. Set `DSH_PROFILE_SENTINELS` to override the marker.

The entries it adds are these two. `web` and `dsh-tui` differ in their base
bundles, so it adds to the existing arrays rather than replacing them:

```jsonc
"dsh": { "profile": { "bundles": [
  /* the profile's own base bundles */
  "dsh-user-presets",
  "dsh-unrestricted"
] } },
"dependencies": {
  "dsh-user-presets":    "file:~/dsh-user-presets",      // expand ~ yourself
  "dsh-unrestricted":    "file:~/dsh-unrestricted-renks"
}
```

Step 3 rebuilds the preset recipe against whichever dsh is installed, so re-run
it after every dsh update. `DSH_BUNDLE_OUT` overrides where the bundle lands, and
the profile's `file:` path must name the same directory.

The bridges should resolve back into the clone:

```bash
for b in ~/.claude/CLAUDE.md ~/.codex/AGENTS.md ~/.gemini/GEMINI.md ~/.cursor/rules ~/.agents/AGENTS.md ~/.local/bin/ai-init; do
  [ -L "$b" ] && echo "ok       $b -> $(readlink "$b")" || echo "MISSING  $b"
done
```

## The `.ai/` directory

Every project gets its own `.ai/`: the agent's working memory for that project,
local to the machine and never committed. This is the other half of the
read-only model. The shared config holds what is true for all projects, and
`.ai/` holds what is true for one of them.

```bash
cd ~/Projects/my-app
ai-init      # creates .ai/, links ./AGENTS.md, adds the .gitignore entry
ai-context   # writes context topic files and the project README, once the project has content
```

| Path | Role | Ownership |
|---|---|---|
| `.ai/agents.md` | symlink to this config's `AGENTS.md` | shared, never edited |
| `.ai/project.md` | stack, build/test/lint commands, local conventions | project |
| `.ai/session.md` | current session state, written at the end of a task | project |
| `.ai/assumptions.md` | decision log, one numbered entry per decision | project |
| `.ai/scratchpad.md` | working notes, commands, investigation results | project |
| `.ai/context/index.md` | maturity, stack, pointers, open gaps | machine, refreshed on every `ai-context` run |
| `.ai/context/<topic>.md` | domain, architecture, database, dependencies, conventions | created once, then never overwritten |
| `.ai/docs/` | project-specific convention docs, created on demand | project |
| `.ai/evals/` | retained eval runs, optional | project, see `core/docs/evals.md` |

How it behaves:

- The shared rules arrive by symlink. Editing `AGENTS.md` here updates
  `.ai/agents.md` in every project at once, and no project keeps a copy to drift.
- `ai-init` also links `./AGENTS.md` in the project root, which is the path Codex,
  Cursor, Windsurf, Amp, Jules, and Claude Code look for.
- `.ai/` stays out of git. `ai-init` writes the entry into the project's
  `.gitignore`, so project knowledge never enters the repository's history and
  never reaches a teammate who does not need it.
- `ai-init` records project maturity. It reads git history and build files and
  stamps the result (NEW or EXISTING) into `context/index.md`, which decides
  whether the agent onboards first or starts building.
- Nothing is generated from a blank template. `ai-context` writes only the files
  that apply, so a project with no database gets no `database.md` and no storage
  row in the README.
- Files already written are left alone. `--force` refreshes only `index.md` and
  `README.md`, which keeps hand-written knowledge safe from a re-run.
- Topic files open with detected facts and explicit open questions. Answers
  replace the questions as they are confirmed, so the knowledge base grows out of
  real sessions instead of placeholders.
- Project rules win. When a project needs different behavior, the rule goes in
  `.ai/project.md`; shared rules never bend to fit one project.
- `.ai/` holds the agent's working memory for one project. Technical
  documentation that humans read, such as architecture and design decisions,
  belongs in the repository's committed `docs/` under the
  `core/docs/project-docs.md` standard. `.ai/docs/` holds only genuine deviations
  from the shared config; when the shared config already covers a convention,
  reference it instead of copying it.
- The memory loop closes at the end of a task: session state goes into
  `session.md`, new decisions append to `assumptions.md`, and finished notes are
  pruned from `scratchpad.md`, so the next session starts oriented.

`core/docs/ai-directory.md` is the full standard, including when a `.ai/docs/`
file is worth creating instead of a line in `project.md`.

## Repository layout

```
AGENTS.md              universal rules, no tool-specific content
setup.sh               installs every tool bridge on this machine
ai-init, ai-context    per-project tooling (linked into ~/.local/bin)
core/
  docs/                reference library, read on demand
  principles.md        universal agent principles
  templates/           .ai/ and project-docs skeletons
agents/
  claude-code/         CLAUDE.md, settings.json, hooks/, rules/, commands/
  gemini/              GEMINI.md
  dsh/                 install.sh and presets/renks/
tools/
  build-preset-recipe.mjs   regenerates the dsh preset baseline, patch and fallback
skills/                one procedure per directory, each a SKILL.md
.gitignore             keeps backups/, evals/, and a stray gitconfig out of git
README.md, LICENSE     this file and the license
```

`core/docs/repository-map.md` is the structure doc: every root file, the tool
adapters, the reference library, and the templates.

## How one config reaches every tool

- `skills/` is symlinked to both `~/.claude/skills` and `~/.dsh/skills`. Every
  skill carries `name` and `description` frontmatter following the Agent Skills
  standard, and the trigger phrasing lives in the description because that is the
  field both tools pick a skill from. Both read the same directory plus SKILL.md
  layout. The Claude slash commands in `agents/claude-code/commands/` are
  symlinks into this directory.
- Files in `agents/claude-code/rules/` carry `description` with `globs` for
  Cursor and `paths` for Claude Code, so one file serves both.
- `ai-init` links `./AGENTS.md` into each project, which is the path Codex,
  Cursor, Windsurf, Amp, Jules, and Claude Code look for.
- Editing a rule and pulling updates every tool and every project, because the
  bridges are symlinks. Only the dsh preset needs its installer re-run.

## dsh and the `renks` preset

dsh (DeepSeek Harness) is the harness this config is tuned against. It runs the
agent loop locally, loads the shared rules from the `~/.dsh/AGENTS.md` symlink,
and discovers procedures from `~/.dsh/skills`, which points at `skills/`. It is
also the one tool here whose prompt composition can be patched, which is why the
leaner delivery lives in a dsh preset instead of in the shared rules.

The stock dsh recipe injects the full instruction files and the whole skill
catalog into the first request of every session. That spends context before any
work happens, and it moves the model's first step: the retained anchor checks
measured 0 of 9 first requests anchored with the catalog injected and about 81
percent without (`core/docs/evals.md`, issue #6).

The `renks` preset keeps the same rules and skills while removing both
injections:

| Stock behavior | Replaced by | What happens instead |
|---|---|---|
| `dsh-agent-instructions` inlines the `AGENTS.md` / `CLAUDE.md` digest | `docs-gate.mjs` | nothing is injected; the digest's read-on-demand index is enforced instead, and the denial names the files it needs |
| `dsh-tool-skill` injects the ~9KB `<available_skills>` catalog into the first step and again after every promotion or compaction | `skill-search.mjs` | `skill_search` lists matching names on demand, `skill_load` pulls one body; the catalog costs nothing until a task needs it |
| nothing enforced the read-on-demand index at the end of `AGENTS.md` | `docs-gate.mjs` | mutating tool calls are denied until the session has successfully read the mandatory doc set's CURRENT content; the denial names the files and lifts as the reads land |

A third plugin, `instruction-hint.mjs`, was removed on 2026-10-02. It named the
doc set after the session's first tool call and never reached a live session: no
hint text appeared in any recorded transcript and its `agent/pre-step` handler
never ran, while the gate beside it in the same composition worked throughout.
What replaced it is the gate itself, which is the stronger form of the same
promise. The plugins import only each other, never dsh internals, so an upstream
release does not break them.

### Why the gate exists

A hint is one message among many, and the rules that matter are cross-references:
`AGENTS.md` names `complexity.md`, `maintainability.md` and `git-workflow.md` in
a read-on-demand index, and a hint saying "instruction files exist" loads none of
them.

An audit over the 96 recorded sessions in `~/.dsh/sessions` (`tools/audit-instruction-reads.mjs`) measured the result:

| Signal | Sessions |
|---|---|
| read `AGENTS.md`, `CLAUDE.md` or `.ai/*.md` at all | 34% |
| read any core behavioural doc | 10% |
| in the sessions the old hint plugin counted as "delivered", never opened an instruction file | 17 of 30 |

Where the old hint was recorded as delivered, the median delay before the read
was two tool calls: the first edits happened before the rules were in context.
The hint fired; nothing enforced it. And on 2026-10-02 the hint was found never
to have reached a live session at all, so even that 30-session figure counts
delivery it may not have achieved.

Replaying those same transcripts against the gate's own classifier is the
strongest argument for enforcing at the tool call rather than in a message: of
the 84 sessions that mutated anything, **83 (99%) made their first mutation
before reading the set**, at a median of 3 tool calls in, and 51 of them mutated
within the first 5 calls. The window in which a hint could plausibly work is
routinely zero to three calls.

That local number matches a result published far more widely. Shin, [The
Compliance Gap](https://arxiv.org/abs/2605.01771), ran 2,031 sessions across six
frontier models and found **0% compliance on file reading under default framing**:
Claude Sonnet 4 agreed verbally ten times out of ten and bypassed in all ten. The
important part is the second theorem. The gap is undetectable from text alone — by
any human or LLM observer — so an agent SAYING it read a file is not evidence, and
no amount of reading transcripts can recover the truth. What the paper prescribes
is a tool-call log, which is what this gate is, and its controlled result points
the same way: removing the affordance to skip raised compliance from 0% to 75%
(Cohen's d = 2.47). The fix is to remove the shortcut, not to phrase the request
better.

`docs-gate.mjs` observes `tools/pre-execute` - the waterfall `dsh-tools` runs
before every tool body - and denies a mutating call until the session has read
what that call's tier requires. The denial reaches the model as the tool result,
so the corrective instruction arrives exactly where the model is looking.

The set is tiered, because demanding a complexity budget before a README edit is
friction with no return:

| Selector | Required for | Docs |
|---|---|---|
| `core` (ladder) | any change, prose included | `principles.md` |
| `code` (ladder) | source changes | `development-workflow.md`, `complexity.md`, `maintainability.md` |
| `language` (by extension) | the language of the changed file, when it has a guide | `languages/python.md`, `languages/go.md`, `languages/rust.md`, `languages/kotlin.md` |
| `commits` (by act) | `git commit`, `git push`, `gh pr create`, `lazygit`, and nothing else | `git-workflow.md` |

The three selectors are unioned, because none implies another: a prose session
that commits needs `git-workflow.md` without ever needing the code tier.

The tier comes from positive identification: only a prose or configuration
extension (`.md`, `.yaml`, `.toml`, …) spares a mutation the code tier. An
unknown extension, no extension, or a `bash` command not attributable to a file
all fall through to `code`, because over-gating is visible in the denial while
under-gating is silent. The project's `.ai/project.md` joins whichever tier
applies, when it exists.

The language guide is chosen the same way, and only one is ever required: a
`.py` file asks for `python.md`, a `.go` file for `go.md`. A language with no
guide asks for none, because naming the wrong guide is worse than naming none.
Guides are read in 11 to 13 of the recorded sessions - more often than the core
docs - so this is the set sessions already reach for.

What it deliberately does not do, since a gate that blocks real work is worse
than no gate:

- It never gates a read-only call. `read`, `grep`, `glob`, `web_search`,
  `todo_write`, `skill_load`, subagent dispatch and read-only `bash` (`git
  status`, `git diff`, test runners) stay open, so the agent can explore and can
  satisfy the gate.
- It never gates a target outside the workspace: an edit at an absolute path
  elsewhere, or a `bash` redirection into `/tmp`.
- It never gates an uninitialized workspace. If no required doc exists - a fresh
  scaffold, a scratch directory, a machine without this checkout - the gate opens
  and says so.
- It never re-gates: once the set is read, the check is one `Set` lookup.
- A subagent inherits its root session's evidence instead of re-reading five
  files, and an unresolvable workspace fails closed rather than silently
  disabling the gate.

`docs-gate.spec.mjs` and `docs-gate-tiers.spec.mjs` are the test suites, and
`docs-gate-tiers.mjs` is the single registry they both read, so the promise and
the enforcement cannot drift apart:

```bash
node --test 'agents/dsh/presets/renks/*.spec.mjs'
```

A dsh update stays a merge, not a rewrite. The repo commits no copy of the stock
recipe; `agents/dsh/presets/renks/` holds three parts:

- `stock-baseline.agent.cordis.yml` is the merge base, kept byte-identical to the
  installed stock `standard` recipe.
- `agent.cordis.patch` is the personal delta, the swaps above.
- `fallback.agent.cordis.yml` is the last-known-good generated recipe.

All three are generated by `tools/build-preset-recipe.mjs`, which reads the stock
recipe for the dsh version actually installed and rewrites the set from it. The
baseline used to be hand-frozen, which meant an upstream persona rewrite made
every install fall through to the fallback - a change to the patch could not
reach the machine at all. Now `install.sh` detects that case, regenerates the
recipe and merges again, so the upgrade path is self-healing:

```bash
node tools/build-preset-recipe.mjs          # regenerate baseline + patch + fallback
node tools/build-preset-recipe.mjs --check  # verify only; non-zero on drift
```

`agents/dsh/install.sh` 3-way merges the patch onto whichever dsh version is
installed, validates the YAML and the plugin rows, and installs the fallback only
when even a regenerated patch cannot merge. It also links `~/.dsh/AGENTS.md` and
`~/.dsh/skills` into this repo and sets `agent-presets.default: renks` in
`~/.dsh/settings.yaml`. After a dsh upgrade:

```bash
git pull && bash agents/dsh/install.sh
```

A dsh upgrade installs into a new pnpm directory and prunes the old one, which
leaves the links an earlier version wrote into `~/.dsh/profiles/node_modules`
pointing at nothing. They are inert, and removing them is safe:

```bash
find ~/.dsh/profiles/node_modules -type l ! -exec test -e {} \; -print
```

On-demand search stays the default as the skill list grows. Injecting the catalog
only pays off while there are a handful of skills, so it should not come back
past roughly three to five.

## What agents are told

`AGENTS.md` is the contract every tool receives: 95 lines covering scope and
ownership, non-negotiables, project entry, the CRISPY workflow, memory files, the
no-go list, and tool usage. Read it directly for the rules; depth lives in
`core/docs/`, which agents load on demand.

## The workflow

The config names its workflow CRISPY, after the ZenML LLMOps Database entry cited
in `core/docs/sources.md`. The shape here is the earlier Research, Plan, Implement
method that entry evolved from: three phases, each ending in a gate.
`core/docs/development-workflow.md` has the detail.

- Analysis. Classify the project as NEW or EXISTING, survey the repository, and
  write a numbered plan with success criteria for anything multi-file or
  uncertain. Assumptions land in `.ai/assumptions.md`. Gate: the plan is approved
  before implementation starts.
- Implementation. One task at a time, tests written before the code, diffs that
  trace back to the request, complexity budgets checked as work proceeds, linters
  and tests clean before moving on. Gate: budgets, linters, and tests pass.
- Review. Self-review the diff, then one ruthless edit of your own diff to remove
  dead code, abstractions, and noise comments. The result goes to a fresh-context
  reviewer, a subagent or second session that does not share the conversation, to
  hunt bugs, overreach, and unintended changes. Then the validation checklist and
  the prose scan. Gate: human approval before the commit.

The separate context is the point of the review step: a reviewer working from the
same session inherits the author's assumptions.

## Guardrails

The same rule is enforced differently per tool, because what a harness can
mediate differs. Three surfaces exist, and they are the reason the rules are
short: a sentence that must not fail belongs behind a control, not in the text.

| Surface | Mediates | Where |
|---|---|---|
| `docs-gate` | the tool call, before it runs | the dsh preset below |
| `block-danger` | the bash command, before it runs | Claude Code hooks, this section |
| linters, tests, the review checklist | the artifact, after it exists | `validation-checklist.md` |

This table mirrors the report `setup.sh` prints at install time; an edit here
belongs there too.

The gate is the strongest of the three, and deliberately the narrowest: it denies
a mutating call until the behavioural docs that call needs have been read. That
failure is the one this repo measured as systematic — of the 84 sessions that
mutated anything, **83 (99%) made their first mutation before reading the rules**
— and no amount of prose moved it, so a control was the only lever left. The
quantitative case for a surface like it comes from AgentGuard
([arXiv:2609.16287](https://arxiv.org/abs/2609.16287), `sources.md`): a frontier
harness left unmodified still modified unrelated files, rewrote tests, or ignored
failed validations in 69% of runs, and the guardrail cut that to 26.7% while
raising completion from 21.7% to 35.0%. Its guardrails are instruction-level,
injected when relevant; this gate mediates the call instead, which is a stronger
mechanism than the one the numbers are about.

Claude Code gets two hooks, wired in `agents/claude-code/settings.json`:

- `block-danger` runs before a Bash call and denies a fixed list: recursive
  deletes, `sudo`, `git push --force`, `chmod 777`, raw disk writes (`dd`,
  `mkfs`, `> /dev/sda`), and `git add -A` or `git add .`, which the shared rules
  ban for every tool.
- `lint-check` reports lint output after a file write or edit, for Python, Go, and
  Rust files whose linter is installed. It lowercases `tool_name` before comparing,
  so the `Write|Edit` matcher in `settings.json` reaches it.

`session-init` is the one piece that waits to be asked for. It would create `.ai/`
wherever a session starts, which surprised projects that chose not to initialize,
so it ships unwired, with the snippet to wire it at the top of the file.
`claudeignore` is wired by `setup.sh` as `~/.claudeignore`: `.env` files, keys,
`credentials/`, `secrets/`, `*.tfstate`, `*.tfvars`, and build or vendor
directories are never opened.

`settings.json` also carries the permission lists. A set of routine commands is
pre-approved: builds, tests, git read commands, file inspection, and network
fetches. Denied outright: `git push`, every `rm`, `git add -A`, `sudo`,
`chmod 777`, `chown`, `shutdown`, `reboot`, `mkfs`, and `dd`.

The shared rules carry the git-add ban for every tool. The destructive-command
list lives only in the Claude Code hook and its settings, so other tools do not
inherit it.

## Skills

| Skill | What it does |
|---|---|
| `plan` | surveys the repo and writes a numbered implementation plan with success criteria |
| `onboard` | reads an existing codebase like a new engineer, then asks about what is still unclear |
| `context` | files knowledge from the conversation into the right `.ai/` files |
| `review` | reviews the pending diff, unpushed commits, linters, and tests |
| `ship` | prepares a commit: verifies the staged diff, writes the message, runs the pre-commit checks |
| `ci` | runs lint, test, build, and security scan locally, then reports pass or fail |
| `debug` | works a bug down systematically: reproduce, isolate, verify assumptions, fix the cause, keep the regression test |
| `worktrees` | does the work in a git worktree so the main checkout stays untouched, then lands and cleans up the branch |
| `dispatch` | splits independent work across parallel subagents and verifies each result before merging it |
| `extend-config` | creates or updates files in this repo following the authoring spec |

## Reference docs

`core/docs/` is shared across projects and never copied into one. The table
below lists the docs people reach for most; `AGENTS.md` section 3 is the entry
point and names every shared doc with its path.

| Doc | Covers |
|---|---|
| `development-workflow.md` | the three workflow phases and the gate that ends each |
| `validation-checklist.md` | what to verify before declaring a task complete |
| `coding-standards.md` | naming, comments, error handling, refactoring rules |
| `testing.md` | unit, integration, and end-to-end tests, conventions, CI commands, quality gates |
| `git-workflow.md` | branches, commits, pull requests, and identity resolution |
| `security.md` | authentication, input validation, secrets, dependency review triggers |
| `onboarding.md` | procedure for entering an existing project |
| `ai-directory.md` | the `.ai/` structure standard |
| `project-docs.md` | the committed `docs/` and README standard |
| `agent-config-authoring.md` | how to add rules, skills, docs, and templates to this repo |
| `ai-writing.md` | prose rules for anything a human reads |
| `evals.md` | the retained eval set that gates changes to the shared rules |
| `sources.md` | where each rule, threshold, and design choice came from, by domain, with retrieval dates |

`core/docs/repository-map.md` describes the full layout, including the language
guides in `core/docs/languages/` and the ADR template in `core/docs/decisions/`.

`core/principles.md` sits outside `core/docs/` and holds the behavior rules an
agent loads before planning: Karpathy-style rigor plus operational rules such as
one task at a time and never committing without approval, complexity budgets, and
the anti-patterns list.

## Git identity

Identity is per machine, never tracked:

- `~/.config/git/identity` holds your `user.name` and `user.email`, mode 600.
- `~/.gitconfig` includes it conditionally for `~/Projects/**` and `~/.config/**`,
  so personal and work directories can resolve differently.
- `setup.sh` creates the file from your existing global config if it is missing,
  and falls back to `YOUR NAME` / `you@example.com` on a machine that has none,
  which you edit before the first commit.

Auth stays at the SSH level and out of git config. `core/docs/git-workflow.md`
covers the resolution order.

## Extending the config

1. Load `core/docs/agent-config-authoring.md`, or run the `extend-config` skill.
2. Write the file following its format rules: imperative bullets for rules,
   numbered steps for skills, headers and bullets for reference docs.
3. Run the wiring checklist: new docs go into `AGENTS.md` section 3, structure
   changes into `core/docs/repository-map.md`, new claims into
   `core/docs/sources.md`.
4. Commit with a conventional message, one logical change per commit, staging
   explicit files only.

## Validation

Run before finishing any change to this config:

```bash
for f in setup.sh ai-init ai-context agents/dsh/install.sh; do bash -n "$f"; done  # shell syntax
for f in agents/dsh/presets/renks/*.mjs; do node --check "$f"; done                # plugin syntax
node --test 'agents/dsh/presets/renks/*.spec.mjs'                                  # gate behaviour and tiers
node tools/build-preset-recipe.mjs --check                                         # preset recipe in sync with installed stock
find . -type l ! -exec test -e {} \; -print                                        # broken symlinks
python3 -c "import tiktoken,pathlib; e=tiktoken.get_encoding('o200k_base'); print(sum(len(e.encode(pathlib.Path(p).read_text())) for p in ('AGENTS.md','agents/claude-code/CLAUDE.md')))"  # injection budget
```

Each check needs its own loop: `bash -n` and `node --check` only inspect the
first file they are given. The last check needs `tiktoken` (`pip install
tiktoken`), which is not a repo dependency. It measures what a first request
carries: 2460 tokens on 2026-09-16 against the ~2.5K ceiling, so roughly 40
tokens of slack (`core/docs/evals.md`).

Skill frontmatter needs `name` and `description`, with `name` matching the
directory. Rule frontmatter needs `description`, `globs`, and
`paths`. Both blocks must parse as YAML: a colon inside an unquoted value ends
the scalar and the loader drops the file without an error, so quote any value
that contains one. The dsh patch flow keeps
`agents/dsh/presets/renks/stock-baseline.agent.cordis.yml` plus
`agent.cordis.patch` byte-identical to `fallback.agent.cordis.yml`; the three
are generated together by `tools/build-preset-recipe.mjs`, and `--check`
reports drift. See `agents/dsh/presets/renks/README.md`.

Prose in the README, docs, comments, and commit messages is checked against
`core/docs/ai-writing.md`, which lists the vocabulary and sentence patterns that
make text read as machine output. It applies to prose written into files humans
read; chat replies and `.ai/` files are exempt.

Provenance is checked too: a new rule or numeric threshold needs an entry in
`core/docs/sources.md` with a retrieval date, and the rule doc ends with a
`Sources:` line naming the sections that justify it. Anything without a source is
labeled repo design or community practice.

The checklist an agent runs before declaring a task done is a separate document:
`core/docs/validation-checklist.md`.

## Status

Wired for Claude Code, Cursor, Codex, Gemini CLI, and dsh; on this machine only
dsh is installed, and the other four carry links that no binary reads until one
is. `setup.sh` reports which harnesses it found and which tools the language
guides expect, because nothing fails when a harness is absent — the links simply
sit there, and a rule that reaches nothing looks the same as a rule that works.

Where the rules are enforced rather than read differs by harness, and the table
in Guardrails names what each one mediates. Two of the five have a control
behind them.

The dsh preset tracks whichever dsh version is installed through a patch instead
of freezing a copy of the upstream recipe.

Changes to the default preset or the shared rules face the retained eval set in
`core/docs/evals.md` first: anchor checks that always run, plus a task set for
substantive work. The gate is that success rate does not drop and cost per solved
task does not rise materially. Public benchmark scores are not treated as
evidence.

## Size, and the one budget this file breaks

`core/docs/complexity.md` budgets a file at 500 lines and requires the reason be
documented whenever one exceeds it. This file is about 680, and it is the only
artefact in the repo that does. It is the front door: everything a reader needs to
decide whether to install this, understand what it does, and check the claims is
here on purpose, because the alternative is a reader following four links before
they can judge anything. The budget exists to stop CODE becoming unreadable, and
the check that matters for docs is different: whether a doc states claims that can
be verified, which is why every measurement in this file names the command that
reproduces it rather than a number to be trusted.

`core/docs/project-docs.md` exceeds the same budget and declares its own reason at
the top of the file.

## License

MIT. See `LICENSE`.

## Sources and acknowledgements

This config is assembled from other people's work. `core/docs/sources.md` records
every source with its retrieval date and what it backs, split between the sources
behind specific rules and the practitioner writing that shaped the stance. The
people below are the ones it leans on most.

- Fabio Akita (`akitaonrails`), for the position that AI-assisted work ships under
  the same review standard as any other code, and for `ai-memory`, an independent
  build of the same idea behind `.ai/`: agent memory as versioned markdown, with
  writes gated by evaluation.
- Robert C. Martin and Justin Martin. The function rules in Clean Code (small
  functions, one thing per function, few arguments, one level of abstraction)
  state in prose what this repo enforces in numbers; Clean Architecture covers
  dependency direction. Their Clean AI: Agentic Discipline series makes the
  argument the guardrails act on: discipline an agent cannot be trusted to
  remember belongs in the tooling.
- Andrej Karpathy, for the llm-rigor principles: think before coding, surgical
  changes, minimum viable code, and pushback that scales with certainty.
- HumanLayer, for the Research-Plan-Implement to CRISPY talk, which supplied the
  CRISPY name and phase structure, and the argument that always-on prompt budget
  is scarce.
- Anthropic, for Claude's Character and the sycophancy research behind the
  non-negotiables, the context engineering guidance behind the lean injection
  policy, and the skills pattern that `skill_search` mirrors.
- Matt Pocock, for publishing his own agent skills, a working reference for how a
  skill directory and its frontmatter should look.
- Martin Fowler and Kent Beck, for the test pyramid and self-testing code that the
  testing rules follow, and for writing about augmented coding as it develops.
- Thomas McCabe and G. Ann Campbell, for the two complexity metrics this repo
  budgets against, and the maintainers of `zj-karina/complexity-budget` for the
  numeric budgets themselves.
- Google, for the developer style guide, the engineering practices on code
  review, and the SRE postmortem culture.
- Simon Willison, for documenting in public what agent tooling does in practice,
  failure modes included, and for naming the lethal trifecta behind the guardrails.
- Jesse Vincent, whose superpowers project is the working reference for shipping
  one skill set to several harnesses at once.

Papers, standards, and studies behind the rest of the rules are listed in
`core/docs/sources.md`: among them the Agent Skills standard that this repo's
`SKILL.md` format follows, the Wikipedia WikiProject AI Cleanup essay on the signs
of AI writing, the ETH Zurich study on instruction bloat and inference cost, the
METR trial on measured developer productivity, the DORA report on AI as an
amplifier, OWASP's application and LLM top tens, Jakob Nielsen on AI usability,
Diataxis, Keep a Changelog, Conventional Commits, and the work of Parnas, Yourdon
and Constantine, Feathers, Nygard, Knuth, and Chroma.

Four additions bear directly on the gate, and the weight of each is recorded where
it is cited rather than left to the reader to guess:

- Shin, **[The Compliance Gap](https://arxiv.org/abs/2605.01771)** (arXiv:2605.01771) — 2,031
  sessions, six frontier models, **0% compliance on file reading**, and a proof
  that the gap cannot be detected from text. This is the strongest published
  support the gate has, and it also bounds the claim: an agent saying it read a
  file is never evidence.
- Dai and Wang, **[AgentGuard](https://arxiv.org/abs/2609.16287)** (arXiv:2609.16287) — what
  execution guardrails buy on real coding-agent traces: an abnormal execution rate
  cut from 69.0% to 26.7%, completion up from 21.7% to 35.0%.
- **[String](https://arxiv.org/abs/2608.28027)** (arXiv:2608.28027) — causal staging: a tier
  of detail disclosed one turn too early costs up to 23 accuracy points, and
  proper staging drops wrong-action selection from 28% to 2%. This is the result
  behind not loading rules a call cannot use.
- Du, **[Memory for Autonomous LLM Agents](https://arxiv.org/abs/2603.07670)** (arXiv:2603.07670)
  — summarisation drift and attentional dilution, the reason a credit must be
  bound to raw content and why a bigger window is not the answer.

Rodrigues Pereira's **An LLM Agent Cannot Be a Gate** and the Du survey are not
peer-reviewed: one is a self-published preprint with a single deployment, the
other a single-author survey. `sources.md` marks both, because what this repo
borrowed from them is the framing, not the evidence. ObjectGraph
(arXiv:2604.27820) is cited as direction only, and `sources.md` says why the 95%
token reduction it reports is not a result about this gate. If a rule here
misstates its source, or a source is missing, the fix belongs in that file.

Named after the Prometheus Circuit in Chrono Trigger, the machine that directs the
others and answers to the people who keep it.

Thank you all. Long live knowledge and open source. =)
