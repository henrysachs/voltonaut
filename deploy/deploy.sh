#!/usr/bin/env bash
# Deploy, roll back, and inspect Voltonaut API releases on the Hetzner VPS.
# Run this script on the VPS from the repository checkout at /opt/voltonaut.
set -Eeuo pipefail

APP_ROOT="${VOLTONAUT_ROOT:-/opt/voltonaut}"
RELEASES_DIR="$APP_ROOT/releases"
STATE_DIR="$APP_ROOT/state"
CURRENT_LINK="$APP_ROOT/current"
SERVICE_NAME="voltonaut-server"
SUDO="${VOLTONAUT_SUDO:-sudo}"
HEALTH_URL="http://127.0.0.1:3000/healthz"

usage() {
  echo "usage: deploy.sh deploy <commit-sha>" >&2
  echo "       deploy.sh rollback [release-sha]" >&2
  echo "       deploy.sh status" >&2
}

ensure_layout() {
  mkdir -p "$RELEASES_DIR" "$STATE_DIR"
}

current_target() {
  if [ -L "$CURRENT_LINK" ]; then
    readlink "$CURRENT_LINK"
  else
    echo ""
  fi
}

release_target() {
  local release_name="$1"
  echo "$RELEASES_DIR/$release_name/server-deploy"
}

switch_current() {
  local target="$1"
  ln -sfn "$target" "$CURRENT_LINK.next"
  mv -Tf "$CURRENT_LINK.next" "$CURRENT_LINK"
}

restart_service() {
  "$SUDO" systemctl restart "$SERVICE_NAME"
}

wait_for_health() {
  local attempt
  for attempt in $(seq 1 50); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

deploy_release() {
  local commit="$1"
  local release_dir="$RELEASES_DIR/$commit"
  local previous_target
  previous_target="$(current_target)"

  if [ -z "$commit" ]; then
    usage
    return 1
  fi

  git -C "$APP_ROOT" fetch origin main
  if ! git -C "$APP_ROOT" cat-file -e "$commit^{commit}"; then
    echo "deploy: commit $commit not found after fetch" >&2
    return 1
  fi
  if [ -e "$release_dir" ]; then
    echo "deploy: release $commit already exists; use rollback to activate it" >&2
    return 1
  fi

  git -C "$APP_ROOT" worktree add --detach "$release_dir" "$commit"
  if ! (
    cd "$release_dir"
    mise exec -- node --version
    mise exec -- pnpm install --frozen-lockfile
    mise exec -- pnpm --filter @voltonaut/server build
    mise exec -- pnpm --filter @voltonaut/server deploy --prod "$release_dir/server-deploy"
  ); then
    echo "deploy: build failed for $commit" >&2
    git -C "$APP_ROOT" worktree remove --force "$release_dir"
    return 1
  fi

  printf "%s\n" "$previous_target" >"$STATE_DIR/previous-target"
  switch_current "$(release_target "$commit")"
  restart_service

  if ! wait_for_health; then
    echo "deploy: health check failed for $commit; rolling back" >&2
    if [ -n "$previous_target" ]; then
      switch_current "$previous_target"
      restart_service
    fi
    return 1
  fi

  echo "deploy: release $commit is active"
}

rollback_release() {
  local release_name="$1"
  if [ -z "$release_name" ]; then
    release_name="$(cat "$STATE_DIR/previous-target" 2>/dev/null || true)"
  fi
  if [ -z "$release_name" ]; then
    echo "rollback: no previous release recorded" >&2
    return 1
  fi

  local target="$release_name"
  if [ ! -d "$target" ]; then
    target="$(release_target "$release_name")"
  fi
  if [ ! -d "$target" ]; then
    echo "rollback: release target not found: $release_name" >&2
    return 1
  fi

  switch_current "$target"
  restart_service
  if ! wait_for_health; then
    echo "rollback: health check failed after switching to $target" >&2
    return 1
  fi

  echo "rollback: active release is $target"
}

show_status() {
  echo "current: $(current_target)"
  echo "service: $("$SUDO" systemctl is-active "$SERVICE_NAME")"
  echo "health: $(curl -fsS "$HEALTH_URL" || echo unavailable)"
  echo "releases:"
  find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf "  %f\n" | sort
}

ensure_layout
case "${1:-}" in
  deploy)
    deploy_release "${2:-}"
    ;;
  rollback)
    rollback_release "${2:-}"
    ;;
  status)
    show_status
    ;;
  *)
    usage
    exit 1
    ;;
esac
