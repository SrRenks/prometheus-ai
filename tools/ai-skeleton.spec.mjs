/**
 * ai-skeleton: definitions with line numbers, without bodies, per language.
 *
 * The view is the middle step of the localization funnel (files, then symbols,
 * then lines) that Agentless measured as more accurate and cheaper than full
 * files. A missed definition hides code from the agent and a false one wastes a
 * read, so each language is tested both ways.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { skeletonOf } from './ai-skeleton.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const lines = (text, ext) => skeletonOf(text, ext).map(d => d.line)

test('python: classes, methods and functions, nothing from the bodies', () => {
  const src = 'import os\n\nclass Cart:\n    def total(self, items):\n        return sum(items)\n\nasync def fetch(url):\n    if url:\n        pass\n'
  assert.deepEqual(lines(src, 'py'), [3, 4, 7])
  assert.equal(skeletonOf(src, 'py')[1].text, '    def total(self, items):')
})

test('typescript: functions, classes, methods, arrows and types, not control flow', () => {
  const src = [
    'export async function load(id: string): Promise<User> {',
    '  if (id) {',
    '  for (const x of y) {',
    '}',
    'export class Store {',
    '  private async save(user: User): Promise<void> {',
    '  constructor(private db: Db) {',
    '}',
    'export const pick = (a: number) => a',
    'export interface User { id: string }',
    'type Id = string',
    'const handler = async (event) => {',
  ].join('\n')
  assert.deepEqual(lines(src, 'ts'), [1, 5, 6, 7, 9, 10, 11, 12])
})

test('go, php, sql and xBase prg', () => {
  assert.deepEqual(lines('package x\nfunc (s *S) Run() error {\n\treturn nil\n}\ntype S struct {\n', 'go'), [2, 5])
  assert.deepEqual(lines('<?php\nclass Bank {\n  public static function pay($x) {\n    if ($x) {}\n', 'php'), [2, 3])
  assert.deepEqual(lines('SELECT 1;\nCREATE OR REPLACE FUNCTION fx() RETURNS int AS $$\ncreate table t (id int);\n', 'sql'), [2, 3])
  assert.deepEqual(lines('STATIC FUNCTION Calc( nVal )\n   LOCAL x := 1\nPROCEDURE Main()\nCLASS TCliente\n   METHOD New()\n', 'PRG'), [1, 3, 4, 5])
})

test('an unknown language has no skeleton, so the caller can tell it apart from an empty one', () => {
  assert.equal(skeletonOf('a: 1\n', 'yml'), undefined)
  assert.deepEqual(skeletonOf('x = 1\n', 'py'), [])
})

test('the command prints path, line numbers and definitions, and reads a directory through git', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-skeleton-spec-'))
  try {
    writeFileSync(join(dir, 'cart.py'), 'def total(items):\n    return 0\n')
    writeFileSync(join(dir, 'notes.txt'), 'def not_code\n')
    spawnSync('git', ['init', '-q'], { cwd: dir })
    spawnSync('git', ['add', '.'], { cwd: dir })
    const r = spawnSync('bash', [join(ROOT, 'ai-skeleton'), '.'], { cwd: dir, encoding: 'utf8', env: { ...process.env, AGENT_CONFIG_DIR: ROOT } })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, 'cart.py\n  L1: def total(items):\n')
    assert.equal(spawnSync('bash', [join(ROOT, 'ai-skeleton')], { encoding: 'utf8' }).status, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Fresh-context review, round one: the definitions it found missing, and the false ones.
test('react and wrapped typescript definitions', () => {
  const src = [
    'export const useAnalytics = (',                                   // 1 wrapped arrow
    'const FaceLivenessDefault: React.FC<Props> = ({',                 // 2 wrapped component
    'const Modal = React.forwardRef(function Modal(props, ref) {',    // 3
    'const Row = memo(() => <div />)',                                 // 4
    '  const onSave = useCallback(async () => {',                      // 5
    'const pick = <T,>(x: T) => x',                                    // 6 generic arrow
    'class Repo {',                                                    // 7
    '  constructor(',                                                  // 8 wrapped constructor
    '  private async save(',                                           // 9 wrapped method
    '  static create<T>(x: T): Repo<T> {',                             // 10 generic method
    '  async *rows() {',                                               // 11 generator method
    '}',
    'export const enum Mode { A }',                                    // 13
    'declare module "x" {',                                            // 14
    'declare function f(): void;',                                     // 15
    '} else if (x) {',
    'useEffect(() => {',
    'const total = items.length',
  ].join('\n')
  assert.deepEqual(lines(src, 'tsx'), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15])
})

test('go named types, php modifiers in any order, sql alter and definer, not #temp tables', () => {
  assert.deepEqual(lines('type Id string\ntype (\n\tA struct {\n)\n', 'go'), [1, 2, 3])
  assert.deepEqual(lines('abstract public function f();\nfinal public function g() {\nreadonly class X {\n', 'php'), [1, 2, 3])
  const sql = 'ALTER PROCEDURE dbo.p AS\nCREATE DEFINER=`root`@`%` PROCEDURE q()\nCREATE TABLE #tmp (id int)\nCREATE TEMPORARY TABLE t2 (id int)\nCREATE MATERIALIZED VIEW mv AS\n'
  assert.deepEqual(lines(sql, 'sql'), [1, 2, 4, 5])
})

test('java and c# patterns stay fast on long whitespace lines', () => {
  const start = Date.now()
  skeletonOf(`${' '.repeat(20000)}x\n`, 'java')
  skeletonOf(`${' '.repeat(20000)}x\n`, 'cs')
  assert.ok(Date.now() - start < 200, `took ${Date.now() - start}ms`)
})

test('the command reads new files, folders outside git, latin-1 sources, and skips binaries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-skeleton-files-'))
  try {
    const run = (cwd, ...args) => spawnSync('bash', [join(ROOT, 'ai-skeleton'), ...args], { cwd, encoding: 'utf8', env: { ...process.env, AGENT_CONFIG_DIR: ROOT } })
    writeFileSync(join(dir, 'plain.py'), 'def outside():\n    pass\n')
    assert.match(run(dir, '.').stdout, /L1: def outside\(\):/, 'a folder outside git is walked')
    spawnSync('git', ['init', '-q'], { cwd: dir })
    writeFileSync(join(dir, 'new.py'), 'def fresh():\n    pass\n')
    writeFileSync(join(dir, 'acao.prg'), Buffer.from('FUNCTION Ação()\n', 'latin1'))
    writeFileSync(join(dir, 'video.ts'), Buffer.from([0x47, 0, 0, 0x10, 0x66, 0x75, 0x6e]))
    const r = run(dir, '.')
    assert.match(r.stdout, /L1: def fresh\(\):/, 'an untracked new file is read')
    assert.match(r.stdout, /L1: FUNCTION Ação\(\)/, 'latin-1 decodes')
    assert.doesNotMatch(r.stdout, /video\.ts/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
