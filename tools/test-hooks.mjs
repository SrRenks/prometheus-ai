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
 *     as `hookSpecificOutput.additionalContext` on stdout. That is the one channel
 *     Claude reads after a successful tool call: stderr with exit 0 reaches only
 *     the debug log, which is where lint-check's reports went for as long as it
 *     wrote them there.
 *
 * Run after any change to a hook:
 *   node tools/test-hooks.mjs
 *
 * Exit code is non-zero when a case fails.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOOKS = join(ROOT, 'agents/claude-code/hooks')

/**
 * Temp directories are removed at exit. A first version left one behind per case,
 * and 81 of them accumulated in one afternoon, which is a leak the suite itself
 * should not have.
 */
const scratchDirs = []
process.on('exit', () => {
  for (const dir of scratchDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Best effort: a leftover temp directory is not worth failing a run over.
    }
  }
})

/** A temp directory that is cleaned up when the run ends. */
const scratch = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  scratchDirs.push(dir)
  return dir
}

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
  'rm -fr build',
  'rm -r -f build',
  'rm --recursive --force build',
  'git push -f origin main',
  'echo x && sudo -i',
  'rm build -rf',
  'rm "-rf" build',
  'rm -r build -f',
  'git push origin +main',
  'git add --all',
  'git -C repo add -A',
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
  'echo pseudo-terminal',
  'grep -rn sudoers /etc/hosts',
  'rm -r build',
  'git push origin main; ls -f',
  'git add ./src/a.txt',
  'git add .gitignore',
  'rm -r build; ls -f',
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

/** The text a PostToolUse hook put in front of Claude, or undefined. */
const contextOf = (result) => {
  try {
    return JSON.parse(result.stdout).hookSpecificOutput?.additionalContext
  } catch {
    return undefined
  }
}

/** Is a command missing from PATH? */
const missing = (tool) => {
  try {
    execFileSync('bash', ['-c', `command -v ${tool}`], { stdio: 'ignore' })
    return false
  } catch {
    return true
  }
}

console.log('\nlint-check reports on writes, to Claude, and never blocks')
{
  const dir = scratch('hook-lint-')
  const env = { ...process.env, LINT_CHECK_STATE_DIR: join(dir, 'state') }
  const runLint = (payload) => {
    const spawn = spawnSync('bash', [join(HOOKS, 'lint-check')], { input: JSON.stringify(payload), encoding: 'utf8', env })
    return { code: spawn.status ?? 1, stdout: spawn.stdout ?? '', stderr: spawn.stderr ?? '' }
  }

  // A syntax error whose message carries quotes and a newline: the old hook built
  // its JSON by string interpolation, so output like this produced invalid JSON.
  const js = join(dir, 'bad.mjs')
  writeFileSync(js, 'const x = "unterminated\n')
  const jsRun = runLint(write(js))
  check('never denies, whatever it finds', jsRun.code === 0, `exit ${jsRun.code}`)
  check('reports a JavaScript syntax error as additionalContext', (contextOf(jsRun) ?? '').includes('bad.mjs'), jsRun.stdout.slice(0, 80))

  const sh = join(dir, 'bad.sh')
  writeFileSync(sh, 'if then fi "\n')
  check('reports a shell syntax error', (contextOf(runLint(write(sh))) ?? '').includes('bad.sh'))

  const good = join(dir, 'good.mjs')
  writeFileSync(good, 'export const x = 1\n')
  const clean = runLint(write(good))
  check('says nothing about a clean file', clean.stdout.trim() === '' && clean.stderr.trim() === '', clean.stdout.slice(0, 60))

  const quiet = runLint(write('/nonexistent/dir/absent.go'))
  check('says nothing about a path that does not exist', quiet.stdout.trim() === '', quiet.stdout.trim().slice(0, 40))

  const wrongTool = runLint({ tool_name: 'Read', tool_input: { file_path: js } })
  check('says nothing after a Read', wrongTool.stdout.trim() === '', wrongTool.stdout.trim().slice(0, 40))

  // The matcher sends the capitalised name; the hook normalises before comparing.
  // This is the case that was once broken by comparing verbatim against lowercase.
  for (const tool of ['Edit', 'MultiEdit']) {
    const capitalised = runLint({ tool_name: tool, tool_input: { file_path: js } })
    check(`accepts the capitalised tool name the matcher sends: ${tool}`, contextOf(capitalised) !== undefined, capitalised.stdout.slice(0, 40))
  }

  // "Clean" and "not checked" are different answers, and only one is good news.
  // Saying so on every write is noise the model learns to skip, so it is said
  // once per session per linter.
  const pyFile = join(dir, 'a.py')
  writeFileSync(pyFile, 'x = 1\n')
  if (missing('ruff')) {
    const first = runLint({ ...write(pyFile), session_id: 'lint-s1' })
    const second = runLint({ ...write(pyFile), session_id: 'lint-s1' })
    const other = runLint({ ...write(pyFile), session_id: 'lint-s2' })
    check('names the linter it could not run', (contextOf(first) ?? '').includes('Not linted'), first.stdout.slice(0, 70))
    check('and says it once per session, not on every write', second.stdout.trim() === '', second.stdout.slice(0, 60))
    check('but again in a new session', (contextOf(other) ?? '').includes('Not linted'))
    const broken = join(dir, 'broken.py')
    writeFileSync(broken, 'def f(:\n')
    check('still catches a Python syntax error without ruff', (contextOf(runLint(write(broken))) ?? '').includes('broken.py'))
  } else {
    console.log('         note: ruff is installed here, so the absent-linter path is not exercised')
  }
}

// ── session-init ─────────────────────────────────────────────────────────────

console.log('\nsession-init creates the .ai/ memory files')
{
  const dir = scratch('hook-session-')
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
  const dir = scratch('hook-session-bad-')
  const { code, output } = run('session-init', {}, { cwd: dir })
  check('succeeds from nothing, because it now creates the directory', code === 0, `exit ${code}`)
  check('and says nothing on the way', output.trim() === '', output.trim().slice(0, 60))
  check('and leaves a usable .ai/', existsSync(join(dir, '.ai/session.md')))
}

// ── settings.json wiring ─────────────────────────────────────────────────────

console.log('\nsettings.json wires every hook the way the hook expects')
{
  const settings = JSON.parse(readFileSync(join(ROOT, 'agents/claude-code/settings.json'), 'utf8'))
  /** Every matcher that runs a command containing `hookName` for one event. */
  const matchersFor = (event, hookName) => (settings.hooks?.[event] ?? [])
    .filter(group => group.hooks.some(h => h.command.includes(hookName)))
    .map(group => new RegExp(`^(?:${group.matcher ?? ''})$`))
  const reaches = (event, hookName, tool) => matchersFor(event, hookName).some(re => re.test(tool))

  for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash']) {
    check(`docs-gate runs before ${tool}`, reaches('PreToolUse', 'docs-gate', tool))
  }
  for (const tool of ['Read', 'Bash']) check(`docs-gate credits after ${tool}`, reaches('PostToolUse', 'docs-gate', tool))
  check('docs-gate leaves Read, Grep and Glob alone before they run', !['Read', 'Grep', 'Glob'].some(t => reaches('PreToolUse', 'docs-gate', t)))
  check('docs-gate sees compaction', reaches('SessionStart', 'docs-gate', 'compact'))
  check('docs-gate prunes at startup', reaches('SessionStart', 'docs-gate', 'startup'))
  check('docs-gate does not reset on resume', !reaches('SessionStart', 'docs-gate', 'resume'))
  check('docs-gate sees /clear', reaches('SessionStart', 'docs-gate', 'clear'))
  for (const tool of ['Write', 'Edit', 'MultiEdit']) check(`lint-check runs after ${tool}`, reaches('PostToolUse', 'lint-check', tool))
  check('block-danger runs before Bash', reaches('PreToolUse', 'block-danger', 'Bash'))

  // Each hook command names a file that exists in this repo.
  for (const group of Object.values(settings.hooks ?? {}).flat()) {
    for (const h of group.hooks) {
      const file = h.command.match(/~\/\.claude\/hooks\/([\w.-]+)/)?.[1]
      check(`hook file exists: ${file}`, file !== undefined && existsSync(join(HOOKS, file)))
    }
  }

  // `Bash(git:diff*)` reads as "a command starting with `git:diff`", which no
  // shell command does, so the rule silently matched nothing. A prefix rule is
  // `Bash(git diff:*)`: the colon comes only before the trailing `*`.
  for (const rule of [...settings.permissions.allow, ...settings.permissions.deny]) {
    const body = rule.match(/^Bash\((.*)\)$/)?.[1]
    if (body === undefined || body.startsWith(':(')) continue
    check(`permission rule uses the prefix syntax: ${rule}`, !/:(?!\*$)/.test(body))
  }
}

console.log(failures === 0 ? `\nALL ${checks} CHECKS PASSED` : `\n${failures} OF ${checks} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
