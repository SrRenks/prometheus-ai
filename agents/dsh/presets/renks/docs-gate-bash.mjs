/**
 * Which `bash` commands change the workspace: the rules docs-gate applies to
 * each simple command `docs-gate-shell.mjs` parses out of a call.
 *
 * Each rule looks at a command's own words, so a word inside a string, a
 * heredoc body or a comment can no longer trip it, and it looks at subcommands
 * and flags, so `git merge-base`, `git tag -l` and `git stash list` read as the
 * queries they are. Commands that only touch paths are judged by those paths:
 * `mkdir -p /tmp/x` and `> /tmp/out.log` leave the workspace alone.
 *
 * Inline interpreter code is handled in `docs-gate-code.mjs`; shell code
 * (`bash -c`, `echo ... | sh`) is parsed and classified like any other.
 *
 * Unknown commands are read-only. A false positive blocks real work, and the
 * gate's job is to make sure the rules were read before a change, not to be
 * the last line of defence against one. Text the parser could not reach, past
 * its nesting bound, is the exception: it is gated as `unparsed`.
 */
import { codeWrites, editsInPlace, inlineCode, interpreterOf, positionals } from './docs-gate-code.mjs'
import { MAX_DEPTH, parseShell, writeTargets } from './docs-gate-shell.mjs'
import { isInside, normalizePath } from './docs-gate-target.mjs'

/**
 * Devices a redirect can name without changing any file. `2>/dev/null` is the
 * commonest redirect in exploration.
 */
const DEVICE_SINK_RE = /^\/dev\/(?:null|stdout|stderr|tty|fd\/\d+)$/

/** Path-taking commands, and which positional arguments they change. */
const FS_COMMANDS = {
  rm: 'all', rmdir: 'all', unlink: 'all', shred: 'all', mkdir: 'all', touch: 'all', truncate: 'all', mv: 'all',
  chmod: 'after-first', chown: 'after-first', chgrp: 'after-first',
  cp: 'last', ln: 'last', install: 'last', rsync: 'last',
}

/** File-command options that take a value, so the value is not a target. */
const FS_VALUE_OPTIONS = {
  mkdir: ['-m', '--mode'],
  install: ['-m', '-o', '-g', '-S', '--mode', '--owner', '--group', '--suffix'],
  cp: ['-S', '--suffix'], mv: ['-S', '--suffix'], ln: ['-S', '--suffix'],
  touch: ['-d', '-r', '-t', '--date', '--reference'],
  truncate: ['-s', '-r', '--size', '--reference'],
  shred: ['-n', '-s', '--iterations', '--size'],
  rsync: ['-e', '--rsh', '--exclude', '--include', '--filter', '-f'],
}

/** git subcommands that change the repository or the working tree. */
const GIT_WRITES = new Set([
  'add', 'commit', 'push', 'pull', 'merge', 'rebase', 'reset', 'checkout', 'switch', 'restore', 'clean',
  'cherry-pick', 'revert', 'am', 'init', 'rm', 'mv', 'filter-branch', 'filter-repo', 'update-ref',
  'update-index', 'replace', 'clone',
])

/** git global options that take a value as the next word. */
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'])

/** Package-manager subcommands that change dependencies, manifests or lock files. */
const PKG_SUBCOMMANDS = new Set(['i', 'in', 'install', 'add', 'remove', 'rm', 'uninstall', 'upgrade', 'update', 'get', 'tidy', 'ci', 'sync', 'lock', 'init', 'link', 'dedupe', 'prune'])
const PKG_COMMANDS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'cargo', 'pip', 'pip3', 'poetry', 'uv', 'go', 'gem', 'composer', 'apt', 'apt-get', 'dnf', 'pacman', 'brew'])
const JS_PKG = new Set(['npm', 'pnpm', 'yarn', 'bun'])

/** Build tools, and the arguments that make them write build output. */
const BUILD_COMMANDS = new Set(['make', 'cmake', 'ninja', 'gradle', 'gradlew', 'mvn', 'mvnw'])
const BUILD_ARGS = new Set(['build', 'install', 'clean', 'package'])

/** gh subcommands that act on the remote. `gh pr view` stays read-only. */
const GH_WRITES = {
  pr: new Set(['create', 'merge', 'close', 'reopen', 'edit', 'comment', 'review']),
  release: new Set(['create', 'edit', 'delete', 'upload']),
  issue: new Set(['create', 'close', 'reopen', 'edit', 'comment']),
  repo: new Set(['create', 'delete', 'fork', 'edit', 'rename', 'archive']),
}

/**
 * Commands that run the rest of their words as another command, with the
 * options of each that take a value. One shared table let `env -i` and
 * `sudo -n` swallow the command after them.
 */
const WRAPPERS = {
  sudo: new Set(['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U', '-T', '--user', '--group', '--host', '--prompt', '--chdir']),
  doas: new Set(['-u', '-C']),
  env: new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string']),
  nice: new Set(['-n', '--adjustment']),
  nohup: new Set(),
  command: new Set(),
  builtin: new Set(),
  exec: new Set(['-a']),
  timeout: new Set(['-s', '--signal', '-k', '--kill-after']),
  stdbuf: new Set(['-i', '-o', '-e']),
  ionice: new Set(['-c', '-n', '-p', '-t']),
  time: new Set(['-f', '-o', '--format', '--output']),
}

/** The command name without its directory: `/usr/bin/git` is `git`. */
function baseName(word) {
  return word.value.split('/').pop()
}

/**
 * Does writing `word` change the workspace?
 *
 * The literal text up to the first expansion decides: `/tmp/f.$$` is in /tmp,
 * while `$OUT/x` or `~/x` could be anywhere and count as inside.
 *
 * @param word - a `{ value, dynamic }` path word.
 * @param ctx - `{ base, root }`, either may be undefined.
 * @returns true when the path is, or may be, inside the workspace.
 */
export function writesInside(word, ctx) {
  const literal = word.value.split('$')[0]
  if (DEVICE_SINK_RE.test(word.value)) return false
  if (ctx.root === undefined) return true
  if (literal.startsWith('/')) return isInside(normalizePath(literal), ctx.root)
  if (literal.length === 0 || literal.startsWith('~') || ctx.base === undefined) return true
  return isInside(normalizePath(`${ctx.base}/${literal}`), ctx.root)
}

/** Is a whole-command act run in a directory this workspace owns? */
function runsInside(dir, ctx) {
  if (ctx.root === undefined || dir === undefined) return true
  return isInside(dir, ctx.root)
}

/** Resolve a directory word against the current base, or undefined if unknown. */
function resolveDir(word, base) {
  if (word === undefined || word.dynamic || word.value === '-' || word.value.startsWith('~')) return undefined
  if (word.value.startsWith('/')) return normalizePath(word.value)
  return base === undefined ? undefined : normalizePath(`${base}/${word.value}`)
}

/**
 * Strip wrappers and leading assignments: `sudo env A=1 nice rm x` is `rm x`.
 * `env -C dir` moves the base; `env -S 'cmd args'` runs a command line.
 *
 * @returns `{ words, base }` for the command that actually runs.
 */
function unwrap(words, base) {
  let i = 0
  let dir = base
  while (i < words.length) {
    const value = words[i].value
    const options = WRAPPERS[baseName(words[i])]
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(value)) i++
    else if (options !== undefined) {
      // `command -v x` asks where x is; it runs nothing.
      if (value === 'command' && /^-[vV]$/.test(words[i + 1]?.value ?? '')) return { words: [], base: dir }
      const step = skipWrapperOptions(words, i + 1, options, dir)
      if (step.split !== undefined) return { words: [{ value: 'sh', dynamic: false }, { value: '-c', dynamic: false }, step.split], base: step.dir }
      i = step.next
      dir = step.dir
      if (value === 'timeout' && /^\d/.test(words[i]?.value ?? '')) i++
    } else break
  }
  return { words: words.slice(i), base: dir }
}

/** Skip one wrapper's options, applying `-C` and catching `-S`. */
function skipWrapperOptions(words, start, options, base) {
  let j = start
  let dir = base
  while (j < words.length && words[j].value.startsWith('-') && words[j].value !== '-') {
    const value = words[j].value
    if (value === '-S' || value === '--split-string') return { split: words[j + 1] ?? { value: '', dynamic: false }, dir }
    if (value === '-C' || value === '--chdir') dir = resolveDir(words[j + 1], dir)
    else if (value.startsWith('--chdir=')) dir = resolveDir({ value: value.slice(8), dynamic: words[j].dynamic }, dir)
    j += options.has(value) ? 2 : 1
  }
  return { next: j, dir }
}

/** The subcommand of a `git` call and where it runs, past the global options. */
function gitCall(words, base) {
  let dir = base
  let i = 1
  while (i < words.length && words[i].value.startsWith('-')) {
    if (words[i].value === '-C') dir = resolveDir(words[i + 1], dir)
    i += GIT_VALUE_OPTIONS.has(words[i].value) ? 2 : 1
  }
  return { sub: words[i]?.value, rest: words.slice(i + 1), dir }
}

/** Read-only listing flags of `git branch` and `git tag`. */
const GIT_LIST_FLAGS = /^(?:-[alrvn]+|--(?:all|list|remotes|verbose|show-current|contains|no-contains|merged|no-merged|points-at|sort|format|color|no-color|column|no-column|ignore-case|abbrev|verify)(?:=.*)?)$/
const GIT_BRANCH_WRITE_FLAGS = /^(?:-[dDmMcCuf]|--(?:delete|move|copy|force|set-upstream-to|unset-upstream|track|edit-description)(?:=.*)?)$/

/** Does a `git branch` or `git tag` call create, delete or rename a ref? */
function refWrites(rest, writeFlags) {
  const values = rest.map(word => word.value)
  if (values.some(v => writeFlags.test(v))) return true
  return !values.some(v => GIT_LIST_FLAGS.test(v)) && positionals(rest).length > 0
}

/** Write rules for the git subcommands that are queries in some forms. */
const GIT_SUB_RULES = {
  branch: rest => refWrites(rest, GIT_BRANCH_WRITE_FLAGS),
  tag: rest => refWrites(rest, /^(?:-d|--delete|-a|-s|-f|-m|-F|--annotate|--sign|--force)$/),
  stash: (rest, first) => !['list', 'show'].includes(first),
  remote: (rest, first) => first !== undefined && !['show', 'get-url'].includes(first),
  worktree: (rest, first) => first !== undefined && first !== 'list',
  'sparse-checkout': (rest, first) => first !== undefined && first !== 'list',
  submodule: (rest, first) => first !== undefined && !['status', 'summary'].includes(first),
  notes: (rest, first) => first !== undefined && !['show', 'list'].includes(first),
  bisect: (rest, first) => !['log', 'view', 'visualize', 'terms'].includes(first),
  'format-patch': rest => !rest.some(word => word.value === '--stdout'),
  apply: rest => !rest.some(word => /^--(?:check|stat|numstat|summary)$/.test(word.value)),
  config: rest => gitConfigWrites(rest),
}

/** Does this `git` subcommand change anything? */
function gitSubWrites(sub, rest) {
  if (GIT_WRITES.has(sub)) return true
  const rule = GIT_SUB_RULES[sub]
  return rule !== undefined && rule(rest, positionals(rest)[0]?.value)
}

/** `git config a.b` reads; `git config a.b value`, `--unset` and `set` write. */
function gitConfigWrites(rest) {
  const values = rest.map(word => word.value)
  if (values.some(v => /^--(?:unset|unset-all|add|replace-all|rename-section|remove-section|edit)$|^-e$/.test(v))) return true
  if (values.some(v => /^--(?:get|get-all|get-regexp|get-urlmatch|list)$|^-l$/.test(v))) return false
  const args = positionals(rest, new Set(['--file', '-f', '--blob', '--type', '--default']))
  if (['set', 'unset', 'rename-section', 'remove-section', 'edit'].includes(args[0]?.value)) return true
  if (['get', 'list'].includes(args[0]?.value)) return false
  return args.length >= 2
}

/** The path words a file command changes. */
function fsTargets(name, args) {
  const targetFlag = args.findIndex(word => word.value === '-t' || word.value.startsWith('--target-directory'))
  if (targetFlag >= 0) {
    const flag = args[targetFlag]
    return [flag.value.includes('=') ? { ...flag, value: flag.value.split('=')[1] } : args[targetFlag + 1]].filter(Boolean)
  }
  const operands = positionals(args, new Set(FS_VALUE_OPTIONS[name] ?? []))
  if (FS_COMMANDS[name] === 'last') return operands.slice(-1)
  if (FS_COMMANDS[name] === 'after-first') return operands.slice(1)
  return operands
}

/** A mutation of one of `files`, or of unknown files when none are named. */
function editHit(kind, files, ctx) {
  if (files.length === 0) return { kind, target: undefined }
  const target = files.find(word => writesInside(word, ctx))
  return target === undefined ? undefined : { kind, target: target.value }
}

/** The files `sed -i` edits: every operand once the script is accounted for. */
function sedFiles(args) {
  const scripted = args.some(word => /^(?:-e|-f|--expression|--file)(?:=|$)/.test(word.value))
  const operands = positionals(args, new Set(['-e', '-f', '--expression', '--file', '-l', '--line-length']))
  return scripted ? operands : operands.slice(1)
}

/**
 * Classify one simple command.
 *
 * @param command - a parsed command from `parseShell`.
 * @param words - its words with wrappers removed.
 * @param ctx - `{ base, root, depth }`.
 * @returns `{ kind, target }` for a mutation, or undefined.
 */
function classifyCommand(command, words, ctx) {
  if (command.tooDeep) return { kind: 'unparsed', target: undefined }
  for (const target of writeTargets(command)) {
    if (writesInside(target, ctx)) return { kind: 'redirect', target: target.value }
  }
  if (words.length === 0) return undefined
  return classifyWords(words, command, ctx)
}

/** Classify a command by its name and arguments. */
function classifyWords(words, command, ctx) {
  const name = baseName(words[0])
  const args = words.slice(1)
  if (name === 'xargs') return classifyXargs(args, command, ctx)
  if (name === 'find') return classifyFind(args, command, ctx)
  if (name in FS_COMMANDS) {
    const target = fsTargets(name, args).find(word => writesInside(word, ctx))
    return target === undefined ? undefined : { kind: 'fs-write', target: target.value }
  }
  return classifyEditor(name, args, ctx) ?? classifyTool(name, words, command, ctx)
}

/** `dd of=`, `tee`, and in-place editors. */
function classifyEditor(name, args, ctx) {
  if (name === 'dd') {
    const of = args.find(word => word.value.startsWith('of='))
    return of === undefined ? undefined : editHit('fs-write', [{ ...of, value: of.value.slice(3) }], ctx)
  }
  if (name === 'tee') {
    const files = positionals(args)
    return files.length === 0 ? undefined : editHit('tee', files, ctx)
  }
  if (name === 'sed' && args.some(word => /^-[A-Za-z]*i|^--in-place/.test(word.value))) return editHit('in-place', sedFiles(args), ctx)
  if (editsInPlace(name, args)) {
    const codeFlag = args.findIndex(word => /^-[A-Za-z]*[eE]$/.test(word.value))
    const files = positionals(args.filter((_, i) => i !== codeFlag + 1 || codeFlag < 0))
    return editHit('in-place', interpreterOf(name) === 'awk' ? files.slice(1) : files, ctx)
  }
  return undefined
}

/** git, gh, package managers, build tools and interpreters. */
function classifyTool(name, words, command, ctx) {
  if (name === 'git') {
    const { sub, rest, dir } = gitCall(words, ctx.base)
    return gitSubWrites(sub, rest) && runsInside(dir, ctx) ? { kind: 'git-write', target: undefined } : undefined
  }
  if (name === 'gh') return ghWrites(words) ? { kind: 'gh-write', target: undefined } : undefined
  if (name === 'lazygit') return { kind: 'lazygit', target: undefined }
  if (pkgWrites(name, words) && runsInside(ctx.base, ctx)) return { kind: 'pkg-write', target: undefined }
  if (BUILD_COMMANDS.has(name) && words.slice(1).some(w => BUILD_ARGS.has(w.value.replace(/^-+/, ''))) && runsInside(ctx.base, ctx)) {
    return { kind: 'build-write', target: undefined }
  }
  return classifyInterpreter(name, words, command, ctx)
}

/** Does this gh call act on the remote? */
function ghWrites(words) {
  const [, group, action] = words.map(word => word.value)
  if (GH_WRITES[group]?.has(action)) return true
  if (group !== 'api') return false
  return words.some((word, i) => {
    const method = /^(?:-X|--method=?)(.*)$/.exec(word.value)
    if (method !== null) return !/^GET$/i.test(method[1] || words[i + 1]?.value || 'GET')
    return /^(?:-f|-F|--field|--raw-field|--input)$/.test(word.value)
  })
}

/** `pip install`, `npm version patch`, `npm pkg set`, `go mod tidy`, bare `yarn`. */
function pkgWrites(name, words) {
  const values = words.slice(1).map(word => word.value)
  if (name === 'yarn' && values.length === 0) return true
  if (JS_PKG.has(name) || name === 'poetry') {
    if (values[0] === 'version') return values.length > 1 && !values[1].startsWith('-')
    if (values[0] === 'pkg') return ['set', 'delete', 'fix'].includes(values[1])
    if (values[0] === 'audit') return values[1] === 'fix'
  }
  if (PKG_COMMANDS.has(name) && PKG_SUBCOMMANDS.has(values[0])) return true
  if (name === 'uv' && values[0] === 'pip' && PKG_SUBCOMMANDS.has(values[1])) return true
  if (name === 'go' && values[0] === 'mod' && ['tidy', 'init', 'edit'].includes(values[1])) return true
  return interpreterOf(name) === 'python' && values[0] === '-m' && /^pip3?$/.test(values[1] ?? '') && PKG_SUBCOMMANDS.has(values[2])
}

/** Inline interpreter code: parse it when it is shell, scan it otherwise. */
function classifyInterpreter(name, words, command, ctx) {
  const family = interpreterOf(name)
  if (family === undefined) return undefined
  const code = inlineCode(family, words.slice(1), command)
  // A program piped in from somewhere unreadable runs unseen.
  if (code === null) return { kind: 'interpreter-write', target: undefined }
  if (code === undefined || code.length === 0) return undefined
  if (family === 'shell') return classifyBashCall(code, ctx.base, ctx.root, ctx.depth + 1)
  const commandWrites = cmd => classifyBashCall(cmd, ctx.base, ctx.root, ctx.depth + 1) !== undefined
  return codeWrites(family, code, commandWrites) ? { kind: 'interpreter-write', target: undefined } : undefined
}

/** `xargs rm`: the command runs on paths read from stdin, so its targets are unknown. */
function classifyXargs(args, command, ctx) {
  let i = 0
  const valued = new Set(['-n', '-I', '-P', '-L', '-d', '-s', '-E', '-a'])
  while (i < args.length && args[i].value.startsWith('-')) i += valued.has(args[i].value) ? 2 : 1
  const inner = args.slice(i)
  if (inner.length === 0) return undefined
  if (baseName(inner[0]) in FS_COMMANDS && runsInside(ctx.base, ctx)) return { kind: 'fs-write', target: undefined }
  return classifyWords(inner, command, ctx)
}

/** `find -delete`, and the command `find -exec` runs on each match. */
function classifyFind(args, command, ctx) {
  const firstExpression = args.findIndex(w => /^[-(!]/.test(w.value))
  const starts = firstExpression < 0 ? args : args.slice(0, firstExpression)
  const roots = starts.length > 0 ? starts : [{ value: '.', dynamic: false }]
  const inside = roots.some(word => writesInside(word, ctx))
  if (args.some(word => word.value === '-delete') && inside) return { kind: 'fs-write', target: undefined }
  const exec = args.findIndex(word => /^-(?:exec|execdir|ok|okdir)$/.test(word.value))
  if (exec < 0) return undefined
  const end = args.findIndex((word, i) => i > exec && (word.value === ';' || word.value === '+'))
  const inner = args.slice(exec + 1, end < 0 ? undefined : end)
  if (inner.length === 0) return undefined
  if (baseName(inner[0]) in FS_COMMANDS) return inside ? { kind: 'fs-write', target: undefined } : undefined
  return classifyWords(inner, command, ctx)
}

/**
 * Track the working directory through `cd`, `pushd` and `popd`.
 *
 * @returns the new base, or undefined when it cannot be known (`cd`, `cd -`).
 */
function changeDir(name, words, base, pushed) {
  if (name === 'popd') return pushed.length > 0 ? pushed.pop() : undefined
  if (name === 'pushd') pushed.push(base)
  return resolveDir(positionals(words.slice(1))[0], base)
}

/**
 * Every mutation in one `bash` command.
 *
 * `cd` moves the base for the commands after it, scoped to its subshell: in
 * `(cd /tmp) && rm x` the `rm` runs where it started. An unknown directory
 * (`cd`, `cd -`, `cd "$D"`) counts every relative target as inside.
 *
 * @param command - the raw command text.
 * @param base - directory relative targets resolve against.
 * @param workspaceRoot - absolute workspace root, or undefined when unknown.
 * @param depth - nesting of `bash -c` strings, bounded.
 * @returns `{ kind, target, hits }` for the first mutation, with every mutation
 *   in `hits`, or undefined when the command is read-only.
 */
export function classifyBashCall(command, base, workspaceRoot, depth = 0) {
  if (typeof command !== 'string' || command.length === 0) return undefined
  if (depth > MAX_DEPTH) return { kind: 'unparsed', target: undefined, hits: [{ kind: 'unparsed', target: undefined }] }
  const root = workspaceRoot === undefined ? undefined : normalizePath(workspaceRoot)
  const scopes = [base === undefined ? root : normalizePath(base)]
  const pushed = []
  const hits = []
  for (const parsed of parseShell(command)) {
    while (scopes.length - 1 < parsed.depth) scopes.push(scopes[scopes.length - 1])
    while (scopes.length - 1 > parsed.depth) scopes.pop()
    const { words, base: dir } = unwrap(parsed.words, scopes[scopes.length - 1])
    const name = words[0] === undefined ? undefined : baseName(words[0])
    if (name === 'cd' || name === 'pushd' || name === 'popd') {
      scopes[scopes.length - 1] = changeDir(name, words, dir, pushed)
      continue
    }
    const hit = classifyCommand(parsed, words, { root, base: dir, depth })
    if (hit !== undefined) hits.push(...(hit.hits ?? [hit]))
  }
  return hits.length === 0 ? undefined : { kind: hits[0].kind, target: hits[0].target, hits }
}

/**
 * The mutation kind of one `bash` command, or undefined when it is read-only.
 *
 * @param command - the raw command text.
 * @param base - directory relative targets resolve against.
 * @param workspaceRoot - absolute workspace root, or undefined when unknown.
 * @returns the kind id, such as `redirect`, `git-write` or `interpreter-write`.
 */
export function classifyBash(command, base, workspaceRoot) {
  return classifyBashCall(command, base, workspaceRoot)?.kind
}

/**
 * The path a command writes to, when it names one: used to pick a doc tier.
 *
 * @param command - the raw command text.
 * @returns the first written path that is not a device, or undefined.
 */
export function redirectTarget(command) {
  for (const parsed of parseShell(command)) {
    const target = writeTargets(parsed).find(word => !DEVICE_SINK_RE.test(word.value))
    if (target !== undefined) return target.value
  }
  return undefined
}

/**
 * Does this command commit, push, merge, rebase, tag or open a pull request?
 * `npm version` counts: it commits and tags unless told not to.
 *
 * @param command - the raw `bash` command.
 * @returns true when one of its commands is a commit-class act.
 */
export function isCommitAct(command) {
  if (typeof command !== 'string' || command.length === 0) return false
  return parseShell(command).some(parsed => {
    const { words } = unwrap(parsed.words, undefined)
    const name = words[0] === undefined ? undefined : baseName(words[0])
    if (name === 'lazygit') return true
    if (name === 'gh') return words[1]?.value === 'pr' && ['create', 'merge'].includes(words[2]?.value)
    if (JS_PKG.has(name) && words[1]?.value === 'version') {
      return pkgWrites(name, words) && !words.some(word => word.value === '--no-git-tag-version')
    }
    if (name !== 'git') return false
    const { sub, rest } = gitCall(words, undefined)
    return ['commit', 'push', 'merge', 'rebase', 'cherry-pick'].includes(sub) || (sub === 'tag' && gitSubWrites(sub, rest))
  })
}
