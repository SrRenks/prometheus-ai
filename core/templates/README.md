<!-- Reference shape, not copied verbatim. `ai-context` generates the project
README from THIS shape, but only the sections that apply to the detected
project - a project without a database gets no Storage row; unknown commands
are omitted, not guessed. Never copy this file into a project; generate it via
`ai-context`. -->

# <Project Name>

<One-line description: what it does, for whom. For a new project leave the
maturity line and fill this in after onboarding.>

## Stack
Only rows that apply to the detected project.
| Layer | Technology |
|---|---|
| Language | <detected: e.g. Kotlin (Android)> |
| Storage | <only when a database exists> |

## Quick start
Only commands that are known to exist in this project.
| Action | Command |
|---|---|
| Build | ./gradlew build |
| Test | ./gradlew test |
| Run | <only if a run command is known> |

## Repository structure
Real top-level entries - no invented directories.
```
app/    <purpose>
docs/   project documentation (start at docs/index.md)
```

## Status
- Maturity: NEW / EXISTING (generated date)
- What works, what is next. Filled in as the project evolves.

Principles (from `docs/project-docs.md`):
- Enterprise overview only - surface level by design; deep docs live in `docs/`.
- Human-facing markdown (full markdown, tables where they clarify).
- No placeholders in the final file: unknown facts become open questions, not `<...>`.
