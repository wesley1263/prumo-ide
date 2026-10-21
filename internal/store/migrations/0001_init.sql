-- 0001_init: schema inicial do estado local. Espelho de replica/schema.sql (o documento de arquitetura).
-- Fonte da verdade do VCS é o git; diagnósticos/símbolos vêm do gopls; nada disso é persistido aqui.
--
-- Convenções (adaptadas do template web para SQLite local):
--   id          TEXT uuid v7 gerado no Go (ordenável por tempo)
--   *_at        INTEGER, Unix ms em UTC (exibição converte para o fuso local)
--   owner       não há usuários: tudo que pertence a um projeto tem project_id; acesso = checagem na camada de dados
--               (todo método de repositório recebe projectID e filtra por ele). Sem RLS.
--   bool        INTEGER 0/1 com CHECK
--   status      CHECK com a lista de valores
--   paths       relativos à raiz do projeto, separador '/', sempre (normalizados no Go)
-- Requer: PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; (setados ao abrir a conexão)


-- ---------------------------------------------------------------- global

CREATE TABLE app_settings (
  key         TEXT PRIMARY KEY,                -- ex.: 'appearance.theme', 'editor.fontSize', 'keymap.overrides'
  value       TEXT NOT NULL,                   -- JSON
  updated_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

CREATE TABLE go_sdks (
  id          TEXT PRIMARY KEY,
  goroot      TEXT NOT NULL UNIQUE,            -- caminho absoluto
  version     TEXT NOT NULL,                   -- 'go1.25.3', lido de $GOROOT/VERSION
  source      TEXT NOT NULL CHECK (source IN ('detected', 'downloaded', 'manual')),
  is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;
-- no máximo um SDK padrão
CREATE UNIQUE INDEX go_sdks_one_default ON go_sdks (is_default) WHERE is_default = 1;

CREATE TABLE projects (
  id              TEXT PRIMARY KEY,
  root_path       TEXT NOT NULL UNIQUE,        -- caminho absoluto canônico (EvalSymlinks)
  name            TEXT NOT NULL,
  go_sdk_id       TEXT REFERENCES go_sdks (id) ON DELETE SET NULL,   -- NULL = usa o padrão
  gopath          TEXT,                         -- NULL = go env GOPATH
  build_tags      TEXT NOT NULL DEFAULT '[]',   -- JSON array
  env             TEXT NOT NULL DEFAULT '{}',   -- JSON object, aplicado a gopls/run/test/debug
  trusted         INTEGER NOT NULL DEFAULT 0 CHECK (trusted IN (0, 1)),  -- workspace trust (ver "parts that bite")
  last_opened_at  INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at      INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;
CREATE INDEX projects_recent ON projects (last_opened_at DESC);
CREATE INDEX projects_go_sdk ON projects (go_sdk_id);

-- ---------------------------------------------------------------- workspace (não versionado)

CREATE TABLE workspaces (
  project_id  TEXT PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  state       TEXT NOT NULL DEFAULT '{}',      -- JSON: abas {path, caret, scroll, pinned}, layout das tool windows,
                                               -- nós expandidos, config de run ativa. Blob de UI: lido/escrito inteiro.
  updated_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

CREATE TABLE branch_contexts (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  repo_root   TEXT NOT NULL,                   -- relativo ao projeto ('' = raiz)
  branch      TEXT NOT NULL,
  state       TEXT NOT NULL,                   -- JSON: abas, run config, ids de breakpoints ativos
  updated_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  UNIQUE (project_id, repo_root, branch)
) STRICT;

-- ---------------------------------------------------------------- run / test

CREATE TABLE run_configurations (
  id                   TEXT PRIMARY KEY,
  project_id           TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  type                 TEXT NOT NULL CHECK (type IN ('go_build', 'go_test')),
  temporary            INTEGER NOT NULL DEFAULT 1 CHECK (temporary IN (0, 1)),
  store_as_project_file INTEGER NOT NULL DEFAULT 0 CHECK (store_as_project_file IN (0, 1)),
  run_kind             TEXT NOT NULL CHECK (run_kind IN ('package', 'file', 'directory')),
  package_path         TEXT,                   -- import path, quando run_kind = 'package'
  files                TEXT NOT NULL DEFAULT '[]',  -- JSON array de paths, quando run_kind = 'file'
  directory            TEXT,                   -- quando run_kind = 'directory'
  output_dir           TEXT,
  run_after_build      INTEGER NOT NULL DEFAULT 1 CHECK (run_after_build IN (0, 1)),
  working_dir          TEXT,                   -- NULL = raiz do módulo
  env                  TEXT NOT NULL DEFAULT '{}',
  program_args         TEXT NOT NULL DEFAULT '',
  go_tool_args         TEXT NOT NULL DEFAULT '',
  use_build_tags       INTEGER NOT NULL DEFAULT 1 CHECK (use_build_tags IN (0, 1)),
  redirect_input_from  TEXT,
  emulate_terminal     INTEGER NOT NULL DEFAULT 0 CHECK (emulate_terminal IN (0, 1)),
  -- só para go_test
  test_framework       TEXT CHECK (test_framework IN ('gotest', 'gobench', 'fuzz')),
  test_pattern         TEXT,                   -- -run / -bench / -fuzz
  last_used_at         INTEGER,
  created_at           INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at           INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  UNIQUE (project_id, name),
  CHECK (type = 'go_test' OR test_framework IS NULL),
  CHECK (run_kind <> 'package' OR package_path IS NOT NULL),
  CHECK (run_kind <> 'directory' OR directory IS NOT NULL)
) STRICT;
CREATE INDEX run_configurations_project ON run_configurations (project_id, temporary, last_used_at DESC);

-- No máximo 5 configurações temporárias por projeto: a mais antiga sai quando entra a sexta.
CREATE TRIGGER run_configurations_cap_temporary
AFTER INSERT ON run_configurations
WHEN NEW.temporary = 1
BEGIN
  DELETE FROM run_configurations
  WHERE project_id = NEW.project_id
    AND temporary = 1
    AND id NOT IN (
      SELECT id FROM run_configurations
      WHERE project_id = NEW.project_id AND temporary = 1
      ORDER BY COALESCE(last_used_at, created_at) DESC
      LIMIT 5
    );
END;

CREATE TABLE before_launch_tasks (
  id                   TEXT PRIMARY KEY,
  run_configuration_id TEXT NOT NULL REFERENCES run_configurations (id) ON DELETE CASCADE,
  position             INTEGER NOT NULL,
  kind                 TEXT NOT NULL CHECK (kind IN ('run_config', 'go_generate', 'external_tool')),
  ref_run_configuration_id TEXT REFERENCES run_configurations (id) ON DELETE CASCADE,
  command              TEXT,                   -- para external_tool
  created_at           INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  UNIQUE (run_configuration_id, position),
  CHECK (kind <> 'run_config' OR ref_run_configuration_id IS NOT NULL),
  CHECK (kind <> 'external_tool' OR command IS NOT NULL),
  CHECK (ref_run_configuration_id IS NULL OR ref_run_configuration_id <> run_configuration_id)
) STRICT;
CREATE INDEX before_launch_tasks_ref ON before_launch_tasks (ref_run_configuration_id);

CREATE TABLE test_runs (
  id                   TEXT PRIMARY KEY,
  project_id           TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  run_configuration_id TEXT REFERENCES run_configurations (id) ON DELETE SET NULL,  -- temporárias somem, o histórico fica
  status               TEXT NOT NULL CHECK (status IN ('running', 'passed', 'failed', 'cancelled', 'error')),
  passed               INTEGER NOT NULL DEFAULT 0,
  failed               INTEGER NOT NULL DEFAULT 0,
  skipped              INTEGER NOT NULL DEFAULT 0,
  started_at           INTEGER NOT NULL,
  finished_at          INTEGER,
  created_at           INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  CHECK (finished_at IS NULL OR finished_at >= started_at)
) STRICT;
CREATE INDEX test_runs_project_recent ON test_runs (project_id, started_at DESC);
CREATE INDEX test_runs_config ON test_runs (run_configuration_id);

CREATE TABLE test_nodes (
  id           TEXT PRIMARY KEY,
  test_run_id  TEXT NOT NULL REFERENCES test_runs (id) ON DELETE CASCADE,
  parent_id    TEXT REFERENCES test_nodes (id) ON DELETE CASCADE,
  package      TEXT NOT NULL,
  name         TEXT NOT NULL,                  -- '' para o nó do pacote; 'TestX/sub_case' para subtests
  status       TEXT NOT NULL CHECK (status IN ('running', 'passed', 'failed', 'skipped', 'not_started')),
  duration_ms  INTEGER,
  output       TEXT NOT NULL DEFAULT '',       -- truncado em 1 MB por nó no Go
  file_path    TEXT,                           -- resolvido via gopls quando possível
  line         INTEGER,
  UNIQUE (test_run_id, package, name)
) STRICT;
CREATE INDEX test_nodes_parent ON test_nodes (parent_id);
CREATE INDEX test_nodes_failed ON test_nodes (test_run_id, status);

CREATE TABLE coverage_suites (
  id                   TEXT PRIMARY KEY,
  project_id           TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  run_configuration_id TEXT REFERENCES run_configurations (id) ON DELETE SET NULL,
  name                 TEXT NOT NULL,
  profile_path         TEXT NOT NULL,          -- coverprofile no cache do app; arquivo apagado junto com a linha (no Go)
  source               TEXT NOT NULL CHECK (source IN ('run', 'imported')),
  active               INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at           INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;
CREATE INDEX coverage_suites_project ON coverage_suites (project_id, active, created_at DESC);
CREATE INDEX coverage_suites_config ON coverage_suites (run_configuration_id);

-- ---------------------------------------------------------------- debug

CREATE TABLE breakpoints (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  kind               TEXT NOT NULL CHECK (kind IN ('line', 'panic')),
  file_path          TEXT,                     -- obrigatório para 'line'
  line               INTEGER,                  -- 1-based
  enabled            INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  suspend            INTEGER NOT NULL DEFAULT 1 CHECK (suspend IN (0, 1)),
  condition          TEXT,
  hit_condition      TEXT,                     -- DAP hitCondition, ex.: '>= 3'
  log_message        INTEGER NOT NULL DEFAULT 0 CHECK (log_message IN (0, 1)),
  log_stack_trace    INTEGER NOT NULL DEFAULT 0 CHECK (log_stack_trace IN (0, 1)),
  log_expression     TEXT,
  remove_once_hit    INTEGER NOT NULL DEFAULT 0 CHECK (remove_once_hit IN (0, 1)),
  disabled_until_id  TEXT REFERENCES breakpoints (id) ON DELETE SET NULL,
  description        TEXT,
  group_name         TEXT,
  created_at         INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at         INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  CHECK (kind <> 'line' OR (file_path IS NOT NULL AND line >= 1)),
  CHECK (disabled_until_id IS NULL OR disabled_until_id <> id)
) STRICT;
-- um breakpoint de linha por linha; um de panic por projeto
CREATE UNIQUE INDEX breakpoints_one_per_line ON breakpoints (project_id, file_path, line) WHERE kind = 'line';
CREATE UNIQUE INDEX breakpoints_one_panic ON breakpoints (project_id) WHERE kind = 'panic';
CREATE INDEX breakpoints_disabled_until ON breakpoints (disabled_until_id);

CREATE TABLE watches (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  expression  TEXT NOT NULL,
  position    INTEGER NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  UNIQUE (project_id, position)
) STRICT;

-- ---------------------------------------------------------------- git (só o que o git não guarda)

CREATE TABLE changelists (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  comment     TEXT NOT NULL DEFAULT '',        -- rascunho da mensagem de commit desta lista
  is_active   INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  UNIQUE (project_id, name)
) STRICT;
CREATE UNIQUE INDEX changelists_one_active ON changelists (project_id) WHERE is_active = 1;

-- Arquivo fora desta tabela = está na changelist ativa. Só registra exceções.
CREATE TABLE changelist_files (
  changelist_id TEXT NOT NULL REFERENCES changelists (id) ON DELETE CASCADE,
  project_id    TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  repo_root     TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  PRIMARY KEY (project_id, repo_root, file_path)   -- um arquivo em uma lista só
) STRICT;
CREATE INDEX changelist_files_list ON changelist_files (changelist_id);

CREATE TABLE commit_messages (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  message     TEXT NOT NULL,
  used_at     INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  UNIQUE (project_id, message)                 -- reusar = atualizar used_at (upsert)
) STRICT;
CREATE INDEX commit_messages_recent ON commit_messages (project_id, used_at DESC);

CREATE TABLE commit_options (
  project_id      TEXT PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  sign_off        INTEGER NOT NULL DEFAULT 0 CHECK (sign_off IN (0, 1)),
  run_hooks       INTEGER NOT NULL DEFAULT 1 CHECK (run_hooks IN (0, 1)),
  check_go_fmt    INTEGER NOT NULL DEFAULT 1 CHECK (check_go_fmt IN (0, 1)),
  check_imports   INTEGER NOT NULL DEFAULT 1 CHECK (check_imports IN (0, 1)),
  check_analyze   INTEGER NOT NULL DEFAULT 0 CHECK (check_analyze IN (0, 1)),
  check_run_configuration_id TEXT REFERENCES run_configurations (id) ON DELETE SET NULL,
  updated_at      INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;
CREATE INDEX commit_options_check_config ON commit_options (check_run_configuration_id);

CREATE TABLE favorite_branches (
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  repo_root   TEXT NOT NULL,
  ref_name    TEXT NOT NULL,                   -- 'refs/heads/main', 'refs/remotes/origin/main'
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  PRIMARY KEY (project_id, repo_root, ref_name)
) STRICT;

-- ---------------------------------------------------------------- navegação

CREATE TABLE bookmarks (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  file_path   TEXT NOT NULL,
  line        INTEGER NOT NULL CHECK (line >= 1),
  mnemonic    TEXT CHECK (mnemonic IS NULL OR length(mnemonic) = 1),
  description TEXT,
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  UNIQUE (project_id, file_path, line)
) STRICT;
CREATE UNIQUE INDEX bookmarks_mnemonic ON bookmarks (project_id, mnemonic) WHERE mnemonic IS NOT NULL;

CREATE TABLE recent_locations (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  file_path   TEXT NOT NULL,
  line        INTEGER NOT NULL,
  col         INTEGER NOT NULL,
  changed     INTEGER NOT NULL DEFAULT 0 CHECK (changed IN (0, 1)),  -- local de edição vs. só visitado
  visited_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;
CREATE INDEX recent_locations_project ON recent_locations (project_id, visited_at DESC);
