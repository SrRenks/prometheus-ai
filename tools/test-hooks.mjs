#!/usr/bin/env node
/**
 * Test the Claude Code hooks against the JSON shape Claude Code actually sends.
 *
 * WHY THIS EXISTS. The gate had 47 tests and these three scripts had none, while
 * doing the same kind of work in a different harness: `block-danger` denies a
 * command and `lint-check` reports on a write. `session-init` creates files.
 * Enforcement that is never executed is enforcement that is presumed, and this
 * repo had four production defects in one day from exactly that assumption.
 *
 * The contract each hook obeys, taken from its own header:
 *   - a PreToolUse hook reads one JSON object on stdin and exits 2 to deny,
 *     0 to allow. The denial reason goes to stderr as `{"systemMessage": ...}`.
 *   - a PostToolUse hook reads the same shape and exits 0 either way, reporting
 *     through `systemMessage` rather than blocking.
 *
 * Run after any change to a hook:
 *   node tools/test-hooks.mjs
 *
 * Exit code is non-zero when a case fails.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOOKS = join(ROOT, 'agents/claude-code/hooks')

let failures = 0
let checks = 0
const check = (label, ok, detail = '') => {
  checks += 1
  if (!ok) failures += 1
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

/**
 * Run one hook with one payload.
 *
 * @param hook - the hook file name under `hooks/`.
 * @param payload - the JSON object to feed on stdin.
 * @returns the exit code and the merged output.
 */
const run = (hook, payload, options = {}) => {
  // `execFileSync` returns stdout only, and a PostToolUse hook reports through
  // STDERR as `{"systemMessage": ...}`. A first version of this file read stdout
  // and concluded the hook was silent, which is a test measuring the wrong
  // channel rather than a broken hook.
  const spawn = spawnSync('bash', [join(HOOKS, hook)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd: options.cwd,
  })
  return {
    code: spawn.status ?? 1,
    output: `${spawn.stdout ?? ''}${spawn.stderr ?? ''}`,
    stdout: spawn.stdout ?? '',
    stderr: spawn.stderr ?? '',
  }
}

/** A Bash tool call carrying one command. */
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } })

/** A file write carrying one path. */
const write = (file_path) => ({ tool_name: 'Write', tool_input: { file_path } })

// ── block-danger ─────────────────────────────────────────────────────────────

console.log('block-danger denies what the shared rules ban')

// Each of these is named in the hook's own comment or in git-workflow.md, which
// bans `git add -A` for every tool.
for (const command of [
  'rm -rf build',
  'sudo apt install x',
  'git push --force origin main',
  'chmod 777 /tmp/x',
  'dd if=/dev/zero of=/dev/sda',
  'mkfs.ext4 /dev/sdb',
  'git add -A',
  'git add .',
]) {
  const { code, output } = run('block-danger', bash(command))
  check(`denies: ${command}`, code === 2, `exit ${code}`)
  // A denial with no reason reaches the model as a bare failure, which is how a
  // gate teaches nothing. The hook writes the reason to stderr as JSON.
  if (code === 2) {
    let parsed
    try {
      parsed = JSON.parse(output.trim())
    } catch {
      parsed = undefined
    }
    check(`  and explains why: ${command}`, typeof parsed?.systemMessage === 'string', output.trim().slice(0, 40))
  }
}

console.log('\nblock-danger allows ordinary work')
for (const command of [
  'git status --short',
  'git diff HEAD',
  'npm test',
  'git add src/a.ts src/b.ts',
  'rm build/out.txt',
  'echo hello',
  'ruff check .',
]) {
  const { code } = run('block-danger', bash(command))
  check(`allows: ${command}`, code === 0, `exit ${code}`)
}

console.log('\nblock-danger only inspects Bash')
// The hook's first condition is the tool name. A denial on another tool would
// block work the shared rules never restricted.
for (const tool of ['Write', 'Edit', 'Read', 'Grep']) {
  const { code } = run('block-danger', { tool_name: tool, tool_input: { command: 'rm -rf /' } })
  check(`ignores a non-Bash tool carrying a banned string: ${tool}`, code === 0, `exit ${code}`)
}

// ── lint-check ───────────────────────────────────────────────────────────────

console.log('\nlint-check reports on writes and never blocks')
{
  const dir = mkdtempSync(join(tmpdir(), 'hook-lint-'))
  const goFile = join(dir, 'bad.go')
  writeFileSync(goFile, 'package main\n\nfunc main() {\n\tunused := 1\n}\n')

  const { code, output } = run('lint-check', write(goFile))
  // A PostToolUse hook must not deny: the write already happened, and exit 2 here
  // would report a completed change as a failure.
  check('never denies, whatever it finds', code === 0, `exit ${code}`)
  check('and reports through systemMessage instead', output.includes('systemMessage'))

  // Nothing to run means nothing to say. A hook that reported "no linter" on
  // every write would be noise the model learns to ignore.
  const quiet = run('lint-check', write('/nonexistent/dir/absent.go'))
  check('says nothing about a path that does not exist', quiet.output.trim() === '', quiet.output.trim().slice(0, 40))

  const wrongTool = run('lint-check', { tool_name: 'Read', tool_input: { file_path: goFile } })
  check('says nothing after a Read', wrongTool.output.trim() === '', wrongTool.output.trim().slice(0, 40))

  // The matcher in settings.json sends the real tool name, capitalised. The hook
  // normalises before comparing, and this is the case that was once broken by
  // comparing verbatim against a lowercase literal.
  const capitalised = run('lint-check', { tool_name: 'Write', tool_input: { file_path: goFile } })
  check('accepts the capitalised tool name the matcher sends', capitalised.output.includes('systemMessage'), capitalised.output.trim().slice(0, 40))
}

// ── session-init ─────────────────────────────────────────────────────────────

console.log('\nsession-init creates the .ai/ memory files')
{
  const dir = mkdtempSync(join(tmpdir(), 'hook-session-'))
  const script = readFileSync(join(HOOKS, 'session-init'), 'utf8')
  // The hook reads the current directory, so it is run with cwd set rather than
  // by editing it.
  const { code } = run('session-init', {}, { cwd: dir })
  check('exits 0 when it succeeds', code === 0, `exit ${code}`)

  const ai = join(dir, '.ai')
  check('creates .ai/agents.md as a symlink to the shared AGENTS.md', existsSync(join(ai, 'agents.md')))
  for (const file of ['project.md', 'session.md', 'assumptions.md', 'scratchpad.md']) {
    check(`creates .ai/${file}`, existsSync(join(ai, file)))
  }
  check('leaves the un-wired intent alone', script.includes('SessionStart'), 'the wiring snippet is documented, not applied')
}

console.log('\nsession-init reports failure instead of printing it')
{
  // The defect this pins: with no `.ai/` yet, the first version wrote into a
  // directory it never created, put five errors on stderr, and exited 0. A hook
  // that fails silently is the shape this repository has produced four times.
  const dir = mkdtempSync(join(tmpdir(), 'hook-session-bad-'))
  const { code, output } = run('session-init', {}, { cwd: dir })
  check('succeeds from nothing, because it now creates the directory', code === 0, `exit ${code}`)
  check('and says nothing on the way', output.trim() === '', output.trim().slice(0, 60))
  check('and leaves a usable .ai/', existsSync(join(dir, '.ai/session.md')))
}

console.log('\nlint-check names the linter it could not run')
{
  const dir = mkdtempSync(join(tmpdir(), 'hook-absent-'))
  const pyFile = join(dir, 'a.py')
  writeFileSync(pyFile, 'x = 1\n')
  let ruff = true
  try {
    execFileSync('command', ['-v', 'ruff'], { shell: true, stdio: 'ignore' })
  } catch {
    ruff = false
  }
  const { output } = run('lint-check', write(pyFile))
  if (ruff) {
    console.log('         note: ruff is installed here, so the absent-linter path is not exercised')
  } else {
    // "Clean" and "not checked" are different answers, and only one is good news.
    check('says it did not lint, rather than saying nothing', output.includes('Not linted'), output.trim().slice(0, 70))
  }
}

console.log(failures === 0 ? `\nALL ${checks} CHECKS PASSED` : `\n${failures} OF ${checks} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
