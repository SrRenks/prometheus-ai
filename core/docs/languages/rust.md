# Rust guidelines

## Tooling

Use:
- rustfmt
- clippy
- cargo test

## Recommended linter configuration

Use `clippy` with these lints:

- `clippy::too_many_lines` - function length (threshold: 60)
- `clippy::too_many_arguments` - parameters (threshold: 4)
- `clippy::result_unit_err` - keep error types meaningful

Clippy does not currently enforce all repository complexity budgets.

Example `Cargo.toml`:

```toml
[lints.clippy]
cognitive_complexity = { level = "deny", threshold = 15 }
too_many_lines = { level = "deny", threshold = 60 }
```

Also run cargo-audit in CI to check for vulnerable dependencies.

## Formatting and line length

`rustfmt` owns formatting, including where to wrap, so the line length is configured there rather than enforced by hand. Set it in `rustfmt.toml`:

```toml
max_width = 100
```

The default is 100. Keep the default unless a project has a reason to differ: an unset `max_width` means `rustfmt` and `clippy` agree, and a hand-wrapped line is the one thing `cargo fmt` will undo.

## Practices

Use ownership-driven design, explicit error types, and zero-cost abstractions.
Do not clone unnecessarily. Do not allocate excessively. Never use unsafe without justification.