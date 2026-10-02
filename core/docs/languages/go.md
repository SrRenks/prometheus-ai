# Go guidelines

## Tooling

Use:
- gofmt
- go vet
- golangci-lint

## Recommended linter configuration

When using `golangci-lint`, turn on these analyzers to enforce the repository's policies:

- `gocyclo` - cyclomatic complexity (budget: 10)
- `gocognit` - cognitive complexity (budget: 15)
- `cyclop` - alternative cyclomatic complexity checker
- `funlen` - function length (budget: 60 lines)
- `nestif` - nesting depth (budget: 3)
- `maintidx` - maintainability index (target ≥ 70)
- `dupl` - code duplication detection
- `staticcheck`, `govet`, `errcheck`, `unused` - general correctness and hygiene

`nestif` scores nested `if` complexity rather than enforcing an exact nesting depth, so it complements the depth budget above instead of replacing it.

## Formatting and line length

`gofmt` settles indentation, so the only line-length question is where to wrap. Go has no formatter-enforced column limit and the community treats one as unnecessary, so this repo does not impose a numeric maximum for Go. `lll` is therefore NOT enabled: a limit nobody agreed on produces churn in diffs, which costs more than the long line it flags.

The one constraint is mechanical rather than stylistic: keep a line inside the review width of the terminal the team actually reads diffs in. Wrap long signatures and calls at their argument boundaries rather than at an arbitrary column.

## Practices

Use small packages, explicit error handling, context propagation, and the standard library when possible.

Never create unnecessary interfaces. Do not use excessive dependency injection. Do not use package-level mutable state.