package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

// RunConfig é uma configuração de execução (Go Build ou Go Test).
type RunConfig struct {
	ID                 string            `json:"id"`
	ProjectID          string            `json:"projectId"`
	Name               string            `json:"name"`
	Type               string            `json:"type"` // go_build | go_test
	Temporary          bool              `json:"temporary"`
	StoreAsProjectFile bool              `json:"storeAsProjectFile"`
	RunKind            string            `json:"runKind"` // package | file | directory
	PackagePath        *string           `json:"packagePath"`
	Files              []string          `json:"files"`
	Directory          *string           `json:"directory"`
	OutputDir          *string           `json:"outputDir"`
	RunAfterBuild      bool              `json:"runAfterBuild"`
	WorkingDir         *string           `json:"workingDir"`
	Env                map[string]string `json:"env"`
	ProgramArgs        string            `json:"programArgs"`
	GoToolArgs         string            `json:"goToolArgs"`
	UseBuildTags       bool              `json:"useBuildTags"`
	RedirectInputFrom  *string           `json:"redirectInputFrom"`
	EmulateTerminal    bool              `json:"emulateTerminal"`
	TestFramework      *string           `json:"testFramework"`
	TestPattern        *string           `json:"testPattern"`
	LastUsedAt         *int64            `json:"lastUsedAt"`
	BeforeLaunch       []BeforeTask      `json:"beforeLaunch"`
}

// BeforeTask roda antes da config, na ordem: go generate, outra config ou um comando do projeto.
type BeforeTask struct {
	Kind    string  `json:"kind"`              // go_generate | run_config | external_tool
	Ref     *string `json:"ref,omitempty"`     // run_config: id da outra config
	Command *string `json:"command,omitempty"` // external_tool: programa e argumentos
}

const runConfigCols = `id, project_id, name, type, temporary, store_as_project_file, run_kind, package_path,
	files, directory, output_dir, run_after_build, working_dir, env, program_args, go_tool_args, use_build_tags,
	redirect_input_from, emulate_terminal, test_framework, test_pattern, last_used_at`

func scanRunConfig(sc interface{ Scan(...any) error }) (RunConfig, error) {
	var c RunConfig
	var temp, store, after, tags, emu int
	var files, env string
	err := sc.Scan(&c.ID, &c.ProjectID, &c.Name, &c.Type, &temp, &store, &c.RunKind, &c.PackagePath,
		&files, &c.Directory, &c.OutputDir, &after, &c.WorkingDir, &env, &c.ProgramArgs, &c.GoToolArgs, &tags,
		&c.RedirectInputFrom, &emu, &c.TestFramework, &c.TestPattern, &c.LastUsedAt)
	if err != nil {
		return c, err
	}
	c.Temporary, c.StoreAsProjectFile, c.RunAfterBuild, c.UseBuildTags, c.EmulateTerminal =
		temp == 1, store == 1, after == 1, tags == 1, emu == 1
	if err := json.Unmarshal([]byte(files), &c.Files); err != nil {
		return c, fmt.Errorf("files corrompido: %w", err)
	}
	if err := json.Unmarshal([]byte(env), &c.Env); err != nil {
		return c, fmt.Errorf("env corrompido: %w", err)
	}
	return c, nil
}

// ListRunConfigs lista as configs do projeto: permanentes por nome, depois temporárias por uso.
func (d *DB) ListRunConfigs(ctx context.Context, projectID string) ([]RunConfig, error) {
	rows, err := d.sql.QueryContext(ctx, `SELECT `+runConfigCols+` FROM run_configurations
		WHERE project_id = ? ORDER BY temporary, CASE WHEN temporary = 1 THEN -COALESCE(last_used_at, created_at) END, name`,
		projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RunConfig{}
	for rows.Next() {
		c, err := scanRunConfig(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	for i := range out {
		if out[i].BeforeLaunch, err = d.beforeTasks(ctx, out[i].ID); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (d *DB) beforeTasks(ctx context.Context, configID string) ([]BeforeTask, error) {
	rows, err := d.sql.QueryContext(ctx, `SELECT kind, ref_run_configuration_id, command FROM before_launch_tasks
		WHERE run_configuration_id = ? ORDER BY position`, configID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []BeforeTask{}
	for rows.Next() {
		var t BeforeTask
		if err := rows.Scan(&t.Kind, &t.Ref, &t.Command); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (d *DB) withTasks(ctx context.Context, c RunConfig, err error) (RunConfig, error) {
	if err != nil {
		return c, err
	}
	c.BeforeLaunch, err = d.beforeTasks(ctx, c.ID)
	return c, err
}

// RunConfigByID busca uma config, sempre escopada ao projeto.
func (d *DB) RunConfigByID(ctx context.Context, projectID, id string) (RunConfig, error) {
	c, err := scanRunConfig(d.sql.QueryRowContext(ctx,
		`SELECT `+runConfigCols+` FROM run_configurations WHERE project_id = ? AND id = ?`, projectID, id))
	if errors.Is(err, sql.ErrNoRows) {
		return c, ErrNotFound
	}
	return d.withTasks(ctx, c, err)
}

// RunConfigByName busca pelo nome único dentro do projeto.
func (d *DB) RunConfigByName(ctx context.Context, projectID, name string) (RunConfig, error) {
	c, err := scanRunConfig(d.sql.QueryRowContext(ctx,
		`SELECT `+runConfigCols+` FROM run_configurations WHERE project_id = ? AND name = ?`, projectID, name))
	if errors.Is(err, sql.ErrNoRows) {
		return c, ErrNotFound
	}
	return d.withTasks(ctx, c, err)
}

// SaveRunConfig insere (ID vazio) ou atualiza a config. Devolve a versão gravada.
func (d *DB) SaveRunConfig(ctx context.Context, c RunConfig) (RunConfig, error) {
	if c.Files == nil {
		c.Files = []string{}
	}
	if c.Env == nil {
		c.Env = map[string]string{}
	}
	files, _ := json.Marshal(c.Files)
	env, _ := json.Marshal(c.Env)
	now := NowMs()
	args := []any{c.Name, c.Type, boolInt(c.Temporary), boolInt(c.StoreAsProjectFile), c.RunKind, c.PackagePath,
		string(files), c.Directory, c.OutputDir, boolInt(c.RunAfterBuild), c.WorkingDir, string(env), c.ProgramArgs,
		c.GoToolArgs, boolInt(c.UseBuildTags), c.RedirectInputFrom, boolInt(c.EmulateTerminal), c.TestFramework,
		c.TestPattern}
	if c.ID == "" {
		c.ID = NewID()
		_, err := d.sql.ExecContext(ctx, `INSERT INTO run_configurations (name, type, temporary, store_as_project_file,
			run_kind, package_path, files, directory, output_dir, run_after_build, working_dir, env, program_args,
			go_tool_args, use_build_tags, redirect_input_from, emulate_terminal, test_framework, test_pattern,
			id, project_id, last_used_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			append(args, c.ID, c.ProjectID, now)...)
		if err != nil {
			return c, err
		}
	} else {
		res, err := d.sql.ExecContext(ctx, `UPDATE run_configurations SET name=?, type=?, temporary=?,
			store_as_project_file=?, run_kind=?, package_path=?, files=?, directory=?, output_dir=?, run_after_build=?,
			working_dir=?, env=?, program_args=?, go_tool_args=?, use_build_tags=?, redirect_input_from=?,
			emulate_terminal=?, test_framework=?, test_pattern=?, updated_at=? WHERE id=? AND project_id=?`,
			append(args, now, c.ID, c.ProjectID)...)
		if err != nil {
			return c, err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return c, ErrNotFound
		}
	}
	if err := d.saveTasks(ctx, c.ID, c.BeforeLaunch); err != nil {
		return c, err
	}
	return d.RunConfigByID(ctx, c.ProjectID, c.ID)
}

// saveTasks troca a lista de tarefas da config (a ordem é a posição).
func (d *DB) saveTasks(ctx context.Context, configID string, tasks []BeforeTask) error {
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM before_launch_tasks WHERE run_configuration_id = ?`, configID); err != nil {
		return err
	}
	for i, t := range tasks {
		if _, err := tx.ExecContext(ctx, `INSERT INTO before_launch_tasks (id, run_configuration_id, position, kind,
			ref_run_configuration_id, command) VALUES (?,?,?,?,?,?)`, NewID(), configID, i, t.Kind, t.Ref, t.Command); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// TouchRunConfig marca o uso (mantém as temporárias mais usadas vivas).
func (d *DB) TouchRunConfig(ctx context.Context, projectID, id string) error {
	_, err := d.sql.ExecContext(ctx, `UPDATE run_configurations SET last_used_at = ? WHERE project_id = ? AND id = ?`,
		NowMs(), projectID, id)
	return err
}

// DeleteRunConfig apaga a config.
func (d *DB) DeleteRunConfig(ctx context.Context, projectID, id string) error {
	_, err := d.sql.ExecContext(ctx, `DELETE FROM run_configurations WHERE project_id = ? AND id = ?`, projectID, id)
	return err
}
