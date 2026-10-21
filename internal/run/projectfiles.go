package run

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"prumo/internal/store"
	"prumo/internal/workspace"
)

// Configs como arquivo do projeto: com "Guardar como arquivo do projeto", a config vive também em
// .prumo/run/<nome>.json, para ir pelo git. O arquivo manda: ao listar, o que veio pelo git (novo ou mudado)
// entra no banco. Ids não vão para o arquivo; "outra configuração" antes de rodar vai pelo nome.

const projectRunDir = ".prumo/run"

// legacyRunDir: onde ficavam antes da troca de nome. Continua sendo lida (está no git do usuário: não é
// renomeada sozinha); as gravações vão para .prumo/run.
const legacyRunDir = ".goide/run"

// fileConfig é o formato do arquivo (sem id, projeto, uso e temporária).
type fileConfig struct {
	Name              string            `json:"name"`
	Type              string            `json:"type"`
	RunKind           string            `json:"runKind"`
	PackagePath       *string           `json:"packagePath,omitempty"`
	Files             []string          `json:"files,omitempty"`
	Directory         *string           `json:"directory,omitempty"`
	OutputDir         *string           `json:"outputDir,omitempty"`
	RunAfterBuild     bool              `json:"runAfterBuild"`
	WorkingDir        *string           `json:"workingDir,omitempty"`
	Env               map[string]string `json:"env,omitempty"`
	ProgramArgs       string            `json:"programArgs,omitempty"`
	GoToolArgs        string            `json:"goToolArgs,omitempty"`
	UseBuildTags      bool              `json:"useBuildTags"`
	RedirectInputFrom *string           `json:"redirectInputFrom,omitempty"`
	EmulateTerminal   bool              `json:"emulateTerminal,omitempty"`
	TestFramework     *string           `json:"testFramework,omitempty"`
	TestPattern       *string           `json:"testPattern,omitempty"`
	BeforeLaunch      []fileTask        `json:"beforeLaunch,omitempty"`
}

type fileTask struct {
	Kind    string  `json:"kind"`
	Config  *string `json:"config,omitempty"` // run_config: nome da outra config
	Command *string `json:"command,omitempty"`
}

var unsafeName = regexp.MustCompile(`[^\p{L}\p{N}._ -]+`)

func configFileName(name string) string {
	n := strings.Trim(unsafeName.ReplaceAllString(name, "_"), " .")
	if n == "" {
		n = "config"
	}
	return n + ".json"
}

func runDir(o *workspace.Open) string {
	return filepath.Join(o.RootPath, filepath.FromSlash(projectRunDir))
}

// writeProjectFile grava a config no arquivo; oldName != name apaga o arquivo do nome antigo.
func (r *RunConfigs) writeProjectFile(o *workspace.Open, c store.RunConfig, oldName string) error {
	ctx := context.Background()
	f := fileConfig{
		Name: c.Name, Type: c.Type, RunKind: c.RunKind, PackagePath: c.PackagePath, Files: c.Files, Directory: c.Directory,
		OutputDir: c.OutputDir, RunAfterBuild: c.RunAfterBuild, WorkingDir: c.WorkingDir, Env: c.Env, ProgramArgs: c.ProgramArgs,
		GoToolArgs: c.GoToolArgs, UseBuildTags: c.UseBuildTags, RedirectInputFrom: c.RedirectInputFrom,
		EmulateTerminal: c.EmulateTerminal, TestFramework: c.TestFramework, TestPattern: c.TestPattern,
	}
	if len(f.Env) == 0 {
		f.Env = nil
	}
	for _, t := range c.BeforeLaunch {
		ft := fileTask{Kind: t.Kind, Command: t.Command}
		if t.Kind == "run_config" && t.Ref != nil {
			if ref, err := r.db.RunConfigByID(ctx, c.ProjectID, *t.Ref); err == nil {
				ft.Config = &ref.Name
			}
		}
		f.BeforeLaunch = append(f.BeforeLaunch, ft)
	}
	b, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(runDir(o), 0o755); err != nil {
		return err
	}
	if oldName != "" && configFileName(oldName) != configFileName(c.Name) {
		_ = os.Remove(filepath.Join(runDir(o), configFileName(oldName)))
	}
	return os.WriteFile(filepath.Join(runDir(o), configFileName(c.Name)), append(b, '\n'), 0o644)
}

func removeProjectFile(o *workspace.Open, name string) {
	_ = os.Remove(filepath.Join(runDir(o), configFileName(name)))
}

// syncProjectFiles traz para o banco as configs dos arquivos (novas ou mudadas pelo git).
// Arquivos inválidos ficam de fora e vão na lista de problemas, sem impedir as outras.
func (r *RunConfigs) syncProjectFiles(o *workspace.Open) []string {
	type entry struct{ dir, name string }
	var entries []entry
	seen := map[string]bool{}
	for _, dir := range []string{runDir(o), filepath.Join(o.RootPath, filepath.FromSlash(legacyRunDir))} {
		list, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range list {
			if !seen[e.Name()] { // a pasta nova manda quando as duas têm o mesmo arquivo
				seen[e.Name()] = true
				entries = append(entries, entry{dir, e.Name()})
			}
		}
	}
	if len(entries) == 0 {
		return nil
	}
	ctx := context.Background()
	var problems []string
	var files []fileConfig
	for _, e := range entries {
		if !strings.HasSuffix(e.name, ".json") {
			continue
		}
		if st, err := os.Stat(filepath.Join(e.dir, e.name)); err != nil || st.IsDir() {
			continue
		}
		b, err := os.ReadFile(filepath.Join(e.dir, e.name))
		var f fileConfig
		if err == nil {
			err = json.Unmarshal(b, &f)
		}
		if err != nil || strings.TrimSpace(f.Name) == "" {
			problems = append(problems, e.name+": arquivo inválido")
			continue
		}
		files = append(files, f)
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Name < files[j].Name })
	// Duas passadas: primeiro as configs, depois as tarefas (que apontam para outras pelo nome).
	ids := map[string]string{}
	for _, f := range files {
		c := store.RunConfig{ProjectID: o.ID, StoreAsProjectFile: true}
		existing, err := r.db.RunConfigByName(ctx, o.ID, f.Name)
		if err == nil {
			c = existing
		} else if !errors.Is(err, store.ErrNotFound) {
			problems = append(problems, f.Name+": "+err.Error())
			continue
		}
		next := c
		next.Name, next.Type, next.RunKind, next.PackagePath, next.Files, next.Directory = f.Name, f.Type, f.RunKind, f.PackagePath, f.Files, f.Directory
		next.OutputDir, next.RunAfterBuild, next.WorkingDir, next.Env, next.ProgramArgs = f.OutputDir, f.RunAfterBuild, f.WorkingDir, f.Env, f.ProgramArgs
		next.GoToolArgs, next.UseBuildTags, next.RedirectInputFrom = f.GoToolArgs, f.UseBuildTags, f.RedirectInputFrom
		next.EmulateTerminal, next.TestFramework, next.TestPattern = f.EmulateTerminal, f.TestFramework, f.TestPattern
		next.StoreAsProjectFile, next.Temporary = true, false
		if next.Files == nil {
			next.Files = []string{}
		}
		if next.Env == nil {
			next.Env = map[string]string{}
		}
		if c.ID != "" && sameConfig(c, next) {
			ids[f.Name] = c.ID
			continue
		}
		if p, err := r.Validate(o.ID, next); err == nil {
			if msg := firstProblem(p, "beforeLaunch"); msg != "" {
				problems = append(problems, f.Name+": "+msg)
				continue
			}
		}
		saved, err := r.db.SaveRunConfig(ctx, next)
		if err != nil {
			problems = append(problems, f.Name+": "+err.Error())
			continue
		}
		ids[f.Name] = saved.ID
	}
	for _, f := range files {
		id, ok := ids[f.Name]
		if !ok {
			continue
		}
		c, err := r.db.RunConfigByID(ctx, o.ID, id)
		if err != nil {
			continue
		}
		var tasks []store.BeforeTask
		for _, t := range f.BeforeLaunch {
			bt := store.BeforeTask{Kind: t.Kind, Command: t.Command}
			if t.Kind == "run_config" {
				ref, ok := ids[deref(t.Config)]
				if !ok {
					if other, err := r.db.RunConfigByName(ctx, o.ID, deref(t.Config)); err == nil {
						ref, ok = other.ID, true
					}
				}
				if !ok {
					problems = append(problems, f.Name+": a configuração "+deref(t.Config)+" não existe")
					continue
				}
				bt.Ref = &ref
			}
			tasks = append(tasks, bt)
		}
		if tasksEqual(c.BeforeLaunch, tasks) {
			continue
		}
		c.BeforeLaunch = tasks
		if msg := r.checkTasks(o.ID, c); msg != "" {
			problems = append(problems, f.Name+": "+msg)
			continue
		}
		_, _ = r.db.SaveRunConfig(ctx, c)
	}
	return problems
}

func firstProblem(p map[string]string, skip string) string {
	for _, f := range fieldOrder {
		if msg, ok := p[f]; ok && f != skip && f != "name" {
			return msg
		}
	}
	return ""
}

// sameConfig compara só o que vem do arquivo (sem as tarefas, comparadas à parte).
func sameConfig(a, b store.RunConfig) bool {
	a.BeforeLaunch, b.BeforeLaunch, a.LastUsedAt, b.LastUsedAt = nil, nil, nil, nil
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	return string(ja) == string(jb)
}

func tasksEqual(a, b []store.BeforeTask) bool {
	if len(a) == 0 && len(b) == 0 {
		return true
	}
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	return string(ja) == string(jb)
}
