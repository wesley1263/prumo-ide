// Somar coberturas de várias execuções: um bloco conta como coberto se alguma execução passou por ele.
// Puro (teste unitário em node).
import type { Coverage, CoverBlock, FileCoverage } from '../lib/api'

const blockKey = (b: CoverBlock) => `${b.startLine}:${b.startCol}-${b.endLine}:${b.endCol}`

export function mergeCoverage(a: Coverage, b: Coverage): Coverage {
  const files = new Map<string, { pkg: string; blocks: Map<string, CoverBlock> }>()
  for (const cov of [a, b]) {
    for (const f of cov.files) {
      const cur = files.get(f.path) ?? { pkg: f.package, blocks: new Map<string, CoverBlock>() }
      for (const bl of f.blocks) {
        const k = blockKey(bl)
        const prev = cur.blocks.get(k)
        cur.blocks.set(k, prev ? { ...prev, covered: prev.covered || bl.covered } : bl)
      }
      files.set(f.path, cur)
    }
  }
  const out: FileCoverage[] = []
  const pkgs = new Map<string, { covered: number; total: number }>()
  let covered = 0
  let total = 0
  for (const [path, { pkg, blocks }] of [...files.entries()].sort(([x], [y]) => x.localeCompare(y))) {
    const list = [...blocks.values()].sort((x, y) => x.startLine - y.startLine || x.startCol - y.startCol)
    const fc = { path, package: pkg, covered: 0, total: 0, blocks: list }
    for (const bl of list) {
      fc.total += bl.stmts
      if (bl.covered) fc.covered += bl.stmts
    }
    out.push(fc)
    const p = pkgs.get(pkg) ?? { covered: 0, total: 0 }
    p.covered += fc.covered
    p.total += fc.total
    pkgs.set(pkg, p)
    covered += fc.covered
    total += fc.total
  }
  return {
    runId: b.runId,
    covered,
    total,
    packages: [...pkgs.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([importPath, p]) => ({ importPath, ...p })),
    files: out,
  }
}
