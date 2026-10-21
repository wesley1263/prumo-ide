#!/usr/bin/env bash
# Prumo installer: checks the requirements, builds the UI and the app, and installs it for the current user.
#
#   ./install.sh                 build and install to ~/.local (binary in ~/.local/bin/prumo)
#   ./install.sh --prefix DIR    install under DIR instead (binary in DIR/bin)
#   ./install.sh --yes           don't ask: install missing system packages and Go tools
#   ./install.sh --no-tools      don't install gopls and dlv
#   ./install.sh --uninstall     same as ./uninstall.sh (your settings stay; --purge there deletes them)
#
# Linux and macOS. Nothing is installed system-wide unless you agree to install missing packages with sudo.
set -euo pipefail

PREFIX="${HOME}/.local"
ASSUME_YES=0
TOOLS=1
UNINSTALL=0
APP=prumo
GO_MIN="1.26"
NODE_MIN="20.19.0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix) PREFIX="${2:?--prefix needs a directory}"; shift 2 ;;
    --prefix=*) PREFIX="${1#*=}"; shift ;;
    -y|--yes) ASSUME_YES=1; shift ;;
    --no-tools) TOOLS=0; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${PREFIX}/bin"
OS="$(uname -s)"

if [[ -t 1 ]]; then B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; N=$'\e[0m'; else B= G= Y= R= N=; fi
step() { printf '%s==>%s %s\n' "$B" "$N" "$*"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
die()  { printf '%serror:%s %s\n' "$R" "$N" "$*" >&2; exit 1; }
ask()  { [[ $ASSUME_YES -eq 1 ]] && return 0; [[ -t 0 ]] || return 1; read -r -p "  $1 [y/N] " a; [[ $a =~ ^[YySs]$ ]]; }
have() { command -v "$1" >/dev/null 2>&1; }

# version_ge A B: A >= B (dotted versions)
version_ge() { [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" == "$2" ]]; }

DESKTOP_FILE="${PREFIX}/share/applications/${APP}.desktop"

if [[ $UNINSTALL -eq 1 ]]; then
  # Um lugar só para desinstalar: o uninstall.sh (que também sabe apagar as configurações com --purge).
  args=(--prefix "$PREFIX")
  [[ $ASSUME_YES -eq 1 ]] && args+=(--yes)
  exec "${ROOT}/uninstall.sh" "${args[@]}"
fi

# ---------------------------------------------------------------- requirements

step "Checking requirements"

have git || die "git is required: install it with your package manager"
ok "git $(git --version | awk '{print $3}')"

have go || die "Go ${GO_MIN}+ is required: https://go.dev/dl/"
GO_VER="$(go env GOVERSION | sed 's/^go//')"
version_ge "$GO_VER" "$GO_MIN" || die "Go ${GO_MIN}+ is required (found ${GO_VER}): https://go.dev/dl/"
ok "go ${GO_VER}"

have node && have npm || die "Node.js ${NODE_MIN}+ and npm are required: https://nodejs.org/"
NODE_VER="$(node --version | sed 's/^v//')"
version_ge "$NODE_VER" "$NODE_MIN" || die "Node.js ${NODE_MIN}+ is required (found ${NODE_VER}): https://nodejs.org/"
ok "node ${NODE_VER}"

BUILD_TAGS="desktop,production"
if [[ "$OS" == "Linux" ]]; then
  # Wails on Linux links against GTK 3 and WebKitGTK (4.1 preferred, 4.0 still works).
  pc() { have pkg-config && pkg-config --exists "$1"; }
  if ! pc gtk+-3.0 || ! { pc webkit2gtk-4.1 || pc webkit2gtk-4.0; }; then
    warn "GTK 3 / WebKitGTK development packages are missing"
    if have apt-get; then PKGS=(libgtk-3-dev libwebkit2gtk-4.1-dev pkg-config build-essential); INSTALL=(sudo apt-get install -y)
    elif have dnf; then PKGS=(gtk3-devel webkit2gtk4.1-devel pkgconf-pkg-config gcc-c++); INSTALL=(sudo dnf install -y)
    elif have pacman; then PKGS=(gtk3 webkit2gtk-4.1 pkgconf base-devel); INSTALL=(sudo pacman -S --needed --noconfirm)
    elif have zypper; then PKGS=(gtk3-devel webkit2gtk3-devel pkg-config gcc-c++); INSTALL=(sudo zypper install -y)
    else die "install the GTK 3 and WebKitGTK 4.1 development packages for your distribution, then run this again"; fi
    echo "  needed: ${PKGS[*]}"
    if ask "Install them now with sudo (${INSTALL[*]} …)?"; then
      [[ "${INSTALL[0]}" == "sudo" && "${INSTALL[1]}" == "apt-get" ]] && sudo apt-get update
      "${INSTALL[@]}" "${PKGS[@]}"
    else
      die "run: ${INSTALL[*]} ${PKGS[*]}"
    fi
    pc webkit2gtk-4.1 || pc webkit2gtk-4.0 || die "WebKitGTK still not found after installing"
  fi
  if pc webkit2gtk-4.1; then BUILD_TAGS+=",webkit2_41"; ok "WebKitGTK 4.1"; else ok "WebKitGTK 4.0"; fi
elif [[ "$OS" == "Darwin" ]]; then
  xcode-select -p >/dev/null 2>&1 || die "the Xcode command line tools are required: xcode-select --install"
  ok "Xcode command line tools"
else
  die "unsupported system: ${OS} (use Linux or macOS; on Windows, build with the Wails CLI)"
fi

# ---------------------------------------------------------------- build

step "Installing the UI dependencies (npm ci)"
cd "${ROOT}/frontend"
if [[ -f package-lock.json ]]; then npm ci --no-audit --no-fund --loglevel=error; else npm install --no-audit --no-fund --loglevel=error; fi
ok "done"

step "Building the UI"
npm run build --silent
ok "frontend/dist"

step "Building the app (tags: ${BUILD_TAGS})"
cd "${ROOT}"
mkdir -p build/bin
CGO_ENABLED=1 go build -tags "${BUILD_TAGS}" -trimpath -ldflags "-s -w" -o "build/bin/${APP}" .
ok "build/bin/${APP}"

# ---------------------------------------------------------------- install

step "Installing to ${PREFIX}"
mkdir -p "${BIN_DIR}"
install -m 0755 "build/bin/${APP}" "${BIN_DIR}/${APP}"
ok "${BIN_DIR}/${APP}"

if [[ "$OS" == "Linux" ]]; then
  ICONS="${PREFIX}/share/icons/hicolor"
  install -Dm 0644 "${ROOT}/assets/brand/prumo-icon.svg" "${ICONS}/scalable/apps/${APP}.svg"
  install -Dm 0644 "${ROOT}/assets/brand/prumo-icon-256.png" "${ICONS}/256x256/apps/${APP}.png"
  have gtk-update-icon-cache && gtk-update-icon-cache -q -t "$ICONS" >/dev/null 2>&1 || true
  ok "icons: ${ICONS}"
  mkdir -p "$(dirname "$DESKTOP_FILE")"
  cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Prumo
GenericName=Go IDE
Comment=A desktop IDE for Go, built from open parts
Exec=${BIN_DIR}/${APP}
Icon=${APP}
Terminal=false
Categories=Development;IDE;
Keywords=go;golang;ide;editor;debugger;git;
StartupWMClass=${APP}
EOF
  have update-desktop-database && update-desktop-database "$(dirname "$DESKTOP_FILE")" >/dev/null 2>&1 || true
  ok "menu entry: ${DESKTOP_FILE}"
fi

# ---------------------------------------------------------------- Go tools

if [[ $TOOLS -eq 1 ]]; then
  step "Go tools used by the IDE"
  GOBIN_DIR="$(go env GOBIN)"; [[ -n "$GOBIN_DIR" ]] || GOBIN_DIR="$(go env GOPATH)/bin"
  tool_ok() { have "$1" || [[ -x "${GOBIN_DIR}/$1" ]]; }
  for t in "gopls golang.org/x/tools/gopls@latest" "dlv github.com/go-delve/delve/cmd/dlv@latest"; do
    name="${t%% *}"; pkg="${t#* }"
    if tool_ok "$name"; then ok "${name} found"
    elif ask "Install ${name} (${pkg})?"; then go install "$pkg" && ok "${name} installed in ${GOBIN_DIR}"
    else warn "${name} not installed (the IDE can install it later from Settings → Tools)"; fi
  done
fi

# ---------------------------------------------------------------- done

echo
printf '%sPrumo is installed.%s Start it with: %s%s%s\n' "$B" "$N" "$B" "${APP}" "$N"
case ":${PATH}:" in
  *":${BIN_DIR}:"*) ;;
  *) warn "${BIN_DIR} is not on your PATH. Add this to your shell profile: export PATH=\"${BIN_DIR}:\$PATH\"" ;;
esac
