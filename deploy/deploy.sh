#!/usr/bin/env bash
# Deploy, roll back, and inspect the Voltonaut API containers on the Hetzner VPS.
# Run inside a checkout of deploy/ (see deploy/README.md). Requires docker and the
# compose plugin. TLS and routing come from the existing Financensor Traefik.
set -Eeuo pipefail

COMPOSE_FILE="${VOLTONAUT_COMPOSE_FILE:-compose.yaml}"
STATE_DIR="${VOLTONAUT_STATE_DIR:-state}"
HEALTH_URL="${VOLTONAUT_HEALTH_URL:-https://api.voltonaut.stammkneipe.dev/healthz}"
HEALTH_ATTEMPTS="${VOLTONAUT_HEALTH_ATTEMPTS:-30}"
SERVER_IMAGE="${VOLTONAUT_IMAGE:-voltonaut-server}"

usage() {
  echo "usage: deploy.sh deploy <image-tag>" >&2
  echo "       deploy.sh rollback [image-tag]" >&2
  echo "       deploy.sh status" >&2
}

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

read_state() {
  if [ -f "$STATE_DIR/$1" ]; then
    cat "$STATE_DIR/$1"
  else
    echo ""
  fi
}

write_state() {
  mkdir -p "$STATE_DIR"
  printf "%s" "$2" >"$STATE_DIR/$1"
}

image_exists() {
  docker image inspect "$SERVER_IMAGE:$1" >/dev/null 2>&1
}

wait_for_health() {
  local attempt

  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  return 1
}

up_with_tag() {
  VOLTONAUT_TAG="$1" compose up -d --remove-orphans
}

deploy_release() {
  local tag="$1"

  if [ -z "$tag" ]; then
    usage
    return 1
  fi

  local previous_tag
  previous_tag="$(read_state current-tag)"

  if [ "$previous_tag" = "$tag" ]; then
    echo "deploy: $tag is already the current release" >&2
    return 1
  fi

  if image_exists "$tag"; then
    echo "deploy: using local image $SERVER_IMAGE:$tag"
  else
    compose pull server
  fi

  write_state previous-tag "$previous_tag"
  up_with_tag "$tag"
  write_state current-tag "$tag"

  if ! wait_for_health; then
    echo "deploy: health check failed for $tag; rolling back" >&2

    if [ -n "$previous_tag" ]; then
      up_with_tag "$previous_tag"
      write_state current-tag "$previous_tag"
    else
      compose stop server
    fi

    return 1
  fi

  echo "deploy: release $tag is active and healthy"
}

rollback_release() {
  local tag="$1"

  if [ -z "$tag" ]; then
    tag="$(read_state previous-tag)"
  fi

  if [ -z "$tag" ]; then
    echo "rollback: no previous release recorded" >&2
    return 1
  fi

  if ! image_exists "$tag"; then
    compose pull server
  fi

  local current_tag
  current_tag="$(read_state current-tag)"
  write_state previous-tag "$current_tag"
  up_with_tag "$tag"
  write_state current-tag "$tag"

  if ! wait_for_health; then
    echo "rollback: health check failed after switching to $tag" >&2
    return 1
  fi

  echo "rollback: active release is $tag"
}

show_status() {
  local current_tag
  local previous_tag
  current_tag="$(read_state current-tag)"
  previous_tag="$(read_state previous-tag)"

  echo "current tag: ${current_tag:-<none>}"
  echo "previous tag: ${previous_tag:-<none>}"
  echo "health: $(curl -fsS "$HEALTH_URL" || echo unavailable)"
  compose ps
}

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
