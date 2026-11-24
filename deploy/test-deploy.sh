#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_SCRIPT="$(cd "$(dirname "$0")" && pwd)/deploy.sh"
export REAL_DOCKER="$(command -v docker)"
temporary="$(mktemp -d "${TMPDIR:-/tmp}/voltonaut-release-test.XXXXXX")"
trap 'rm -rf "$temporary"' EXIT
mkdir -p "$temporary/bin"
export TEST_ROOT="$temporary" PATH="$temporary/bin:$PATH"
export VOLTONAUT_STATE_DIR="$temporary/state" VOLTONAUT_HEALTH_ATTEMPTS=1
export VOLTONAUT_COMPOSE_FILE="$(dirname "$DEPLOY_SCRIPT")/compose.yaml"
export VOLTONAUT_ENV_FILE="$temporary/deploy.env"
unset VOLTONAUT_IMAGE VOLTONAUT_TAG VOLTONAUT_BACKUP_FILE
unset AUTH_MODE CLIENT_ORIGIN OIDC_PROVIDERS OIDC_CLOUDFLARE_ISSUER OIDC_CLOUDFLARE_CLIENT_ID OIDC_CLOUDFLARE_CLIENT_SECRET OIDC_CLOUDFLARE_REDIRECT_URI
unset LITESTREAM_BUCKET LITESTREAM_ENDPOINT LITESTREAM_ACCESS_KEY_ID LITESTREAM_SECRET_ACCESS_KEY
cat >"$temporary/base.env" <<ENV
AUTH_MODE=disabled
CLIENT_ORIGIN=https://voltonaut.stammkneipe.dev
ENV
chmod 600 "$temporary/base.env"

cat >"$temporary/bin/docker" <<'COMMAND'
#!/usr/bin/env bash
set -eu
printf '%s|%s\n' "${VOLTONAUT_TAG:-unset}" "$*" >>"$TEST_ROOT/commands"
if [ "$1 $2" = 'image inspect' ]; then
  [ "${MISSING_IMAGE:-false}" != true ]
  if [ -n "${LOCAL_IMAGE:-}" ]; then [[ "$3" = "$LOCAL_IMAGE:"* ]]; fi
  exit
fi
[ "$1" = compose ]; shift
options=()
env_file=''
while [ "$1" != config ] && [ "$1" != up ] && [ "$1" != stop ] && [ "$1" != pull ] && [ "$1" != ps ] \
  && [ "$1" != run ]; do
  if [ "$1" = --env-file ]; then env_file="$2"; fi
  options+=("$1"); shift
done
if [ "$1" = config ]; then
  [ "$*" = 'config --images server' ] || [ "$*" = config ]
  exec "$REAL_DOCKER" compose "${options[@]}" "$@"
fi
"$REAL_DOCKER" compose "${options[@]}" config --quiet
case "$1" in
  up)
    printf '%s' "$VOLTONAUT_TAG" >"$TEST_ROOT/active"
    # What Compose actually hands to the container, not just what the env file contains.
    "$REAL_DOCKER" compose "${options[@]}" config >"$TEST_ROOT/active-env"
    [ "${FAIL_UP_TAG:-}" != "$VOLTONAUT_TAG" ]
    ;;
  run)
    [ "$*" = 'run --rm --no-deps -T --label traefik.enable=false server node dist/main.js check-config' ]
    [ "${INVALID_CONFIG_TAG:-}" != "$VOLTONAUT_TAG" ]
    ;;
  stop) rm -f "$TEST_ROOT/active" ;;
  pull) [ "${OFFLINE_REGISTRY:-false}" != true ] ;;
esac
COMMAND
cat >"$temporary/bin/curl" <<'COMMAND'
#!/usr/bin/env bash
set -eu
[ -f "$TEST_ROOT/active" ]
[ "$(cat "$TEST_ROOT/active")" != "${UNHEALTHY_TAG:-}" ]
# Optional model of ADR-026, read from the rendered container environment: the pre-ADR release
# only starts with the single OIDC_* set, every later release only with OIDC_PROVIDERS.
if [ -n "${LEGACY_RELEASE:-}" ]; then
  if [ "$(cat "$TEST_ROOT/active")" = "$LEGACY_RELEASE" ]; then
    grep -Eq '^[[:space:]]+OIDC_ISSUER: [^[:space:]]' "$TEST_ROOT/active-env"
  else
    grep -Eq '^[[:space:]]+OIDC_PROVIDERS: [^[:space:]]' "$TEST_ROOT/active-env"
  fi
fi
COMMAND
printf '#!/usr/bin/env bash\nexit 0\n' >"$temporary/bin/sleep"
chmod +x "$temporary/bin/"*

reset_state() {
  rm -rf "$VOLTONAUT_STATE_DIR"
  rm -f "$temporary/active" "$temporary/active-env"
  : >"$temporary/commands"
  cp "$temporary/base.env" "$VOLTONAUT_ENV_FILE"
  unset MISSING_IMAGE UNHEALTHY_TAG FAIL_UP_TAG LOCAL_IMAGE OFFLINE_REGISTRY VOLTONAUT_IMAGE VOLTONAUT_BACKUP_FILE
  unset INVALID_CONFIG_TAG LEGACY_RELEASE
}

base_without_backup() {
  reset_state
  local services
  services="$(VOLTONAUT_TAG=proof "$REAL_DOCKER" compose --env-file "$VOLTONAUT_ENV_FILE" \
    -f "$VOLTONAUT_COMPOSE_FILE" config --services)"
  test "$services" = server
  bash "$DEPLOY_SCRIPT" deploy without-backup >"$temporary/output"
  expect_tag current without-backup
  echo 'Base Compose and release passed without backup credentials or sidecar.'
}

optional_backup_requires_credentials() {
  local key
  for key in LITESTREAM_ENDPOINT LITESTREAM_BUCKET LITESTREAM_ACCESS_KEY_ID LITESTREAM_SECRET_ACCESS_KEY; do
    reset_state
    export VOLTONAUT_BACKUP_FILE="$(dirname "$DEPLOY_SCRIPT")/compose.backup.yaml"
    printf '\nLITESTREAM_ENDPOINT=https://storage.example.invalid\nLITESTREAM_BUCKET=release-proof\nLITESTREAM_ACCESS_KEY_ID=release-proof\nLITESTREAM_SECRET_ACCESS_KEY=release-proof\n' >>"$VOLTONAUT_ENV_FILE"
    sed "/^$key=/d" "$VOLTONAUT_ENV_FILE" >"$temporary/missing.env"
    mv "$temporary/missing.env" "$VOLTONAUT_ENV_FILE"
    expect_failure deploy missing-backup-value
    expect_tag current ''
    if grep -Eq ' (up|pull) ' "$temporary/commands"; then
      echo 'missing backup credentials must fail before starting or pulling a release' >&2
      return 1
    fi
  done
  reset_state
  export VOLTONAUT_BACKUP_FILE="$(dirname "$DEPLOY_SCRIPT")/compose.backup.yaml"
  printf '\nLITESTREAM_ENDPOINT=https://storage.example.invalid\nLITESTREAM_BUCKET=release-proof\nLITESTREAM_ACCESS_KEY_ID=release-proof\nLITESTREAM_SECRET_ACCESS_KEY=release-proof\n' >>"$VOLTONAUT_ENV_FILE"
  bash "$DEPLOY_SCRIPT" deploy with-backup >"$temporary/output"
  expect_tag current with-backup
  reset_state
}

oidc_env() {
  printf 'AUTH_MODE=oidc\nCLIENT_ORIGIN=https://voltonaut.stammkneipe.dev\n' >"$VOLTONAUT_ENV_FILE"
  printf '%s\n' "$@" >>"$VOLTONAUT_ENV_FILE"
}

legacy_oidc_config_blocks_release() {
  reset_state
  oidc_env OIDC_ISSUER=https://login.example.invalid/oidc OIDC_CLIENT_ID=synthetic-client \
    "OIDC_CLIENT_SECRET=\"legacy-secret-must-not-print\"" \
    OIDC_REDIRECT_URI=https://api.voltonaut.stammkneipe.dev/v1/auth/oidc/callback
  expect_failure deploy legacy
  grep -q 'removed single OIDC_\* set' "$temporary/output"
  grep -q 'provision_env.py migrate' "$temporary/output"
  if grep -q 'legacy-secret-must-not-print' "$temporary/output"; then
    echo 'the release check must not print configuration values' >&2
    return 1
  fi
  reset_state
  oidc_env OIDC_CLOUDFLARE_ISSUER=https://login.example.invalid/oidc
  expect_failure deploy without-providers
  grep -q 'requires OIDC_PROVIDERS' "$temporary/output"
  expect_tag current ''
  if grep -Eq ' (up|pull|config) ' "$temporary/commands"; then
    echo 'a legacy OIDC configuration must fail before Compose, pulls or starts' >&2
    return 1
  fi
  reset_state
  oidc_env 'OIDC_PROVIDERS="cloudflare"' OIDC_CLOUDFLARE_ISSUER=https://login.example.invalid/oidc \
    OIDC_CLOUDFLARE_CLIENT_ID=synthetic-client OIDC_CLOUDFLARE_CLIENT_SECRET=synthetic-secret \
    OIDC_CLOUDFLARE_REDIRECT_URI=https://api.voltonaut.stammkneipe.dev/v1/auth/oidc/cloudflare/callback
  bash "$DEPLOY_SCRIPT" deploy provider-list >"$temporary/output"
  expect_tag current provider-list
  echo 'Legacy single-set OIDC configuration is refused before any release step.'
}

legacy_release_env() {
  oidc_env OIDC_ISSUER=https://login.example.invalid/oidc OIDC_CLIENT_ID=synthetic-client \
    OIDC_CLIENT_SECRET=synthetic-secret \
    OIDC_REDIRECT_URI=https://api.voltonaut.stammkneipe.dev/v1/auth/oidc/callback
}

provider_release_env() {
  oidc_env 'OIDC_PROVIDERS="cloudflare"' OIDC_CLOUDFLARE_ISSUER=https://login.example.invalid/oidc \
    OIDC_CLOUDFLARE_CLIENT_ID=synthetic-client OIDC_CLOUDFLARE_CLIENT_SECRET=synthetic-secret \
    OIDC_CLOUDFLARE_REDIRECT_URI=https://api.voltonaut.stammkneipe.dev/v1/auth/oidc/cloudflare/callback
}

expect_active() {
  test "$(cat "$temporary/active")" = "$1"
  grep -Eq "^[[:space:]]+$2: [^[:space:]]" "$temporary/active-env"
}

# compose.yaml as shipped before ADR-026: passes the single OIDC_* set through.
legacy_compose() {
  sed '/OIDC_/d' "$(dirname "$DEPLOY_SCRIPT")/compose.yaml" | sed '/CORS_ORIGINS:/a\
      OIDC_ISSUER: ${OIDC_ISSUER:-}\
      OIDC_CLIENT_ID: ${OIDC_CLIENT_ID:-}\
      OIDC_CLIENT_SECRET: ${OIDC_CLIENT_SECRET:-}\
      OIDC_REDIRECT_URI: ${OIDC_REDIRECT_URI:-}' >"$1"
}

adr025_transition_keeps_a_working_rollback() {
  local snapshots="$VOLTONAUT_STATE_DIR/config" live="$temporary/live" shipped="$VOLTONAUT_COMPOSE_FILE"
  reset_state
  mkdir -p "$live" "$VOLTONAUT_STATE_DIR"
  legacy_compose "$temporary/legacy-compose.yaml"
  grep -q 'OIDC_ISSUER: ' "$temporary/legacy-compose.yaml"
  export LEGACY_RELEASE=legacy VOLTONAUT_COMPOSE_FILE="$live/compose.yaml"
  # A release started by the previous deploy.sh with the previous compose.yaml and deploy.env.
  cp "$temporary/legacy-compose.yaml" "$live/compose.yaml"
  legacy_release_env
  printf legacy >"$VOLTONAUT_STATE_DIR/current-tag"
  printf legacy >"$temporary/active"
  VOLTONAUT_TAG=legacy "$REAL_DOCKER" compose --project-directory "$live" --env-file "$VOLTONAUT_ENV_FILE" \
    -f "$live/compose.yaml" config >"$temporary/active-env"
  expect_active legacy OIDC_ISSUER

  # An early main deploy ships the new compose.yaml first; the guard keeps the old container.
  cp "$shipped" "$live/compose.yaml"
  expect_failure deploy new
  grep -q 'removed single OIDC_\* set' "$temporary/output"
  expect_active legacy OIDC_ISSUER
  # That shipped file would not pass the old settings: snapshot refuses the inconsistent pair.
  expect_failure snapshot
  grep -q 'does not pass the OIDC settings' "$temporary/output"
  test ! -e "$snapshots/legacy"
  bash "$DEPLOY_SCRIPT" snapshot "$temporary/legacy-compose.yaml" >"$temporary/output"
  cmp -s "$temporary/legacy-compose.yaml" "$snapshots/legacy/compose.yaml"
  test "$(stat -c %a "$snapshots/legacy")" = 700
  test "$(stat -c %a "$snapshots/legacy/deploy.env")" = 600
  test "$(stat -c %a "$snapshots/legacy/compose.yaml")" = 600
  provider_release_env

  export INVALID_CONFIG_TAG=new
  expect_failure deploy new
  grep -q 'rejected its configuration before the switch' "$temporary/output"
  if grep -Eq '^new\|.* up ' "$temporary/commands"; then
    echo 'a rejected configuration must not replace the running release' >&2
    return 1
  fi
  expect_active legacy OIDC_ISSUER
  expect_tag current legacy
  unset INVALID_CONFIG_TAG

  export UNHEALTHY_TAG=new
  expect_failure deploy new
  if grep -q 'recovery failed' "$temporary/output"; then
    echo 'the previous release must recover with its own saved configuration' >&2
    return 1
  fi
  expect_active legacy OIDC_ISSUER
  expect_tag current legacy
  unset UNHEALTHY_TAG

  bash "$DEPLOY_SCRIPT" deploy new >"$temporary/output"
  expect_active new OIDC_PROVIDERS
  expect_tag current new
  expect_tag previous legacy
  bash "$DEPLOY_SCRIPT" rollback >"$temporary/output"
  expect_active legacy OIDC_ISSUER
  expect_tag current legacy
  grep -q '^OIDC_PROVIDERS=' "$VOLTONAUT_ENV_FILE"
  bash "$DEPLOY_SCRIPT" rollback >"$temporary/output"
  expect_active new OIDC_PROVIDERS
  expect_tag current new

  bash "$DEPLOY_SCRIPT" deploy third >"$temporary/output"
  test "$(ls "$snapshots" | tr '\n' ' ')" = 'new third '
  export VOLTONAUT_COMPOSE_FILE="$shipped"
  reset_state
  echo 'ADR-026 transition validates before the switch and recovers the previous release with its configuration.'
}

deploy_requires_saved_configuration_of_running_release() {
  reset_state
  provider_release_env
  mkdir -p "$VOLTONAUT_STATE_DIR"
  printf unsaved >"$VOLTONAUT_STATE_DIR/current-tag"
  expect_failure deploy next
  grep -q 'no saved configuration for the running release unsaved' "$temporary/output"
  if grep -Eq ' (up|pull|run) ' "$temporary/commands"; then
    echo 'a deploy without a recoverable running release must stop before any release step' >&2
    return 1
  fi
  bash "$DEPLOY_SCRIPT" snapshot >"$temporary/output"
  bash "$DEPLOY_SCRIPT" deploy next >"$temporary/output"
  expect_tag current next
  expect_tag previous unsaved
  reset_state
}

expect_failure() {
  if bash "$DEPLOY_SCRIPT" "$@" >"$temporary/output" 2>&1; then
    echo "unexpected success: $*" >&2
    exit 1
  fi
}

expect_tag() {
  local actual=""
  if [ -f "$VOLTONAUT_STATE_DIR/$1-tag" ]; then actual="$(cat "$VOLTONAUT_STATE_DIR/$1-tag")"; fi
  if [ "$actual" != "$2" ]; then
    echo "expected $1=$2, got $actual" >&2
    exit 1
  fi
}

first_deploy_stops() {
  reset_state
  export UNHEALTHY_TAG=broken
  expect_failure deploy broken
  expect_tag current ''
  expect_tag previous ''
  if [ -f "$temporary/active" ]; then
    echo 'failed first deployment must stop the server with valid tagged Compose configuration' >&2
    return 1
  fi
}

selects_local_image() {
  local source
  for source in file process; do
    reset_state
    printf '\nVOLTONAUT_IMAGE=review-file-server\n' >>"$VOLTONAUT_ENV_FILE"
    export LOCAL_IMAGE=review-file-server OFFLINE_REGISTRY=true
    if [ "$source" = process ]; then
      export LOCAL_IMAGE=review-process-server VOLTONAUT_IMAGE=review-process-server
    fi
    if ! bash "$DEPLOY_SCRIPT" deploy requested >"$temporary/output" 2>&1; then
      echo "$source-selected local image must deploy without contacting the offline registry" >&2
      return 1
    fi
    expect_tag current requested
    if grep -q ' pull server$' "$temporary/commands"; then
      echo 'a locally present selected image must not be pulled' >&2
      return 1
    fi
  done
}

case "${1:-all}" in
  first-deploy) first_deploy_stops; exit ;;
  image-selection) selects_local_image; exit ;;
  base-no-backup) base_without_backup; exit ;;
  all) ;;
  *) exit 2 ;;
esac

base_without_backup
optional_backup_requires_credentials

reset_state
expect_failure rollback
bash "$DEPLOY_SCRIPT" status >"$temporary/output"
grep -q 'current tag: <none>' "$temporary/output"
export MISSING_IMAGE=true
bash "$DEPLOY_SCRIPT" deploy requested >"$temporary/output"
grep -Eq '^requested\|.* pull server$' "$temporary/commands"
expect_tag current requested
expect_tag previous ''

first_deploy_stops

reset_state
bash "$DEPLOY_SCRIPT" deploy oldest >"$temporary/output"
bash "$DEPLOY_SCRIPT" deploy stable >"$temporary/output"
export UNHEALTHY_TAG=broken
expect_failure deploy broken
expect_tag current stable
expect_tag previous oldest
test "$(cat "$temporary/active")" = stable

export FAIL_UP_TAG=stable
expect_failure deploy broken
grep -q 'recovery failed' "$temporary/output"
expect_tag current stable
expect_tag previous oldest
unset FAIL_UP_TAG

export FAIL_UP_TAG=partial
expect_failure deploy partial
expect_tag current stable
expect_tag previous oldest
test "$(cat "$temporary/active")" = stable
unset FAIL_UP_TAG

expect_failure rollback broken
expect_tag current stable
expect_tag previous oldest
test "$(cat "$temporary/active")" = stable

unset UNHEALTHY_TAG
bash "$DEPLOY_SCRIPT" rollback >"$temporary/output"
expect_tag current oldest
expect_tag previous stable
bash "$DEPLOY_SCRIPT" rollback >"$temporary/output"
expect_tag current stable
expect_tag previous oldest
expect_failure rollback stable
expect_tag current stable
expect_tag previous oldest

if grep -Eq 'remove-orphans| down|prune|volume rm' "$temporary/commands"; then
  echo 'release commands must preserve other services and volumes' >&2
  exit 1
fi
selects_local_image
legacy_oidc_config_blocks_release
adr025_transition_keeps_a_working_rollback
deploy_requires_saved_configuration_of_running_release
echo 'Release command tests passed. Pull tag, health commit, recovery, rollback, preserved data.'
