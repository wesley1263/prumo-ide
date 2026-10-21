// node --test: somar coberturas.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeCoverage } from './coverageMerge.ts'

const bl = (startLine: number, stmts: number, covered: boolean) => ({ startLine, startCol: 1, endLine: startLine, endCol: 10, stmts, covered })

test('mergeCoverage: o coberto em qualquer uma vale; arquivos de só uma entram', () => {
  const a = { runId: 'a', covered: 2, total: 5, packages: [], files: [{ path: 'x.go', package: 'p', covered: 2, total: 5, blocks: [bl(1, 2, true), bl(3, 3, false)] }] }
  const b = {
    runId: 'b',
    covered: 4,
    total: 9,
    packages: [],
    files: [
      { path: 'x.go', package: 'p', covered: 3, total: 5, blocks: [bl(1, 2, false), bl(3, 3, true)] },
      { path: 'y.go', package: 'q', covered: 1, total: 4, blocks: [bl(1, 1, true), bl(2, 3, false)] },
    ],
  }
  const m = mergeCoverage(a, b)
  assert.equal(m.runId, 'b')
  assert.deepEqual([m.covered, m.total], [6, 9])
  assert.deepEqual(m.files.map((f) => [f.path, f.covered, f.total]), [['x.go', 5, 5], ['y.go', 1, 4]])
  assert.deepEqual(m.packages, [{ importPath: 'p', covered: 5, total: 5 }, { importPath: 'q', covered: 1, total: 4 }])
})
