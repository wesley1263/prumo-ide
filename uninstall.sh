#!/usr/bin/env bash
# Prumo uninstaller: removes what install.sh installed for the current user.
#
#   ./uninstall.sh                 remove the app and its menu entry from ~/.local (your settings stay)
#   ./uninstall.sh --prefix DIR    the same, for an install made with install.sh --prefix DIR
#   ./uninstall.sh --purge         also delete settings, recent projects, breakpoints and caches (asks first)
#   ./uninstall.sh --yes           don't ask
#
# gopls and dlv are left alone: other editors and tools may use them.
set -euo pipefail

PREFIX="${HOME}/.local"
PURGE=0
ASSUME_YES=0
APP=prumo

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix) PREFIX="${2:?--prefix needs a directory}"; shift 2 ;;
    --prefix=*) PREFIX="${1#*=}"; shift ;;
    --purge) PURGE=1; shift ;;
    -y|--yes) ASSUME_YES=1; shift ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

if [[ -t 1 ]]; then B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; N=$'\e[0m'; else B= G= Y= N=; fi
step() { printf '%s==>%s %s\n' "$B" "$N" "$*"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
ask()  { [[ $ASSUME_YES -eq 1 ]] && return 0; [[ -t 0 ]] || return 1; read -r -p "  $1 [y/N] " a; [[ $a =~ ^[YySs]$ ]]; }

# Removes a path if it exists and says what happened.
remove() {
  if [[ -e "$1" || -L "$1" ]]; then rm -rf -- "$1" && ok "removed $1"; else ok "not found: $1"; fi
}

step "Removing Prumo from ${PREFIX}"
if pgrep -x "$APP" >/dev/null 2>&1; then warn "Prumo is running: close it first so nothing is left half open"; fi
remove "${PREFIX}/bin/${APP}"
remove "${PREFIX}/share/applications/${APP}.desktop"
remove "${PREFIX}/share/icons/hicolor/scalable/apps/${APP}.svg"
remove "${PREFIX}/share/icons/hicolor/256x256/apps/${APP}.png"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "${PREFIX}/share/applications" >/dev/null 2>&1 || true

# Where the app keeps its data: the same folders Go's os.UserConfigDir and os.UserCacheDir give it.
case "$(uname -s)" in
  Darwin)
    CONFIG_BASE="${HOME}/Library/Application Support"
    CACHE_BASE="${HOME}/Library/Caches"
    ;;
  *)
    CONFIG_BASE="${XDG_CONFIG_HOME:-${HOME}/.config}"
    CACHE_BASE="${XDG_CACHE_HOME:-${HOME}/.cache}"
    ;;
esac
DATA_DIRS=(
  "${CONFIG_BASE}/${APP}" "${CACHE_BASE}/${APP}"
  "${CONFIG_BASE}/goide" "${CACHE_BASE}/goide" # nome antigo, de antes da marca
)

if [[ $PURGE -eq 1 ]]; then
  step "Deleting settings and caches"
  found=()
  for d in "${DATA_DIRS[@]}"; do [[ -e "$d" ]] && found+=("$d"); done
  if [[ ${#found[@]} -eq 0 ]]; then
    ok "nothing to delete"
  else
    printf '    %s\n' "${found[@]}"
    if ask "Delete these folders (settings, recent projects, breakpoints, caches)? This cannot be undone."; then
      for d in "${found[@]}"; do remove "$d"; done
    else
      warn "kept them"
    fi
  fi
else
  echo "  Settings and caches were kept. To delete them too: ./uninstall.sh --purge"
fi

echo
printf '%sPrumo was uninstalled.%s\n' "$B" "$N"
echo "  Project files (including .prumo/run inside your repositories) were not touched."
