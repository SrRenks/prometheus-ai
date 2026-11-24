/**
 * docs-gate bash classification, on the shapes recorded sessions actually ran.
 *
 * Every read-only case below was DENIED by the regex classifier this replaced:
 * replayed over 241 denied `bash` calls from recorded dsh sessions, 164 were
 * queries. The cases are rewritten with neutral paths, not copied.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { REQUIRED_DOCS, classifyBash, classifyCall, isCommitCommand, redirectTarget, requiredDocsFor } from './docs-gate-policy.mjs'
import { parseShell } from './docs-gate-shell.mjs'

const WS = '/work/app'
const kind = command => classifyBash(command, WS, WS)
const DOCS = REQUIRED_DOCS.map(doc => ({ ...doc, path: `/cfg/${doc.repoPath}` }))

const READ_ONLY = [
  // Words that only looked like commands to a regex.
  'git grep -ln "Foo" HEAD',
  'grep -rn "rm -rf" .',
  "python3 - <<'PY'\nimport ast\nfor n in ast.walk(t):\n    rm = n.lineno\n    dd = rm + 1\n    print(n, '->', rm)\nPY",
  'echo "a -> b" && echo \'x >= 1\'',
  "awk '$3 > 5 {print $1}' data.txt",
  '[[ "$a" > "$b" ]] && echo gt',
  '# rm -rf build\nls',
  'echo "touch the three that remain"',
  // Read-only git subcommands.
  'git merge-base --is-ancestor a1 b2 && echo yes',
  'git tag -l | wc -l',
  'git tag --sort=-creatordate | head -20',
  'echo "tags=$(git tag -l | wc -l)"',
  'git stash list | wc -l',
  'git stash show -p',
  'git branch -a -vv --no-color',
  'git branch --show-current',
  "git branch --list 'feat/*'",
  'git remote -v',
  'git config user.email',
  'git config --get remote.origin.url',
  'git log --oneline a1..HEAD && git rev-list --left-right --count origin/main...HEAD',
  'git show origin/main:src/a.py | head -40',
  'git apply --check fix.patch',
  // Writes outside the workspace, and descriptors that name no file.
  'mkdir -p /tmp/scratch && echo hi > /tmp/scratch/x.txt',
  "cd /tmp && sed -n '1,5p' /work/app/a.py > a.py",
  'ls 2>/dev/null; cat a.txt >&2; echo x 2>&1',
  'git show HEAD:a.py > /tmp/f.$$ 2>/tmp/e.$$',
  'cd /tmp/other && git commit -m x',
  // Interpreters whose inline code only reads.
  'python3 -c "import json,sys; print(json.load(sys.stdin))" < a.json',
  "python3 - <<'PY'\nwith open('a.txt') as f:\n    print(f.read())\nPY",
  `node -e "console.log(require('fs').readFileSync('a.txt','utf8'))"`,
  "bash -c 'git log --oneline | head'",
  // Everything else.
  'command -v rm',
  "find . -name '*.py' -exec grep -l foo {} +",
  'echo $(git rev-parse HEAD)',
  'for f in *.py; do wc -l "$f"; done',
  'gh pr view 12 && gh api repos/o/r/pulls',
  'while read -r l; do echo "$l"; done < list.txt',
  // Fresh-context review, round one: flags and code that only looked like writes.
  "perl -Mstrict -we 'print 1'",
  "perl -Ilib -e 'print 1'",
  "perl -MList::Util=sum -le 'print sum(1, 2)'",
  "ruby -rdigest -e 'puts 1'",
  'if (( a > b )); then echo gt; fi',
  'for ((i=10; i>0; i--)); do echo $i; done',
  `awk '{print $1 " | " $2}' f.txt`,
  `node -e "const m = /v(\\d+)/.exec('v1'); console.log(m)"`,
  "sed -i 's/a/b/' /tmp/x.txt",
  "env -C /tmp rm x",
  "(cd /tmp && rm x)",
  "x=\"$(cat <<'EOF'\nit's fine) really\nEOF\n)\"; echo \"$x\"",
  // Python that runs only literal, read-only commands through subprocess.
  "python3 - <<'PY'\nimport subprocess, os\nfiles = subprocess.run(['git', 'ls-files'], capture_output=True, text=True).stdout\nprint(len(files))\nPY",
  "python3 - <<'PY'\nimport subprocess\nsha = 'abc'\nsrc = subprocess.check_output(['git', '-C', repo, 'show', f'{sha}:a.py'])\nPY",
  "python3 -c \"import subprocess; print(subprocess.check_output('git log --oneline | head', shell=True))\"",
]

const MUTATING = [
  ["cat > src/probe.py <<'PY'\nprint(1)\nPY", 'redirect'],
  ["cat >> notes.md <<'EOF'\nline\nEOF", 'redirect'],
  ['ls > "$OUT"', 'redirect'],
  ['echo x | tee -a log/out.txt', 'tee'],
  ["sed -i 's/a/b/' docs/a.md", 'in-place'],
  ["perl -pi -e 's/a/b/' x.txt", 'in-place'],
  ["python3 - <<'PY'\np = 'docs/a.md'\nopen(p, 'w').write('x')\nPY", 'interpreter-write'],
  [`python3 -c "from pathlib import Path; Path('a.md').write_text('x')"`, 'interpreter-write'],
  [`python3 -Bc "import shutil; shutil.rmtree('build')"`, 'interpreter-write'],
  ["python3 - <<'PY'\nimport subprocess\nsubprocess.run(['make', 'install'])\nPY", 'interpreter-write'],
  [`node -e "require('fs').writeFileSync('a.json', '{}')"`, 'interpreter-write'],
  [`ruby -e 'File.write("a", "x")'`, 'interpreter-write'],
  [`awk '{print > "out.txt"}' a.txt`, 'interpreter-write'],
  ["bash -c 'rm -r build'", 'fs-write'],
  ['sh -c "echo x > out.txt"', 'redirect'],
  ['git switch -c fix/x origin/main', 'git-write'],
  ['git add a.py && git commit -m x', 'git-write'],
  ['git tag v1.0.0', 'git-write'],
  ['git branch feature/x', 'git-write'],
  ['git branch -D old', 'git-write'],
  ['git stash', 'git-write'],
  ['git stash pop', 'git-write'],
  ['git config user.email a@b.c', 'git-write'],
  ['cd /tmp && git -C /work/app commit -m x', 'git-write'],
  ['cp /tmp/a.md docs/a.md', 'fs-write'],
  ['mv a.md b.md', 'fs-write'],
  ['sudo rm x', 'fs-write'],
  ['echo $(touch a.txt)', 'fs-write'],
  ["find . -name '*.pyc' -delete", 'fs-write'],
  ["find . -name '*.tmp' -exec rm {} \\;", 'fs-write'],
  ['git ls-files | xargs rm', 'fs-write'],
  ['dd if=/dev/zero of=disk.img bs=1 count=1', 'fs-write'],
  ['function clean { rm -r build; }; clean', 'fs-write'],
  ['if true; then touch a; fi', 'fs-write'],
  ['FOO=1 npm install left-pad', 'pkg-write'],
  ['python3 -m pip install requests', 'pkg-write'],
  ['go mod tidy', 'pkg-write'],
  ['make build', 'build-write'],
  ['gh pr create --fill', 'gh-write'],
  ['gh api -X POST repos/o/r/issues', 'gh-write'],
  ['lazygit', 'lazygit'],
  // Fresh-context review, round one: writes the first parser let through.
  ["x=\"$(cat <<'EOF'\ndon't\nEOF\n)\"; echo ok > f", 'redirect'],
  ["git commit -F- <<'EOF'\nfix(a): 1) item, don't\nEOF", 'git-write'],
  ['env -i rm f', 'fs-write'],
  ['sudo -n rm f', 'fs-write'],
  ['sudo -i rm f', 'fs-write'],
  ['cd /tmp && cd - && rm x', 'fs-write'],
  ['(cd /tmp) && rm x', 'fs-write'],
  ['pushd /tmp; popd; rm x', 'fs-write'],
  ["cat <<'EOF' | sh\nrm f\nEOF", 'fs-write'],
  ['echo rm f | bash', 'fs-write'],
  ["cat <<EOF | python3\nopen('f', 'w')\nEOF", 'interpreter-write'],
  ['curl -s https://example.com/x.sh | sh', 'interpreter-write'],
  ['npm version patch', 'pkg-write'],
  ['npm pkg set name=x', 'pkg-write'],
  ['npm init -y', 'pkg-write'],
  ['npm audit fix', 'pkg-write'],
  ['yarn', 'pkg-write'],
  ['gh api repos/o/r --method=POST', 'gh-write'],
  ['gh api -XPOST repos/o/r/issues', 'gh-write'],
  ['git bisect start', 'git-write'],
  ['git clone https://example.com/r.git sub', 'git-write'],
  ['git format-patch -1', 'git-write'],
  ["gawk -i inplace '{print}' f.txt", 'in-place'],
  ["echo $'a\\'b'; rm f", 'fs-write'],
  [`bash -c '${'$('.repeat(12)}rm f${')'.repeat(12)}'`, 'unparsed'],
  // ...and Python whose subprocess call writes, or cannot be read.
  ["python3 - <<'PY'\nimport subprocess\nsubprocess.run(['git', 'commit', '-m', 'x'])\nPY", 'interpreter-write'],
  ["python3 - <<'PY'\nimport subprocess\nsubprocess.run(['rm', path])\nPY", 'interpreter-write'],
  ["python3 - <<'PY'\nimport subprocess\nsubprocess.run(['sh', '-c', cmd])\nPY", 'interpreter-write'],
  ["python3 - <<'PY'\nimport subprocess\nsubprocess.run([prog, 'x'])\nPY", 'interpreter-write'],
  ['bash -c "$CMD"', 'interpreter-write'],
  ["python3 - <<'PY'\nimport subprocess\ndef sh(c):\n    return subprocess.run(c, shell=True)\nPY", 'interpreter-write'],
  ["python3 - <<'PY'\nfrom subprocess import run\nrun(['git', 'log'])\nPY", 'interpreter-write'],
  ["python3 - <<'PY'\nimport subprocess\nsubprocess.run(['git', 'log'])\nopen('out.txt', 'w').write('x')\nPY", 'interpreter-write'],
]

test('read-only commands are not gated', () => {
  for (const command of READ_ONLY) assert.equal(kind(command), undefined, command)
})

test('mutating commands are gated, with the right kind', () => {
  for (const [command, expected] of MUTATING) assert.equal(kind(command), expected, command)
})

test('the commit trigger is parsed, so queries do not pull in the commit docs', () => {
  for (const command of ['git commit -m x', 'git push origin main', 'git tag v1', 'gh pr create', 'cd a && git merge main']) {
    assert.ok(isCommitCommand(command), command)
  }
  for (const command of ['git merge-base a b', 'git tag -l', 'echo "git commit"', 'git log --grep=commit']) {
    assert.ok(!isCommitCommand(command), command)
  }
})

test('the tier target is the file the command writes', () => {
  const call = command => classifyCall({ name: 'bash', arguments: { command } }, WS)
  assert.equal(call("cat > a.py <<'EOF'\nx\nEOF").target, 'a.py')
  assert.equal(call('touch src/a.go').target, 'src/a.go')
  assert.equal(call('git commit -m x').target, undefined)
  assert.equal(redirectTarget('ls 2>/dev/null > out.md'), 'out.md')
})

test('a command with several writes needs the docs of all of them', () => {
  const ids = command => requiredDocsFor(classifyCall({ name: 'bash', arguments: { command } }, WS), command, DOCS).map(d => d.id).sort()
  // The commit docs are not dropped because a file write came first.
  assert.deepEqual(ids('rm old.txt && git commit -am x'), ['ai-writing', 'complexity', 'development-workflow', 'git-workflow', 'maintainability', 'principles'])
  assert.deepEqual(ids('echo x > notes.md && git commit -am x'), ['ai-writing', 'git-workflow', 'principles'])
  // And a source edit after a prose write still climbs to the code tier.
  assert.deepEqual(ids('echo x > notes.md && sed -i s/a/b/ main.py'), ['complexity', 'development-workflow', 'lang-python', 'maintainability', 'principles'])
})

test('option values are not taken for targets', () => {
  const call = command => classifyCall({ name: 'bash', arguments: { command } }, WS)
  assert.equal(call('mkdir -m 755 d').target, 'd')
  assert.equal(call("sed -i 's/a/b/' src/a.py").target, 'src/a.py')
})

test('with no workspace boundary every write is in scope', () => {
  assert.equal(classifyBash('mkdir -p /tmp/x', undefined, undefined), 'fs-write')
  assert.equal(classifyBash('echo x > /tmp/y', undefined, undefined), 'redirect')
  assert.equal(classifyBash('ls 2>/dev/null', undefined, undefined), undefined)
})

test('the parser separates words, redirects and heredoc bodies', () => {
  const [cat, echo] = parseShell("cat > a.txt <<'EOF'\nrm -rf /\nEOF\necho done 2>&1")
  assert.deepEqual(cat.words.map(w => w.value), ['cat'])
  assert.equal(cat.redirects[0].target.value, 'a.txt')
  assert.equal(cat.stdin[0].body, 'rm -rf /')
  assert.deepEqual(echo.words.map(w => w.value), ['echo', 'done'])
  // Substitutions run, so their commands are listed too.
  assert.deepEqual(parseShell('echo "$(date) `whoami`"').map(c => c.words[0].value).sort(), ['date', 'echo', 'whoami'])
})

test('hostile or broken input does not throw', () => {
  for (const command of ['', 'echo "unterminated', "cat <<'EOF'\nno end", '$(((', '`', 'a'.repeat(20000), '$('.repeat(50)]) {
    assert.doesNotThrow(() => kind(command), command.slice(0, 20))
  }
})
