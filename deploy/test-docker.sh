#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
temporary="$(mktemp -d "${TMPDIR:-/tmp}/voltonaut-proof.XXXXXX")"
mkdir "$temporary/data"
chmod 755 "$temporary"
chmod 777 "$temporary/data"
project="voltonaut-proof-$(basename "$temporary" | tr '[:upper:].' '[:lower:]-')"
image="$project:proof"
replica="$project-replica"
restored="$project-restored"
legacy="$project-legacy"
unset AUTH_MODE CLIENT_ORIGIN OIDC_ISSUER OIDC_CLIENT_ID OIDC_CLIENT_SECRET OIDC_REDIRECT_URI
unset LITESTREAM_BUCKET LITESTREAM_ENDPOINT LITESTREAM_ACCESS_KEY_ID LITESTREAM_SECRET_ACCESS_KEY
export VOLTONAUT_IMAGE="$project" VOLTONAUT_TAG=proof
compose() {
  docker compose -p "$project" --env-file "$temporary/local.env" \
    -f "$root/deploy/compose.yaml" -f "$temporary/override.yaml" "$@"
}
cleanup() {
  compose logs --no-color >"$temporary/containers.log" 2>&1 || true
  compose down --volumes >"$temporary/cleanup.log" 2>&1 || true
  docker rm -f "$project-restored-server" >>"$temporary/cleanup.log" 2>&1 || true
  docker volume rm "$replica" "$restored" "$legacy" >>"$temporary/cleanup.log" 2>&1 || true
  printf 'Proof files and resource ledger: %s\n' "$temporary"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf 'project=%s\nimage=%s\nreplica=%s\nrestored=%s\nlegacy=%s\n' \
  "$project" "$image" "$replica" "$restored" "$legacy" >"$temporary/resources.txt"
cat >"$temporary/local.env" <<ENV
AUTH_MODE=disabled
CLIENT_ORIGIN=https://voltonaut.stammkneipe.dev
OIDC_ISSUER=https://identity.example.invalid/oidc/proof
OIDC_CLIENT_ID=$project
OIDC_CLIENT_SECRET='$project-local-only'
OIDC_REDIRECT_URI=https://api.voltonaut.stammkneipe.dev/v1/auth/oidc/callback
LITESTREAM_ENDPOINT=https://storage.example.invalid
LITESTREAM_BUCKET=$project
LITESTREAM_ACCESS_KEY_ID=$project
LITESTREAM_SECRET_ACCESS_KEY='$project-local-only'
ENV
chmod 600 "$temporary/local.env"
cat >"$temporary/litestream.yml" <<'YAML'
socket:
  enabled: true
  path: /tmp/voltonaut-litestream.sock
dbs:
  - path: /data/voltonaut.db
    replicas:
      - type: file
        path: /replica/voltonaut
YAML
cp "$temporary/litestream.yml" "$temporary/working-litestream.yml"
cat >"$temporary/override.yaml" <<YAML
services:
  server:
    labels:
      traefik.enable: "false"
    volumes:
      - $temporary/data:/proof
      - $root/deploy/verify-data.ts:/verify-data.ts:ro
  litestream:
    volumes:
      - $temporary/litestream.yml:/etc/litestream/litestream.yml:ro
      - replica:/replica
volumes:
  replica:
    external: true
    name: $replica
networks:
  traefik:
    name: $project-private
    external: false
    internal: true
  default:
    name: $project-backup-private
    internal: true
YAML
compose config --quiet
sed '/^AUTH_MODE=/d' "$temporary/local.env" >"$temporary/missing.env"
if docker compose -p "$project" --env-file "$temporary/missing.env" \
  -f "$root/deploy/compose.yaml" config --quiet >"$temporary/missing-mode.log" 2>&1; then
  echo 'Compose must reject a missing auth mode' >&2
  exit 1
fi
docker build -f "$root/deploy/Dockerfile" -t "$image" "$root" >"$temporary/build.log" 2>&1
docker image inspect --format 'image-id={{.Id}} platform={{.Os}}/{{.Architecture}} user={{.Config.User}}' \
  "$image" >>"$temporary/resources.txt"
docker pull litestream/litestream:0.5.18 >"$temporary/pull.log" 2>&1
docker image inspect --format '{{json .Config.Entrypoint}} {{json .Config.User}}' \
  litestream/litestream:0.5.18 >"$temporary/litestream-image.txt"
docker run --rm --network none litestream/litestream:0.5.18 version >"$temporary/litestream-version.txt"
docker run --rm --network none litestream/litestream:0.5.18 replicate -h >"$temporary/replicate-help.txt" 2>&1
docker run --rm --network none litestream/litestream:0.5.18 restore -h >"$temporary/restore-help.txt" 2>&1
docker run --rm --network none litestream/litestream:0.5.18 sync -h >"$temporary/sync-help.txt" 2>&1
if docker run --rm --network none litestream/litestream:0.5.18 sh -c 'exit 0' >"$temporary/legacy-entrypoint.log" 2>&1; then
  echo 'Expected the old shell command to fail with the binary entrypoint' >&2
  exit 1
fi
for volume in "$replica" "$restored" "$legacy"; do
  docker volume create "$volume" >>"$temporary/resources.txt"
  docker run --rm --network none -v "$volume:/app/data" "$image" node -e \
    "require('node:assert/strict').equal(require('node:fs').existsSync('/app/data/voltonaut.db'),false)"
done
docker run --rm --network none --entrypoint /bin/sh -v "$legacy:/data" \
  litestream/litestream:0.5.18 -c 'touch /data/voltonaut.db'
docker run --rm --network none -v "$legacy:/app/data" "$image" node -e \
  "const fs=require('node:fs'),a=require('node:assert/strict');a.equal(fs.statSync('/app/data/voltonaut.db').uid,0);a.throws(()=>fs.openSync('/app/data/voltonaut.db','a'),{code:'EACCES'})"
docker run --rm -i --network none "$image" node --input-type=module >"$temporary/config-check.log" 2>&1 <<'JS'
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const valid = { PATH: process.env.PATH, NODE_ENV: 'production', AUTH_MODE: 'oidc',
  OIDC_ISSUER: 'https://identity.example.invalid/oidc/proof', OIDC_CLIENT_ID: crypto.randomUUID(),
  OIDC_CLIENT_SECRET: crypto.randomUUID(), CLIENT_ORIGIN: 'https://voltonaut.stammkneipe.dev',
  OIDC_REDIRECT_URI: 'https://api.voltonaut.stammkneipe.dev/v1/auth/oidc/callback' };
const invalid = ['AUTH_MODE','OIDC_ISSUER','OIDC_CLIENT_ID','OIDC_CLIENT_SECRET','OIDC_REDIRECT_URI']
  .map((key) => ({ ...valid, [key]: undefined }));
invalid.push({ ...valid, OIDC_REDIRECT_URI: 'https://api.voltonaut.stammkneipe.dev/wrong' });
invalid.push({ ...valid, AUTH_MODE: 'magic-link', MAIL_PROVIDER: 'memory' });
for (const env of invalid) {
  const result = spawnSync(process.execPath, ['dist/main.js'], { env, stdio: 'ignore', timeout: 5000 });
  assert.equal(result.error, undefined, 'invalid configuration exits rather than hanging');
  assert.notEqual(result.status, 0, 'invalid production configuration fails closed');
}
JS
compose up -d --wait --wait-timeout 90 >"$temporary/start.log" 2>&1
compose exec -T server node -e \
  "fetch('http://127.0.0.1:3000/v1/auth/config').then(async r=>require('node:assert/strict').deepEqual(await r.json(),{mode:'disabled'}))"
compose stop litestream >"$temporary/failed-replica-stop.log" 2>&1
sed 's|/replica/voltonaut|/cannot-write-proof|' "$temporary/working-litestream.yml" >"$temporary/litestream.yml"
if compose up -d --no-deps --force-recreate --wait --wait-timeout 60 litestream >"$temporary/failed-replica.log" 2>&1; then
  echo 'A running sidecar with an unwritable replica must not pass deployment health' >&2
  exit 1
fi
test "$(docker inspect --format '{{.State.Running}} {{.State.Health.Status}}' "$(compose ps -q litestream)")" = 'true unhealthy'
cp "$temporary/working-litestream.yml" "$temporary/litestream.yml"
compose up -d --no-deps --force-recreate --wait --wait-timeout 90 litestream >"$temporary/repaired-replica.log" 2>&1
sed 's/^AUTH_MODE=disabled$/AUTH_MODE=oidc/' "$temporary/local.env" >"$temporary/oidc.env"
mv "$temporary/oidc.env" "$temporary/local.env"
chmod 600 "$temporary/local.env"
compose up -d --wait --wait-timeout 90 >"$temporary/oidc-start.log" 2>&1
compose exec -T server node /verify-data.ts seed
compose restart server >"$temporary/restart.log" 2>&1
compose up -d --wait --wait-timeout 90 >>"$temporary/restart.log" 2>&1
compose exec -T server node /verify-data.ts verify
compose stop litestream >"$temporary/replica-stop.log" 2>&1
compose run --rm --no-deps -T litestream replicate -once -force-snapshot \
  -config /etc/litestream/litestream.yml >"$temporary/replicate-once.log" 2>&1
docker run --rm --network none --user 1000:1000 \
  -v "$replica:/replica:ro" -v "$restored:/restore" litestream/litestream:0.5.18 \
  restore -o /restore/voltonaut.db file:///replica/voltonaut >"$temporary/restore.log" 2>&1
if docker run --rm --network none --user 1000:1000 \
  -v "$replica:/replica:ro" -v "$restored:/restore" litestream/litestream:0.5.18 \
  restore -o /restore/voltonaut.db file:///replica/voltonaut >"$temporary/restore-existing.log" 2>&1; then
  echo 'Restore unexpectedly overwrote an existing database' >&2
  exit 1
fi
docker run -d --name "$project-restored-server" --network none \
  --env-file "$temporary/local.env" -e DATABASE_PATH=/app/data/voltonaut.db -e HOST=127.0.0.1 \
  -v "$restored:/app/data" -v "$temporary/data:/proof" \
  -v "$root/deploy/verify-data.ts:/verify-data.ts:ro" "$image" >>"$temporary/resources.txt"
docker exec "$project-restored-server" node --input-type=module -e \
  "for(let n=0;;n++){try{const r=await fetch('http://127.0.0.1:3000/healthz');if(r.ok)break;}catch{}if(n>=100)process.exit(1);await new Promise(r=>setTimeout(r,100));}"
docker exec "$project-restored-server" node /verify-data.ts verify
printf 'PASS. Actual image, node-owned SQLite, migrations, restart and Litestream filesystem restore. NOT an external S3 backup.\n' | tee "$temporary/result.txt"
