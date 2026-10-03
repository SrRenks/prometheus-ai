# Project documentation standard

Defines the committed documentation of a project: root-level entry files and the
`docs/` directory. Deep technical documentation belongs here; agent/AI configuration
never does (it lives in `.ai/`, gitignored).

This standard encodes Diátaxis, Docs as Code, Keep a Changelog, and
MkDocs/Docusaurus conventions as a single baseline.

EXCEPTION, declared as `core/docs/complexity.md` requires when a limit is
exceeded: this file is over the 500-line file budget, and deliberately. It is a
reference standard read in sections rather than an artefact loaded whole, and
splitting it would scatter one convention across files a reader has to join back
together, which the same rule lists as a reason not to split. The budget exists to
stop CODE becoming unreadable; applying it to a consulted reference measures the
wrong thing. Project-specific deviations
go in `.ai/docs/project-docs.md`.

## Core principles

Apply these principles when creating or modifying any committed doc.

### Index, not a dump
- AGENTS.md at project root must stay ≤150 lines: a navigation index that points
  to separate files for detailed content. Never embed full architecture docs,
  testing strategy, or style guides in it; link to them.
- ETH Zurich research (Gloaguen et al., "Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?", arXiv:2602.11988, Feb 2026; retrieved 2026-09-06): auto-generated context files filled with generic
  information the model already knows can hurt agent performance (developer-written files +4% success, LLM-generated -3%, +20-23% inference cost either way). Review and
  prune auto-generated content - remove what the agent can infer.
- Start AGENTS.md with build/test commands - the most important information first.
- Six areas an effective AGENTS.md covers: commands, testing practices, project
  structure, code style, git workflow, boundaries. Cover only what the agent
  cannot figure out on its own.

### Progressive disclosure
- Organize in layers: high-level overviews first, deep technical details deeper.
- Every doc starts with a one-paragraph summary before diving into detail.
- Use `index.md` files as navigation hubs - summaries and pointers, not dumps.
- Keep `README.md` superficial - pointers to `docs/index.md`, not walls of text.

### Single source of truth
- Every fact lives in exactly one committed doc.
- Cross-reference instead of duplicating. Use relative links.
- If content is needed in multiple places, use the canonical source and link to it.
- Never copy-paste sections between docs.

### Docs as code
- Documentation undergoes the same quality gates as code:
  - Peer review in pull requests.
  - Link checking (all internal and external links resolve).
  - Spell checking (with project-specific technical dictionary).
  - Version control with meaningful commit messages.
- Treat doc-only PRs with the same rigor as code PRs.

### Audience-first
- Write for specific audiences. Tag each doc with its primary audience.
- New developers need: setup, basic concepts, project tour.
- Contributors need: development workflow, testing, debugging.
- Architects need: design decisions, component relationships, ADRs.
- Operators need: deployment, monitoring, runbooks, disaster recovery.
- API consumers need: endpoints, authentication, request/response examples.

### Context-aware AI consumption
- Structure docs to maximize AI agent effectiveness:
  - Clear hierarchical headings for navigation.
  - Consistent metadata frontmatter on every page.
  - Explicit cross-references for relationship mapping.
  - Roadmap with status for forward-looking context.

### Self-healing documentation
- Flag docs older than 6 months for review.
- Validate links in CI on every push to docs.
- Archive outdated docs; never delete - move to `docs/archive/` with a
  deprecation notice at the top.
- Assign an owner team to every doc.

### Production-ready, no skeletons
- Committed docs are production artifacts. Never commit template skeletons,
  unfilled placeholders (`<...>`, `TODO`, `[TBD]`), or lorem ipsum filler.
- Every section contains real, project-specific facts. If a section does not
  apply, delete it - don't leave a "coming soon" stub.
- Draft status (`status: "Draft"`) allows incomplete sections during development
  but never on the default branch. Before merge: fill every section or remove it.

### AI-internal isolation
- Committed docs (`docs/`, `README.md`, `CHANGELOG.md`) are for humans and
  describe only the project itself. Never reference `.ai/`, agent configuration,
  AI tooling, or agent workflow. The `.ai/` directory is an isolated space for
  agent instructions - gitignored and never mentioned in production documentation.
- Cross-references between committed docs and `.ai/` are forbidden in both
  directions. Human docs discuss the project; agent docs discuss how to build it.

## Audience and formatting

### Human-facing docs (committed)
- Full Markdown: headings, bold, lists, links, tables, code blocks with language
  tags, admonitions, Mermaid diagrams.
- Every doc is consumable as raw Markdown on GitHub AND publishable via MkDocs,
  Docusaurus, or ReadTheDocs without transformation.
- Lean by default: short sections, pointers over walls of text.

### Agent-facing docs (`.ai/`, this config)
- AI-only formatting: headers and bullets, no bold, no tables, no decorative
  markdown. Never mix the two styles in the same file.

## Root-level files

### README.md - superficial entry (required)
- Enterprise overview: description, stack, quick-start commands, structure
  pointers, status.
- Template shape: `~/.config/agent-config/core/templates/README.md`.
- Generated by `ai-context` with only sections that apply; never copy the
  template verbatim.
- Surface level by design - deep explanations live in `docs/`.
- Points to `docs/index.md` as the documentation entry point.
- Include a one-line description at the top: what the project does, for whom.

### CHANGELOG.md - release history (required)
- Root-level, [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.
- Sections: Added, Changed, Deprecated, Removed, Fixed, Security.
- Semantic versioning headers.
- Template: `~/.config/agent-config/core/templates/CHANGELOG.md`.
- Generated from conventional commits; reviewed and edited for humans before release.

## docs/ - directory structure

### Required base structure

Every project must have these files. Generate them on demand with `ai-context`;
fill with real facts, never placeholders.

```
docs/
├── index.md                  # Table of contents - Diátaxis-categorized
├── getting-started.md        # Tutorial: first-time setup
├── architecture.md           # Explanation: design, layers, data flow
├── roadmap.md                # Reference: phased plan with status
├── repository-map.md         # Reference: full file listing
├── validation-checklist.md   # Reference: pre-declaration review
└── decisions/                # Architectural Decision Records (recommended)
    └── index.md              # ADR index: number, title, status, date
```

### Expanded structure - create directories as they fill

Create subdirectories only when ≥3 files of the same Diátaxis type accumulate.
When a project grows, expand into these optional directories:

```
docs/
├── getting-started/          # Onboarding - create when ≥3 setup guides
│   ├── index.md
│   ├── quickstart.md         # 5-minute setup
│   ├── environment-setup.md  # Detailed environment configuration
│   ├── first-contribution.md # Workflow for first contribution
│   └── troubleshooting.md    # Common setup issues
│
├── architecture/             # System design - create when ≥3 architecture docs
│   ├── index.md
│   ├── system-context.md     # C4 Model - System Context
│   ├── containers.md         # C4 Model - Containers
│   ├── components.md         # C4 Model - Components
│   ├── data-flow.md          # Data flow diagrams and explanation
│   └── deployment.md         # Deployment architecture
│
├── development/              # Dev workflow - create when ≥3 dev guides
│   ├── index.md
│   ├── code-standards.md     # Style guides and conventions
│   ├── testing.md            # Testing strategy and execution
│   ├── debugging.md          # Debugging techniques
│   └── performance.md        # Performance considerations
│
├── api/                      # API docs - create when the project has an API
│   ├── index.md
│   ├── authentication.md     # Auth flows and token management
│   ├── endpoints/            # Endpoint-specific docs
│   │   └── <resource>.md
│   └── errors.md             # Error codes and handling
│
├── operations/               # Ops docs - create when the project is deployed
│   ├── index.md
│   ├── deployment.md         # Deployment procedures
│   ├── monitoring.md         # Monitoring and alerting
│   ├── logging.md            # Logging strategy
│   ├── runbook.md            # Incident response
│   └── disaster-recovery.md  # DR procedures
│
├── guides/                   # Developer guides - create when ≥3 guides
│   ├── index.md
│   ├── contributing.md       # Contribution guidelines
│   ├── code-review.md        # Code review checklist
│   └── security.md           # Security practices
│
├── reference/                # Technical reference - create when ≥3 ref docs
│   ├── index.md
│   ├── glossary.md           # Domain terminology
│   ├── configuration.md      # Configuration reference
│   ├── database-schema.md    # Database schema reference
│   └── api/                  # Developer interface - exhaustive symbol docs
│       ├── index.md          # Hierarchical API index (every public symbol)
│       └── <module>.md       # Per-module/per-class docs with signatures,
│                             # params, returns, raises, examples
│
├── changes/                  # Change management
│   ├── index.md
│   ├── changelog.md          # Mirror of root CHANGELOG.md (optional)
│   ├── migration-guides/     # Version migration guides
│   └── deprecations.md       # Deprecated features and timelines
│
└── meta/                     # Docs about docs - create when contributing guide needed
    ├── index.md
    ├── style-guide.md        # Writing style guide
    └── review-process.md     # Documentation review process
```

### Navigation patterns

Every doc must include these navigation aids:
- Breadcrumb at the bottom: `[← Back to docs index](index.md)` (adjust path for
  subdirectories).
- Related content section when there are linked docs: "See also" with links to
  related documents.
- Previous/Next navigation for sequential tutorials and guides.
- Table of contents at the top for docs over 500 lines (use `##` anchor links).
- `index.md` in every subdirectory acts as a navigation hub: summary table with
  doc name, description, and audience.

## Developer interface reference - exhaustive API docs

Every project with public-facing code must document its developer interface
completely. This is the Requests/readthedocs pattern: every public symbol
enumerated in a hierarchical tree, each with its signature, parameters, return
value, exceptions, and behavior description.

### Scope - document everything public

For every public class, function, method, property, constant, and exception:
- Document it. No exceptions for "self-explanatory" or "trivial" symbols.
- If it appears in `__all__`, `pub`, `export`, or equivalent public surface, it
  must be in the docs.
- Private/internal symbols (underscore-prefixed, `internal` visibility) are
  documented only if they are extension points or widely used internally.

### Hierarchy - mirror the code's structure

Organize the developer interface docs as a tree that mirrors the codebase's
module/package/class structure:

```
docs/reference/api/
├── index.md                     # Flat overview: list of modules with descriptions
├── <module-1>.md                # One file per top-level module/package
├── <module-2>.md
├── <module-1>/                  # Subdirectory when a module has ≥5 symbols
│   ├── index.md                 # Module index: list of exported symbols
│   ├── <class-1>.md            # One file per major class
│   ├── <class-2>.md
│   └── <function-1>.md         # Standalone functions if complex enough
└── <module-2>/
    └── ...
```

### Per-symbol documentation format

Every class, function, and method must document these elements:

**Signature** - the exact callable signature with types:
```markdown
### `Session.send(request, **kwargs)`
```
Use backticks around names. Include all parameters in the header.

**Parameters** - table of every parameter:
```markdown
| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `request` | `PreparedRequest` | Yes | - | The prepared request to send. |
| `timeout` | `float \| None` | No | `None` | Seconds to wait for a response. |
| `stream` | `bool` | No | `False` | Whether to stream the response body. |
```

**Returns** - type and description:
```markdown
**Returns**: `Response` - The server's response to the request.
```

**Raises** - every exception the symbol can raise:
```markdown
**Raises**:
- `ConnectionError` - if the connection fails.
- `Timeout` - if the request exceeds the timeout.
- `TooManyRedirects` - if the redirect limit is exceeded.
```

**Description** - behavior, side effects, edge cases:
- What the symbol does, not how it's implemented.
- Preconditions: what must be true before calling.
- Postconditions: what is guaranteed after returning.
- Side effects: mutations, I/O, state changes.
- Thread safety / async considerations if applicable.
- Edge cases: empty input, null values, boundary conditions.

**Code example** - at least one runnable example:
````markdown
```python
session = requests.Session()
response = session.send(request, timeout=30)
print(response.status_code)
```
````

**Properties** - for classes, document every public property:
```markdown
#### Properties

- `response.status_code` (`int`) - HTTP status code (e.g., 200, 404).
- `response.headers` (`dict`) - Case-insensitive dictionary of response headers.
- `response.text` (`str`) - Response body decoded as text using `response.encoding`.
```
For each property: name, type, description, whether it's read-only.

**Methods** - for classes, group methods by purpose:
```markdown
### Session methods

#### Request execution
- `Session.request(method, url, **kwargs)` - construct and send a request.
- `Session.get(url, **kwargs)` - send a GET request.
- `Session.post(url, data=None, json=None, **kwargs)` - send a POST request.

#### Configuration
- `Session.mount(prefix, adapter)` - register an adapter for a URL prefix.
- `Session.close()` - close all adapters and free resources.
```

### Page structure for a class doc

```markdown
---
title: "Session - Persistent HTTP Session"
status: "Published"
owner: "api-team"
last_updated: "2026-01-15"
review_cycle: "quarterly"
audience: "developers, api-consumers"
tags: ["api", "http", "session"]
---
<!-- type: reference -->

# `Session`

Brief description: what it is, when to use it.

## Constructor

### `Session.__init__()`

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| ... |

## Properties

- `Session.auth` (`AuthBase | None`) - default authentication for requests.
- `Session.headers` (`dict`) - default headers sent with every request.

## Methods

### Request execution

#### `Session.request(method, url, **kwargs)`

...

#### `Session.get(url, **kwargs)`

...

### Configuration

#### `Session.mount(prefix, adapter)`

...

## See also

- [Request](request.md) - the request object
- [Response](response.md) - the response object

---

[← Back to API index](index.md)
```

### Page structure for a module doc

```markdown
---
title: "requests.api - Main Interface"
status: "Published"
owner: "api-team"
last_updated: "2026-01-15"
review_cycle: "quarterly"
---
<!-- type: reference -->

# `requests.api` - Main Interface

Brief description of the module's purpose.

## Functions

### `requests.request(method, url, **kwargs)`

Constructs and sends a `Request`. The primary entry point.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `method` | `str` | Yes | - | HTTP method: `GET`, `POST`, `PUT`, etc. |
| `url` | `str` | Yes | - | URL for the request. |
| `params` | `dict \| None` | No | `None` | Query string parameters. |
| `data` | `Any \| None` | No | `None` | Request body. |
| `headers` | `dict \| None` | No | `None` | HTTP headers. |
| `timeout` | `float \| None` | No | `None` | Seconds to wait. |

**Returns**: `Response`

**Raises**:
- `ConnectionError` - network problem.
- `Timeout` - request timed out.
- `TooManyRedirects` - redirect limit exceeded.

```python
import requests
response = requests.request('GET', 'https://api.example.com/data')
print(response.json())
```

### `requests.get(url, params=None, **kwargs)`

Sends a GET request. Convenience wrapper around `requests.request('GET', ...)`.

...

### `requests.post(url, data=None, json=None, **kwargs)`

Sends a POST request.

...

## See also

- [Session](session.md) - persistent session with connection pooling
- [Exceptions](exceptions.md) - error types raised by this module

---

[← Back to API index](index.md)
```

### The API index page

`docs/reference/api/index.md` is the entry point for developer interface docs:

```markdown
---
title: "Developer Interface"
status: "Published"
owner: "api-team"
last_updated: "2026-01-15"
review_cycle: "quarterly"
---
<!-- type: reference -->

# Developer Interface

Complete reference for every public symbol in <project-name>.

## Main interface

- [request](api/main.md#request) - construct and send a request
- [get](api/main.md#get) - send a GET request
- [post](api/main.md#post) - send a POST request
- [put](api/main.md#put) - send a PUT request
- [patch](api/main.md#patch) - send a PATCH request
- [delete](api/main.md#delete) - send a DELETE request

## Exceptions

- [RequestException](api/exceptions.md#requestexception) - base exception
- [ConnectionError](api/exceptions.md#connectionerror) - connection failure
- [HTTPError](api/exceptions.md#httperror) - bad HTTP status
- [Timeout](api/exceptions.md#timeout) - request timed out

## Request sessions

- [Session](api/session.md) - persistent HTTP session
  - [Session.get](api/session.md#sessionget) - GET within a session
  - [Session.post](api/session.md#sessionpost) - POST within a session
  - [Session.mount](api/session.md#sessionmount) - register an adapter

## Lower-level classes

- [Request](api/request.md) - the request object
- [Response](api/response.md) - the response object
- [PreparedRequest](api/prepared-request.md) - the prepared request

## Authentication

- [AuthBase](api/auth.md#authbase) - base auth class
- [HTTPBasicAuth](api/auth.md#httpbasicauth) - HTTP Basic authentication

---

[← Back to docs index](../index.md)
```

### Depth rules

- Create a subdirectory under `reference/api/` when a module exports ≥5 symbols
  that each need their own page.
- Collapse simple modules (≤5 trivial symbols) into a single page.
- Maximum nesting: module → class → methods. Don't create pages for individual
  methods unless the method has ≥5 parameters or complex behavior.
- If a class has ≥10 methods, group them under H3 subheadings by purpose
  (e.g., "Request execution", "Configuration", "Inspection").
- Properties are listed under an H2 "Properties" section using bullet points,
  not individual pages.

### When to create developer interface docs

- Any project with ≥1 public module/package must have `docs/reference/api/`.
- Create it as part of the initial project documentation scaffold.
- Fill it incrementally: start with the main interface and public classes, then
  expand to exceptions, lower-level classes, utilities.
- After any new public symbol is added to the code, add its documentation entry
  in the same commit or PR.
- Run a CI check that fails if public symbols lack documentation entries.

## Metadata frontmatter

Every doc page must include YAML frontmatter between `---` delimiters at the top
of the file. The type tag HTML comment goes after the frontmatter, on its own line.

### Required fields

```yaml
---
title: "Document Title"         # Required
description: "Brief summary"    # Recommended - used for SEO and search
status: "Published"             # Draft | Review | Published | Archived
owner: "team-name"              # Responsible team or person
last_updated: "YYYY-MM-DD"      # Last review date
review_cycle: "quarterly"       # monthly | quarterly | annually
---
```

### Optional fields

```yaml
audience: "developers, architects"   # Intended audience
tags: ["architecture", "design"]     # Search tags
related:                              # Related documents
  - "/architecture/containers.md"
  - "/architecture/components.md"
deprecated: false                     # True if deprecated
deprecation_reason: ""                # Reason if deprecated
version: "2.1.0"                      # Document version
```

### Page structure after frontmatter

```markdown
---
(title and metadata)
---
<!-- type: tutorial -->

# Document Title

One-paragraph summary of what this doc covers and who it's for.

## First section
...

---

## See also

- [Related Doc](../path/doc.md) - brief description of relationship
- [Another Doc](../path/other.md) - brief description

---

[← Back to docs index](index.md)
```

## Diátaxis categorization

Every doc is tagged with its Diátaxis type so readers know what to expect.
Tag each doc with an HTML comment on the line immediately after the frontmatter:

```markdown
<!-- type: tutorial -->
```

Allowed values: `tutorial`, `how-to`, `reference`, `explanation`.

### Type rules

Tutorial - learning-oriented, step-by-step:
- Audience: "Teach me".
- Convention: `getting-started.md`, `getting-started/*.md`.
- Structure: prerequisites → steps → verification → next steps.
- Never skip steps; assume the reader knows nothing about the project.

How-to - task-oriented, problem-solving:
- Audience: "Show me how".
- Convention: `how-to/*.md`.
- Structure: goal → numbered steps → expected result.
- Focus on one specific task per doc. If a doc covers multiple tasks, split it.

Reference - information-oriented, factual:
- Audience: "Tell me the facts".
- Convention: `roadmap.md`, `repository-map.md`, `validation-checklist.md`,
  `reference/*.md`, `decisions/`, `changes/`.
- Structure: tables, lists, schemas - optimized for scanning, not reading.
- No prose where a table will do.

Explanation - understanding-oriented, context:
- Audience: "Why does it work?".
- Convention: `architecture.md`, `architecture/*.md`.
- Structure: overview → design rationale → data flow → cross-cutting decisions.
- Explain the why, then the what.

## File conventions

### Naming
- Lowercase kebab-case: `getting-started.md`, `parser-templates.md`.
- Index files: `index.md` inside subdirectories (MkDocs/Docusaurus convention).
  Exception: root `README.md` stays `README.md` (GitHub convention).
- ADR files: `NNNN-lowercase-title.md` (e.g., `0001-use-room-for-storage.md`).
- One topic per file. Split when a file exceeds ~150 lines.
- No spaces, no underscores, no CamelCase in filenames.

### Structure rules
- Every directory inside `docs/` has an `index.md`.
- Flat by default - create subdirectories only when ≥3 files of the same Diátaxis
  type accumulate.
- Maximum depth: 3 levels from `docs/` (e.g., `docs/reference/parsers/santander.md`).
- Files at the same level and type: sort alphabetically in index tables.

### Cross-linking
- Use relative links: `[architecture.md](architecture.md)` from sibling files,
  `[../architecture/decisions/adr-001.md](../architecture/decisions/adr-001.md)`
  from deeper paths.
- Every doc ends with a breadcrumb back to the index:
  ```markdown
  ---

  [← Back to docs index](index.md)
  ```
  From subdirectories, adjust the path: `../index.md`, `../../index.md`.
- Architecture and roadmap cross-link each other.
- ADRs link to related ADRs via "Supersedes" / "Superseded by" fields.
- Add a "See also" section at the end of every doc that has related content:
  ```markdown
  ## See also

  - [ADR-002: Authentication](../architecture/decisions/adr-002-auth.md) - design decision
  - [API Authentication](../api/authentication.md) - implementation details
  ```

### Type tags
- HTML comment on line immediately after frontmatter, before the H1 heading.
- Allowed values: `tutorial`, `how-to`, `reference`, `explanation`.
- Index files use `<!-- type: reference -->`.

## Markdown features for humans

Use the full capabilities of Markdown as rendered by GitHub, MkDocs, Docusaurus,
and ReadTheDocs. Never use syntax that only one renderer supports - stick to
Markdown that degrades gracefully everywhere.

### Tables
- For comparisons, matrices, indexes, and structured data.
- Always include a header row.
- Example:
  ```markdown
  | Field | Type | Required | Description |
  |---|---|---|---|
  | `id` | UUID | Yes | Unique identifier |
  ```

### Code blocks
- Always specify the language for syntax highlighting: ```` ```kotlin ````, ```` ```sh ````,
  ```` ```json ````, ```` ```yaml ````, ```` ```python ````.
- For shell commands, use `$` prompt prefix. For SQL, use `>` prompt prefix.
- Include command output where it clarifies behavior.
- For line highlighting (supported by MkDocs/Docusaurus), add line numbers in
  braces after the language tag: ```` ```python {3,7-9} ````.

### Mermaid diagrams
- Preferred for data flow, architecture, state machines, and sequence diagrams.
  Use fenced code blocks with the `mermaid` language tag.
- Flowcharts for component relationships:
  ```` ```mermaid
  flowchart TD
      A[Start] --> B[Process]
      B --> C{Decision?}
      C -->|Yes| D[Result]
  ```` ```
- Sequence diagrams for request flows and interactions:
  ```` ```mermaid
  sequenceDiagram
      participant U as User
      participant A as API
      U->>A: Request
      A-->>U: Response
  ```` ```
- GitHub, GitLab, MkDocs, and Docusaurus render Mermaid natively. The source
  text is human-readable as a fallback in plain-text viewers.

### Admonitions (callouts)
- Use blockquote + bold label for GitHub compatibility:
  ```markdown
  > **Note**: Helpful context that adds nuance.
  > **Tip**: Best practice recommendation.
  > **Warning**: Critical information - could cause issues if ignored.
  > **Caution**: Potentially dangerous operation - proceed carefully.
  > **Important**: Must-read before proceeding.
  ```
- MkDocs Material and Docusaurus auto-convert these to styled callouts.
- Place admonitions on their own line; they apply to the following content.

### Collapsible sections
- Use `<details>` for expandable content - reduces clutter for optional or
  advanced topics:
  ```markdown
  <details>
  <summary>Advanced Configuration (Click to expand)</summary>

  Content here - rendered as Markdown inside the collapsed section.
  </details>
  ```

### Definition lists
- For glossaries and terminology:
  ```markdown
  Term
  : Definition of the term. Multiple paragraphs allowed.

  Another Term
  : Its definition.
  ```
- Use in `reference/glossary.md` and any doc that defines multiple terms.

### Task lists
- For checklists and roadmaps:
  ```markdown
  - [ ] Pending item
  - [x] Completed item
  ```
- Use in `validation-checklist.md` and `roadmap.md`.

### Math notation
- Use LaTeX for formulas when the project requires mathematical notation.
  Supported by most renderers:
  ```markdown
  The rate $R$ is calculated as: $$ R = \frac{N}{T} $$
  ```
- Only include if the project domain requires it. Skip otherwise.

### Deep linking
- Every heading is an anchor; use `[text](#heading)` for within-page navigation.
- Use lowercase, hyphenated anchor IDs (GitHub convention).

## Document lifecycle

Every doc has a lifecycle state. Track it in the frontmatter `status` field.

### States
- Draft - work in progress, not ready for review. May have incomplete sections.
- Review - content complete, awaiting peer review.
- Published - reviewed, approved, current.
- Archived - moved to `docs/archive/`, superseded or no longer relevant.

### Freshness policy
- Docs must be reviewed at the interval specified in `review_cycle`.
- Flag docs over 6 months past their `last_updated` date.
- During review, update `last_updated` and reset the review clock.
- If a doc is still accurate, update only `last_updated` - don't rewrite.
- If a doc is outdated and cannot be updated immediately, change status to
  "Review" and file an issue.

### Archival
- Never delete docs. Move outdated docs to `docs/archive/`.
- Add a deprecation notice at the top of archived docs:
  ```markdown
  > **Warning**: This document is deprecated. See [new-doc.md](../new-doc.md) for current information.
  ```
- Archive docs that are: superseded by a newer doc, for removed features,
  or no longer relevant to the current version.

## Writing standards

### Language and tone
- Professional register: enterprise-serious tone throughout. No emojis, no
  exclamation marks, no casual asides, no slang, no colloquialisms. Write like
  production documentation, not a chat message.
- Imperative mood for instructions: "Run npm test before committing", not
  "Tests should be run" or "You should run tests".
- Active voice: "The system processes the request", not "The request is processed
  by the system".
- Present tense for current state; future tense only for planned features.
- Technical precision: use domain terminology accurately and consistently.
- Action-oriented: use "you" for instructions ("Run the build", "Configure the
  environment").
- Gender-neutral: "they/them" or "the user". Never "he" or "she".
- No ableist language: avoid "blind to", "lame", "crazy", "insane".
- No flattery or sycophancy: never "Great question", "Good catch", "Well done".
  State facts directly without praise.

### Structure guidelines
- H1 (#): document title only - exactly one per file.
- H2 (##): major sections.
- H3 (###): subsections.
- H4 (####): detailed points. Never skip heading levels (no H1 → H3 jump).
- Paragraphs: 3-5 sentences. Break up walls of text.
- Bullet points for lists of items; numbered lists for sequential steps.
- Every doc starts with a one-paragraph summary before the first H2.

### Code examples
- Every code block must have a language tag.
- Prefer complete, runnable examples over fragments.
- Show expected output where it clarifies behavior.
- For multi-language examples, use tab groups when the renderer supports them;
  otherwise, use separate code blocks with language labels.

### Visual aids
- Use Mermaid diagrams for complex relationships and flows.
- Use tables for structured data - prefer tables over prose lists.
- Include screenshots for UI-related documentation only if the UI is stable.
- Every image must have ALT text describing its content.
- Provide text alternatives for diagram content in the surrounding prose.

## ADR conventions (`docs/decisions/`)
- Numbered sequentially: `0001-title.md`.
- Index at `docs/decisions/index.md`: table with #, title, status, date.
- Template: `~/.config/agent-config/core/docs/decisions/ADR-template.md`.
- Status lifecycle: proposed → accepted → deprecated → superseded.
- Always fill "Supersedes" and "Superseded by" when applicable - both directions.
- Promote stable decisions from `.ai/assumptions.md` to ADRs.
- Every ADR must include: Context (why this decision is needed), Decision (what
  was decided), Consequences (what becomes easier and harder because of this).

## Quality gates

Apply these checks before marking any doc as Published. Integrate into CI where
possible.

### Link validation
- All internal links must resolve to existing files.
- All external links must return HTTP 200 (check in CI).
- Use relative links for internal references; absolute URLs for external.

### Spelling
- Run spell check on all docs: `cspell "docs/**/*.md"`.
- Maintain a project-specific technical dictionary: `.cspell/techterms.txt`.
- Add domain terms, library names, and acronyms to the dictionary.

### Frontmatter validation
- Every doc has `title`, `status`, `owner`, `last_updated`, `review_cycle`.
- `status` is one of: Draft, Review, Published, Archived.
- `type` tag (HTML comment) is present on the line after frontmatter.

### Structural validation
- Heading hierarchy: H1 → H2 → H3, no skipped levels.
- Only one H1 per file.
- Every code block has a language tag.
- Every image has ALT text.
- Breadcrumb present at the end of every file.
- No broken cross-references.

### Freshness check
- Docs over 6 months past `last_updated`: flag for review.
- Docs with `review_cycle: quarterly` and `last_updated` over 3 months: flag.
- Integrate into CI as a warning (not a blocker).

### CI pipeline example

```yaml
# .github/workflows/docs.yml
name: Documentation Quality
on:
  push:
    paths: ['docs/**', '*.md']
jobs:
  docs-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Check links
        run: npx markdown-link-check docs/**/*.md
      - name: Check spelling
        run: npx cspell "docs/**/*.md"
      - name: Validate frontmatter
        run: npx @docmd/validate docs/**/*.md
```

## AI agent instructions

### When to create docs
- During project analysis, ensure required files exist:
  `README.md`, `CHANGELOG.md`, `docs/index.md`, `docs/architecture.md`,
  `docs/repository-map.md`, `docs/roadmap.md`, `docs/validation-checklist.md`.
- Create missing required files; fill with real detected facts, never placeholders.
- Propose optional directories only when the project warrants them (≥3 files of
  that type, or an API/deployment surface that justifies it).

### How to generate docs
- Use `ai-context` for initial generation of context files and README.md.
- For committed docs under `docs/`, start from the templates in
  `~/.config/agent-config/core/templates/project-docs/`.
- Fill templates with real facts detected from the codebase. Remove all
  placeholder text. Replace `<...>` markers with actual content or delete the
  section if it does not apply.
- Never mention `.ai/`, agent configuration, or AI tooling in any committed doc.
  These are human-facing artifacts that describe only the project.
- When creating a new doc, use this structure:
  ```markdown
  ---
  title: "[Title]"
  status: "Draft"
  owner: "[Team Name]"
  last_updated: "[Date]"
  review_cycle: "quarterly"
  ---
  <!-- type: [tutorial|how-to|reference|explanation] -->

  # [Title]

  [One-paragraph summary.]

  ## [First section]
  ...

  ---

  [← Back to docs index](index.md)
  ```

### Context extraction for AI agents
- When reading project docs, prioritize:
  1. Docs updated within 6 months.
  2. `docs/architecture.md` and `docs/decisions/` for design constraints.
  3. `docs/roadmap.md` for forward-looking context.
  4. Cross-references - traverse the document graph.
- Build a mental model from architecture docs before proposing changes.
- Cache roadmap items for contextualizing suggestions.
- Warning: auto-generated context filled with generic information the model
  already knows can hurt agent performance (Gloaguen et al., ETH Zurich,
  arXiv:2602.11988, Feb 2026; retrieved 2026-09-06). Review and prune
  auto-generated content. Remove what the agent can infer from the code itself.
- Every line in AGENTS.md is sent with every prompt - keep it lean. Dilution is
  the enemy of signal.

### When code changes
- After any code change that modifies behavior, propose documentation updates.
- Flag docs that may be stale due to the change.
- Update `last_updated` on any doc you modify.
- Add an entry to the Assumptions log (`.ai/assumptions.md`) when a documentation
  decision is made during implementation.

## Doc reader tool compatibility
- GitHub - primary renderer. All docs must render correctly in the GitHub web
  UI. Relative links, tables, code blocks, task lists work natively.
- MkDocs / Material for MkDocs - `index.md` in every directory maps to the
  section landing page. `mkdocs.yml` `nav:` can mirror the directory structure.
- Docusaurus - `index.md` as category index. Sidebar auto-generated from
  directory structure.
- ReadTheDocs - supports MkDocs and Sphinx. The `index.md` convention works
  with both.
- Cross-compatibility rule: never use syntax that only one renderer supports
  (e.g., MkDocs-specific admonition `!!! note`). Stick to Markdown that degrades
  gracefully everywhere. Mermaid is the exception - universally supported by
  modern doc renderers and its source text is human-readable as a fallback.

## Maintenance
- Update `docs/index.md` when adding, removing, or renaming docs.
- Update `roadmap.md` when a phase completes.
- Update `CHANGELOG.md` before every release.
- Update `repository-map.md` when the file structure changes.
- Archive, don't delete - move outdated docs to `docs/archive/` with a
  deprecation notice at the top.
- Review all docs before every release: check for stale references, broken
  links, outdated status badges, metadata freshness.
- Run `ai-context --force` after structural changes to refresh the context
  index and README.md.

## Workflow
- During project analysis, ensure `README.md`, `CHANGELOG.md`, `docs/index.md`,
  `docs/architecture.md`, `docs/repository-map.md`, and `docs/roadmap.md` exist.
- Generate docs on demand with `ai-context` - only sections that apply to the
  detected project.
- Never copy generic templates verbatim into a project - fill them with real
  detected facts.
- When creating a new doc manually, start from the template and fill every field.
- Project-specific deviations from this standard go in `.ai/docs/project-docs.md`.
- Overrides must state what they change and why.

Sources: `core/docs/sources.md`, sections "Documentation standards" and "Git, commits, and releases".
