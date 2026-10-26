#!/bin/sh
# =============================================================================
#  sodl-exec — fixed-argument sandbox launcher for the SmartODL judge worker
#
#  WHY THIS EXISTS:
#  A sudoers line like `NOPASSWD: /usr/bin/unshare, /usr/bin/chown, /usr/bin/rm`
#  grants ARBITRARY arguments — `sudo -n unshare -- /bin/sh -c 'anything'` is a
#  full root shell for whoever can run the worker. This wrapper replaces those
#  wildcard grants: sudoers allows ONLY this script, and this script only ever
#  does the bounded operations the judge legitimately needs, as root:
#
#    1. chown the run's own work directory to the sandbox user (strictly
#       bounded to $ROOT/run-* — nothing else can be touched);
#    2. create namespaces (network off by default; optional PID namespace);
#    3. drop to the sandbox user under prlimit caps and exec the run.
#
#  usage:  sodl-exec --probe [--ns a,b,c]
#          sodl-exec --dir D [--user U] [--ns a,b,c] --cpu N --as N --nproc N
#                    --nofile N --fsize N --stack N [--core N] -- CMD [ARGS…]
#
#  --probe runs the whole chain against /bin/true and exits 0/1, so it doubles
#  as the sandbox health check. Every numeric limit must be a non-negative
#  integer, the user must be one of the two configured judge accounts, and the
#  namespace tokens come from a closed allowlist.
# =============================================================================
set -eu

ROOT="/tmp/smartodl-judge"
WEB_USER="judgeweb"
RUN_USER="judgerun"
PRLIMIT="/usr/bin/prlimit"
SUDO="/usr/bin/sudo"
UNSHARE="/usr/bin/unshare"
# Root-owned overrides (the Docker image writes this; manual installs may edit).
if [ -r /etc/smartodl-judge.conf ]; then . /etc/smartodl-judge.conf; fi

die() { echo "sodl-exec: $*" >&2; exit 1; }
num_ok() { case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }
user_ok() { [ "$1" = "$WEB_USER" ] || [ "$1" = "$RUN_USER" ]; }

# Map validated tokens to unshare flags. Returns non-zero on anything outside
# the allowlist, so sudoers-granted "root" can never be steered elsewhere.
NS_FLAGS=""
add_ns() {
  case "$1" in
    n) NS_FLAGS="$NS_FLAGS -n" ;;
    u) NS_FLAGS="$NS_FLAGS -u" ;;
    i) NS_FLAGS="$NS_FLAGS -i" ;;
    m) NS_FLAGS="$NS_FLAGS -m" ;;
    p) NS_FLAGS="$NS_FLAGS -p" ;;
    pid) NS_FLAGS="$NS_FLAGS --pid" ;;
    fork) NS_FLAGS="$NS_FLAGS --fork" ;;
    mount-proc) NS_FLAGS="$NS_FLAGS --mount-proc" ;;
    user) NS_FLAGS="$NS_FLAGS --user" ;;
    map-root-user) NS_FLAGS="$NS_FLAGS --map-root-user" ;;
    mount) NS_FLAGS="$NS_FLAGS --mount" ;;
    *) return 1 ;;
  esac
}
parse_ns() {
  NS_FLAGS=""
  [ -z "${1:-}" ] && return 0
  OLDIFS="$IFS"; IFS=','
  for tok in $1; do
    [ -z "$tok" ] && continue
    add_ns "$tok" || { IFS="$OLDIFS"; return 1; }
  done
  IFS="$OLDIFS"
  return 0
}

DIR=""
USER="$RUN_USER"
NS=""
CPU=""
AS=""
NPROC=""
NOFILE=""
FSIZE=""
STACK=""
CORE="0"
PROBE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --probe) PROBE=1; shift ;;
    --dir) [ $# -ge 2 ] || die "--dir needs a value"; DIR="$2"; shift 2 ;;
    --user) [ $# -ge 2 ] || die "--user needs a value"; USER="$2"; shift 2 ;;
    --ns) [ $# -ge 2 ] || die "--ns needs a value"; NS="$2"; shift 2 ;;
    --cpu) [ $# -ge 2 ] || die "--cpu needs a value"; CPU="$2"; shift 2 ;;
    --as) [ $# -ge 2 ] || die "--as needs a value"; AS="$2"; shift 2 ;;
    --nproc) [ $# -ge 2 ] || die "--nproc needs a value"; NPROC="$2"; shift 2 ;;
    --nofile) [ $# -ge 2 ] || die "--nofile needs a value"; NOFILE="$2"; shift 2 ;;
    --fsize) [ $# -ge 2 ] || die "--fsize needs a value"; FSIZE="$2"; shift 2 ;;
    --stack) [ $# -ge 2 ] || die "--stack needs a value"; STACK="$2"; shift 2 ;;
    --core) [ $# -ge 2 ] || die "--core needs a value"; CORE="$2"; shift 2 ;;
    --) shift; break ;;
    *) die "unknown argument: $1" ;;
  esac
done

user_ok "$USER" || die "user not allowed: $USER"
parse_ns "$NS" || die "namespace flag not on the allowlist: $NS"

if [ "$PROBE" = 1 ]; then
  # shellcheck disable=SC2086
  exec "$UNSHARE" $NS_FLAGS "$SUDO" -n -u "$RUN_USER" "$PRLIMIT" --cpu=2 -- /bin/true
fi

[ -n "$DIR" ] || die "--dir is required"
num_ok "$CPU" || die "--cpu must be an integer"
num_ok "$AS" || die "--as must be an integer"
num_ok "$NPROC" || die "--nproc must be an integer"
num_ok "$NOFILE" || die "--nofile must be an integer"
num_ok "$FSIZE" || die "--fsize must be an integer"
num_ok "$STACK" || die "--stack must be an integer"
num_ok "$CORE" || die "--core must be an integer"
[ "$#" -gt 0 ] || die "no command given after --"

# The work directory must be a run-* directory directly inside the judge root.
# Resolve first, so `..` or symlink games cannot escape it.
[ -d "$DIR" ] || die "directory does not exist: $DIR"
REAL="$(readlink -f -- "$DIR")"
case "$REAL" in
  "$ROOT"/run-*/) ;;
  "$ROOT"/run-*) ;;
  *) die "directory must live under $ROOT as a run-* directory" ;;
esac

chown -R "$USER" "$REAL"
chmod 0711 "$REAL"

# shellcheck disable=SC2086
exec "$UNSHARE" $NS_FLAGS \
  "$SUDO" -n -u "$USER" "$PRLIMIT" \
    --cpu="$CPU" --as="$AS" --nproc="$NPROC" --nofile="$NOFILE" \
    --fsize="$FSIZE" --stack="$STACK" --core="$CORE" \
    -- "$@"
