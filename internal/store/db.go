// Package store guarda o estado local da IDE num arquivo SQLite.
//
// O git, o gopls e o disco são a fonte da verdade do que mostram; aqui fica só o que
// nenhum deles guarda: projetos recentes, configs de run, breakpoints, preferências.
package store

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

// DB é a conexão com o banco local. Seguro para uso concorrente.
type DB struct {
	sql *sql.DB
}

// Open abre (ou cria) o banco em path e aplica as migrações pendentes.
// Use ":memory:" em testes.
func Open(ctx context.Context, path string) (*DB, error) {
	dsn := "file::memory:?cache=shared"
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return nil, fmt.Errorf("criar diretório do banco: %w", err)
		}
		dsn = "file:" + path
	}
	dsn += sep(dsn) + "_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)"

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("abrir banco: %w", err)
	}
	if path == ":memory:" {
		// Banco em memória some quando a última conexão fecha.
		db.SetMaxOpenConns(1)
	}
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("conectar ao banco: %w", err)
	}
	if path != ":memory:" {
		_ = os.Chmod(path, 0o600)
	}
	d := &DB{sql: db}
	if err := d.migrate(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return d, nil
}

// Close fecha a conexão.
func (d *DB) Close() error { return d.sql.Close() }

func sep(dsn string) string {
	if strings.Contains(dsn, "?") {
		return "&"
	}
	return "?"
}

// migrate aplica, em ordem, os arquivos NNNN_*.sql com número maior que PRAGMA user_version.
func (d *DB) migrate(ctx context.Context) error {
	var current int
	if err := d.sql.QueryRowContext(ctx, "PRAGMA user_version").Scan(&current); err != nil {
		return fmt.Errorf("ler versão do schema: %w", err)
	}
	entries, err := fs.ReadDir(migrations, "migrations")
	if err != nil {
		return err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, e := range entries {
		num, err := strconv.Atoi(strings.SplitN(e.Name(), "_", 2)[0])
		if err != nil {
			return fmt.Errorf("migração com nome inválido: %s", e.Name())
		}
		if num <= current {
			continue
		}
		body, err := migrations.ReadFile("migrations/" + e.Name())
		if err != nil {
			return err
		}
		tx, err := d.sql.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, string(body)); err != nil {
			tx.Rollback()
			return fmt.Errorf("migração %s: %w", e.Name(), err)
		}
		if _, err := tx.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", num)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

// NewID gera um UUID v7 (ordenável pelo tempo de criação).
func NewID() string { return uuid.Must(uuid.NewV7()).String() }

// NowMs é o instante atual em Unix ms UTC, o formato de todas as colunas *_at.
func NowMs() int64 { return time.Now().UnixMilli() }

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
