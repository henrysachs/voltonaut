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
unset VOLTONAUT_IMAGE VOLTONAUT_TAG
unset AUTH_MODE CLIENT_ORIGIN OIDC_ISSUER OIDC_CLIENT_ID OIDC_CLIENT_SECRET OIDC_REDIRECT_URI
unset LITESTREAM_BUCKET LITESTREAM_ENDPOINT LITESTREAM_ACCESS_KEY_ID LITESTREAM_SECRET_ACCESS_KEY
cat >"$temporary/base.env" <<ENV
AUTH_MODE=disabled
CLIENT_ORIGIN=https://voltonaut.stammkneipe.dev
LITESTREAM_ENDPOINT=https://storage.example.invalid
LITESTREAM_BUCKET=$(basename "$temporary")
LITESTREAM_ACCESS_KEY_ID=$(basename "$temporary")
LITESTREAM_SECRET_ACCESS_KEY=$(basename "$temporary")
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
while [ "$1" != config ] && [ "$1" != up ] && [ "$1" != stop ] && [ "$1" != pull ] && [ "$1" != ps ]; do
  options+=("$1"); shift
done
if [ "$1" = config ]; then
  [ "$*" = 'config --images server' ]
  exec "$REAL_DOCKER" compose "${options[@]}" "$@"
fi
"$REAL_DOCKER" compose "${options[@]}" config --quiet
case "$1" in
  up)
    printf '%s' "$VOLTONAUT_TAG" >"$TEST_ROOT/active"
    [ "${FAIL_UP_TAG:-}" != "$VOLTONAUT_TAG" ]
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
COMMAND
printf '#!/usr/bin/env bash\nexit 0\n' >"$temporary/bin/sleep"
chmod +x "$temporary/bin/"*

reset_state() {
  rm -rf "$VOLTONAUT_STATE_DIR"
  rm -f "$temporary/active"
  : >"$temporary/commands"
  cp "$temporary/base.env" "$VOLTONAUT_ENV_FILE"
  unset MISSING_IMAGE UNHEALTHY_TAG FAIL_UP_TAG LOCAL_IMAGE OFFLINE_REGISTRY VOLTONAUT_IMAGE
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
  all) ;;
  *) exit 2 ;;
esac

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
echo 'Release command tests passed. Pull tag, health commit, recovery, rollback, preserved data.'
