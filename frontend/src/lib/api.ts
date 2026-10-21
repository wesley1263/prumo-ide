// Cliente da API do backend. O mesmo contrato roda de dois jeitos:
//  - dentro do app: bindings do Wails (window.go.api.<Serviço>.<Método>)
//  - no navegador (modo dev): POST /bridge/rpc no devserver
// Os tipos espelham as structs Go de internal/api e dos pacotes que ele expõe.
import { translateBackend } from '../i18n/backend'

declare const __DEV_TOKEN__: string

type WailsGo = Record<string, Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>>
declare global {
  interface Window {
    go?: WailsGo
    runtime?: {
      EventsOn: (name: string, cb: (data: unknown) => void) => () => void
    }
  }
}

export const inWails = typeof window !== 'undefined' && !!window.go?.api

/** Erro de uma chamada ao backend. message vem traduzida para o idioma da interface; raw é o texto original
 * do Go (para o código que reconhece mensagens específicas, como "seletor nativo"). */
export class ApiError extends Error {
  public raw: string
  constructor(
    public method: string,
    message: string,
  ) {
    super(translateBackend(message))
    this.raw = message
  }
}

/** O texto original do backend (sem tradução), quando é um ApiError; senão a mensagem. */
export const rawMessage = (e: unknown) => (e instanceof ApiError ? e.raw : String((e as Error)?.message ?? e))

// Campos de respostas que trazem texto do backend para a tela (traduzidos aqui, uma vez).
function translateResult(method: string, r: unknown): unknown {
  if (!r || typeof r !== 'object') return r
  const o = r as Record<string, unknown>
  const tr = (k: string) => (typeof o[k] === 'string' ? { [k]: translateBackend(o[k] as string) } : {})
  if (method === 'RunConfigs.Validate') return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? translateBackend(v) : v]))
  if (method === 'Git.CloneStatus') return { ...o, ...tr('phase'), ...tr('error') }
  if (method === 'Sdks.Download' || method === 'Sdks.DownloadStatus') return { ...o, ...tr('error') }
  if (method.startsWith('Git.') && !Array.isArray(r)) return { ...o, ...tr('message') }
  return r
}

async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  if (inWails) {
    const [svc, fn] = method.split('.')
    const f = window.go!.api?.[svc]?.[fn]
    if (!f) throw new ApiError(method, `método ausente no binding: ${method}`)
    try {
      return translateResult(method, await f(...args)) as T
    } catch (e) {
      throw new ApiError(method, String(e))
    }
  }
  const res = await fetch('/bridge/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Prumo-Token': __DEV_TOKEN__ },
    body: JSON.stringify({ method, args }),
  }).catch(() => {
    throw new ApiError(method, 'backend fora do ar: rode `go run ./cmd/devserver`')
  })
  const body = (await res.json().catch(() => ({ error: `resposta inválida (${res.status})` }))) as {
    result?: T
    error?: string
  }
  if (body.error) throw new ApiError(method, body.error)
  return translateResult(method, body.result) as T
}

// ---------------------------------------------------------------- tipos

export interface Tool {
  name: string
  path: string
  version: string
}
export interface ToolsStatus {
  go: Tool
  git: Tool
  gopls: Tool
  dlv: Tool
  rg: Tool
}
export interface GoSdk {
  id: string
  goroot: string
  version: string
  source: string
  isDefault: boolean
}
export interface Project {
  id: string
  rootPath: string
  name: string
  goSdkId: string | null
  buildTags: string[]
  env: Record<string, string>
  trusted: boolean
  lastOpenedAt: number | null
}
export interface RecentProject extends Project {
  exists: boolean
}
export interface OpenProject extends Project {
  hasGoMod: boolean
  hasGoWork: boolean
  goRoot: string
}
export interface Bootstrap {
  bridgePort: number
  bridgeToken: string
  dev: boolean
  platform: string
  settings: Record<string, unknown>
  recent: RecentProject[]
  sdks: GoSdk[]
  tools: ToolsStatus
  homeDir: string
}
export interface FileNode {
  name: string
  path: string
  isDir: boolean
  size: number
}
export interface FileContent {
  path: string
  content: string
  mtime: number
  size: number
  lineEnding: '\n' | '\r\n'
  readOnly: boolean
  tooLarge: boolean
  binary: boolean
}
export interface WriteResult {
  mtime: number
  conflict: boolean
  diskMtime: number
}
export type ChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflict'
export interface FileChange {
  path: string
  origPath: string
  kind: ChangeKind
  staged: boolean
  unstaged: boolean
}
export interface RepoStatus {
  isRepo: boolean
  branch: string
  head: string
  upstream: string
  ahead: number
  behind: number
  operation: string
  files: FileChange[]
}
export interface CommitResult {
  hash: string
  summary: string
}
export interface DiffContents {
  path: string
  left: string
  right: string
  binary: boolean
}
export interface Branch {
  name: string
  remote: boolean
  current: boolean
  upstream: string
  ahead: number
  behind: number
  gone: boolean
  date: number
}
export interface Branches {
  current: string
  head: string
  local: Branch[]
  remote: Branch[]
  remotes: string[]
  operation: string
}
export interface RebaseStep {
  action: 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop'
  hash: string
  message?: string
}
export interface SdkDownload {
  version: string
  done: number
  total: number
  phase: 'baixando' | 'conferindo' | 'extraindo' | 'pronto' | 'erro'
  error?: string
  goroot?: string
}
export interface Worktree {
  path: string
  branch: string
  head: string
  current: boolean
  main: boolean
}
export interface BranchCompare {
  current: string
  other: string
  onlyOther: LogCommit[]
  onlyCurrent: LogCommit[]
  files: CommitFile[]
  truncated: boolean
}
export interface OpResult {
  ok: boolean
  message: string
  rejected: boolean
  conflicts: string[] | null
  operation: string
}
export interface OutCommit {
  hash: string
  subject: string
  author: string
  date: number
}
export interface LogFilter {
  text: string
  author: string
  branch: string // "" = todas
  path: string
  follow: boolean
}

export interface GraphSeg {
  x1: number
  y1: number // 0 topo, 1 meio, 2 base
  x2: number
  y2: number
  color: number
}

export interface LogCommit {
  hash: string
  short: string
  parents: string[]
  subject: string
  author: string
  email: string
  date: number
  refs: Array<{ name: string; kind: 'head' | 'local' | 'remote' | 'tag' }>
  node: number
  color: number
  lines: GraphSeg[]
}

export interface LogPage {
  commits: LogCommit[]
  hasMore: boolean
  width: number
}

export interface CommitFile {
  path: string
  oldPath: string
  kind: 'added' | 'modified' | 'deleted' | 'renamed'
  outside: boolean
}

export interface CommitDetails {
  hash: string
  parents: string[]
  author: string
  email: string
  date: number
  committer: string
  message: string
  files: CommitFile[]
  branches: string[]
}

export interface StashEntry {
  index: number
  message: string
  branch: string
  date: number
  files: number
}

export interface MergeChunk {
  conflict: boolean
  text: string
  ours: string
  base: string
  theirs: string
}

export interface MergeInput {
  path: string
  kind: 'both-modified' | 'both-added' | 'deleted-by-us' | 'deleted-by-them'
  ours: string
  base: string
  theirs: string
  oursLabel: string
  theirsLabel: string
  chunks: MergeChunk[]
  conflicts: number
  binary: boolean
  operation: string
}

export interface Blame {
  commits: Array<{ hash: string; short: string; author: string; date: number; summary: string; pending: boolean }>
  lines: number[]
}

export interface Outgoing {
  branch: string
  remote: string
  target: string
  hasUpstream: boolean
  remotes: string[]
  commits: OutCommit[]
}
export interface PushRequest {
  remote: string
  target: string
  setUpstream: boolean
  force: boolean
  tags: boolean
}

export interface RunConfig {
  id: string
  projectId: string
  name: string
  type: 'go_build' | 'go_test'
  temporary: boolean
  storeAsProjectFile: boolean
  runKind: 'package' | 'file' | 'directory'
  packagePath: string | null
  files: string[]
  directory: string | null
  outputDir: string | null
  runAfterBuild: boolean
  workingDir: string | null
  env: Record<string, string>
  programArgs: string
  goToolArgs: string
  useBuildTags: boolean
  redirectInputFrom: string | null
  emulateTerminal: boolean
  testFramework: string | null
  testPattern: string | null
  lastUsedAt: number | null
  beforeLaunch: BeforeTask[]
}
export interface BeforeTask {
  kind: 'go_generate' | 'run_config' | 'external_tool'
  ref?: string | null
  command?: string | null
}
export interface CoverBlock {
  startLine: number
  startCol: number
  endLine: number
  endCol: number
  stmts: number
  covered: boolean
}
export interface FileCoverage {
  path: string
  package: string
  covered: number
  total: number
  blocks: CoverBlock[]
}
export interface Coverage {
  runId: string
  covered: number
  total: number
  packages: Array<{ importPath: string; covered: number; total: number }>
  files: FileCoverage[]
}

export type RunState = 'building' | 'running' | 'exited' | 'failed' | 'stopped'
export interface RunInfo {
  id: string
  projectId: string
  configId: string
  name: string
  kind: '' | 'test'
  state: RunState
  exitCode: number | null
  startedAt: number
}

export type TestStatus = 'running' | 'passed' | 'failed' | 'skipped'
export interface TestNode {
  package: string
  name: string // '' = o pacote
  status: TestStatus
  elapsedMs: number
  output: string
  summary?: string // benchmark (ns/op…) e fuzz (execs…)
}
export interface TestRun {
  runId: string
  state: RunState
  passed: number
  failed: number
  skipped: number
  nodes: TestNode[]
}

export interface TermInfo {
  id: string
  projectId: string
  title: string
  shell: string
  exited: boolean
  exitCode: number
  created: number
}

export interface FileHit {
  path: string
  score: number
  positions: number[] // índices em path dos caracteres casados
}

export interface SearchOptions {
  query: string
  regex: boolean
  caseSensitive: boolean
  wholeWords: boolean
  mask: string // "*.go, !*_test.go"
  dir: string // "" = projeto todo
}

/** Ocorrência; colunas UTF-16 começando em 1 (as do Monaco). */
export interface SearchMatch {
  path: string
  line: number
  col: number
  len: number
  preview: string
  start: number // trecho casado dentro de preview
  end: number
}

export interface TextResults {
  matches: SearchMatch[]
  next: number
  done: boolean
  truncated: boolean
  files: number
  error?: string
}

export interface ReplaceResult {
  paths: string[]
  replaced: number
  skipped: number
}

export type DebugState = 'starting' | 'running' | 'stopped' | 'terminated'
export interface DebugInfo {
  id: string
  projectId: string
  configId: string
  name: string
  state: DebugState
  reason: string
  threadId: number
  file: string
  line: number
  message: string
  exitCode: number | null
}
export interface Frame {
  id: number
  name: string
  file: string
  line: number
  column: number
  external: boolean
}
export interface Goroutine {
  id: number
  name: string
  function: string
  current: boolean
  system: boolean // do runtime do Go
}
export interface Variable {
  name: string
  value: string
  type: string
  ref: number
}
export interface Scope {
  name: string
  ref: number
}
export interface Breakpoint {
  id: string
  projectId: string
  kind: 'line' | 'panic'
  filePath: string | null
  line: number | null
  enabled: boolean
  suspend: boolean
  condition: string | null
  logMessage: string | null
}

// ---------------------------------------------------------------- serviços

export const api = {
  App: {
    Bootstrap: () => call<Bootstrap>('App.Bootstrap'),
    SetDirty: (dirty: boolean) => call<void>('App.SetDirty', dirty),
    Quit: () => call<void>('App.Quit'),
  },
  Projects: {
    ListRecent: () => call<RecentProject[]>('Projects.ListRecent'),
    Open: (path: string) => call<{ project: OpenProject; needsTrust: boolean }>('Projects.Open', path),
    SetTrusted: (id: string, trusted: boolean) => call<OpenProject>('Projects.SetTrusted', id, trusted),
    Close: (id: string) => call<void>('Projects.Close', id),
    RemoveRecent: (id: string) => call<void>('Projects.RemoveRecent', id),
    CreateModule: (parent: string, name: string, path: string, withMain: boolean) =>
      call<{ project: OpenProject; needsTrust: boolean }>('Projects.CreateModule', parent, name, path, withMain),
  },
  Dialogs: {
    PickDirectory: (title: string) => call<string>('Dialogs.PickDirectory', title),
  },
  Workspace: {
    Load: (projectId: string) => call<Record<string, unknown>>('Workspace.Load', projectId),
    Save: (projectId: string, state: unknown) => call<void>('Workspace.Save', projectId, state),
  },
  Settings: {
    Get: (keys: string[]) => call<Record<string, unknown>>('Settings.Get', keys),
    Set: (key: string, value: unknown) => call<void>('Settings.Set', key, value),
  },
  Sdks: {
    List: () => call<GoSdk[]>('Sdks.List'),
    Detect: () => call<GoSdk[]>('Sdks.Detect'),
    SetDefault: (id: string) => call<void>('Sdks.SetDefault', id),
    Available: () => call<Array<{ version: string; stable: boolean; file: string; size: number }>>('Sdks.Available'),
    Download: (version: string) => call<SdkDownload>('Sdks.Download', version),
    DownloadStatus: (version: string) => call<SdkDownload>('Sdks.DownloadStatus', version),
  },
  Tools: {
    Status: () => call<ToolsStatus>('Tools.Status'),
    Install: (name: 'gopls' | 'dlv') => call<string>('Tools.Install', name),
  },
  Files: {
    Tree: (projectId: string, dir: string) => call<FileNode[]>('Files.Tree', projectId, dir),
    Read: (projectId: string, path: string) => call<FileContent>('Files.Read', projectId, path),
    ReadExternal: (projectId: string, absPath: string) => call<FileContent>('Files.ReadExternal', projectId, absPath),
    Write: (projectId: string, path: string, content: string, expectedMtime: number) =>
      call<WriteResult>('Files.Write', projectId, path, content, expectedMtime),
  },
  Git: {
    Status: (projectId: string) => call<RepoStatus>('Git.Status', projectId),
    Commit: (projectId: string, req: { files: string[]; message: string; amend: boolean; partial?: Record<string, string> }) =>
      call<CommitResult>('Git.Commit', projectId, req),
    Diff: (projectId: string, path: string) => call<DiffContents>('Git.Diff', projectId, path),
    HeadContent: (projectId: string, path: string) => call<{ tracked: boolean; content: string }>('Git.HeadContent', projectId, path),
    Branches: (projectId: string) => call<Branches>('Git.Branches', projectId),
    Checkout: (projectId: string, ref: string, mode: 'normal' | 'smart' | 'force') =>
      call<{ ok: boolean; localChanges: string[] | null; message: string }>('Git.Checkout', projectId, ref, mode),
    CreateBranch: (projectId: string, name: string, from: string, checkout: boolean) =>
      call<void>('Git.CreateBranch', projectId, name, from, checkout),
    RenameBranch: (projectId: string, oldName: string, newName: string) => call<void>('Git.RenameBranch', projectId, oldName, newName),
    DeleteBranch: (projectId: string, name: string, force: boolean) =>
      call<{ deleted: boolean; hash: string; notMerged: boolean }>('Git.DeleteBranch', projectId, name, force),
    RestoreBranch: (projectId: string, name: string, hash: string) => call<void>('Git.RestoreBranch', projectId, name, hash),
    Fetch: (projectId: string) => call<OpResult>('Git.Fetch', projectId),
    Update: (projectId: string, mode: 'merge' | 'rebase') => call<OpResult>('Git.Update', projectId, mode),
    AbortOperation: (projectId: string) => call<void>('Git.AbortOperation', projectId),
    CherryPick: (projectId: string, hash: string) => call<OpResult>('Git.CherryPick', projectId, hash),
    Revert: (projectId: string, hash: string) => call<OpResult>('Git.Revert', projectId, hash),
    Reset: (projectId: string, hash: string, mode: 'soft' | 'mixed' | 'hard') => call<OpResult>('Git.Reset', projectId, hash, mode),
    Clone: (url: string, parentDir: string, name: string) => call<{ id: string; path: string }>('Git.Clone', url, parentDir, name),
    CancelClone: (id: string) => call<void>('Git.CancelClone', id),
    CloneStatus: (id: string) =>
      call<{ id: string; phase: string; percent: number; line: string; done: boolean; ok: boolean; error?: string; path: string }>('Git.CloneStatus', id),
    StashList: (projectId: string) => call<StashEntry[]>('Git.StashList', projectId),
    StashSave: (projectId: string, message: string, untracked: boolean) => call<void>('Git.StashSave', projectId, message, untracked),
    StashApply: (projectId: string, index: number, pop: boolean) => call<OpResult>('Git.StashApply', projectId, index, pop),
    StashDrop: (projectId: string, index: number) => call<void>('Git.StashDrop', projectId, index),
    ConflictVersions: (projectId: string, path: string) => call<MergeInput>('Git.ConflictVersions', projectId, path),
    ResolveConflict: (projectId: string, path: string, side: 'content' | 'ours' | 'theirs' | 'delete', content = '') =>
      call<void>('Git.ResolveConflict', projectId, path, side, content),
    ContinueOperation: (projectId: string) => call<OpResult>('Git.ContinueOperation', projectId),
    Outgoing: (projectId: string) => call<Outgoing>('Git.Outgoing', projectId),
    Log: (projectId: string, filter: LogFilter, limit: number) => call<LogPage>('Git.Log', projectId, filter, limit),
    CommitDetails: (projectId: string, hash: string) => call<CommitDetails>('Git.CommitDetails', projectId, hash),
    CommitDiff: (projectId: string, hash: string, path: string, oldPath = '') => call<DiffContents>('Git.CommitDiff', projectId, hash, path, oldPath),
    CompareBranches: (projectId: string, other: string) => call<BranchCompare>('Git.CompareBranches', projectId, other),
    RebaseCommits: (projectId: string, base: string) => call<LogCommit[]>('Git.RebaseCommits', projectId, base),
    InteractiveRebase: (projectId: string, base: string, steps: RebaseStep[]) => call<OpResult>('Git.InteractiveRebase', projectId, base, steps),
    CreateTag: (projectId: string, name: string, hash: string, message: string) => call<void>('Git.CreateTag', projectId, name, hash, message),
    DeleteTag: (projectId: string, name: string) => call<void>('Git.DeleteTag', projectId, name),
    Worktrees: (projectId: string) => call<Worktree[]>('Git.Worktrees', projectId),
    AddWorktree: (projectId: string, path: string, branch: string, newBranch: boolean) => call<Worktree>('Git.AddWorktree', projectId, path, branch, newBranch),
    RemoveWorktree: (projectId: string, path: string, force: boolean) => call<void>('Git.RemoveWorktree', projectId, path, force),
    RefDiff: (projectId: string, base: string, other: string, path: string, oldPath = '') => call<DiffContents>('Git.RefDiff', projectId, base, other, path, oldPath),
    Blame: (projectId: string, path: string) => call<Blame>('Git.Blame', projectId, path),
    Push: (projectId: string, req: PushRequest) => call<OpResult>('Git.Push', projectId, req),
  },
  RunConfigs: {
    List: (projectId: string) => call<RunConfig[]>('RunConfigs.List', projectId),
    Save: (projectId: string, cfg: RunConfig) => call<RunConfig>('RunConfigs.Save', projectId, cfg),
    Delete: (projectId: string, id: string) => call<void>('RunConfigs.Delete', projectId, id),
    Validate: (projectId: string, cfg: RunConfig) => call<Record<string, string>>('RunConfigs.Validate', projectId, cfg),
    FromContext: (projectId: string, filePath: string, testName = '') =>
      call<RunConfig>('RunConfigs.FromContext', projectId, filePath, testName),
  },
  Runs: {
    Start: (projectId: string, configId: string) => call<RunInfo>('Runs.Start', projectId, configId),
    Vet: (projectId: string, files: string[]) => call<{ ok: boolean; output: string }>('Runs.Vet', projectId, files),
    TestPackages: (projectId: string, files: string[]) => call<{ ok: boolean; output: string }>('Runs.TestPackages', projectId, files),
    StartGoTool: (projectId: string, tool: 'mod-tidy' | 'mod-download' | 'generate' | 'vet' | 'get', arg = '') => call<RunInfo>('Runs.StartGoTool', projectId, tool, arg),
    StartCoverage: (projectId: string, configId: string) => call<RunInfo>('Runs.StartCoverage', projectId, configId),
    Coverage: (runId: string) => call<Coverage>('Runs.Coverage', runId),
    Stop: (runId: string) => call<void>('Runs.Stop', runId),
    WriteStdin: (runId: string, data: string) => call<void>('Runs.WriteStdin', runId, data),
    List: (projectId: string) => call<RunInfo[]>('Runs.List', projectId),
  },
  Terminal: {
    Create: (projectId: string, cols: number, rows: number) => call<TermInfo>('Terminal.Create', projectId, cols, rows),
    List: (projectId: string) => call<TermInfo[]>('Terminal.List', projectId),
    Rename: (termId: string, title: string) => call<void>('Terminal.Rename', termId, title),
    Close: (termId: string) => call<void>('Terminal.Close', termId),
  },
  Search: {
    Files: (projectId: string, query: string, limit = 100) => call<FileHit[]>('Search.Files', projectId, query, limit),
    Text: (projectId: string, opt: SearchOptions) => call<string>('Search.Text', projectId, opt),
    Results: (searchId: string, from: number, max = 2000) => call<TextResults>('Search.Results', searchId, from, max),
    Cancel: (searchId: string) => call<void>('Search.Cancel', searchId),
    Replace: (projectId: string, opt: SearchOptions, replacement: string, targets: Array<{ path: string; line: number; col: number }>) =>
      call<ReplaceResult>('Search.Replace', projectId, opt, replacement, targets),
  },
  Tests: {
    Get: (runId: string) => call<TestRun>('Tests.Get', runId),
    Locate: (projectId: string, runId: string, pkg: string, name: string) =>
      call<{ file: string; line: number }>('Tests.Locate', projectId, runId, pkg, name),
    RerunFailed: (projectId: string, runId: string) => call<RunInfo>('Tests.RerunFailed', projectId, runId),
  },
  Debug: {
    Start: (projectId: string, configId: string) => call<DebugInfo>('Debug.Start', projectId, configId),
    Control: (sessionId: string, action: 'resume' | 'pause' | 'stepOver' | 'stepInto' | 'stepOut', threadId = 0) =>
      call<void>('Debug.Control', sessionId, action, threadId),
    Stop: (sessionId: string) => call<void>('Debug.Stop', sessionId),
    Processes: () => call<Array<{ pid: number; name: string; command: string }>>('Debug.Processes'),
    AttachLocal: (projectId: string, pid: number) => call<DebugInfo>('Debug.AttachLocal', projectId, pid),
    AttachRemote: (projectId: string, addr: string) => call<DebugInfo>('Debug.AttachRemote', projectId, addr),
    RunToCursor: (sessionId: string, path: string, line: number) => call<void>('Debug.RunToCursor', sessionId, path, line),
    Goroutines: (sessionId: string) => call<Goroutine[]>('Debug.Goroutines', sessionId),
    Stack: (sessionId: string, threadId: number) => call<Frame[]>('Debug.Stack', sessionId, threadId),
    Scopes: (sessionId: string, frameId: number) => call<Scope[]>('Debug.Scopes', sessionId, frameId),
    Variables: (sessionId: string, ref: number, start = 0, count = 0) => call<Variable[]>('Debug.Variables', sessionId, ref, start, count),
    Evaluate: (sessionId: string, frameId: number, expr: string) => call<Variable>('Debug.Evaluate', sessionId, frameId, expr),
    List: (projectId: string) => call<DebugInfo[]>('Debug.List', projectId),
  },
  Breakpoints: {
    List: (projectId: string) => call<Breakpoint[]>('Breakpoints.List', projectId),
    Toggle: (projectId: string, path: string, line: number) => call<Breakpoint[]>('Breakpoints.Toggle', projectId, path, line),
    Update: (projectId: string, bp: Breakpoint) => call<Breakpoint[]>('Breakpoints.Update', projectId, bp),
    Move: (projectId: string, path: string, moves: Record<string, number>) => call<Breakpoint[]>('Breakpoints.Move', projectId, path, moves),
    Delete: (projectId: string, id: string) => call<Breakpoint[]>('Breakpoints.Delete', projectId, id),
    SetPanic: (projectId: string, enabled: boolean) => call<Breakpoint[]>('Breakpoints.SetPanic', projectId, enabled),
    SetMuted: (projectId: string, muted: boolean) => call<void>('Breakpoints.SetMuted', projectId, muted),
    Muted: (projectId: string) => call<boolean>('Breakpoints.Muted', projectId),
  },
}

/**
 * Grava um arquivo mesmo com a página sendo descarregada (recarregar/fechar a aba no modo dev).
 * fetch com keepalive sobrevive ao unload; no app nativo o fechamento passa por App.Quit.
 */
export function writeOnUnload(projectId: string, path: string, content: string, expectedMtime: number) {
  const args = [projectId, path, content, expectedMtime]
  if (inWails) {
    void window.go!.api.Files.Write(...args)
    return
  }
  void fetch('/bridge/rpc', {
    method: 'POST',
    keepalive: true, // o navegador limita a ~64 KB por página: arquivos maiores dependem do autosave por ociosidade
    headers: { 'Content-Type': 'application/json', 'X-Prumo-Token': __DEV_TOKEN__ },
    body: JSON.stringify({ method: 'Files.Write', args }),
  }).catch(() => {})
}

// ---------------------------------------------------------------- ponte (WebSocket)

let bridge = { port: 0, token: '' }

/** Guarda porta e token da ponte (vem do Bootstrap). */
export function setBridge(port: number, token: string) {
  bridge = { port, token }
}

/** URL de WebSocket da ponte: direto no app, pelo proxy do Vite no modo dev. */
export function bridgeWsUrl(path: string): string {
  if (inWails) {
    return `ws://127.0.0.1:${bridge.port}${path}?token=${encodeURIComponent(bridge.token)}`
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/bridge${path}?token=${encodeURIComponent(__DEV_TOKEN__)}`
}
