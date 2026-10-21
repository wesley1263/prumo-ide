package run

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path"
	"regexp"
	"strings"

	"prumo/internal/store"
	"prumo/internal/workspace"
)

// RunConfigs é o serviço de configurações exposto à UI.
type RunConfigs struct {
	db  *store.DB
	reg *workspace.Registry
}

// NewRunConfigs cria o serviço.
func NewRunConfigs(db *store.DB, reg *workspace.Registry) *RunConfigs {
	return &RunConfigs{db: db, reg: reg}
}

// List devolve as configs do projeto (antes, traz as que estão em .prumo/run).
func (r *RunConfigs) List(projectID string) ([]store.RunConfig, error) {
	o, err := r.reg.Get(projectID)
	if err != nil {
		return nil, err
	}
	r.syncProjectFiles(o)
	return r.db.ListRunConfigs(context.Background(), projectID)
}

// Save cria ou atualiza uma config (recusa a que não passa em Validate).
func (r *RunConfigs) Save(projectID string, cfg store.RunConfig) (store.RunConfig, error) {
	problems, err := r.Validate(projectID, cfg)
	if err != nil {
		return cfg, err
	}
	for _, f := range fieldOrder {
		if msg, ok := problems[f]; ok {
			return cfg, errors.New(msg)
		}
	}
	cfg.ProjectID = projectID
	cfg.Name = strings.TrimSpace(cfg.Name)
	ctx := context.Background()
	var before store.RunConfig
	if cfg.ID != "" {
		before, _ = r.db.RunConfigByID(ctx, projectID, cfg.ID)
	}
	saved, err := r.db.SaveRunConfig(ctx, cfg)
	if err != nil {
		return saved, err
	}
	o, err := r.reg.Get(projectID)
	if err != nil {
		return saved, err
	}
	switch {
	case saved.StoreAsProjectFile:
		if err := r.writeProjectFile(o, saved, before.Name); err != nil {
			return saved, fmt.Errorf("a configuração foi salva, mas não o arquivo do projeto: %w", err)
		}
	case before.StoreAsProjectFile: // desmarcou: o arquivo sai do projeto
		removeProjectFile(o, before.Name)
	}
	return saved, nil
}

// fieldOrder é a ordem dos campos no formulário (o primeiro erro é o que o Save devolve).
var fieldOrder = []string{"name", "type", "runKind", "packagePath", "files", "directory", "outputDir", "workingDir", "env", "programArgs", "goToolArgs", "testPattern", "redirectInputFrom", "beforeLaunch"}

var envKeyRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// Validate confere a config campo a campo (chave = campo do formulário, valor = o que dizer ao usuário).
// Caminhos são relativos ao projeto e precisam existir: a config errada falharia só na hora de rodar.
func (r *RunConfigs) Validate(projectID string, cfg store.RunConfig) (map[string]string, error) {
	o, err := r.reg.Get(projectID)
	if err != nil {
		return nil, err
	}
	p := map[string]string{}
	name := strings.TrimSpace(cfg.Name)
	if name == "" {
		p["name"] = "Dê um nome à configuração."
	} else if existing, err := r.db.RunConfigByName(context.Background(), projectID, name); err == nil && existing.ID != cfg.ID {
		p["name"] = "Já existe uma configuração com esse nome."
	}
	if cfg.Type != "go_build" && cfg.Type != "go_test" {
		p["type"] = "Tipo desconhecido."
	}
	exists := func(rel string, dir bool) bool {
		abs, err := o.Abs(rel)
		if err != nil {
			return false
		}
		st, err := os.Stat(abs)
		return err == nil && st.IsDir() == dir
	}
	switch cfg.RunKind {
	case "package":
		if cfg.PackagePath == nil || strings.TrimSpace(*cfg.PackagePath) == "" {
			p["packagePath"] = "Informe o pacote (ex.: ./cmd/shop ou example.com/app/cmd/shop)."
		} else if strings.ContainsAny(*cfg.PackagePath, " \t") {
			p["packagePath"] = "O caminho do pacote não pode ter espaços."
		}
	case "file":
		if len(cfg.Files) == 0 {
			p["files"] = "Escolha pelo menos um arquivo .go."
		}
		for _, f := range cfg.Files {
			if !strings.HasSuffix(f, ".go") || !exists(f, false) {
				p["files"] = fmt.Sprintf("Arquivo não encontrado no projeto: %s", f)
				break
			}
		}
	case "directory":
		if cfg.Directory != nil && *cfg.Directory != "" && !exists(*cfg.Directory, true) {
			p["directory"] = "Pasta não encontrada no projeto."
		}
	default:
		p["runKind"] = "Escolha o que rodar: pacote, arquivo ou pasta."
	}
	if cfg.WorkingDir != nil && *cfg.WorkingDir != "" && !exists(*cfg.WorkingDir, true) {
		p["workingDir"] = "Pasta não encontrada no projeto."
	}
	if cfg.OutputDir != nil && *cfg.OutputDir != "" {
		if _, err := o.Abs(*cfg.OutputDir); err != nil {
			p["outputDir"] = "A pasta de saída precisa ficar dentro do projeto."
		}
	}
	if cfg.RedirectInputFrom != nil && *cfg.RedirectInputFrom != "" && !exists(*cfg.RedirectInputFrom, false) {
		p["redirectInputFrom"] = "Arquivo não encontrado no projeto."
	}
	for k := range cfg.Env {
		if !envKeyRe.MatchString(k) {
			p["env"] = fmt.Sprintf("Nome de variável inválido: %q (letras, números e _, sem começar por número).", k)
			break
		}
	}
	if _, err := SplitArgs(cfg.ProgramArgs); err != nil {
		p["programArgs"] = "Aspas sem fechar nos argumentos."
	}
	if msg := r.checkTasks(projectID, cfg); msg != "" {
		p["beforeLaunch"] = msg
	}
	if _, err := SplitArgs(cfg.GoToolArgs); err != nil {
		p["goToolArgs"] = "Aspas sem fechar nos argumentos."
	}
	if cfg.Type == "go_test" && cfg.TestPattern != nil && *cfg.TestPattern != "" {
		// O go test separa o padrão em "/" e compila cada nível como regex.
		for _, part := range strings.Split(*cfg.TestPattern, "/") {
			if _, err := regexp.Compile(part); err != nil {
				p["testPattern"] = "Expressão regular inválida: " + part
				break
			}
		}
	}
	return p, nil
}

// checkTasks confere as tarefas antes de rodar: tipos, comandos e que uma config não acabe chamando a si mesma.
func (r *RunConfigs) checkTasks(projectID string, cfg store.RunConfig) string {
	ctx := context.Background()
	for i, t := range cfg.BeforeLaunch {
		n := i + 1
		switch t.Kind {
		case "go_generate":
		case "external_tool":
			if t.Command == nil || strings.TrimSpace(*t.Command) == "" {
				return fmt.Sprintf("Tarefa %d: informe o comando.", n)
			}
			if args, err := SplitArgs(*t.Command); err != nil || len(args) == 0 {
				return fmt.Sprintf("Tarefa %d: aspas sem fechar no comando.", n)
			}
		case "run_config":
			if t.Ref == nil || *t.Ref == "" {
				return fmt.Sprintf("Tarefa %d: escolha a configuração.", n)
			}
			if cfg.ID != "" && *t.Ref == cfg.ID {
				return fmt.Sprintf("Tarefa %d: a configuração não pode rodar a si mesma.", n)
			}
			ref, err := r.db.RunConfigByID(ctx, projectID, *t.Ref)
			if err != nil {
				return fmt.Sprintf("Tarefa %d: configuração não encontrada.", n)
			}
			// Ciclo: a outra (ou uma que ela roda antes) volta para esta.
			seen := map[string]bool{}
			var walk func(c store.RunConfig) bool
			walk = func(c store.RunConfig) bool {
				if c.ID == cfg.ID {
					return true
				}
				if seen[c.ID] { // já visitada por outro caminho (diamante): não é ciclo
					return false
				}
				seen[c.ID] = true
				for _, tt := range c.BeforeLaunch {
					if tt.Kind != "run_config" || tt.Ref == nil {
						continue
					}
					if next, err := r.db.RunConfigByID(ctx, projectID, *tt.Ref); err == nil && walk(next) {
						return true
					}
				}
				return false
			}
			if cfg.ID != "" && walk(ref) {
				return fmt.Sprintf("Tarefa %d: %s acaba rodando esta configuração de novo (ciclo).", n, ref.Name)
			}
		default:
			return fmt.Sprintf("Tarefa %d: tipo desconhecido.", n)
		}
	}
	return ""
}

// Delete apaga uma config.
func (r *RunConfigs) Delete(projectID, id string) error {
	o, err := r.reg.Get(projectID)
	if err != nil {
		return err
	}
	if c, err := r.db.RunConfigByID(context.Background(), projectID, id); err == nil && c.StoreAsProjectFile {
		removeProjectFile(o, c.Name)
	}
	return r.db.DeleteRunConfig(context.Background(), projectID, id)
}

// FromContext devolve a config temporária para o ▶ do gutter:
//   - testName vazio num arquivo comum: compila e roda o pacote (go build);
//   - testName vazio num _test.go: todos os testes do pacote (go test);
//   - testName preenchido: só esse teste (go test -run '^Nome$').
//
// Reaproveita a config se já existir uma com o mesmo nome.
func (r *RunConfigs) FromContext(projectID, filePath, testName string) (store.RunConfig, error) {
	o, err := r.reg.Get(projectID)
	if err != nil {
		return store.RunConfig{}, err
	}
	if _, err := o.Abs(filePath); err != nil {
		return store.RunConfig{}, err
	}
	dir := path.Dir(filePath)
	if dir == "." {
		dir = ""
	}
	label := o.Name
	if dir != "" {
		label = dir
	}
	cfg := store.RunConfig{
		ProjectID: projectID, Type: "go_build", Temporary: true,
		RunKind: "directory", Directory: &dir, RunAfterBuild: true, UseBuildTags: true,
	}
	switch {
	case testName != "":
		if !testNameRe.MatchString(testName) {
			return store.RunConfig{}, errors.New("nome de teste inválido")
		}
		pattern := TestPattern(testName)
		fw := "gotest"
		cfg.Type, cfg.Name, cfg.TestPattern, cfg.TestFramework = "go_test", "go test "+testName+" ("+label+")", &pattern, &fw
	case strings.HasSuffix(filePath, "_test.go"):
		fw := "gotest"
		cfg.Type, cfg.Name, cfg.TestFramework = "go_test", "go test "+label, &fw
	default:
		cfg.Name = "go build " + label
	}
	ctx := context.Background()
	if existing, err := r.db.RunConfigByName(ctx, projectID, cfg.Name); err == nil {
		_ = r.db.TouchRunConfig(ctx, projectID, existing.ID)
		return existing, nil
	} else if !errors.Is(err, store.ErrNotFound) {
		return store.RunConfig{}, err
	}
	return r.db.SaveRunConfig(ctx, cfg)
}

// TestPattern monta o -run de um teste ou subteste: o go test separa o padrão em "/" e casa cada nível
// à parte, então cada parte é ancorada sozinha ("TestA/caso 1" vira "^TestA$/^caso_1$").
func TestPattern(name string) string {
	parts := strings.Split(name, "/")
	for i, p := range parts {
		parts[i] = "^" + regexp.QuoteMeta(strings.ReplaceAll(p, " ", "_")) + "$"
	}
	return strings.Join(parts, "/")
}

// testNameRe aceita TestX, BenchmarkX, FuzzX e ExampleX (e subtestes com /).
var testNameRe = regexp.MustCompile(`^(Test|Benchmark|Fuzz|Example)[A-Za-z0-9_]*(/[^\s]+)?$`)
