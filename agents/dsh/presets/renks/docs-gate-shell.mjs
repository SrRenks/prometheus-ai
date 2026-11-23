/**
 * A small shell reader for docs-gate: enough POSIX sh and bash syntax to tell a
 * command word from text inside a string, a heredoc body or a comment.
 *
 * WHY. The gate used to match regexes against the raw command text. Replayed
 * over 241 denied `bash` calls from recorded dsh sessions, most denials came
 * from text that was never a command: `ln` inside `git grep -ln`, `rm` and `dd`
 * as Python identifiers in a heredoc, `->` and `>=` in quoted strings read as
 * redirects, and `git merge-base` read as `git merge`. Auto-approvers that
 * parse instead of matching (Dippy, safe-chains, Codex's tree-sitter split) do
 * not make that class of mistake, so this module parses.
 *
 * WHAT IT RETURNS. A flat list of simple commands, each with its words, its
 * redirections and the text fed to it on stdin by a heredoc or here-string.
 * Command and process substitutions are parsed too and their commands added to
 * the list, because they run. It is not a full shell grammar: compound
 * commands are flattened, and a construct it does not know reads as words,
 * which the classifier treats as an unknown, read-only command.
 *
 * Pure text handling, no dependencies, so the dsh bundle and the Claude Code
 * hook load it unchanged.
 */

/** Deepest nesting of substitutions and `bash -c` strings that is followed. */
export const MAX_DEPTH = 8

/** Reserved words that open or close a compound command and are not commands. */
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', 'esac', '{', '}', '!', 'time', 'in'])

/** Reserved words whose header up to the next separator is not a command. */
const HEADER_KEYWORDS = new Set(['for', 'select', 'case'])

/** Control operators, longest first so `&&` wins over `&`. */
const CONTROL_OPS = [';;&', ';;', ';&', '&&', '||', '|&', ';', '&', '|', '(', ')', '\n']

/** Redirection operators, longest first. */
const REDIRECT_OPS = ['&>>', '<<<', '<<-', '&>', '>>', '>|', '>&', '<&', '<>', '<<', '>', '<']

/** Characters that end an unquoted word. */
const WORD_END = new Set([' ', '\t', '\n', ';', '&', '|', '<', '>', '(', ')'])

/**
 * Read the body of a balanced `( ... )` starting just after the opening paren,
 * skipping parens inside quotes.
 *
 * @param src - the source text.
 * @param start - index just after the opening paren.
 * @param heredocs - false inside arithmetic, where `<<` is a shift.
 * @returns `{ text, end }`, where `end` is the index after the closing paren.
 */
function readBalanced(src, start, heredocs = true) {
  let depth = 1
  let i = start
  // Heredoc bodies and comments are text: an apostrophe in a commit message
  // body must not open a quote that swallows the rest of the command.
  const delimiters = []
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\') i += 2
    else if (ch === "'") i = skipSingle(src, i + 1)
    else if (ch === '"') i = skipDouble(src, i + 1)
    else if (ch === '#' && atWordStart(src, i)) i = skipComment(src, i)
    else if (heredocs && ch === '<' && src.startsWith('<<', i) && src[i + 2] !== '<') i = noteHeredoc(src, i, delimiters)
    else if (ch === '\n' && delimiters.length > 0) i = skipHeredocBodies(src, i + 1, delimiters)
    else {
      if (ch === '(') depth++
      if (ch === ')' && --depth === 0) return { text: src.slice(start, i), end: i + 1 }
      i++
    }
  }
  return { text: src.slice(start), end: src.length }
}

/** Record the delimiter of a heredoc met inside a substitution. */
function noteHeredoc(src, i, delimiters) {
  const dash = src[i + 2] === '-'
  const match = /^[ \t]*(?:'([^']*)'|"([^"]*)"|\\?([^\s;&|<>()]+))/.exec(src.slice(i + (dash ? 3 : 2)))
  if (match === null) return i + 2
  delimiters.push({ word: match[1] ?? match[2] ?? match[3], dash })
  return i + (dash ? 3 : 2) + match[0].length
}

/** Skip the heredoc bodies that start after a newline inside a substitution. */
function skipHeredocBodies(src, start, delimiters) {
  let i = start
  for (const { word, dash } of delimiters) {
    while (i < src.length) {
      const nl = src.indexOf('\n', i)
      const line = src.slice(i, nl < 0 ? src.length : nl)
      i = nl < 0 ? src.length : nl + 1
      if ((dash ? line.replace(/^\t+/, '') : line) === word) break
    }
  }
  delimiters.length = 0
  return i
}

/** Index after the closing single quote. */
function skipSingle(src, start) {
  const close = src.indexOf("'", start)
  return close < 0 ? src.length : close + 1
}

/** Index after the closing double quote, honouring backslash escapes. */
function skipDouble(src, start) {
  let i = start
  while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1
  return Math.min(i + 1, src.length)
}

/** Index after the closing backtick, honouring backslash escapes. */
function skipBacktick(src, start) {
  let i = start
  while (i < src.length && src[i] !== '`') i += src[i] === '\\' ? 2 : 1
  return i
}

/**
 * Read one `$...` expansion. Command substitutions are recorded in `subs`.
 *
 * @returns `{ text, end }`: the placeholder text and the index after it.
 */
function readDollar(src, i, subs) {
  // ANSI-C quoting: `$'a\'b'` is one string, and `\'` does not close it.
  if (src[i + 1] === "'") {
    let j = i + 2
    while (j < src.length && src[j] !== "'") j += src[j] === '\\' ? 2 : 1
    return { text: src.slice(i + 2, j), end: Math.min(j + 1, src.length) }
  }
  if (src.startsWith('$((', i)) {
    const { end } = readBalanced(src, i + 2, false)
    return { text: '$((…))', end: src[end] === ')' ? end + 1 : end }
  }
  if (src[i + 1] === '(') {
    const { text, end } = readBalanced(src, i + 2)
    subs.push(text)
    return { text: '$(…)', end }
  }
  if (src[i + 1] === '{') {
    const close = src.indexOf('}', i + 2)
    const end = close < 0 ? src.length : close + 1
    return { text: src.slice(i, end), end }
  }
  return { text: '$', end: i + 1 }
}

/**
 * Read the inside of a double-quoted string, collecting substitutions.
 *
 * @returns `{ text, end }`: the unquoted text and the index after the quote.
 */
function readDoubleQuoted(src, start, subs) {
  let text = ''
  let i = start
  while (i < src.length && src[i] !== '"') {
    const ch = src[i]
    if (ch === '\\' && i + 1 < src.length) {
      text += src[i + 1]
      i += 2
    } else if (ch === '$') {
      const part = readDollar(src, i, subs)
      text += part.text
      i = part.end
    } else if (ch === '`') {
      const close = skipBacktick(src, i + 1)
      subs.push(src.slice(i + 1, close))
      text += '$(…)'
      i = close + 1
    } else {
      text += ch
      i++
    }
  }
  return { text, end: Math.min(i + 1, src.length) }
}

/**
 * Read one word starting at `start`.
 *
 * `dynamic` is true when the word holds an expansion, so its value is not the
 * literal text the shell will use: a path check must treat it as unknown.
 *
 * @returns `{ word: { value, dynamic }, end }`.
 */
function readWord(src, start, subs) {
  let value = ''
  let i = start
  while (i < src.length && !WORD_END.has(src[i])) {
    const part = readWordPart(src, i, subs)
    value += part.text
    i = part.end
  }
  return { word: { value, dynamic: value.includes('$') }, end: i }
}

/** One quoted run, escape, expansion or literal character of a word. */
function readWordPart(src, i, subs) {
  const ch = src[i]
  if (ch === '\\') return { text: src[i + 1] === '\n' ? '' : (src[i + 1] ?? ''), end: i + 2 }
  if (ch === "'") {
    const end = skipSingle(src, i + 1)
    return { text: src.slice(i + 1, end - 1), end }
  }
  if (ch === '"') return readDoubleQuoted(src, i + 1, subs)
  if (ch === '$') return readDollar(src, i, subs)
  if (ch === '`') {
    const close = skipBacktick(src, i + 1)
    subs.push(src.slice(i + 1, close))
    return { text: '$(…)', end: close + 1 }
  }
  return { text: ch, end: i + 1 }
}

/**
 * Read the heredoc bodies queued on the line that just ended.
 *
 * @param src - the source text.
 * @param start - index of the first character after the newline.
 * @param pending - heredoc tokens waiting for a body, in order.
 * @returns the index after the last body's delimiter line.
 */
function readHeredocBodies(src, start, pending) {
  let i = start
  for (const token of pending) {
    const lines = []
    while (i < src.length) {
      const nl = src.indexOf('\n', i)
      const line = src.slice(i, nl < 0 ? src.length : nl)
      i = nl < 0 ? src.length : nl + 1
      const compare = token.op === '<<-' ? line.replace(/^\t+/, '') : line
      if (compare === token.delimiter) break
      lines.push(line)
    }
    token.body = lines.join('\n')
  }
  pending.length = 0
  return i
}

/** The operator in `list` that starts at `i`, if any. */
function operatorAt(src, i, list) {
  return list.find(op => src.startsWith(op, i))
}

/**
 * Split shell text into tokens: words, control operators and redirections.
 *
 * @param src - the shell text.
 * @param subs - collects the bodies of command and process substitutions.
 * @returns the token list.
 */
function tokenize(src, subs) {
  const tokens = []
  const pending = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === ' ' || ch === '\t') i++
    else if (ch === '\\' && src[i + 1] === '\n') i += 2
    else if (ch === '#' && atWordStart(src, i)) i = skipComment(src, i)
    else if (ch === '\n') {
      tokens.push({ type: 'op', value: '\n' })
      i = readHeredocBodies(src, i + 1, pending)
    } else i = readToken(src, i, tokens, pending, subs)
  }
  return tokens
}

/** A `#` begins a comment only where a word could begin. */
function atWordStart(src, i) {
  return i === 0 || WORD_END.has(src[i - 1])
}

/** Index of the newline ending this comment (kept, it separates commands). */
function skipComment(src, i) {
  const nl = src.indexOf('\n', i)
  return nl < 0 ? src.length : nl
}

/** Read one operator, redirection, process substitution or word. */
function readToken(src, i, tokens, pending, subs) {
  if ((src[i] === '<' || src[i] === '>') && src[i + 1] === '(') {
    const { text, end } = readBalanced(src, i + 2)
    subs.push(text)
    tokens.push({ type: 'word', word: { value: '$(…)', dynamic: true } })
    return end
  }
  if (src.startsWith('((', i) && atCommandStart(tokens)) {
    const { end } = readBalanced(src, i + 2, false)
    tokens.push({ type: 'word', word: { value: '((…))', dynamic: true } })
    return src[end] === ')' ? end + 1 : end
  }
  const redirect = operatorAt(src, i, REDIRECT_OPS)
  if (redirect !== undefined) return readRedirect(src, i, redirect, tokens, pending, subs)
  const control = operatorAt(src, i, CONTROL_OPS)
  if (control !== undefined) {
    tokens.push({ type: 'op', value: control })
    return i + control.length
  }
  const { word, end } = readWord(src, i, subs)
  // `2>file`: a word of digits glued to a redirection is its file descriptor.
  if (/^\d+$/.test(word.value) && (src[end] === '<' || src[end] === '>')) {
    const op = operatorAt(src, end, REDIRECT_OPS)
    return readRedirect(src, end, op, tokens, pending, subs, word.value)
  }
  tokens.push({ type: 'word', word })
  return end
}

/**
 * Is the next token the first of a command? After a reserved word it is too:
 * `if (( a > b ))` and `for ((i=0; i<3; i++))` are arithmetic, not redirects.
 */
function atCommandStart(tokens) {
  const last = tokens[tokens.length - 1]
  if (last === undefined || last.type === 'op') return true
  return last.type === 'word' && (KEYWORDS.has(last.word.value) || HEADER_KEYWORDS.has(last.word.value))
}

/** Read a redirection and the word it names. Heredocs wait for their body. */
function readRedirect(src, i, op, tokens, pending, subs, fd = undefined) {
  let j = i + op.length
  while (src[j] === ' ' || src[j] === '\t') j++
  const { word, end } = readWord(src, j, subs)
  const token = { type: 'redirect', op, fd, target: word }
  if (op === '<<' || op === '<<-') {
    token.delimiter = word.value
    pending.push(token)
  }
  tokens.push(token)
  return end
}

/**
 * Parse shell text into simple commands.
 *
 * @param src - the shell text.
 * @param depth - substitution nesting, bounded by {@link MAX_DEPTH}.
 * @returns `[{ words, redirects, stdin }]`; `words` are `{ value, dynamic }`.
 */
export function parseShell(src, depth = 0) {
  if (typeof src !== 'string' || src.length === 0) return []
  // Past the bound the text is not read, and unread text is not proof of
  // anything: the sentinel makes the classifier gate it.
  if (depth > MAX_DEPTH) return [{ ...emptyCommand(), tooDeep: true }]
  const subs = []
  const commands = group(tokenize(src, subs))
  // A substitution runs in a subshell of its own, so a `cd` inside stays there.
  for (const sub of subs) commands.push(...parseShell(sub, depth + 1).map(c => ({ ...c, depth: c.depth + 1 })))
  return commands
}

/** Fold tokens into simple commands at each control operator. */
function group(tokens) {
  const commands = []
  let current = emptyCommand()
  let header = false
  let depth = 0
  // `function name { ... }`: the keyword and the name are not a command.
  let skip = 0
  const flush = (op) => {
    const kept = !header && (current.words.length > 0 || current.redirects.length > 0)
    if (kept) commands.push(current)
    const previous = kept ? current : undefined
    current = emptyCommand(depth)
    // The command after `|` reads the previous one's output.
    if (op === '|' || op === '|&') current.pipedFrom = previous
    header = false
  }
  for (const token of tokens) {
    if (token.type === 'op') {
      flush(token.value)
      // Subshell depth, so a `cd` inside `( ... )` does not move the commands after it.
      if (token.value === '(') depth++
      if (token.value === ')' && depth > 0) depth--
      current.depth = depth
    } else if (token.type === 'redirect') addRedirect(current, token)
    else if (skip > 0) skip--
    else if (current.words.length > 0) current.words.push(token.word)
    else if (token.word.value === 'function') skip = 1
    else if (HEADER_KEYWORDS.has(token.word.value)) header = true
    else if (!KEYWORDS.has(token.word.value)) current.words.push(token.word)
  }
  flush()
  return commands
}

/** A command with nothing in it yet. */
function emptyCommand(depth = 0) {
  return { words: [], redirects: [], stdin: [], depth, pipedFrom: undefined }
}

/**
 * Attach a redirection to its command. Inside `[[ ... ]]`, `<` and `>` compare
 * strings and are words, not redirections.
 */
function addRedirect(command, token) {
  if (command.words[0]?.value === '[[' && (token.op === '<' || token.op === '>')) {
    command.words.push({ value: token.op, dynamic: false }, token.target)
    return
  }
  if (token.op === '<<' || token.op === '<<-') command.stdin.push(token)
  else if (token.op === '<<<') command.stdin.push({ body: token.target.value })
  else command.redirects.push(token)
}

/**
 * The text a command receives on stdin from heredocs and here-strings.
 *
 * Read lazily, because a heredoc body is filled in only once its line ends.
 *
 * @param command - one parsed command.
 * @returns the bodies joined by newlines.
 */
export function stdinOf(command) {
  return command.stdin.map(entry => entry.body ?? '').join('\n')
}

/** Redirection operators that write a file. */
const WRITE_OPS = new Set(['>', '>>', '>|', '&>', '&>>', '<>'])

/**
 * The file targets a command's redirections write.
 *
 * `>&2` and `2>&1` duplicate a descriptor and name no file; `>&file` does.
 *
 * @param command - one parsed command.
 * @returns the target words, in order.
 */
export function writeTargets(command) {
  const out = []
  for (const redirect of command.redirects) {
    if (redirect.op === '>&') {
      if (!/^(\d+|-)$/.test(redirect.target.value)) out.push(redirect.target)
    } else if (WRITE_OPS.has(redirect.op)) out.push(redirect.target)
  }
  return out
}
