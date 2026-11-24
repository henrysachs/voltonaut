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
# Relative paths in Compose (env_file, bind mounts) always resolve against the live deploy
# directory, also when a release is started with its saved configuration snapshot.
PROJECT_DIR="$(dirname "$COMPOSE_FILE")"
SNAPSHOT_DIR="$STATE_DIR/config"

usage() {
  echo "usage: deploy.sh deploy <image-tag>" >&2
  echo "       deploy.sh rollback [image-tag]" >&2
  echo "       deploy.sh status" >&2
  echo "       deploy.sh snapshot" >&2
}

compose() {
  local files=(-f "$COMPOSE_FILE")
  if [ -n "${VOLTONAUT_BACKUP_FILE:-}" ]; then
    files+=(-f "$VOLTONAUT_BACKUP_FILE")
  fi
  docker compose --project-directory "$PROJECT_DIR" --env-file "$ENV_FILE" "${files[@]}" "$@"
}

valid_tag() {
  [[ "$1" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]
}

# Saves the configuration a release was confirmed healthy with: compose file and env file,
# private (0600), for the current and the previous release only.
snapshot_config() {
  local tag="$1" keep="${2:-}" target
  target="$SNAPSHOT_DIR/$tag"

  if [ "$COMPOSE_FILE" != "$target/compose.yaml" ] || [ "$ENV_FILE" != "$target/deploy.env" ]; then
    (
      umask 077
      mkdir -p "$target"
      cp -- "$COMPOSE_FILE" "$target/.compose.yaml.tmp"
      cp -- "$ENV_FILE" "$target/.deploy.env.tmp"
      chmod 600 "$target/.compose.yaml.tmp" "$target/.deploy.env.tmp"
      mv -f -- "$target/.compose.yaml.tmp" "$target/compose.yaml"
      mv -f -- "$target/.deploy.env.tmp" "$target/deploy.env"
    )
  fi

  local entry
  for entry in "$SNAPSHOT_DIR"/*; do
    [ -d "$entry" ] || continue
    case "$(basename "$entry")" in
      "$tag" | "$keep") ;;
      *) rm -rf -- "$entry" ;;
    esac
  done
}

has_snapshot() {
  [ -n "$1" ] && [ -f "$SNAPSHOT_DIR/$1/compose.yaml" ] && [ -f "$SNAPSHOT_DIR/$1/deploy.env" ]
}

# Runs "$@" with the saved configuration of a release, or the live one when none exists.
with_release_config() {
  local tag="$1"
  shift

  if has_snapshot "$tag"; then
    COMPOSE_FILE="$SNAPSHOT_DIR/$tag/compose.yaml" ENV_FILE="$SNAPSHOT_DIR/$tag/deploy.env" "$@"
  else
    echo "deploy: no saved configuration for $tag; using the live configuration" >&2
    "$@"
  fi
}

# Lets the new image parse its configuration in a one-off container before the running
# release is replaced. Output is discarded: errors may name configuration keys.
validate_config() {
  # The one-off container must never become a Traefik backend for live traffic.
  VOLTONAUT_TAG="$1" compose run --rm --no-deps -T --label traefik.enable=false \
    server node dist/main.js check-config >/dev/null 2>&1
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

# Refuses a release before touching containers when deploy.env still holds the single OIDC_*
# set removed by ADR-026. Only matches key names with grep -q; never prints or sources values.
check_auth_config() {
  if [ ! -f "$ENV_FILE" ]; then
    return 0
  fi

  if grep -Eq '^OIDC_(ISSUER|CLIENT_ID|CLIENT_SECRET|REDIRECT_URI)=' "$ENV_FILE"; then
    echo "deploy: $ENV_FILE still uses the removed single OIDC_* set (ADR-026)." >&2
    echo "deploy: run 'python3 provision_env.py migrate' and register /v1/auth/oidc/cloudflare/callback first" >&2
    return 1
  fi

  if grep -Eq '^AUTH_MODE="?oidc"?$' "$ENV_FILE" && ! grep -Eq '^OIDC_PROVIDERS="?[a-z]' "$ENV_FILE"; then
    echo "deploy: AUTH_MODE=oidc requires OIDC_PROVIDERS in $ENV_FILE (ADR-026)" >&2
    return 1
  fi
}

up_with_tag() {
  VOLTONAUT_TAG="$1" compose up -d --wait --wait-timeout 90
}

deploy_release() {
  local mode="$1" tag="$2"

  if [ -z "$tag" ]; then
    usage
    return 1
  fi

  if ! valid_tag "$tag"; then
    echo "deploy: invalid image tag" >&2
    return 1
  fi

  local previous_tag
  previous_tag="$(read_state current-tag)"

  if [ "$previous_tag" = "$tag" ]; then
    echo "deploy: $tag is already the current release" >&2
    return 1
  fi

  if [ "$mode" = deploy ]; then
    check_auth_config || return 1
  elif ! has_snapshot "$tag"; then
    check_auth_config || return 1
  fi

  local image
  image="$(VOLTONAUT_TAG="$tag" compose config --images server)"

  if docker image inspect "$image" >/dev/null 2>&1; then
    echo "deploy: using local image $image"
  else
    VOLTONAUT_TAG="$tag" compose pull server
  fi

  if [ "$mode" = deploy ] && ! validate_config "$tag"; then
    echo "deploy: $tag rejected its configuration before the switch; the running release is unchanged" >&2
    return 1
  fi

  if ! start_release "$mode" "$tag" || ! wait_for_health; then
    echo "deploy: health check failed for $tag; rolling back" >&2

    if [ -n "$previous_tag" ]; then
      if ! with_release_config "$previous_tag" up_with_tag "$previous_tag" || ! wait_for_health; then
        echo "deploy: recovery failed; recorded tags describe the last confirmed release only" >&2
      fi
    else
      VOLTONAUT_TAG="$tag" compose stop server
    fi

    return 1
  fi

  if [ "$mode" = deploy ] || ! has_snapshot "$tag"; then
    snapshot_config "$tag" "$previous_tag"
  else
    snapshot_config_of "$tag" "$previous_tag"
  fi

  write_state previous-tag "$previous_tag"
  write_state current-tag "$tag"
  echo "deploy: release $tag is active and healthy"
}

# A new release starts with the live configuration; a rollback with the target's snapshot.
start_release() {
  if [ "$1" = deploy ]; then
    up_with_tag "$2"
  else
    with_release_config "$2" up_with_tag "$2"
  fi
}

snapshot_config_of() {
  COMPOSE_FILE="$SNAPSHOT_DIR/$1/compose.yaml" ENV_FILE="$SNAPSHOT_DIR/$1/deploy.env" \
    snapshot_config "$1" "$2"
}

# One-time bootstrap: records the live configuration for the running release, e.g. before the
# ADR-026 provider-list migration replaces deploy.env.
snapshot_current() {
  local current_tag
  current_tag="$(read_state current-tag)"

  if [ -z "$current_tag" ] || ! valid_tag "$current_tag"; then
    echo "snapshot: no current release recorded" >&2
    return 1
  fi

  if has_snapshot "$current_tag"; then
    echo "snapshot: configuration for $current_tag already saved" >&2
    return 0
  fi

  snapshot_config "$current_tag" "$(read_state previous-tag)"
  echo "snapshot: saved configuration for $current_tag"
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

  deploy_release rollback "$tag"
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
    deploy_release deploy "${2:-}"
    ;;
  rollback)
    rollback_release "${2:-}"
    ;;
  status)
    show_status
    ;;
  snapshot)
    snapshot_current
    ;;
  *)
    usage
    exit 1
    ;;
esac
