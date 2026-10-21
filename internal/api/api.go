// Package api é a superfície que a UI enxerga: cada struct vira um serviço ("Projects.Open").
//
// O Wails faz binding de todo método exportado destas structs; o modo dev expõe os mesmos
// métodos por HTTP. Por isso aqui só entram métodos que a UI deve poder chamar.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync/atomic"

	"goide/internal/bridge"
	"goide/internal/debug"
	"goide/internal/events"
	"goide/internal/files"
	"goide/internal/gitx"
	"goide/internal/lsp"
	"goide/internal/run"
	"goide/internal/sdk"
	"goide/internal/search"
	"goide/internal/store"
	"goide/internal/term"
	"goide/internal/tools"
	"goide/internal/workspace"
)

// Core reúne as peças do backend. Montado por internal/app.
type Core struct {
	DB      *store.DB
	Bus     *events.Bus
	Reg     *workspace.Registry
	Tools   *tools.Finder
	Hub     *lsp.Hub
	Runs    *run.Manager
	Debug   *debug.Manager
	RunCfgs *run.RunConfigs
	Files   *files.Files
	Git     *gitx.Git
	Sdks    *sdk.Sdks
	Search  *search.Service
	Terms   *term.Manager
	Bridge  *bridge.Server
	Dev     bool
	// PickDir abre o seletor nativo de pasta. No modo dev não existe: a UI pede o caminho por texto.
	PickDir func(title string) (string, error)
	// QuitApp fecha o app de verdade (runtime.Quit). Nil no modo dev.
	QuitApp func()

	dirty atomic.Bool
}

// HasUnsaved diz se a UI avisou que há arquivos com alterações não salvas.
func (c *Core) HasUnsaved() bool { return c.dirty.Load() }

// Services devolve as fachadas com o nome que a UI usa.
func (c *Core) Services() map[string]any {
	return map[string]any{
		"App":         &App{c},
		"Projects":    &Projects{c},
		"Dialogs":     &Dialogs{c},
		"Workspace":   &Workspace{c},
		"Settings":    &Settings{c},
		"Sdks":        &Sdks{c},
		"Tools":       &Tools{c},
		"Files":       &Files{c},
		"Git":         &Git{c},
		"RunConfigs":  &RunConfigs{c},
		"Runs":        &Runs{c},
		"Debug":       &Debug{c},
		"Tests":       &Tests{c},
		"Breakpoints": &Breakpoints{c},
		"Search":      &Search{c},
		"Terminal":    &Terminal{c},
	}
}

// ---------------------------------------------------------------- App

// App: estado inicial.
type App struct{ c *Core }

// RecentProject é um projeto recente e se a pasta ainda existe.
type RecentProject struct {
	store.Project
	Exists bool `json:"exists"`
}

// Bootstrap é tudo que a UI precisa para desenhar a primeira tela.
type Bootstrap struct {
	BridgePort  int                        `json:"bridgePort"`
	BridgeToken string                     `json:"bridgeToken"`
	Dev         bool                       `json:"dev"`
	Platform    string                     `json:"platform"`
	Settings    map[string]json.RawMessage `json:"settings"`
	Recent      []RecentProject            `json:"recent"`
	Sdks        []store.GoSdk              `json:"sdks"`
	Tools       tools.Status               `json:"tools"`
	HomeDir     string                     `json:"homeDir"`
}

// Bootstrap monta o estado inicial. Na primeira vez detecta os Go SDKs.
func (a *App) Bootstrap() (Bootstrap, error) {
	ctx := context.Background()
	sdks, err := a.c.DB.ListSdks(ctx)
	if err != nil {
		return Bootstrap{}, err
	}
	if len(sdks) == 0 {
		if sdks, err = a.c.Sdks.Detect(); err != nil {
			return Bootstrap{}, err
		}
	}
	settings, err := a.c.DB.GetSettings(ctx, SettingKeys())
	if err != nil {
		return Bootstrap{}, err
	}
	recent, err := (&Projects{a.c}).ListRecent()
	if err != nil {
		return Bootstrap{}, err
	}
	home, _ := os.UserHomeDir()
	return Bootstrap{
		BridgePort: a.c.Bridge.Port(), BridgeToken: a.c.Bridge.Token(), Dev: a.c.Dev, Platform: runtime.GOOS,
		Settings: settings, Recent: recent, Sdks: sdks, Tools: a.c.Tools.Status(ctx), HomeDir: home,
	}, nil
}

// SetDirty é chamado pela UI sempre que muda o "há algo não salvo". O fechamento da janela consulta.
func (a *App) SetDirty(dirty bool) { a.c.dirty.Store(dirty) }

// Quit fecha o app depois que a UI salvou tudo (resposta a events.BeforeClose).
func (a *App) Quit() {
	a.c.dirty.Store(false)
	if a.c.QuitApp != nil {
		a.c.QuitApp()
	}
}

// ---------------------------------------------------------------- Projects

// Projects: abrir, fechar, confiar.
type Projects struct{ c *Core }

// ListRecent devolve os recentes, marcando pastas que sumiram.
func (p *Projects) ListRecent() ([]RecentProject, error) {
	list, err := p.c.DB.RecentProjects(context.Background(), 30)
	if err != nil {
		return nil, err
	}
	out := make([]RecentProject, 0, len(list))
	for _, pr := range list {
		st, err := os.Stat(pr.RootPath)
		out = append(out, RecentProject{Project: pr, Exists: err == nil && st.IsDir()})
	}
	return out, nil
}

// OpenResult é o projeto aberto e se a UI precisa perguntar sobre confiança.
type OpenResult struct {
	Project    *workspace.Open `json:"project"`
	NeedsTrust bool            `json:"needsTrust"`
}

// Open abre uma pasta como projeto.
func (p *Projects) Open(path string) (OpenResult, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return OpenResult{}, errors.New("informe uma pasta")
	}
	if strings.HasPrefix(path, "~") {
		if home, err := os.UserHomeDir(); err == nil {
			path = filepath.Join(home, strings.TrimPrefix(path, "~"))
		}
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return OpenResult{}, err
	}
	if real, err := filepath.EvalSymlinks(abs); err == nil {
		abs = real
	}
	st, err := os.Stat(abs)
	if err != nil {
		return OpenResult{}, fmt.Errorf("pasta não encontrada: %s", abs)
	}
	if !st.IsDir() {
		return OpenResult{}, fmt.Errorf("não é uma pasta: %s", abs)
	}
	ctx := context.Background()
	pr, err := p.c.DB.TouchProject(ctx, abs, filepath.Base(abs))
	if err != nil {
		return OpenResult{}, err
	}
	if o, err := p.c.Reg.Get(pr.ID); err == nil {
		return OpenResult{Project: o, NeedsTrust: !o.Trusted}, nil
	}
	o, err := p.c.Reg.Add(ctx, pr)
	if err != nil {
		return OpenResult{}, err
	}
	return OpenResult{Project: o, NeedsTrust: !o.Trusted}, nil
}

// SetTrusted grava a confiança. Sem ela não sobe gopls nem roda código do projeto.
func (p *Projects) SetTrusted(projectID string, trusted bool) (*workspace.Open, error) {
	if err := p.c.DB.SetProjectTrusted(context.Background(), projectID, trusted); err != nil {
		return nil, err
	}
	p.c.Reg.SetTrusted(projectID, trusted)
	return p.c.Reg.Get(projectID)
}

// Close fecha o projeto: para o gopls e as execuções dele.
func (p *Projects) Close(projectID string) error {
	p.c.Reg.Remove(projectID)
	return nil
}

// RemoveRecent tira o projeto da lista de recentes.
func (p *Projects) RemoveRecent(projectID string) error {
	return p.c.DB.ForgetRecent(context.Background(), projectID)
}

// ---------------------------------------------------------------- Dialogs

// Dialogs: diálogos nativos.
type Dialogs struct{ c *Core }

// ErrNoNativeDialog: sem janela nativa (modo dev no navegador).
var ErrNoNativeDialog = errors.New("seletor nativo indisponível")

// PickDirectory abre o seletor de pasta. Devolve "" se o usuário cancelar.
func (d *Dialogs) PickDirectory(title string) (string, error) {
	if d.c.PickDir == nil {
		return "", ErrNoNativeDialog
	}
	return d.c.PickDir(title)
}

// ---------------------------------------------------------------- Workspace e Settings

// Workspace: abas e layout por projeto.
type Workspace struct{ c *Core }

// Load devolve o estado salvo da UI do projeto.
func (w *Workspace) Load(projectID string) (json.RawMessage, error) {
	if _, err := w.c.Reg.Get(projectID); err != nil {
		return nil, err
	}
	return w.c.DB.LoadWorkspace(context.Background(), projectID)
}

// Save grava o estado da UI do projeto.
func (w *Workspace) Save(projectID string, state json.RawMessage) error {
	if _, err := w.c.Reg.Get(projectID); err != nil {
		return err
	}
	return w.c.DB.SaveWorkspace(context.Background(), projectID, state)
}

// Settings: preferências globais.
type Settings struct{ c *Core }

// Get devolve os valores das chaves pedidas.
func (s *Settings) Get(keys []string) (map[string]json.RawMessage, error) {
	return s.c.DB.GetSettings(context.Background(), keys)
}

// Set grava um valor (JSON). Só chaves conhecidas e com o tipo certo: o banco não vira depósito de lixo.
func (s *Settings) Set(key string, value json.RawMessage) error {
	if err := validateSetting(key, value); err != nil {
		return err
	}
	return s.c.DB.SetSetting(context.Background(), key, value)
}

// settingRules são as configurações da IDE (S28) e como validar cada uma.
var settingRules = map[string]func(raw json.RawMessage) error{
	"appearance.theme": func(raw json.RawMessage) error {
		var v string
		if json.Unmarshal(raw, &v) != nil || (v != "dark" && v != "light") {
			return errors.New(`tema deve ser "dark" ou "light"`)
		}
		return nil
	},
	"appearance.language": func(raw json.RawMessage) error {
		var v string
		if json.Unmarshal(raw, &v) != nil || (v != "system" && v != "pt-BR" && v != "en") {
			return errors.New(`idioma deve ser "system", "pt-BR" ou "en"`)
		}
		return nil
	},
	"editor.fontSize": func(raw json.RawMessage) error {
		var v float64
		if json.Unmarshal(raw, &v) != nil || v != float64(int(v)) || v < 9 || v > 32 {
			return errors.New("tamanho da fonte deve ser um inteiro entre 9 e 32")
		}
		return nil
	},
	"editor.formatOnSave": isBool,
	"editor.inlayHints":   isBool,
	"commit.format":       isBool,
	"keymap.overrides": func(raw json.RawMessage) error {
		var v map[string]string
		if json.Unmarshal(raw, &v) != nil {
			return errors.New("atalhos: esperado um objeto ação → teclas")
		}
		for id, keys := range v {
			if id == "" || len(id) > 80 || len(keys) > 40 || strings.ContainsAny(keys, " \t\n") {
				return fmt.Errorf("atalho inválido para %q", id)
			}
		}
		return nil
	},
	"commit.vet":   isBool,
	"commit.tests": isBool,
	"terminal.shell": func(raw json.RawMessage) error {
		var v string
		if json.Unmarshal(raw, &v) != nil {
			return errors.New("shell deve ser texto")
		}
		if v == "" {
			return nil // padrão: $SHELL
		}
		if _, err := exec.LookPath(v); err != nil {
			return fmt.Errorf("shell não encontrado: %s", v)
		}
		return nil
	},
}

func isBool(raw json.RawMessage) error {
	var v bool
	if json.Unmarshal(raw, &v) != nil {
		return errors.New("valor deve ser verdadeiro ou falso")
	}
	return nil
}

// SettingKeys são as chaves que a UI carrega no início.
func SettingKeys() []string {
	keys := make([]string, 0, len(settingRules))
	for k := range settingRules {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func validateSetting(key string, raw json.RawMessage) error {
	rule, ok := settingRules[key]
	if !ok {
		return fmt.Errorf("configuração desconhecida: %s", key)
	}
	return rule(raw)
}

// ---------------------------------------------------------------- Sdks e Tools

// Sdks: Go SDKs.
type Sdks struct{ c *Core }

// List devolve os SDKs conhecidos.
func (s *Sdks) List() ([]store.GoSdk, error) { return s.c.Sdks.List() }

// Detect procura SDKs na máquina.
func (s *Sdks) Detect() ([]store.GoSdk, error) { return s.c.Sdks.Detect() }

// SetDefault troca o SDK padrão.
func (s *Sdks) SetDefault(id string) error { return s.c.Sdks.SetDefault(id) }

// Available lista as versões do go.dev para este sistema.
func (s *Sdks) Available() ([]sdk.Release, error) { return s.c.Sdks.Available() }

// Download baixa e instala uma versão em ~/sdk (o andamento vem por DownloadStatus).
func (s *Sdks) Download(version string) (sdk.DownloadState, error) { return s.c.Sdks.Download(version) }

// DownloadStatus é o andamento de um download.
func (s *Sdks) DownloadStatus(version string) (sdk.DownloadState, error) {
	return s.c.Sdks.DownloadStatus(version)
}

// Tools: ferramentas externas.
type Tools struct{ c *Core }

// Status localiza go, git, gopls, dlv e rg.
func (t *Tools) Status() tools.Status { return t.c.Tools.Status(context.Background()) }

// Install instala gopls ou dlv na versão fixada e devolve a saída do go install.
func (t *Tools) Install(name string) (string, error) {
	module := map[string]string{"gopls": tools.GoplsModule, "dlv": tools.DlvModule}[name]
	if module == "" {
		return "", fmt.Errorf("a IDE não instala %q", name)
	}
	out, err := t.c.Tools.Install(context.Background(), module)
	t.c.Bus.Emit(events.ToolsStatus, t.c.Tools.Status(context.Background()))
	return string(out), err
}

// ---------------------------------------------------------------- Files

// Files: árvore e conteúdo.
type Files struct{ c *Core }

// Tree lista os filhos de uma pasta do projeto ("" = raiz).
func (f *Files) Tree(projectID, dir string) ([]files.Node, error) {
	return f.c.Files.Tree(projectID, dir)
}

// Read lê um arquivo.
func (f *Files) Read(projectID, path string) (files.FileContent, error) {
	return f.c.Files.Read(projectID, path)
}

// ReadExternal lê só para leitura um arquivo do Go SDK ou do cache de módulos (ir para definição na stdlib).
func (f *Files) ReadExternal(projectID, absPath string) (files.FileContent, error) {
	o, err := f.c.Reg.Get(projectID)
	if err != nil {
		return files.FileContent{}, err
	}
	return f.c.Files.ReadExternal(projectID, absPath, f.c.Tools.GoRoots(o.GoEnv(nil)))
}

// Write grava um arquivo se ele não mudou no disco desde expectedMtime (0 = arquivo novo).
func (f *Files) Write(projectID, path, content string, expectedMtime int64) (files.WriteResult, error) {
	res, err := f.c.Files.Write(projectID, path, content, expectedMtime)
	if err == nil && !res.Conflict {
		f.c.Bus.Emit(events.GitStatus, map[string]string{"projectId": projectID})
	}
	return res, err
}

// ---------------------------------------------------------------- Git

// Git: status, commit e diff.
type Git struct{ c *Core }

// Status lê o estado do repositório do projeto.
func (g *Git) Status(projectID string) (gitx.RepoStatus, error) { return g.c.Git.Status(projectID) }

// Commit grava um commit só com os arquivos escolhidos.
func (g *Git) Commit(projectID string, req gitx.CommitRequest) (gitx.CommitResult, error) {
	return g.c.Git.Commit(projectID, req)
}

// Diff compara HEAD com o disco.
func (g *Git) Diff(projectID, path string) (gitx.DiffContents, error) {
	return g.c.Git.Diff(projectID, path)
}

// HeadContent devolve o arquivo como está no último commit (marcadores de mudança no editor).
func (g *Git) HeadContent(projectID, path string) (gitx.HeadFile, error) {
	return g.c.Git.HeadContent(projectID, path)
}

// Branches lista branches locais e remotas.
func (g *Git) Branches(projectID string) (gitx.Branches, error) { return g.c.Git.Branches(projectID) }

// Checkout troca de branch (mode: normal | smart | force).
func (g *Git) Checkout(projectID, ref, mode string) (gitx.CheckoutResult, error) {
	return g.c.Git.Checkout(projectID, ref, mode)
}

// CreateBranch cria uma branch (a partir de from, "" = HEAD).
func (g *Git) CreateBranch(projectID, name, from string, checkout bool) error {
	return g.c.Git.CreateBranch(projectID, name, from, checkout)
}

// RenameBranch renomeia uma branch local.
func (g *Git) RenameBranch(projectID, oldName, newName string) error {
	return g.c.Git.RenameBranch(projectID, oldName, newName)
}

// DeleteBranch apaga uma branch local.
func (g *Git) DeleteBranch(projectID, name string, force bool) (gitx.DeleteResult, error) {
	return g.c.Git.DeleteBranch(projectID, name, force)
}

// RestoreBranch desfaz o apagar.
func (g *Git) RestoreBranch(projectID, name, hash string) error {
	return g.c.Git.RestoreBranch(projectID, name, hash)
}

// Fetch busca os remotos.
func (g *Git) Fetch(projectID string) (gitx.OpResult, error) { return g.c.Git.Fetch(projectID) }

// Update traz a branch em dia (mode: merge | rebase).
func (g *Git) Update(projectID, mode string) (gitx.OpResult, error) {
	return g.c.Git.Update(projectID, mode)
}

// AbortOperation desfaz um merge/rebase parado em conflito.
func (g *Git) AbortOperation(projectID string) error { return g.c.Git.AbortOperation(projectID) }

// CherryPick aplica um commit do Log no branch atual; conflito deixa a operação em andamento.
func (g *Git) CherryPick(projectID, hash string) (gitx.OpResult, error) {
	return g.c.Git.CherryPick(projectID, hash)
}

// Revert cria um commit que desfaz o escolhido.
func (g *Git) Revert(projectID, hash string) (gitx.OpResult, error) {
	return g.c.Git.Revert(projectID, hash)
}

// CompareBranches compara a branch atual com outra (commits de cada lado e arquivos que diferem).
func (g *Git) CompareBranches(projectID, other string) (gitx.BranchCompare, error) {
	return g.c.Git.CompareBranches(projectID, other)
}

// RefDiff: um arquivo entre duas revisões (esquerda = base).
func (g *Git) RefDiff(projectID, base, other, path, oldPath string) (gitx.DiffContents, error) {
	return g.c.Git.RefDiff(projectID, base, other, path, oldPath)
}

// RebaseCommits: os commits depois de base (do mais antigo ao mais novo), para o rebase interativo.
func (g *Git) RebaseCommits(projectID, base string) ([]gitx.LogCommit, error) {
	return g.c.Git.RebaseCommits(projectID, base)
}

// InteractiveRebase reescreve os commits depois de base conforme a lista.
func (g *Git) InteractiveRebase(projectID, base string, steps []gitx.RebaseStep) (gitx.OpResult, error) {
	return g.c.Git.InteractiveRebase(projectID, base, steps)
}

// CreateTag cria uma tag no commit (com mensagem: anotada).
func (g *Git) CreateTag(projectID, name, hash, message string) error {
	return g.c.Git.CreateTag(projectID, name, hash, message)
}

// DeleteTag apaga a tag local.
func (g *Git) DeleteTag(projectID, name string) error { return g.c.Git.DeleteTag(projectID, name) }

// Worktrees lista as cópias de trabalho do repositório.
func (g *Git) Worktrees(projectID string) ([]gitx.Worktree, error) {
	return g.c.Git.Worktrees(projectID)
}

// AddWorktree cria uma cópia de trabalho com a branch.
func (g *Git) AddWorktree(projectID, path, branch string, newBranch bool) (gitx.Worktree, error) {
	return g.c.Git.AddWorktree(projectID, path, branch, newBranch)
}

// RemoveWorktree tira uma cópia de trabalho.
func (g *Git) RemoveWorktree(projectID, path string, force bool) error {
	return g.c.Git.RemoveWorktree(projectID, path, force)
}

// Reset move o branch atual até o commit (soft | mixed | hard).
func (g *Git) Reset(projectID, hash, mode string) (gitx.OpResult, error) {
	return g.c.Git.Reset(projectID, hash, mode)
}

// Clone começa um git clone (tela inicial, S29); o andamento vem pelo evento clone:progress.
func (g *Git) Clone(url, parentDir, name string) (gitx.CloneStart, error) {
	return g.c.Git.Clone(url, parentDir, name)
}

// CloneStatus devolve o último estado de um clone (para quando um evento se perde).
func (g *Git) CloneStatus(id string) (gitx.CloneProgress, error) { return g.c.Git.CloneStatus(id) }

// CancelClone interrompe um clone em andamento.
func (g *Git) CancelClone(id string) { g.c.Git.CancelClone(id) }

// StashList devolve a pilha de stash.
func (g *Git) StashList(projectID string) ([]gitx.StashEntry, error) {
	return g.c.Git.StashList(projectID)
}

// StashSave guarda as mudanças (untracked: também os arquivos novos).
func (g *Git) StashSave(projectID, message string, untracked bool) error {
	return g.c.Git.StashSave(projectID, message, untracked)
}

// StashApply aplica um stash (pop: e tira da pilha).
func (g *Git) StashApply(projectID string, index int, pop bool) (gitx.OpResult, error) {
	return g.c.Git.StashApply(projectID, index, pop)
}

// StashDrop apaga um stash.
func (g *Git) StashDrop(projectID string, index int) error {
	return g.c.Git.StashDrop(projectID, index)
}

// ConflictVersions devolve as três versões de um arquivo em conflito e a mesclagem automática (S26).
func (g *Git) ConflictVersions(projectID, path string) (gitx.MergeInput, error) {
	return g.c.Git.ConflictVersions(projectID, path)
}

// ResolveConflict grava a resolução (content, ours, theirs ou delete) e marca o arquivo como resolvido.
func (g *Git) ResolveConflict(projectID, path, side, content string) error {
	return g.c.Git.ResolveConflict(projectID, path, side, content)
}

// ContinueOperation conclui o merge/rebase depois de resolver os conflitos.
func (g *Git) ContinueOperation(projectID string) (gitx.OpResult, error) {
	return g.c.Git.ContinueOperation(projectID)
}

// Log devolve o histórico com o grafo (S24).
func (g *Git) Log(projectID string, filter gitx.LogFilter, limit int) (gitx.LogPage, error) {
	return g.c.Git.Log(projectID, filter, limit)
}

// CommitDetails devolve mensagem, autor e arquivos de um commit.
func (g *Git) CommitDetails(projectID, hash string) (gitx.CommitDetails, error) {
	return g.c.Git.CommitDetails(projectID, hash)
}

// CommitDiff compara um arquivo antes e depois de um commit.
func (g *Git) CommitDiff(projectID, hash, path, oldPath string) (gitx.DiffContents, error) {
	return g.c.Git.CommitDiff(projectID, hash, path, oldPath)
}

// Blame anota cada linha do arquivo com o commit que a trouxe (S27).
func (g *Git) Blame(projectID, path string) (gitx.Blame, error) {
	return g.c.Git.Blame(projectID, path)
}

// Outgoing lista o que o push vai mandar.
func (g *Git) Outgoing(projectID string) (gitx.Outgoing, error) { return g.c.Git.Outgoing(projectID) }

// Push envia a branch atual.
func (g *Git) Push(projectID string, req gitx.PushRequest) (gitx.OpResult, error) {
	return g.c.Git.Push(projectID, req)
}

// ---------------------------------------------------------------- Run

// RunConfigs: configurações de execução.
type RunConfigs struct{ c *Core }

// List devolve as configs do projeto.
func (r *RunConfigs) List(projectID string) ([]store.RunConfig, error) {
	return r.c.RunCfgs.List(projectID)
}

// Save cria ou atualiza.
func (r *RunConfigs) Save(projectID string, cfg store.RunConfig) (store.RunConfig, error) {
	return r.c.RunCfgs.Save(projectID, cfg)
}

// Delete apaga.
func (r *RunConfigs) Delete(projectID, id string) error { return r.c.RunCfgs.Delete(projectID, id) }

// Validate confere uma config campo a campo, sem salvar (o diálogo S12 mostra cada erro no campo).
func (r *RunConfigs) Validate(projectID string, cfg store.RunConfig) (map[string]string, error) {
	return r.c.RunCfgs.Validate(projectID, cfg)
}

// FromContext devolve a config temporária para o ▶ do gutter (programa, testes do pacote ou um teste).
func (r *RunConfigs) FromContext(projectID, filePath, testName string) (store.RunConfig, error) {
	return r.c.RunCfgs.FromContext(projectID, filePath, testName)
}

// Runs: execuções.
type Runs struct{ c *Core }

// Start compila e roda uma config.
func (r *Runs) Start(projectID, configID string) (run.Info, error) {
	return r.c.Runs.Start(projectID, configID)
}

// Vet roda go vet nos pacotes dos arquivos (verificação antes do commit).
func (r *Runs) Vet(projectID string, files []string) (run.VetResult, error) {
	return r.c.Runs.Vet(projectID, files)
}

// TestPackages roda go test nos pacotes dos arquivos (verificação antes do commit).
func (r *Runs) TestPackages(projectID string, files []string) (run.VetResult, error) {
	return r.c.Runs.TestPackages(projectID, files)
}

// StartGoTool roda go mod tidy, go generate, go vet, go get... (menu Ferramentas do Go).
func (r *Runs) StartGoTool(projectID, tool, arg string) (run.Info, error) {
	return r.c.Runs.StartGoTool(projectID, tool, arg)
}

// StartCoverage roda uma config Go Test com cobertura (S18).
func (r *Runs) StartCoverage(projectID, configID string) (run.Info, error) {
	return r.c.Runs.StartCoverage(projectID, configID)
}

// Coverage devolve a cobertura de uma execução com cobertura que já terminou.
func (r *Runs) Coverage(runID string) (run.Coverage, error) { return r.c.Runs.Coverage(runID) }

// Stop para uma execução.
func (r *Runs) Stop(runID string) error { return r.c.Runs.Stop(runID) }

// WriteStdin manda texto para a entrada do programa.
func (r *Runs) WriteStdin(runID, data string) error { return r.c.Runs.WriteStdin(runID, data) }

// List devolve as execuções do projeto nesta sessão.
func (r *Runs) List(projectID string) []run.Info { return r.c.Runs.List(projectID) }

// ---------------------------------------------------------------- Debug

// Debug: sessões de depuração (Delve).
type Debug struct{ c *Core }

// Start depura a config (programa ou teste).
func (d *Debug) Start(projectID, configID string) (debug.Info, error) {
	return d.c.Debug.Start(projectID, configID)
}

// Control: resume | pause | stepOver | stepInto | stepOut. threadID 0 = a goroutine que parou.
func (d *Debug) Control(sessionID, action string, threadID int) error {
	return d.c.Debug.Control(sessionID, action, threadID)
}

// Stop encerra a depuração.
func (d *Debug) Stop(sessionID string) error { return d.c.Debug.Stop(sessionID) }

// Processes lista os processos do usuário (para anexar o depurador).
func (d *Debug) Processes() ([]debug.Process, error) { return d.c.Debug.Processes() }

// AttachLocal anexa o Delve a um processo desta máquina.
func (d *Debug) AttachLocal(projectID string, pid int) (debug.Info, error) {
	return d.c.Debug.AttachLocal(projectID, pid)
}

// AttachRemote conecta num "dlv --headless" pelo endereço (host:porta).
func (d *Debug) AttachRemote(projectID, addr string) (debug.Info, error) {
	return d.c.Debug.AttachRemote(projectID, addr)
}

// RunToCursor continua até a linha do arquivo (Alt+F9); o arquivo é relativo ao projeto da sessão.
func (d *Debug) RunToCursor(sessionID, path string, line int) error {
	return d.c.Debug.RunToCursor(sessionID, path, line)
}

// Goroutines lista as goroutines do programa parado.
func (d *Debug) Goroutines(sessionID string) ([]debug.Goroutine, error) {
	return d.c.Debug.Goroutines(sessionID)
}

// Stack devolve a pilha de uma goroutine.
func (d *Debug) Stack(sessionID string, threadID int) ([]debug.Frame, error) {
	return d.c.Debug.Stack(sessionID, threadID)
}

// Scopes devolve os escopos de um quadro.
func (d *Debug) Scopes(sessionID string, frameID int) ([]debug.Scope, error) {
	return d.c.Debug.Scopes(sessionID, frameID)
}

// Variables devolve os filhos de uma referência.
func (d *Debug) Variables(sessionID string, ref, start, count int) ([]debug.Variable, error) {
	return d.c.Debug.Variables(sessionID, ref, start, count)
}

// Evaluate avalia uma expressão no quadro.
func (d *Debug) Evaluate(sessionID string, frameID int, expr string) (debug.Variable, error) {
	return d.c.Debug.Evaluate(sessionID, frameID, expr)
}

// List devolve as sessões do projeto.
func (d *Debug) List(projectID string) []debug.Info { return d.c.Debug.List(projectID) }

// ---------------------------------------------------------------- Breakpoints

// Breakpoints: breakpoints do projeto, persistidos e sincronizados com as sessões.
type Breakpoints struct{ c *Core }

// List devolve os breakpoints do projeto.
func (b *Breakpoints) List(projectID string) ([]store.Breakpoint, error) {
	if _, err := b.c.Reg.Get(projectID); err != nil {
		return nil, err
	}
	return b.c.DB.ListBreakpoints(context.Background(), projectID)
}

// Toggle liga ou desliga o breakpoint da linha. Devolve a lista atualizada.
func (b *Breakpoints) Toggle(projectID, path string, line int) ([]store.Breakpoint, error) {
	o, err := b.c.Reg.Get(projectID)
	if err != nil {
		return nil, err
	}
	if _, err := o.Abs(path); err != nil {
		return nil, err
	}
	if _, err := b.c.DB.ToggleLineBreakpoint(context.Background(), projectID, path, line); err != nil {
		return nil, err
	}
	return b.changed(projectID, path)
}

// Update grava condição, mensagem de log e ligado.
func (b *Breakpoints) Update(projectID string, bp store.Breakpoint) ([]store.Breakpoint, error) {
	bp.ProjectID = projectID
	cur, err := b.c.DB.BreakpointByID(context.Background(), projectID, bp.ID)
	if err != nil {
		return nil, err
	}
	if err := b.c.DB.UpdateBreakpoint(context.Background(), bp); err != nil {
		return nil, err
	}
	return b.changed(projectID, deref(cur.FilePath))
}

// Move acompanha as linhas depois de editar o arquivo (id → linha nova).
func (b *Breakpoints) Move(projectID, path string, moves map[string]int) ([]store.Breakpoint, error) {
	if err := b.c.DB.MoveBreakpoints(context.Background(), projectID, moves); err != nil {
		return nil, err
	}
	return b.changed(projectID, path)
}

// Delete apaga um breakpoint.
func (b *Breakpoints) Delete(projectID, id string) ([]store.Breakpoint, error) {
	cur, err := b.c.DB.BreakpointByID(context.Background(), projectID, id)
	if err != nil {
		return nil, err
	}
	if err := b.c.DB.DeleteBreakpoint(context.Background(), projectID, id); err != nil {
		return nil, err
	}
	return b.changed(projectID, deref(cur.FilePath))
}

// SetPanic liga ou desliga "parar em qualquer panic".
func (b *Breakpoints) SetPanic(projectID string, enabled bool) ([]store.Breakpoint, error) {
	if _, err := b.c.Reg.Get(projectID); err != nil {
		return nil, err
	}
	if err := b.c.DB.SetPanicBreakpoint(context.Background(), projectID, enabled); err != nil {
		return nil, err
	}
	go b.c.Debug.SyncPanic(projectID)
	return b.changed(projectID, "")
}

// SetMuted silencia todos os breakpoints (continuam salvos; voltam ao tirar o silêncio).
func (b *Breakpoints) SetMuted(projectID string, muted bool) error {
	if _, err := b.c.Reg.Get(projectID); err != nil {
		return err
	}
	b.c.Debug.SetMuted(projectID, muted)
	b.c.Bus.Emit(events.Breakpoints, map[string]string{"projectId": projectID})
	return nil
}

// Muted diz se os breakpoints do projeto estão silenciados.
func (b *Breakpoints) Muted(projectID string) bool { return b.c.Debug.Muted(projectID) }

func (b *Breakpoints) changed(projectID, path string) ([]store.Breakpoint, error) {
	if path != "" {
		go b.c.Debug.SyncFile(projectID, path)
	}
	b.c.Bus.Emit(events.Breakpoints, map[string]string{"projectId": projectID})
	return b.c.DB.ListBreakpoints(context.Background(), projectID)
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// ---------------------------------------------------------------- Tests

// Tests: resultados de execuções de go test.
type Tests struct{ c *Core }

// Get devolve a árvore (parcial enquanto roda) de uma execução de testes.
func (t *Tests) Get(runID string) (run.TestRun, error) { return t.c.Runs.Tests(runID) }

// Locate acha no código o teste ou subteste de um resultado.
func (t *Tests) Locate(projectID, runID, pkg, name string) (run.Location, error) {
	return t.c.Runs.Locate(projectID, runID, pkg, name)
}

// RerunFailed roda de novo só os testes que falharam.
func (t *Tests) RerunFailed(projectID, runID string) (run.Info, error) {
	if _, err := t.c.Reg.RequireTrusted(projectID); err != nil {
		return run.Info{}, err
	}
	return t.c.Runs.RerunFailed(projectID, runID)
}

// ---------------------------------------------------------------- Search

// Search: buscar em tudo (arquivos) e buscar/substituir nos arquivos. Símbolos vêm do gopls pelo frontend.
type Search struct{ c *Core }

// Files acha arquivos do projeto pelo nome (fuzzy).
func (s *Search) Files(projectID, query string, limit int) ([]search.FileHit, error) {
	return s.c.Search.Files(projectID, query, limit)
}

// Text começa uma busca de texto; os resultados vêm por Results (o evento search:update avisa).
func (s *Search) Text(projectID string, opt search.Options) (string, error) {
	return s.c.Search.Text(projectID, opt)
}

// Results devolve as ocorrências achadas a partir de from.
func (s *Search) Results(searchID string, from, max int) (search.TextResults, error) {
	return s.c.Search.Results(searchID, from, max)
}

// Cancel interrompe a busca.
func (s *Search) Cancel(searchID string) { s.c.Search.Cancel(searchID) }

// Replace substitui as ocorrências escolhidas e devolve os arquivos alterados.
func (s *Search) Replace(projectID string, opt search.Options, replacement string, targets []search.Target) (search.ReplaceResult, error) {
	return s.c.Search.Replace(projectID, opt, replacement, targets)
}

// ---------------------------------------------------------------- Terminal

// Terminal: shells do usuário na pasta do projeto. A entrada e a saída passam pelo WebSocket /term/{id}.
type Terminal struct{ c *Core }

// Create abre um terminal (exige projeto confiável).
func (t *Terminal) Create(projectID string, cols, rows int) (term.Info, error) {
	shell := ""
	if v, err := t.c.DB.GetSettings(context.Background(), []string{"terminal.shell"}); err == nil {
		_ = json.Unmarshal(v["terminal.shell"], &shell)
	}
	return t.c.Terms.Create(projectID, shell, cols, rows)
}

// List devolve os terminais abertos do projeto.
func (t *Terminal) List(projectID string) []term.Info { return t.c.Terms.List(projectID) }

// Rename troca o título da aba.
func (t *Terminal) Rename(termID, title string) error { return t.c.Terms.Rename(termID, title) }

// Close encerra o shell e o que estiver rodando nele.
func (t *Terminal) Close(termID string) error { return t.c.Terms.Close(termID) }
