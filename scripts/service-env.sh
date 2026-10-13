#!/usr/bin/env sh
# service-env.sh — resolve o ambiente que o SERVIÇO (launchd/systemd) vai receber.
# Não executa nada: é feito para ser carregado com `. "$ROOT/scripts/service-env.sh"` pelos
# install-hub.sh / install-runner.sh. POSIX sh (o jarvis-setup.sh chama o doctor com `sh`).
#
# POR QUE EXISTE
#
# Um LaunchAgent do macOS não herda o PATH do seu terminal: ele recebe
# `/usr/bin:/bin:/usr/sbin:/sbin` e mais nada. O mesmo vale para o systemd --user, que não conhece
# o ~/.nvm. Os plists/units gerados aqui chamam `start-hub.sh`, que termina em `exec npm ...` — um
# nome relativo. Resultado: o serviço registra, sobe, não encontra o `npm` e sai com 127, em loop,
# com o launchd reiniciando para sempre. O log fica vazio porque quem falhou foi o shell, não o Hub.
#
# E este é o ponto onde a ARQUITETURA do Mac aparece de verdade: o prefixo do Homebrew é
# /usr/local no Intel e /opt/homebrew no Apple Silicon. Qualquer caminho fixo acerta uma das duas
# máquinas e erra a outra. `brew --prefix` responde certo nas duas; os dois literais entram depois
# como rede, para a máquina que tem o Node por pkg/nvm e as CLIs por brew (ou o inverso).
#
# EXPORTA: SVC_PATH, SVC_NPM, SVC_PY, SVC_ARCH — e a função env_set_once.

# Acrescenta um diretório ao SVC_PATH, ignorando vazio e duplicata. Um segmento vazio no PATH
# significa "diretório atual", que num serviço é coisa que não se faz de propósito.
svc_path_add() {
  [ -n "$1" ] || return 0
  case ":${SVC_PATH}:" in *":$1:"*) return 0 ;; esac
  SVC_PATH="${SVC_PATH:+$SVC_PATH:}$1"
}

SVC_ARCH="$(uname -m)"
SVC_PATH=""

# 1) O diretório do node/npm que ESTE instalador está usando — é o toolchain que acabou de rodar o
#    `npm install`, então é o que o serviço tem de usar também.
_node_bin="$(command -v node 2>/dev/null || true)"
[ -n "$_node_bin" ] && svc_path_add "$(cd "$(dirname "$_node_bin")" && pwd)"

# 2) Homebrew, perguntando a ele mesmo onde mora (resolve Intel vs Apple Silicon sem testar arch).
if command -v brew >/dev/null 2>&1; then
  _brew_prefix="$(brew --prefix 2>/dev/null || true)"
  [ -n "$_brew_prefix" ] && svc_path_add "$_brew_prefix/bin"
fi

# 3) Os dois prefixos literais, como rede. /usr/local/bin = Homebrew no Intel e também onde o
#    instalador do python.org põe os symlinks; /opt/homebrew/bin = Homebrew no Apple Silicon.
svc_path_add /usr/local/bin
svc_path_add /opt/homebrew/bin

# 4) O PATH de quem está instalando. NÃO é redundância: é aqui que vivem as CLIs de agente
#    (claude, codex, gemini…) que o install-hub.sh valida com `command -v`. Sem elas no PATH do
#    serviço, o Hub sobe "sem IA" — e nada no log explica por quê, porque resolveBin() em
#    packages/core/src/agents.ts lê process.env.PATH e simplesmente não acha nada.
_old_ifs="$IFS"; IFS=:
for _d in $PATH; do svc_path_add "$_d"; done
IFS="$_old_ifs"

# 5) O default do sistema, por último e sempre — um PATH no plist SUBSTITUI o default, então
#    esquecer estes quatro quebraria git, curl, sw_vers e qualquer coisa que o Hub invoque.
svc_path_add /usr/bin
svc_path_add /bin
svc_path_add /usr/sbin
svc_path_add /sbin

# npm por caminho ABSOLUTO: é o que start-hub.sh/start-runner.sh passam a usar e o que o
# self-update (packages/core/src/update.ts) herda via JARVIS_NPM.
SVC_NPM="$(command -v npm 2>/dev/null || true)"

# Python por caminho absoluto, usando o MESMO resolvedor do Hub (apps/hub/src/python.ts) para o
# instalador e o runtime nunca escolherem interpretadores diferentes — divergir aí foi o que fez o
# doctor dar PASS na voz enquanto o Hub morria com ENOENT.
SVC_PY=""
if [ -n "${ROOT:-}" ] && [ -d "$ROOT/node_modules" ]; then
  SVC_PY="$(cd "$ROOT" && node --import tsx apps/hub/src/python.ts --path 2>/dev/null | head -1 || true)"
fi

export SVC_PATH SVC_NPM SVC_PY SVC_ARCH

# Escapa o que vai dentro de um <string> de plist — aplicado em TODOS os campos interpolados (PATH,
# caminho do script, caminho do log), não só no PATH. Um `<` num caminho gera XML inválido e o
# launchd recusa o plist inteiro com uma mensagem que não aponta para o caractere. (`&` sozinho o
# parser até tolera; `<` não.)
plist_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

# Cita um valor para ser lido de volta por `. arquivo`, que é como o start-hub.sh:5 carrega o
# hub.env (sob `set -a`). Sem aspas, um caminho com espaço faz o shell EXECUTAR o resto da linha:
# `JARVIS_PYTHON=/Users/x/My Tools/python3.12` virava "Tools/python3.12: not found" e a variável
# chegava VAZIA ao Hub. Aspas simples com o escape '\'' cobrem espaço, $, backtick e a própria aspa.
env_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

# Anexar a um arquivo que não termina em newline COLA a linha nova na última. O estrago é duplo: a
# variável anterior recebe lixo e a nova nem passa a existir — e nada avisa. Não é hipótese: o
# próprio projeto manda editar o hub.env à mão (docs/setup.md, install-voice.sh) e editor nenhum
# garante newline final.
_env_ensure_newline() {
  [ -s "$1" ] || return 0
  # `$( )` remove o newline final, então _last só é não-vazio quando o último byte NÃO é newline.
  _last="$(tail -c1 "$1" 2>/dev/null)"
  [ -n "$_last" ] && printf '\n' >> "$1"
  return 0
}

# Garante KEY=VALUE num arquivo de env, SEM sobrescrever uma escolha que o dono já fez. Precisa
# existir porque install-hub.sh só cria o hub.env quando ele ainda não existe (e o jarvis-setup.sh
# costuma tê-lo criado antes) — sem isto, nada novo chega a quem já instalou.
#
# Use para o que o DONO escolhe (JARVIS_AGENT, JARVIS_AUTH, JARVIS_PORT). Para o que o instalador
# DERIVA da máquina, use env_set_managed — ver o porquê lá.
env_set_once() {
  _key="$1"; _val="$2"; _file="$3"
  [ -n "$_val" ] || return 0
  [ -f "$_file" ] || : > "$_file"
  grep -q "^[[:space:]]*${_key}=" "$_file" 2>/dev/null && return 0
  _env_ensure_newline "$_file"
  printf '%s=%s\n' "$_key" "$(env_quote "$_val")" >> "$_file"
}

# Igual, mas SUBSTITUI a linha existente. É o certo para valor DERIVADO da máquina (JARVIS_NPM,
# JARVIS_PYTHON): não é preferência do dono, é um caminho absoluto que só vale enquanto o binário
# existir. `nvm install 26 && nvm uninstall 24` apaga o npm apontado, e um pin que nunca atualiza
# deixa o serviço saindo 126/127 em loop — com reinstalar NÃO consertando, porque o env_set_once
# via a linha velha e desistia, enquanto o instalador imprimia na tela o npm novo e correto.
env_set_managed() {
  _key="$1"; _val="$2"; _file="$3"
  [ -n "$_val" ] || return 0
  [ -f "$_file" ] || : > "$_file"
  if grep -q "^[[:space:]]*${_key}=" "$_file" 2>/dev/null; then
    _tmp="$_file.jarvis-tmp.$$"
    if grep -v "^[[:space:]]*${_key}=" "$_file" > "$_tmp" 2>/dev/null || [ -f "$_tmp" ]; then
      mv "$_tmp" "$_file"
    fi
  fi
  _env_ensure_newline "$_file"
  printf '%s=%s\n' "$_key" "$(env_quote "$_val")" >> "$_file"
}
