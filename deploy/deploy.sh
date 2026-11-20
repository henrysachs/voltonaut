#!/usr/bin/env bash
# Deploy, roll back, and inspect the Voltonaut API containers on the Hetzner VPS.
# Run inside a checkout of deploy/ (see deploy/README.md). Requires docker and the
# compose plugin. TLS and routing come from the existing Financensor Traefik.
set -Eeuo pipefail

COMPOSE_FILE="${VOLTONAUT_COMPOSE_FILE:-compose.yaml}"
STATE_DIR="${VOLTONAUT_STATE_DIR:-state}"
HEALTH_URL="${VOLTONAUT_HEALTH_URL:-https://api.voltonaut.stammkneipe.dev/healthz}"
HEALTH_ATTEMPTS="${VOLTONAUT_HEALTH_ATTEMPTS:-30}"
ENV_FILE="${VOLTONAUT_ENV_FILE:-deploy.env}"

usage() {
  echo "usage: deploy.sh deploy <image-tag>" >&2
  echo "       deploy.sh rollback [image-tag]" >&2
  echo "       deploy.sh status" >&2
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
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
  VOLTONAUT_TAG="$1" compose up -d --wait --wait-timeout 90
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

  local image
  image="$(VOLTONAUT_TAG="$tag" compose config --images server)"

  if docker image inspect "$image" >/dev/null 2>&1; then
    echo "deploy: using local image $image"
  else
    VOLTONAUT_TAG="$tag" compose pull server
  fi

  if ! up_with_tag "$tag" || ! wait_for_health; then
    echo "deploy: health check failed for $tag; rolling back" >&2

    if [ -n "$previous_tag" ]; then
      if ! up_with_tag "$previous_tag" || ! wait_for_health; then
        echo "deploy: recovery failed; recorded tags describe the last confirmed release only" >&2
      fi
    else
      VOLTONAUT_TAG="$tag" compose stop server
    fi

    return 1
  fi

  write_state previous-tag "$previous_tag"
  write_state current-tag "$tag"
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

  deploy_release "$tag"
}

show_status() {
  local current_tag
  local previous_tag
  current_tag="$(read_state current-tag)"
  previous_tag="$(read_state previous-tag)"

  echo "current tag: ${current_tag:-<none>}"
  echo "previous tag: ${previous_tag:-<none>}"
  echo "health: $(curl -fsS "$HEALTH_URL" || echo unavailable)"
  VOLTONAUT_TAG="${current_tag:-unreleased}" compose ps
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
