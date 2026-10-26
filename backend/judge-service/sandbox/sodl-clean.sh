#!/bin/sh
# =============================================================================
#  sodl-clean — bounded work-directory cleanup for the SmartODL judge worker
#
#  The run directories get chowned to the sandbox user, so the worker itself
#  cannot delete (or re-list) them. Root has to do it — but a plain
#  `NOPASSWD: /usr/bin/rm, /usr/bin/chown` sudoers grant is an unlimited root
#  primitive. This script confines both operations to run-* directories inside
#  the judge work root, and to the worker's own user for the reclaim step.
#
#  usage:  sodl-clean [--chown-only] --dir D
# =============================================================================
set -eu

ROOT="/tmp/smartodl-judge"
WEB_USER="judgeweb"
if [ -r /etc/smartodl-judge.conf ]; then . /etc/smartodl-judge.conf; fi

die() { echo "sodl-clean: $*" >&2; exit 1; }

CHOWN_ONLY=0
DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --chown-only) CHOWN_ONLY=1; shift ;;
    --dir) [ $# -ge 2 ] || die "--dir needs a value"; DIR="$2"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$DIR" ] || die "--dir is required"
[ -e "$DIR" ] || exit 0   # already gone — nothing to clean
REAL="$(readlink -f -- "$DIR")"
case "$REAL" in
  "$ROOT"/run-*/) ;;
  "$ROOT"/run-*) ;;
  *) die "directory must live under $ROOT as a run-* directory" ;;
esac

chown -R "$WEB_USER" "$REAL"
if [ "$CHOWN_ONLY" = 0 ]; then
  rm -rf -- "$REAL"
fi
