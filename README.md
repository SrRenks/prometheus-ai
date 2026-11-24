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

## What is in this file

Getting it running: [Supported tools](#supported-tools) · [Requirements](#requirements) · [Install](#install)

How it works: [The `.ai/` directory](#the-ai-directory) · [Repository layout](#repository-layout) · [How one config reaches every tool](#how-one-config-reaches-every-tool) · [dsh and the `renks` preset](#dsh-and-the-renks-preset) · [What agents are told](#what-agents-are-told) · [The workflow](#the-workflow) · [How this setup compares with the evidence](#how-this-setup-compares-with-the-evidence)

What holds the rules in place: [Guardrails](#guardrails) · [Reference docs](#reference-docs)

Checking it yourself: [Validation](#validation) · [Status](#status)

Working on it: [Git identity](#git-identity) · [Extending the config](#extending-the-config)

The rest: [Sources and acknowledgements](#sources-and-acknowledgements) · [License](#license) · [Size, and the one budget this file breaks](#size-and-the-one-budget-this-file-breaks)

## Supported tools

| Tool | Source in this repo | Bridge installed by `setup.sh` |
|---|---|---|
| Claude Code | `agents/claude-code/` (CLAUDE.md or CLAUDE.token.md, settings.json, hooks, rules, commands, claudeignore) plus `skills/` | `~/.claude/` |
| Codex | `AGENTS.md` | `~/.codex/AGENTS.md` |
| Gemini CLI | `agents/gemini/GEMINI.md` | `~/.gemini/GEMINI.md` |
| Cursor | `agents/claude-code/rules/` (combined frontmatter) | `~/.cursor/rules` |
| Any AGENTS.md tool | `AGENTS.md` | `~/.agents/AGENTS.md` |
| dsh | `agents/dsh/` preset plus `skills/` | not by `setup.sh`: run `agents/dsh/install.sh`, which writes `~/.dsh/` |

## Requirements

- `bash` and `git`.
- `node` for the Claude Code `docs-gate` hook and the preset YAML check inside
  `agents/dsh/install.sh`.
- `jq` for the `block-danger` and `lint-check` hooks. Without `node` or `jq` those
  hooks let every call through, and `setup.sh` says so.
- dsh itself, if you want the dsh preset; the rest of the config works without it.

## Install

```bash
git clone git@github.com:SrRenks/prometheus-ai.git ~/.config/prometheus-ai
cd ~/.config/prometheus-ai
./setup.sh                    # tool bridges and the git identity include
                              # add --mode token on pay-per-token billing, see below
bash agents/dsh/install.sh    # dsh preset and shared skills (optional)
```

### Two modes: subscription and token

The rules reach Claude Code one of two ways, and `setup.sh --mode` picks which
`CLAUDE.md` is linked into `~/.claude/`:

| Mode | `~/.claude/CLAUDE.md` links to | What every session carries | Use it when |
|---|---|---|---|
| `subscription` (default) | `agents/claude-code/CLAUDE.md` | all of `AGENTS.md` plus `claude-code.md`, about 2.5K tokens | Claude Code on a flat-rate plan |
| `token` | `agents/claude-code/CLAUDE.token.md` | a four-line pointer plus `claude-code.md` | Claude Code on an API key, or to save plan usage |

Token mode is close to what the dsh preset does: only the pointer is injected, the
agent is told where the rules are, and `docs-gate` denies a write until the
tier's docs have been read. `AGENTS.md` itself is read because the pointer says
so, not because the gate demands it. The hooks, skills and settings are the same in both modes. dsh is
always in token mode through its own preset. Codex and Gemini get the full rules
in both modes, because nothing in those tools enforces a read, so a pointer would
leave them with no rules at all.

```bash
./setup.sh --mode token          # switch to token mode
./setup.sh --mode subscription   # switch back
./setup.sh                       # re-run, keeping whichever mode is linked
```

The link itself records the mode, so there is no state file to drift from what
Claude Code loads. The Claude Code rules live once, in
`agents/claude-code/claude-code.md`, and both CLAUDE files import it.

`setup.sh` derives every path from its own location and is safe to re-run. A real
file sitting where a symlink will go is copied to `backups/<timestamp>/` first, so
nothing is lost.

Keep the clone at `~/.config/prometheus-ai`. The paths written inside `AGENTS.md`
and the skills name that location, and `ai-init` / `ai-context` point every project
they touch at it, so a clone somewhere else leaves agent instructions referencing
files that are not there. `setup.sh` warns when it runs from another path, and
`ai-init` / `ai-context` accept `PROMETHEUS_AI_CONFIG_DIR` if you relocate the config on
purpose.

### Bringing up a machine from nothing

Five steps, and only the last two are manual. Two of them are separate
repositories, because this config is not the whole system.

| # | Step | What it produces |
|---|---|---|
| 1 | install dsh itself | the runtime, and the stock recipe `install.sh` reads |
| 2 | clone this repo, run `setup.sh` | harness bridges, git identity include |
| 3 | `bash agents/dsh/install.sh` | the `renks` preset, and the 0.2.0 bundle at `~/dsh-user-presets` |

Two constraints matter on a second machine, both found by `dsh web` failing on
one running an older dsh.

The preset needs **dsh >= 0.1.7-alpha.1**, because a preset is a
`@deepseek-ai/dsh-agent-preset` row and that package does not exist before then.
`install.sh` checks for it first and refuses with the upgrade command rather than
building a bundle whose profile cannot start.

The bundle declares `dsh.bundle.patch` as a **single path**, and the builder
refuses to emit more than one. dsh 0.2.0 accepts a path or a list, but dsh 0.1.2
reads the field with no type check and hands it to `path.join`, so a list throws
`ERR_INVALID_ARG_TYPE` before any profile loads. That is what a one-element list
did here, and `tools/verify-bundle-manifest.mjs` reproduces both loaders so it
cannot come back. `dsh-unrestricted` has always declared a single path for the
same reason.
| 4 | clone `dsh-unrestricted-renks`, edit the profile's `package.json` | the toggleable unrestricted plugin, mounted |
| 5 | `pnpm install` in the profile, start a new session | the profile reads both bundles |

`dsh-unrestricted-renks` is its own repository and nothing here installs it. Its
version and the dsh version this recipe was merged against are the two facts to
match on another machine:

```
dsh                      0.2.0-rc.2
dsh-unrestricted-renks   v0.2.2-renks.1   (tag on that repo; 0.1.9 is the floor)
prometheus-ai            this commit
```

THE FLOOR APPLIES TO EVERY PROFILE, the TUI included, and `install.sh` checks it.
An old pin on `dsh-tui` reads as deliberate, on the theory that the TUI runs its
own runtime with a different adapter. It does not: both profiles boot the same dsh
CLI, so their runtime comes from the CLI's install rather than from the profile,
and `dsh-settings` offers `configure`, `get` and `update` with no `register` in
either. A pin below 0.1.9 therefore installs in the TUI exactly as it installs in
`web`, and then fails to activate.

Step 8 runs `node tools/check-profile-deps.mjs`, which reads every profile that
names the plugin and reports one below the floor. A `file:` pin carries no version,
so the version is read from the package that spec points at; a spec naming no
version that can be found is reported as unreadable rather than assumed good.

WHAT THIS CLAIM RESTS ON, because it is not all the same strength. The settings
service is the strong part: it is `dsh-settings` in the CLI's install, and the
absence of `register` there was read from that package. The TUI's own peer range
is not checked against a running TUI: the profile on this machine carries
`@deepseek-harness-tui/dsh-tui` **0.12.0**, and no TUI session has ever been
recorded, so nothing here observes the plugin loading under the TUI. What the
check can say is what the pins are, which is the part that was silently wrong.

WHY v0.2.2-renks.1 AND NOT v0.2.1-renks.1: the published tag of that name is the
older code, kept so anyone who pinned it keeps getting what they pinned. The 0.2.2
tag carries the renks preset port for dsh 0.2.1 plus the drift guard that follows
the preset into the 0.2.0 bundle layout.

That floor is worth stating because it was a real failure. `dsh-unrestricted` up to
v0.1.8 calls `ctx.settings.register`, which cordis 4.0.4 does not have, so an older
tag installs cleanly and then fails to activate with `TypeError:
ctx.settings.register is not a function`. v0.1.9 replaced it with
`ctx.settings.configure`. Anything before that cannot run on dsh 0.2.0, and the
only published tag on that repository was v0.1.4-renks.1 until v0.2.2-renks.1 was
cut.

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
ai-init      # creates .ai/ and ignores it in .git/info/exclude (local, never committed)
ai-init --team         # also writes a short ./AGENTS.md for the team to commit
ai-init --link-agents  # links ./AGENTS.md to the shared rules, for Cursor only
ai-context   # writes context topic files and the project README, once the project has content
ai-init --overlay acme # links .ai/overlay.md to your overlay named acme
ai-survey    # prints computed facts: git state, stack markers, churn; --siblings ~/Projects for neighbours
ai-lint      # checks .ai/: citations that no longer resolve, tables, bold, placeholders
ai-skeleton src/   # classes and functions with line numbers, no bodies
ai-worktree new login-fix --type fix   # a locked worktree and branch for one task
```

| Path | Role | Ownership |
|---|---|---|
| `.ai/agents.md` | symlink to this config's `AGENTS.md` | shared, never edited |
| `.ai/project.md` | stack, build/test/lint commands, local conventions | project |
| `.ai/overlay.md` | symlink to a company or personal overlay | your overlay, or the shipped default |
| `.ai/session.md` | current session state, written at the end of a task | project |
| `.ai/assumptions.md` | decision log, one numbered entry per decision | project |
| `.ai/scratchpad.md` | working notes, commands, investigation results | project |
| `.ai/context/index.md` | maturity, stack, pointers, open gaps | machine, refreshed on every `ai-context` run |
| `.ai/context/<topic>.md` | domain, architecture, database, dependencies, conventions | created once, then never overwritten |
| `.ai/docs/` | project-specific convention docs, created on demand | project |
| `.ai/audits/` | `quality-audit` reports, one dated file per run | project |
| `.ai/evals/` | retained eval runs, optional | project, see `core/docs/evals.md` |

How it behaves:

- The shared rules arrive by symlink. Editing `AGENTS.md` here updates
  `.ai/agents.md` in every project at once, and no project keeps a copy to drift.
- A project is set up before its first change. In a git repository with no
  `.ai/project.md`, `docs-gate` denies changes in both dsh and Claude Code and
  names the steps: classify the project, ask the user to approve `ai-init`, run
  it. Reading and exploring stay open, so do writes that only create files
  under `.ai/` (`ln`, `mv` and `rm` do not count, and a symlink cannot carry a
  write out), and Claude Code says so when a new session starts. Folders without
  git, this config checkout, a clone opted out with
  `touch "$(git rev-parse --git-path info/ai-optout)"` (it works in worktrees and
  submodules too) and `DOCS_GATE_REQUIRE_INIT=0` are exempt. Run from a
  subdirectory, `ai-init` sets up the repository root. The check requires `ai-init`, not the
  whole onboarding survey; the next section says why.
- `.ai/` stays out of git without touching the repository. `ai-init` writes the
  ignore entry to `.git/info/exclude`, which belongs to the clone and is never
  committed, so one person's agent files do not show up as a change to the
  team's `.gitignore`.
- `ai-init` no longer links `./AGENTS.md` into the project. Claude Code (2.1.277
  and later) loads a project `AGENTS.md` whenever the project has no `CLAUDE.md`,
  so the link put the whole shared rule set back into token-mode sessions, and
  every harness except Cursor already gets the shared rules from its user-level
  config. `--link-agents` keeps the link for Cursor.
- `ai-init --team` writes a short `./AGENTS.md` meant to be committed: the
  commands and the conventions the code does not show, for teammates and CI
  agents. It stays separate from `.ai/`, which is personal working memory.
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

### Overlays: company and personal rules

Rules that hold for every repository of one company, or for one person's style,
sit in an overlay between the shared rules and the project: the reply and doc
language, the branch model, how tickets are named, the environments, which acts
need separate approvals. `.ai/project.md` still wins over the overlay.

The shipped `core/overlays/default.md` changes nothing and explains each section;
every section is optional, so an overlay can set only the branch model and leave
ticket numbers out. Your own overlays live outside this repository, in
`~/.config/prometheus-ai.local/overlays/<name>.md` (or `$PROMETHEUS_AI_LOCAL`), so
company process never lands in a public config. `ai-init --overlay <name>` links
one into a project; name yours `default.md` and every new project gets it.

### Existing projects: audit, quality audit, task kickoff

Three skills cover the work that used to be long pasted prompts:

| Skill | What it does | What it writes |
|---|---|---|
| `audit` | First audit of an existing project and the repositories it talks to. Starts from `ai-survey`, explores by the questions the work needs, records each fact with `path:line` evidence and a confidence, keeps conflicts and one-sided cross-repo relations as open questions. Re-run it to refresh facts whose cited files changed. | `.ai/context/` topic files |
| `quality-audit` | Tools first (linters, tests, complexity, dependency audit, semgrep when installed), then findings judged against the code's stated intent. A finding counts only with a reproducing test or command, or a `path:line` trace from input to wrong outcome; the rest are listed as unverified, and what the actionability filter dropped is counted. | `.ai/audits/<date>-quality.md` |
| `kickoff` | Reads an issue, lists what it states, what the code answers and what is missing, and asks about the gaps; then creates the task's worktree and branch, writes a failing reproduction, and plans in fixed phases (locate, reproduce, change, validate) before stopping. | the worktree's `.ai/session.md` |

They differ from the earlier prompts on purpose. Those asked for 100% file
coverage, repeated scoring loops and self-graded 100/100 scores. A study of
repository context files found that pushing agents into more exploration cost
about a fifth more without raising success (arXiv:2602.11988), LLM reviewers
over-report on correct code, and a score a model gives its own audit cannot be
checked from outside. So the computable parts became commands (`ai-survey`,
`ai-lint`, `ai-skeleton`), the audit is scoped by questions, and every finding
carries evidence a person or a script can check. `core/docs/sources.md` has the
studies.

Measured here on a client repository (Sonnet, 10 questions provable from the code, graded
blind): a fresh agent answering from an audit's `.ai/` pack scored 3.0 to 3.5 of
10, from the old first-audit prompt's packs or from the `audit` skill's alike,
while an agent that read the code when asked scored 9.25, for about the cost of
one audit ($0.45 against $0.49 plus $0.15). The skill reached the old prompt's
score with a third to a half of its tokens. So an audit is not the way to learn
what the code already shows; its use is the knowledge the code cannot show,
which only you can answer, and that part was not measured. Full numbers are in
`core/docs/sources.md`.

Each step below rests on a benchmarked study, with its strength stated:

| Step | What was measured | Strength |
|---|---|---|
| `kickoff` plans a failing reproduction as the first phase, before any fix | the most valuable signal on SWE-bench Live and Pro; a reproduction written by a stronger model and given to a weaker one added 19 to 28 points (ORACLE-SWE, about 100 sampled tasks per dataset); Agentless's largest component (+5) | strong |
| `kickoff` lists missing information and asks | models almost never ask unprompted; asking recovered 80 to 89% of full-spec performance for Claude models and 54 to 59% for weaker ones (Ambig-SWE, ICLR 2026, six models) | strong, simulated users |
| files, then `ai-skeleton`, then lines, one hop of callers | signatures beat whole files for localization (58% vs 54%, a seventh of the cost); two-hop context measured worse | replicated, but the resolve-rate gain is small (+1.6 to +3.3) and mostly 2024 models |
| `quality-audit` proves findings by reproduction or trace, uses intent text, filters for action | path-grounded triage of static-analysis alarms removed 94 to 98% of false positives while dropping 12 to 25% of real bugs; intent text raised review F1 from 36 to 64 on older models; an LLM correctness judge had minimal impact in one production system | mixed: single or private datasets, consistent in direction; applying them to audits is a judgement |

`ai-skeleton` matched Python's own parser on all 7,607 definitions of six local
repositories (precision and recall 1.000), and the TypeScript compiler on 516 of
521 definitions in a client repository's TS/TSX files (precision and recall 0.990). Other languages are matched by
pattern and checked only by the spec.

### How the flow starts by itself

Agents rarely pick the right skill on their own. In Vercel's eval a skill was
never invoked in 56% of runs, and an explicit instruction raised triggering to
over 95%; in a study of four coding agents, the repository's policy file was
opened in 12 of 347 runs. So both dsh and Claude Code now say the next step at
the moment it applies, from `flow-router.mjs`:

| When | What the agent is told |
|---|---|
| a session starts in a repo with no `.ai/project.md` | ask you to approve `ai-init` (with your overlay), then run `audit` |
| a session starts in a set-up repo with no audited facts | `audit` builds `.ai/context/` when the work needs it |
| a session starts while task worktrees are running | which tasks, and that a new task gets `ai-worktree new` |
| a session starts inside a task worktree | its spec and plan are in `.ai/session.md` |
| your message names a GitHub issue or PR (`owner/repo#12`, an issues or pull URL) | `kickoff` starts a task from it |
| your message asks for an audit | `audit` and `quality-audit` |

Each note is one line, said once per session, and never blocks. One thing is
blocked instead of suggested: `git switch` and `git checkout <branch>` in a
checkout while an `ai-worktree` task is running, because the same study found
"do not" rules followed 0 to 10% of the time even with reminders. Restoring a
file (`git checkout -- a.txt`) is not affected, and with no task running nothing
changes.

Measured here with Claude Code on Sonnet (24 headless runs, 3 per cell, router
on against `FLOW_ROUTER_DISABLED=1`): with a task worktree locked and the prompt
"switch to develop and fix a typo", the shared checkout stayed on `main` in 3 of
3 runs with the router and in 0 of 3 without it. The guidance notes changed
nothing on Sonnet: it asked for `ai-init`, used `kickoff` and used `audit` in
3 of 3 runs either way. They are kept for weaker models and cost nothing
measurable; that part is untested on DeepSeek, which this network cannot reach.

What stays manual is what every vendor keeps manual: approving `ai-init`, the
plan, each commit and the merge. There is no gate that forces questions. Pushed
to ask, models asked needless questions on complete tasks at rates of 36 to 93%
(Ambig-SWE), and mid-task interruptions were dismissed 62% of the time in a
JetBrains field study, so `kickoff` keeps its one missing-information check at
the start of a task.

For you at the terminal, `ai status` prints the same state and the next
command, and `ai init`, `ai task new|list|remove` and `ai survey|lint|skeleton`
route to the ai-* commands.

To turn the notes and the block off: `FLOW_ROUTER_DISABLED=1` disables only the
router in Claude Code (`DOCS_GATE_DISABLED=1` disables the whole hook), and
`flowRouter: false` in the dsh preset config disables the router there. Both fail open: an error in a note or in the switch check lets the
prompt or the command through.

### Several tasks in one repository

Two agents in one checkout share its HEAD and its index: one `git switch` moves
the files under the other, their staging collides, and each ends up waiting for
the other. The rule is one worktree per task, and never switching the branch of
a checkout your task did not create.

```bash
ai-worktree new login-fix --type fix   # .worktrees/login-fix on fix/login-fix, locked
ai-worktree list                       # every task, its branch, and whether it is taken
ai-worktree remove login-fix --delete-branch   # refuses uncommitted work
```

`.worktrees/` sits in the main checkout and is ignored through
`.git/info/exclude`; the name belongs to no vendor, and worktrees made by other
tools still show up in `ai-worktree list`. Each worktree shares the project's
`.ai/` knowledge through links to the main checkout and keeps its own
`session.md` and `scratchpad.md`. Gitignored files it needs, such as `.env`, go
in `.worktreeinclude`, in gitignore syntax; git does the matching, so only
files it ignores are copied and nothing outside the repository can be named.
The lock marks the task as taken until `remove`; it cannot tell a running task
from a finished one. Dependencies, ports and database names are per worktree,
and the tool installs nothing: the `worktrees` skill tells the agent to set them
up. `ai-init` inside a worktree sets up the main checkout, and `docs-gate` in
both dsh and Claude Code reads the main checkout's `.ai/project.md` from a
worktree.

## Repository layout

```
AGENTS.md              universal rules, no tool-specific content
setup.sh               installs every tool bridge on this machine
ai-init, ai-context    per-project tooling (linked into ~/.local/bin)
ai-survey, ai-lint     computed project facts, and the .ai/ checker
ai-skeleton            definitions with line numbers, without bodies
ai-worktree            one worktree per task
core/
  docs/                reference library, read on demand
  principles.md        universal agent principles
  templates/           .ai/ and project-docs skeletons
  overlays/            the shipped default overlay (yours live in ~/.config/prometheus-ai.local)
agents/
  claude-code/         CLAUDE.md, CLAUDE.token.md, claude-code.md, settings.json, hooks/, rules/, commands/
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
- Each harness gets the shared rules from its own user-level config:
  `~/.claude`, `~/.codex`, `~/.gemini`, `~/.dsh`. A project gets a `./AGENTS.md`
  only when asked: a committed team file (`ai-init --team`) or, for Cursor, a link
  (`ai-init --link-agents`).
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
| nothing enforced the read-on-demand index at the end of `AGENTS.md` | `docs-gate.mjs` | mutating tool calls are denied until the session has successfully read the mandatory doc set's CURRENT content; the denial names the files and lifts as the reads land, points at the AGENTS.md contract, and requires that contract itself only for writes under `.ai/` |

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

Replaying those transcripts against the gate's own classifier is the strongest
argument for enforcing at the tool call rather than in a message, and it is a
BASELINE FROM BEFORE THE GATE EXISTED rather than a current reading: measured
2026-10-02 on the 84 sessions recorded up to then, **83 (99%) made their first
mutation before reading the set**, at a median of 3 tool calls in, and 51 mutated
within the first 5 calls. The window in which a hint could plausibly work is
routinely zero to three calls.

That percentage falls as this gate does its job, so quoting it as a live figure
would invert its meaning: a session that mutates before reading is now the case
the gate is built to catch, and the sessions recorded since are a mix of gated and
ungated. `tools/audit-instruction-reads.mjs` reports the part that can be
re-derived on demand, which is how many transcripts read an instruction file and
how many denials a session then honoured. The pre-gate figure is history and is
labelled as such.

That local number matches a result published far more widely. Shin, [The
Compliance Gap](https://arxiv.org/abs/2605.01771), ran 2,031 sessions across six
frontier models and found **0% compliance on file reading under default framing**:
Claude Sonnet 4 agreed verbally ten times out of ten and bypassed in all ten. The
important part is the second theorem. The gap is undetectable from text alone, by
any human or LLM observer, so an agent SAYING it read a file is not evidence, and
no amount of reading transcripts can recover the truth. What the paper prescribes
is a tool-call log, which is what this gate is, and its controlled result points
the same way: removing the affordance to skip raised compliance from 0% to 75%
(Cohen's d = 2.47). The fix is to remove the shortcut, not to phrase the request
better.

`docs-gate.mjs` observes `tools/pre-execute` - the waterfall `dsh-tools` runs
before every tool body - and denies a mutating call until the session has read
what that call's tier requires. The denial reaches the model as the tool result,
so the corrective instruction arrives exactly where the model is looking. It
also observes `tools/post-execute`, only to note next to a read result that the
read covered part of a gated doc.

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
  files. Claude Code does name the subagent in hook input (`agent_id`), so
  per-agent credits are possible; they are not used because the shared rules
  keep subagents to exploration and review, which the gate leaves open, and
  re-reading would cost every delegated writer the whole tier. An unresolvable
  workspace fails closed rather than silently
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
`~/.dsh/skills` into this repo and makes `renks` the default preset by writing
`agent-preset-registry.default` into each profile's `cordis.patch.yml`. An earlier
version wrote `agent-presets.default` into `~/.dsh/settings.yaml`; dsh 0.2.0
imports that file's sections into the entry with the matching id and renames it,
no entry carries that id, and the choice was dropped. After a dsh upgrade:

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

`AGENTS.md` is the contract every tool receives: 89 lines covering scope and
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

## How this setup compares with the evidence

Checked on 2026-11-23 against vendor guidance, two controlled studies and the
practitioners most cited for agent workflows. The entries, with links, are in
`core/docs/sources.md` under "Agent context files" and "Practitioner sources".

| Choice | What the evidence says | Status here |
|---|---|---|
| Plan gate, test-first, fresh-context review | Supported by Anthropic's best practices, Addy Osmani, Harper Reed and Kent Beck; TDFlow reached 88.8% on SWE-bench Lite with human-written tests | kept |
| Hooks for rules that must hold | Anthropic: use a hook when a rule keeps being missed, and keep the enforced set small | kept, see Guardrails |
| One short global file plus repo-level context | The AGENTS.md standard and Claude Code, Codex and Gemini all layer a user file under a repo file | kept |
| Forcing a full onboarding survey before the first change | The ETH Zurich study of context files (ICLR 2026) found pushed exploration raised cost by about a fifth without raising success | dropped: only `ai-init` is required, and the survey covers what the task touches |
| Context written by an LLM | Same study: generated files moved success by -0.5 to -2 points, not significant, and cost 20 to 23% more; human-written ones beat generated ones by 7 points | topic files stay question lists, and the docs say to record only what the code does not show |
| Keeping project rules uncommitted | Every vendor, and Thoughtworks' Technology Radar at Adopt, commits a short repo file for the team | `.ai/` stays local as working memory; `ai-init --team` adds the committed file |
| A gate that makes agents read the rules | Called deferred eager loading by the review this table comes from; against it, agents opened the policy file in 3.5% of unprompted runs and complied with read instructions 0% of the time in the studies cited under Guardrails | kept, with the cost measured (`node tools/verify-docs-gate.mjs`) |

The two studies disagree in places. Lulla et al. found an `AGENTS.md` cut runtime
by 28.6% and output tokens by 16.6% at similar completion, where the ETH study
measured higher cost. Neither covers this repository's tasks, which is why
`core/docs/evals.md` keeps a retained task set; running it with and without the
context is the open measurement.

## Guardrails

The same rule is enforced differently per tool, because what a harness can
mediate differs. Three surfaces exist, and they are the reason the rules are
short: a sentence that must not fail belongs behind a control, not in the text.

| Surface | Mediates | Where |
|---|---|---|
| `docs-gate` | the tool call, before it runs | the dsh preset below, and a Claude Code hook |
| `block-danger` | the bash command, before it runs | Claude Code hooks, this section |
| linters, tests, the review checklist | the artifact, after it exists | `validation-checklist.md` |

This table mirrors the report `setup.sh` prints at install time; an edit here
belongs there too.

The gate is the strongest of the three, and deliberately the narrowest: it denies
a mutating call until the behavioural docs that call needs have been read. That
failure is the one this repo measured as systematic before the gate existed: of
the 84 sessions recorded up to 2026-10-02 that mutated anything, **83 (99%) made
their first mutation before reading the rules**, as above. No amount of prose
moved that, so a control was the only lever left. The
quantitative case for a surface like it comes from AgentGuard
([arXiv:2609.16287](https://arxiv.org/abs/2609.16287), `sources.md`): a frontier
harness left unmodified still modified unrelated files, rewrote tests, or ignored
failed validations in 69% of runs, and the guardrail cut that to 26.7% while
raising completion from 21.7% to 35.0%. Its guardrails are instruction-level,
injected when relevant; this gate mediates the call instead, which is a stronger
mechanism than the one the numbers are about.

Claude Code gets three hooks, wired in `agents/claude-code/settings.json`:

- `docs-gate.mjs` is the dsh gate as a hook. It imports the classifier, the tiers,
  the workspace walk, the content fingerprint and the credit store from
  `agents/dsh/presets/renks/`, so both harnesses deny the same calls for the same
  missing docs. It runs before Edit, Write, MultiEdit, NotebookEdit and Bash,
  credits after Read and Bash, and costs no model tokens until it denies. Four
  things differ from dsh. A hook is a new process per call, so the credits live
  on disk under `~/.claude/state/docs-gate/<session>/`, one file per doc.
  Compaction and `/clear` reset them, the optional store included, because a
  compacted session holds a summary of the rules and not the rules. A `cat` of
  a whole doc counts as a read, but only when the doc's full current content is
  in the command's stdout. And the denial lists absolute paths, which the Read
  tool takes as written. In token mode `AGENTS.md` joins the required set,
  because that mode no longer injects it. In a git repository with no
  `.ai/project.md` the first denial asks for `ai-init` instead, as described
  under "The `.ai/` directory".
  `DOCS_GATE_DISABLED=1` turns it off; `DOCS_GATE_CREDIT_STORE=<path>` turns on
  the cross-session store, off by default for the reason the preset README gives.

  How both harnesses judge a Bash command. It is parsed into simple commands
  (`docs-gate-shell.mjs`), so words inside strings, heredoc bodies and comments
  are text. git counts by subcommand and flags: `git log`, `git merge-base`,
  `git tag -l` and `git stash list` pass, `git commit`, `git switch` and
  `git tag v1` do not. File commands and redirects count only when the target is
  inside the workspace, after any `cd`, so `mkdir -p /tmp/x` passes. Inline
  interpreter code (`python -c`, `python - <<EOF`, `node -e`, `bash -c`) is
  scanned for write and process calls, and shell code (`bash -c`, `echo ... | sh`)
  is parsed like the rest; a program piped in from somewhere unreadable, such as
  `curl ... | sh`, counts as a write. That scan is a tripwire, not a sandbox, and
  a script file is not read at all. A command that does several things needs the
  docs of all of them, so `rm a.txt && git commit` asks for the code tier and the
  commit docs. Inline Python that runs only literal, read-only commands through
  `subprocess` (`git ls-files`, `git show`) passes; any other `subprocess` use
  counts. Replayed with `node tools/replay-gate-denials.mjs` over the 241 `bash`
  calls the old regex classifier denied in recorded dsh sessions, 180 were
  queries and now pass; the 61 still denied write to the workspace or run a
  process the gate cannot read.

  Three things keep a denial from turning into a loop. A Read with `offset` or
  `limit` that misses part of a doc is not a credit, and the agent is told so
  next to the tool result, in dsh and in Claude Code. Every denial ends by
  naming the exit, tell the user and
  stop, and says writing another way is gated too; that wording comes from a
  measured study in which only "report and stop" brought circumvention to zero
  (`core/docs/sources.md`). The third identical denial of a call says that
  retrying it unchanged will not help.
- `block-danger` runs before a Bash call and denies a fixed list: a recursive
  forced `rm` (combined, split, quoted or trailing flags), `sudo`, a force push
  (`-f`, `--force`, or a `+ref` refspec), `chmod 777`, raw disk writes (`dd`,
  `mkfs`, `> /dev/sd*`), and `git add -A`, `--all` or `.`, which the shared rules
  ban for every tool. It is a tripwire for the usual spellings, not a sandbox:
  `find -delete` or an interpreter can still delete. It matches the whole command
  text, heredoc bodies included, so a script that only carries one of those
  strings as data has to live in a file.
- `lint-check` reports after a write or edit: ruff for Python, `go vet` for Go,
  `rustfmt --check` for Rust, `node --check` for JavaScript and `bash -n` for
  shell. The report goes to stdout as `additionalContext`, which is the channel
  Claude reads after a tool call. Until 2026-11 it went to stderr with exit 0,
  which only reaches the debug log, so no lint report had ever reached the model.
  A missing linter is said once per session, and Python still gets a syntax
  check without ruff.

`session-init` is the one piece that waits to be asked for. It would create `.ai/`
wherever a session starts, which surprised projects that chose not to initialize,
so it ships unwired, with the snippet to wire it at the top of the file.
`claudeignore` is wired by `setup.sh` as `~/.claudeignore`: `.env` files, keys,
`credentials/`, `secrets/`, `*.tfstate`, `*.tfvars`, and build or vendor
directories are never opened.

`settings.json` also carries the permission lists. A set of routine commands is
pre-approved: builds, tests, git read commands, file inspection, and network
fetches. Denied outright: `git push`, every `rm`, `git add -A`, `sudo`,
`chmod 777`, `chown`, `shutdown`, `reboot`, `mkfs`, and `dd`. A multi-word rule
is written `Bash(git diff:*)`. The file used `Bash(git:diff*)` until 2026-11,
which names a command starting with `git:diff`, so those rules matched nothing;
`tools/test-hooks.mjs` now rejects that spelling.

`~/.claude/settings.json` is a link to this file, and Claude Code writes user
settings such as the theme into it, so a `/config` change shows up in
`git status` here. That is the usual cost of a linked dotfile. Commit the
change if it should follow you to other machines, or `git restore` it if not.
There is no user-level `settings.local.json` to move it into (Claude Code
settings docs, retrieved 2026-11-24).

The Bash sandbox is left off here, because this file applies to every project.
docs-gate and `block-danger` are tripwires; the sandbox is the hard boundary,
enforced by the OS, and by default it limits Bash writes to the working
directory. Turn it on per project, in that project's `.claude/settings.json`:

```json
{
  "sandbox": { "enabled": true, "allowUnsandboxedCommands": false },
  "permissions": { "blockWritesOutsideWorkingDirectories": true }
}
```

`allowUnsandboxedCommands: false` removes the retry outside the sandbox, and
`blockWritesOutsideWorkingDirectories` (Claude Code 2.1.314+) gives the Write
and Edit tools the same limit, since the sandbox covers Bash only. Commands
that need more, such as `docker`, go in `sandbox.excludedCommands`.

The shared rules carry the git-add ban for every tool. The destructive-command
list lives only in the Claude Code hook and its settings, so other tools do not
inherit it.

## Skills

| Skill | What it does |
|---|---|
| `plan` | surveys the repo and writes a numbered implementation plan with success criteria |
| `onboard` | reads an existing codebase like a new engineer, then asks about what is still unclear |
| `audit` | first audit of an existing project and its related repos, every fact with evidence, then open questions |
| `quality-audit` | tools first, then findings proven by a reproduction or a traced path, unproven ones kept apart |
| `kickoff` | asks about what an issue leaves out, reproduces it in its own worktree, then plans and stops |
| `context` | files knowledge from the conversation into the right `.ai/` files |
| `review` | reviews the pending diff, unpushed commits, linters, and tests |
| `ship` | prepares a commit: verifies the staged diff, writes the message, runs the pre-commit checks |
| `ci` | runs lint, test, build, and security scan locally, then reports pass or fail |
| `debug` | works a bug down systematically: reproduce, isolate, verify assumptions, fix the cause, keep the regression test |
| `worktrees` | gives each task its own worktree with `ai-worktree`, so parallel tasks never share a checkout, then lands and cleans up the branch |
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
| `prometheus-ai-authoring.md` | how to add rules, skills, docs, and templates to this repo |
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

1. Load `core/docs/prometheus-ai-authoring.md`, or run the `extend-config` skill.
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
for f in setup.sh ai-init ai-context ai-worktree ai-survey ai-lint ai-skeleton agents/dsh/install.sh; do bash -n "$f"; done  # shell syntax
for f in agents/dsh/presets/renks/*.mjs; do node --check "$f"; done                # plugin syntax
node --test 'agents/dsh/presets/renks/*.spec.mjs'                                  # gate behaviour and tiers
node --test 'tools/*.spec.mjs'                                                     # stock resolver, helper parsers, Claude docs-gate, audit, setup modes
node tools/test-hooks.mjs                                                          # Claude Code hooks and their settings.json wiring
node tools/replay-gate-denials.mjs                                                 # recorded gate denials replayed through the current bash rules
node tools/build-preset-recipe.mjs --check                                         # preset recipe in sync with installed stock
find . -type l ! -exec test -e {} \; -print                                        # broken symlinks
python3 -c "import tiktoken,pathlib; e=tiktoken.get_encoding('o200k_base'); print(sum(len(e.encode(pathlib.Path(p).read_text())) for p in ('AGENTS.md','agents/claude-code/claude-code.md')))"  # injection budget
```

Each check needs its own loop: `bash -n` and `node --check` only inspect the
first file they are given. The last check needs `tiktoken` (`pip install
tiktoken`), which is not a repo dependency. It measures what a first request
carries in subscription mode: 2485 tokens on o200k_base as of 2026-11-23 (AGENTS.md
2289, `claude-code.md` 165, the import lines of `CLAUDE.md` 31) against the 2.5K
ceiling, so 15 tokens of slack. Token mode carries 293 (`core/docs/evals.md`
records the method and the older readings).

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
guides expect, because nothing fails when a harness is absent. The links simply
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

## License

MIT. See `LICENSE`.

## Sources and acknowledgements

This config is assembled from other people's work. `core/docs/sources.md` records
every source with its retrieval date and what it backs, split between the sources
behind specific rules and the practitioner writing that shaped the stance. The
people below are the ones it leans on most, each with the thing itself rather than
only a name.

- [Fabio Akita](https://akitaonrails.com/en/2026/02/24/rant-akita-caved-to-ai/),
  for the position that AI-assisted work ships under the same review standard as
  any other code, and for [`ai-memory`](https://github.com/akitaonrails/ai-memory),
  an independent build of the same idea behind `.ai/`: agent memory as versioned
  markdown, with writes gated by evaluation.
- [Robert C. Martin](https://cleancoders.com/episode/agentic-discipline-6) and
  Justin Martin. [Clean Code](https://books.google.com/books?vid=ISBN9780132350884)
  states in prose what this repo enforces in numbers (small functions, one thing
  per function, few arguments, one level of abstraction);
  [Clean Architecture](https://books.google.com/books?vid=ISBN9780134494166)
  covers dependency direction. Their
  [Clean AI: Agentic Discipline](https://cleancoders.com/episode/agentic-discipline-6)
  series makes the argument the guardrails act on: discipline an agent cannot be
  trusted to remember belongs in the tooling.
- Andrej Karpathy, for the [llm-rigor](https://github.com/luiscrsilveira/llm-rigor)
  principles: think before coding, surgical changes, minimum viable code, and
  pushback that scales with certainty.
- [HumanLayer](https://www.zenml.io/llmops-database/evolving-ai-coding-agent-workflows-from-research-plan-implement-to-crispy),
  for the Research-Plan-Implement to CRISPY talk, which supplied the CRISPY name
  and phase structure, and the argument that always-on prompt budget is scarce.
- [Anthropic](https://www.anthropic.com/research/claude-character), for Claude's
  Character and the sycophancy research behind the non-negotiables, the context
  engineering guidance behind the lean injection policy, and the
  [skills pattern](https://github.com/anthropics/skills/blob/main/spec/agent-skills-spec.md)
  that `skill_search` mirrors.
- [Matt Pocock](https://github.com/mattpocock/skills), for publishing his own agent
  skills, a working reference for how a skill directory and its frontmatter should
  look.
- [Martin Fowler](https://martinfowler.com/books/refactoring.html) and
  [Kent Beck](https://books.google.com/books?vid=ISBN9780321146533), for the test
  pyramid and self-testing code that the testing rules follow, and for writing
  about augmented coding as it develops.
- [Thomas McCabe](https://doi.org/10.1109/TSE.1976.233837) and
  [G. Ann Campbell](https://doi.org/10.1145/3194164.3194186), for the two
  complexity metrics this repo budgets against, and the maintainers of
  [`zj-karina/complexity-budget`](https://github.com/zj-karina/complexity-budget)
  for the numeric budgets themselves.
- [Google](https://developers.google.com/style), for the developer style guide,
  the [engineering practices](https://google.github.io/eng-practices/review/reviewer/)
  on code review, and the
  [SRE postmortem culture](https://sre.google/sre-book/postmortem-culture/).
- [Simon Willison](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/), for
  documenting in public what agent tooling does in practice, failure modes
  included, and for naming the lethal trifecta behind the guardrails.
- [Jesse Vincent](https://github.com/obra/superpowers), whose superpowers project
  is the working reference for shipping one skill set to several harnesses at once.

Papers, standards, and studies behind the rest of the rules are listed in
`core/docs/sources.md`: among them the
[Agent Skills standard](https://agentskills.io) that this repo's `SKILL.md` format
follows, the Wikipedia WikiProject AI Cleanup
[essay on the signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing),
the ETH Zurich [study on instruction bloat and inference cost](https://arxiv.org/abs/2602.11988),
the METR [trial on measured developer productivity](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/),
the DORA report on [AI as an amplifier](https://dora.dev/insights/balancing-ai-tensions/),
OWASP's [application](https://github.com/OWASP/ASVS) and
[LLM](https://genai.owasp.org/llm-top-10/) top tens,
[Jakob Nielsen on AI usability](https://www.uxtigers.com/post/intent-ux),
[Diataxis](https://diataxis.fr/),
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/), and the
work of [Parnas](https://doi.org/10.1145/361598.361623),
[Yourdon and Constantine](https://books.google.com/books?vid=ISBN9780138544713),
[Feathers](https://books.google.com/books?vid=ISBN9780131177055),
[Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions),
[Knuth](https://doi.org/10.1145/356635.356640), and
[Chroma](https://www.trychroma.com/research/context-rot).

Four additions bear directly on the gate, and the weight of each is recorded where
it is cited rather than left to the reader to guess:

- Shin, [The Compliance Gap](https://arxiv.org/abs/2605.01771) (arXiv:2605.01771). 2,031
  sessions, six frontier models, **0% compliance on file reading**, and a proof
  that the gap cannot be detected from text. This is the strongest published
  support the gate has, and it also bounds the claim: an agent saying it read a
  file is never evidence.
- Dai and Wang, [AgentGuard](https://arxiv.org/abs/2609.16287) (arXiv:2609.16287). What
  execution guardrails buy on real coding-agent traces: an abnormal execution rate
  cut from 69.0% to 26.7%, completion up from 21.7% to 35.0%.
- [String](https://arxiv.org/abs/2608.28027) (arXiv:2608.28027). Causal staging: a tier
  of detail disclosed one turn too early costs up to 23 accuracy points, and
  proper staging drops wrong-action selection from 28% to 2%. This is the result
  behind not loading rules a call cannot use.
- Du, [Memory for Autonomous LLM Agents](https://arxiv.org/abs/2603.07670) (arXiv:2603.07670).
  Summarisation drift and attentional dilution, the reason a credit must be
  bound to raw content and why a bigger window is not the answer.

[Rodrigues Pereira's An LLM Agent Cannot Be a Gate](https://doi.org/10.5281/zenodo.20520851)
and the Du survey are not peer-reviewed: one is a self-published preprint with a
single deployment, the other a single-author survey. `sources.md` marks both,
because what this repo borrowed from them is the framing, not the evidence.
[ObjectGraph](https://arxiv.org/abs/2604.27820) is cited as direction only, and
`sources.md` says why the 95% token reduction it reports is not a result about
this gate. One reference stays unlinked on purpose: "liangshen issue 6", cited for
the 0/9 anchoring measurement, comes from an issue tracker that is not published,
so a reader cannot follow it and a link would pretend otherwise. If a rule here
misstates its source, or a source is missing, the fix belongs in that file.

Named after the [Prometheus Circuit](https://www.chronowiki.org/wiki/Prometheus_Circuit)
in Chrono Trigger, the name Robo carries in Chrono Cross, where he is the machine
that directs the others and answers to the people who keep it.

Thank you all. Long live knowledge and open source. =)

## Size, and the one budget this file breaks

`core/docs/complexity.md` budgets a file at 500 lines and requires the reason be
documented whenever one exceeds it. This file and `core/docs/project-docs.md` are
the two that do. `project-docs.md` declares its own at the top of the file; this
file declares its own here, where a reader who reached the end is already asking
why it is long.

NO LINE COUNT IS GIVEN, deliberately. An earlier version of this section said
"about 680", and the file was 789 lines the next day: seven commits had each added
a paragraph and every one was individually worth adding. That is the
death-by-a-thousand-cuts shape `complexity.md` warns about, happening to the file
that was quoting the warning. A number that drifts is worse than no number, and
`wc -l README.md` answers the question exactly when someone wants it.

WHAT JUSTIFIES THE EXCEPTION. The budget exists to stop code becoming unreadable.
A README is not code: it is read once to decide whether to adopt this, searched
afterwards, and never executed. The check that matters for a doc is different, and
it is whether its claims can be verified. Every measurement in this file names the
command that reproduces it, and where a figure cannot be re-derived on demand it is
dated and labelled as a reading rather than stated as a fact. That standard is
what this file is held to instead of a line limit.
