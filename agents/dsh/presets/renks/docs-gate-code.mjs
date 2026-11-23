/**
 * Inline interpreter code, for docs-gate's bash rules: which interpreter a
 * command runs, what code it runs, and whether that code writes.
 *
 * A scan for write and process calls is a tripwire for the common spellings,
 * not a sandbox, and a script FILE (`python tool.py`) is not read at all.
 * Code the gate cannot see, such as a program piped in from `curl`, is counted
 * as a write, because unread is not the same as harmless.
 */
import { stdinOf } from './docs-gate-shell.mjs'

/**
 * Write and process calls, per interpreter. Matching one means the inline code
 * can change files; a process call is counted because what it runs is unknown.
 */
const CODE_WRITES = {
  python: /\bopen\s*\([^)]*?,\s*(?:mode\s*=\s*)?['"][^'"]*[wax+]|\.open\s*\(\s*(?:mode\s*=\s*)?['"][^'"]*[wax+]|\.write_(?:text|bytes)\s*\(|\b(?:os|shutil)\s*\.\s*(?:remove|unlink|rename|renames|replace|makedirs|mkdir|rmdir|removedirs|chmod|chown|symlink|link|truncate|system|popen|copy\w*|move|rmtree|make_archive)\b|\bsubprocess\b|\bpty\b|\.(?:unlink|rmdir|mkdir|touch|symlink_to|hardlink_to|rename|chmod|extractall)\s*\(|(?<![.\w])(?:exec|eval|__import__)\s*\(/,
  node: /(?<![.\w])(?:exec|spawn|eval)\s*\(|\b(?:writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|rename|renameSync|copyFile|copyFileSync|cp|cpSync|symlink|symlinkSync|truncate|truncateSync|chmod|chmodSync|createWriteStream|utimes|utimesSync|execSync|spawnSync|execFile|execFileSync)\s*\(|child_process|Deno\.(?:write|remove|mkdir|rename|create|copyFile|run|Command)|Bun\.write/,
  perl: /\bopen\s*\(?[^;]*?['"]\s*\+?[>|]|\b(?:unlink|rename|mkdir|rmdir|chmod|chown|symlink|link|truncate|utime|system|exec)\b|`|\bqx\b/,
  ruby: /\bFile\s*\.\s*(?:write|delete|unlink|rename|symlink|chmod|truncate|open\s*\([^)]*['"][wa+])|\bFileUtils\b|\bIO\s*\.\s*write|\bDir\s*\.\s*(?:mkdir|rmdir|delete|unlink)|\bsystem\s*\(|`|%x|\bspawn\b|\bexec\b|\bOpen3\b/,
  // Checked with string literals blanked: `print $1 " | " $2` pipes nothing.
  awk: /\bsystem\s*\(|\b(?:print|printf)\b[^;}]*[>|]/,
}

/** The flag that introduces inline code, per family. */
const CODE_FLAGS = {
  python: /^-[A-Za-z]*c$/,
  node: /^(?:-e|-p|--eval|--print|-pe)$/,
  perl: /^-[A-Za-z]*[eE]$/,
  ruby: /^-[A-Za-z]*e$/,
  shell: /^-[A-Za-z]*c[A-Za-z]*$/,
}

/**
 * Switches that take the rest of their word as a value, so an `i` after them
 * is part of a module or directory name: `perl -Ilib`, `ruby -rdigest`.
 */
const VALUE_SWITCHES = { perl: 'MmIeExdDCl0', ruby: 'rIeECxWTFK0' }

/** The interpreter family a command name belongs to, if any. */
export function interpreterOf(name) {
  if (/^(?:python|pypy)(?:\d+(?:\.\d+)?)?$/.test(name)) return 'python'
  if (name === 'node' || name === 'deno' || name === 'bun' || name === 'nodejs') return 'node'
  if (name === 'perl' || name === 'ruby') return name
  if (name === 'awk' || name === 'gawk' || name === 'mawk') return 'awk'
  if (name === 'bash' || name === 'sh' || name === 'zsh' || name === 'dash' || name === 'ksh') return 'shell'
  return undefined
}

/** Positional arguments: the words that are not options. `--` ends options. */
export function positionals(words, valueOptions = undefined) {
  const out = []
  let options = true
  for (let i = 0; i < words.length; i++) {
    const value = words[i].value
    if (options && value === '--') options = false
    else if (options && value.startsWith('-') && value !== '-') {
      if (valueOptions?.has(value)) i++
    } else out.push(words[i])
  }
  return out
}

/** Does this perl, ruby or gawk call edit its files in place? */
export function editsInPlace(name, args) {
  if (interpreterOf(name) === 'awk') {
    return args.some((word, i) => (word.value === '-i' && args[i + 1]?.value === 'inplace') || word.value === '--include=inplace')
  }
  const values = VALUE_SWITCHES[name]
  if (values === undefined) return false
  return args.some(word => {
    if (!word.value.startsWith('-') || word.value.startsWith('--')) return false
    for (const ch of word.value.slice(1)) {
      if (ch === 'i') return true
      if (values.includes(ch)) return false
    }
    return false
  })
}

/** The program a piped-in interpreter reads, when the gate can see it. */
function pipedProgram(command) {
  const source = command.pipedFrom
  if (source === undefined) return undefined
  const name = source.words[0]?.value
  if (name === 'echo' || name === 'printf') return source.words.slice(1).map(word => word.value).join(' ')
  if (name === 'cat' && source.stdin.length > 0 && source.words.length === 1) return stdinOf(source)
  return null
}

/**
 * The inline code an interpreter call runs.
 *
 * @returns the code; undefined for a script file or no code at all; null for
 *   a program piped in from somewhere the gate cannot read.
 */
export function inlineCode(family, args, command) {
  if (family === 'awk') return positionals(args.filter(w => !/^-[fv]$/.test(w.value)))[0]?.value
  const flag = args.findIndex(word => CODE_FLAGS[family].test(word.value))
  // `bash -c "$CMD"`: code that is only a variable cannot be read.
  if (flag >= 0) return /^\$\S*$/.test(args[flag + 1]?.value ?? '') ? null : (args[flag + 1]?.value ?? '')
  const operands = positionals(args, new Set(['-m', '-W', '-X', '-r', '-I']))
  if (family === 'python' && args.some(word => word.value === '-m')) return undefined
  if (operands.length > 0 && operands[0].value !== '-') return undefined
  const heredoc = stdinOf(command)
  if (heredoc.length > 0) return heredoc
  return pipedProgram(command)
}

/**
 * A `subprocess` call whose command is a literal, so the gate can read it:
 * `subprocess.run(['git', 'ls-files'], ...)` or `check_output("git log", ...)`.
 */
const SUBPROCESS_CALL_RE = /\bsubprocess\s*\.\s*(?:run|check_output|check_call|call|Popen|getoutput|getstatusoutput)\s*\(\s*(\[[^\]]*\]|[rRbBuU]*'[^'\n]*'|[rRbBuU]*"[^"\n]*")/g

/** One Python literal, or `$X` (an unknown word) for anything else. */
function pythonWord(element) {
  const text = element.trim()
  const literal = /^([rRbBuUfF]*)(['"])((?:\\.|(?!\2).)*)\2$/s.exec(text)
  if (literal === null) return '$X'
  if (/[fF]/.test(literal[1]) && literal[3].includes('{')) return '$X'
  const value = literal[3].replace(/\\(['"\\])/g, '$1')
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}

/** Split the inside of a Python list on its top-level commas. */
function splitList(inner) {
  const parts = []
  let quote
  let start = 0
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (quote !== undefined) {
      if (ch === '\\') i++
      else if (ch === quote) quote = undefined
    } else if (ch === "'" || ch === '"') quote = ch
    else if (ch === ',') {
      parts.push(inner.slice(start, i))
      start = i + 1
    }
  }
  parts.push(inner.slice(start))
  return parts.filter(part => part.trim().length > 0)
}

/** The shell command a literal `subprocess` argument runs. */
function subprocessCommand(arg) {
  if (!arg.startsWith('[')) return pythonWord(arg).replace(/^'|'$/g, '')
  return splitList(arg.slice(1, -1)).map(pythonWord).join(' ')
}

/**
 * Remove the `subprocess` calls whose literal command the gate reads as a
 * query, and `subprocess` from the imports. What is left still says
 * `subprocess` when any call could not be read, and is then counted.
 *
 * Replayed over recorded sessions, most inline Python the gate denied used
 * `subprocess` only to run `git ls-files`, `git show` or `git log`.
 */
function withoutReadOnlySubprocess(code, commandWrites) {
  return code
    .replace(SUBPROCESS_CALL_RE, (call, arg) => {
      const command = subprocessCommand(arg)
      // A program named by a variable could be anything.
      return command.startsWith('$') || commandWrites(command) ? call : 'None'
    })
    .replace(/(^|;)([ \t]*import[ \t]+)([\w \t,]+?)(?=[ \t]*(?:;|$))/gm, (line, lead, head, names) => {
      const kept = names.split(',').map(name => name.trim()).filter(name => name !== 'subprocess')
      return kept.length === 0 ? lead : `${lead}${head}${kept.join(', ')}`
    })
}

/**
 * Does this code, in this family, write or start a process?
 *
 * @param family - the interpreter family.
 * @param code - the inline code.
 * @param commandWrites - classifies a shell command a Python `subprocess`
 *   call runs; without it every `subprocess` use counts.
 * @returns true when the code can change files.
 */
export function codeWrites(family, code, commandWrites = undefined) {
  let text = code
  if (family === 'awk') text = code.replace(/"(?:[^"\\]|\\.)*"/g, '""')
  if (family === 'python' && commandWrites !== undefined) text = withoutReadOnlySubprocess(code, commandWrites)
  return CODE_WRITES[family].test(text)
}
