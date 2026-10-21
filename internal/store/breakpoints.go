package store

import (
	"context"
	"database/sql"
	"errors"
)

// Breakpoint é um breakpoint de linha (ou de panic) persistido por projeto.
type Breakpoint struct {
	ID         string  `json:"id"`
	ProjectID  string  `json:"projectId"`
	Kind       string  `json:"kind"` // line | panic
	FilePath   *string `json:"filePath"`
	Line       *int    `json:"line"`
	Enabled    bool    `json:"enabled"`
	Suspend    bool    `json:"suspend"`
	Condition  *string `json:"condition"`
	LogMessage *string `json:"logMessage"` // texto do log ({expr} interpolado pelo Delve); nil = sem log
}

const bpCols = `id, project_id, kind, file_path, line, enabled, suspend, condition, log_expression`

func scanBreakpoint(sc interface{ Scan(...any) error }) (Breakpoint, error) {
	var b Breakpoint
	var en, su int
	err := sc.Scan(&b.ID, &b.ProjectID, &b.Kind, &b.FilePath, &b.Line, &en, &su, &b.Condition, &b.LogMessage)
	b.Enabled, b.Suspend = en == 1, su == 1
	return b, err
}

// ListBreakpoints devolve os breakpoints do projeto, por arquivo e linha.
func (d *DB) ListBreakpoints(ctx context.Context, projectID string) ([]Breakpoint, error) {
	rows, err := d.sql.QueryContext(ctx, `SELECT `+bpCols+` FROM breakpoints WHERE project_id = ? ORDER BY file_path, line`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Breakpoint{}
	for rows.Next() {
		b, err := scanBreakpoint(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// ToggleLineBreakpoint cria o breakpoint da linha ou apaga o que existir. Devolve se ficou ligado.
func (d *DB) ToggleLineBreakpoint(ctx context.Context, projectID, path string, line int) (bool, error) {
	res, err := d.sql.ExecContext(ctx, `DELETE FROM breakpoints WHERE project_id = ? AND kind = 'line' AND file_path = ? AND line = ?`,
		projectID, path, line)
	if err != nil {
		return false, err
	}
	if n, _ := res.RowsAffected(); n > 0 {
		return false, nil
	}
	_, err = d.sql.ExecContext(ctx, `INSERT INTO breakpoints (id, project_id, kind, file_path, line) VALUES (?, ?, 'line', ?, ?)`,
		NewID(), projectID, path, line)
	return err == nil, err
}

// SetPanicBreakpoint liga ou desliga o breakpoint de panic do projeto (há no máximo um).
func (d *DB) SetPanicBreakpoint(ctx context.Context, projectID string, enabled bool) error {
	res, err := d.sql.ExecContext(ctx, `UPDATE breakpoints SET enabled = ?, updated_at = ? WHERE project_id = ? AND kind = 'panic'`,
		boolInt(enabled), NowMs(), projectID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n > 0 || !enabled {
		return nil
	}
	_, err = d.sql.ExecContext(ctx, `INSERT INTO breakpoints (id, project_id, kind) VALUES (?, ?, 'panic')`, NewID(), projectID)
	return err
}

// UpdateBreakpoint grava condição, log, ligado e suspender.
func (d *DB) UpdateBreakpoint(ctx context.Context, b Breakpoint) error {
	res, err := d.sql.ExecContext(ctx, `UPDATE breakpoints SET enabled = ?, suspend = ?, condition = ?, log_expression = ?,
		log_message = ?, updated_at = ? WHERE id = ? AND project_id = ?`,
		boolInt(b.Enabled), boolInt(b.Suspend), nullIfEmpty(b.Condition), nullIfEmpty(b.LogMessage),
		boolInt(b.LogMessage != nil && *b.LogMessage != ""), NowMs(), b.ID, b.ProjectID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// MoveBreakpoints atualiza as linhas depois de edições no arquivo (o editor acompanha as linhas).
// Breakpoints que colidirem numa mesma linha ficam só um.
func (d *DB) MoveBreakpoints(ctx context.Context, projectID string, moves map[string]int) error {
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for id, line := range moves {
		if line < 1 {
			continue
		}
		_, err := tx.ExecContext(ctx, `UPDATE OR IGNORE breakpoints SET line = ?, updated_at = ? WHERE id = ? AND project_id = ?`,
			line, NowMs(), id, projectID)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

// DeleteBreakpoint apaga um breakpoint.
func (d *DB) DeleteBreakpoint(ctx context.Context, projectID, id string) error {
	_, err := d.sql.ExecContext(ctx, `DELETE FROM breakpoints WHERE project_id = ? AND id = ?`, projectID, id)
	return err
}

// BreakpointByID busca um breakpoint do projeto.
func (d *DB) BreakpointByID(ctx context.Context, projectID, id string) (Breakpoint, error) {
	b, err := scanBreakpoint(d.sql.QueryRowContext(ctx, `SELECT `+bpCols+` FROM breakpoints WHERE project_id = ? AND id = ?`, projectID, id))
	if errors.Is(err, sql.ErrNoRows) {
		return b, ErrNotFound
	}
	return b, err
}

func nullIfEmpty(s *string) *string {
	if s == nil || *s == "" {
		return nil
	}
	return s
}
