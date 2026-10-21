package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

// ErrNotFound indica que a linha pedida não existe (ou não pertence ao projeto).
var ErrNotFound = errors.New("não encontrado")

// ---------------------------------------------------------------- settings

// GetSettings devolve os valores JSON das chaves pedidas. Chaves ausentes ficam de fora.
func (d *DB) GetSettings(ctx context.Context, keys []string) (map[string]json.RawMessage, error) {
	out := make(map[string]json.RawMessage, len(keys))
	for _, k := range keys {
		var v string
		err := d.sql.QueryRowContext(ctx, `SELECT value FROM app_settings WHERE key = ?`, k).Scan(&v)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		out[k] = json.RawMessage(v)
	}
	return out, nil
}

// SetSetting grava um valor JSON válido.
func (d *DB) SetSetting(ctx context.Context, key string, value json.RawMessage) error {
	if !json.Valid(value) {
		return fmt.Errorf("valor de %q não é JSON válido", key)
	}
	_, err := d.sql.ExecContext(ctx, `
		INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		key, string(value), NowMs())
	return err
}

// ---------------------------------------------------------------- go sdks

// GoSdk é um GOROOT conhecido.
type GoSdk struct {
	ID        string `json:"id"`
	Goroot    string `json:"goroot"`
	Version   string `json:"version"`
	Source    string `json:"source"`
	IsDefault bool   `json:"isDefault"`
}

// UpsertSdk registra um GOROOT (idempotente pelo caminho) e devolve a linha atual.
func (d *DB) UpsertSdk(ctx context.Context, goroot, version, source string) (GoSdk, error) {
	_, err := d.sql.ExecContext(ctx, `
		INSERT INTO go_sdks (id, goroot, version, source) VALUES (?, ?, ?, ?)
		ON CONFLICT (goroot) DO UPDATE SET version = excluded.version, updated_at = ?`,
		NewID(), goroot, version, source, NowMs())
	if err != nil {
		return GoSdk{}, err
	}
	var s GoSdk
	var def int
	err = d.sql.QueryRowContext(ctx,
		`SELECT id, goroot, version, source, is_default FROM go_sdks WHERE goroot = ?`, goroot).
		Scan(&s.ID, &s.Goroot, &s.Version, &s.Source, &def)
	s.IsDefault = def == 1
	return s, err
}

// ListSdks lista os SDKs, o padrão primeiro.
func (d *DB) ListSdks(ctx context.Context) ([]GoSdk, error) {
	rows, err := d.sql.QueryContext(ctx,
		`SELECT id, goroot, version, source, is_default FROM go_sdks ORDER BY is_default DESC, version DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []GoSdk{}
	for rows.Next() {
		var s GoSdk
		var def int
		if err := rows.Scan(&s.ID, &s.Goroot, &s.Version, &s.Source, &def); err != nil {
			return nil, err
		}
		s.IsDefault = def == 1
		out = append(out, s)
	}
	return out, rows.Err()
}

// SetDefaultSdk troca o SDK padrão numa transação (o índice único parcial exige um por vez).
func (d *DB) SetDefaultSdk(ctx context.Context, id string) error {
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE go_sdks SET is_default = 0 WHERE is_default = 1`); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `UPDATE go_sdks SET is_default = 1, updated_at = ? WHERE id = ?`, NowMs(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

// SdkByID busca um SDK.
func (d *DB) SdkByID(ctx context.Context, id string) (GoSdk, error) {
	var s GoSdk
	var def int
	err := d.sql.QueryRowContext(ctx,
		`SELECT id, goroot, version, source, is_default FROM go_sdks WHERE id = ?`, id).
		Scan(&s.ID, &s.Goroot, &s.Version, &s.Source, &def)
	if errors.Is(err, sql.ErrNoRows) {
		return s, ErrNotFound
	}
	s.IsDefault = def == 1
	return s, err
}

// ---------------------------------------------------------------- projects

// Project é uma pasta aberta como projeto.
type Project struct {
	ID           string            `json:"id"`
	RootPath     string            `json:"rootPath"`
	Name         string            `json:"name"`
	GoSdkID      *string           `json:"goSdkId"`
	BuildTags    []string          `json:"buildTags"`
	Env          map[string]string `json:"env"`
	Trusted      bool              `json:"trusted"`
	LastOpenedAt *int64            `json:"lastOpenedAt"`
}

const projectCols = `id, root_path, name, go_sdk_id, build_tags, env, trusted, last_opened_at`

func scanProject(sc interface{ Scan(...any) error }) (Project, error) {
	var p Project
	var tags, env string
	var trusted int
	if err := sc.Scan(&p.ID, &p.RootPath, &p.Name, &p.GoSdkID, &tags, &env, &trusted, &p.LastOpenedAt); err != nil {
		return p, err
	}
	p.Trusted = trusted == 1
	if err := json.Unmarshal([]byte(tags), &p.BuildTags); err != nil {
		return p, fmt.Errorf("build_tags corrompido: %w", err)
	}
	if err := json.Unmarshal([]byte(env), &p.Env); err != nil {
		return p, fmt.Errorf("env corrompido: %w", err)
	}
	return p, nil
}

// TouchProject cria o projeto se não existir e marca a abertura agora.
func (d *DB) TouchProject(ctx context.Context, rootPath, name string) (Project, error) {
	now := NowMs()
	_, err := d.sql.ExecContext(ctx, `
		INSERT INTO projects (id, root_path, name, last_opened_at) VALUES (?, ?, ?, ?)
		ON CONFLICT (root_path) DO UPDATE SET last_opened_at = excluded.last_opened_at, updated_at = ?`,
		NewID(), rootPath, name, now, now)
	if err != nil {
		return Project{}, err
	}
	return scanProject(d.sql.QueryRowContext(ctx,
		`SELECT `+projectCols+` FROM projects WHERE root_path = ?`, rootPath))
}

// ProjectByID busca um projeto.
func (d *DB) ProjectByID(ctx context.Context, id string) (Project, error) {
	p, err := scanProject(d.sql.QueryRowContext(ctx, `SELECT `+projectCols+` FROM projects WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, err
}

// RecentProjects lista os projetos abertos alguma vez, mais recentes primeiro.
func (d *DB) RecentProjects(ctx context.Context, limit int) ([]Project, error) {
	rows, err := d.sql.QueryContext(ctx, `SELECT `+projectCols+` FROM projects
		WHERE last_opened_at IS NOT NULL ORDER BY last_opened_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Project{}
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// SetProjectTrusted grava a decisão de confiança.
func (d *DB) SetProjectTrusted(ctx context.Context, id string, trusted bool) error {
	res, err := d.sql.ExecContext(ctx, `UPDATE projects SET trusted = ?, updated_at = ? WHERE id = ?`,
		boolInt(trusted), NowMs(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ForgetRecent tira o projeto da lista de recentes sem apagar configs nem breakpoints.
func (d *DB) ForgetRecent(ctx context.Context, id string) error {
	_, err := d.sql.ExecContext(ctx, `UPDATE projects SET last_opened_at = NULL, updated_at = ? WHERE id = ?`, NowMs(), id)
	return err
}

// ---------------------------------------------------------------- workspaces

// LoadWorkspace devolve o blob de UI do projeto ("{}" se nunca salvo).
func (d *DB) LoadWorkspace(ctx context.Context, projectID string) (json.RawMessage, error) {
	var s string
	err := d.sql.QueryRowContext(ctx, `SELECT state FROM workspaces WHERE project_id = ?`, projectID).Scan(&s)
	if errors.Is(err, sql.ErrNoRows) {
		return json.RawMessage("{}"), nil
	}
	return json.RawMessage(s), err
}

// SaveWorkspace substitui o blob de UI do projeto.
func (d *DB) SaveWorkspace(ctx context.Context, projectID string, state json.RawMessage) error {
	if !json.Valid(state) {
		return errors.New("estado do workspace não é JSON válido")
	}
	_, err := d.sql.ExecContext(ctx, `
		INSERT INTO workspaces (project_id, state, updated_at) VALUES (?, ?, ?)
		ON CONFLICT (project_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
		projectID, string(state), NowMs())
	return err
}
