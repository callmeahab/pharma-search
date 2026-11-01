#!/usr/bin/env bash
# Build in an isolated release directory; activate only after a published catalog.
# deploy.sh [server] --prepare ; deploy.sh [server] --activate /var/www/pharma-search-releases/...
set -euo pipefail
SERVER="${1:-pharma}"; shift || true
MODE="${1:---prepare}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "$MODE" == --prepare ]]; then
  SOURCE_VERSION="$(python3 "$REPO_ROOT/deploy/source-version.py")"
  VERSION="$SOURCE_VERSION-$(date +%Y%m%d%H%M%S)"
  RELEASE="/var/www/pharma-search-releases/$VERSION"
  ssh -o BatchMode=yes "$SERVER" "mkdir -p '$RELEASE'"
  rsync -az --delete --exclude='.git' --exclude='.env*' --exclude='.gradle' --exclude='mobile' --exclude='.claude' --exclude='.codex' --exclude='.devcontainer' --exclude='*.xlsx' --exclude='*.apk' --exclude='cache' --exclude='node_modules' \
    --exclude='.next' --exclude='ml' --exclude='scrapers' --exclude='scrapers_logs' --exclude='*.log' \
    --exclude='frontend/lib/gen' --exclude='*.tsbuildinfo' --exclude='pharma-server' \
    --exclude='pharma-search' --exclude='.gocache' --exclude='.gomodcache' \
    "$REPO_ROOT/" "$SERVER:$RELEASE/"
  ssh -o BatchMode=yes "$SERVER" bash -s -- "$RELEASE" "$VERSION" "$SOURCE_VERSION" <<'ENDSSH'
set -euo pipefail
release=$1; version=$2; source_version=$3
export PATH="/root/.bun/bin:/usr/local/go/bin:$PATH"
# Configuration is private and shared across releases; never synthesize credentials.
test -f /var/www/pharma-search/.env
ln -s /var/www/pharma-search/.env "$release/.env"
for file in .env .env.local .env.production; do
 if [[ -f "/var/www/pharma-search/frontend/$file" ]]; then ln -s "/var/www/pharma-search/frontend/$file" "$release/frontend/$file"; fi
done
cd "$release"
# Go protobuf output is generated locally and uploaded with this release.
go build -ldflags "-X main.buildVersion=$source_version" -o pharma-server .
go build -o migrate ./cmd/migrate
cd frontend
bun install --frozen-lockfile
CATALOG_API_URL=http://127.0.0.1:50051 NODE_OPTIONS=--max_old_space_size=1024 bun run build
test -f .next/BUILD_ID
cd ..
# The migration runner checks checksums and aborts on SQL errors.
install -d -m 700 -o postgres -g postgres /var/backups/pharma-search
sudo -u postgres pg_dump -d pharma_search -Fc -f "/var/backups/pharma-search/before-migration-$version.dump"
sudo -u postgres env DATABASE_URL='postgres:///pharma_search?host=/var/run/postgresql' "$release/migrate" -repo "$release" -seed-vendors=false
sudo -u postgres psql -d pharma_search -X -v ON_ERROR_STOP=1 -c 'GRANT ALL ON ALL TABLES IN SCHEMA public TO root; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO root;'
printf '%s\n' "$version" > RELEASE_VERSION
ENDSSH
  echo "Prepared release: $RELEASE"
  exit 0
fi
[[ "$MODE" == --activate ]] || { echo "Expected --prepare or --activate" >&2; exit 1; }
RELEASE="${2:?release path required}"
[[ "$RELEASE" =~ ^/var/www/pharma-search-releases/[a-zA-Z0-9_-]+$ ]] || exit 1
ssh -o BatchMode=yes "$SERVER" bash -s -- "$RELEASE" <<'ENDSSH'
set -euo pipefail
release=$1
export PATH="/root/.bun/bin:/usr/local/go/bin:$PATH"
test -f "$release/frontend/.next/BUILD_ID"
test -x "$release/pharma-server"
# Save only these two processes. A rollback does not restart unrelated apps.
umask 077
pm2 jlist > "$release/previous-pm2.json"
node - "$release" <<'NODE'
const fs=require('fs'); const dir=process.argv[2];
const old=JSON.parse(fs.readFileSync(dir+'/previous-pm2.json')).filter(p=>['pharma-backend','pharma-frontend'].includes(p.name));
fs.writeFileSync(dir+'/rollback.json',JSON.stringify({apps:old.map(p=>({name:p.name,cwd:p.pm2_env.pm_cwd,script:p.pm2_env.pm_exec_path,args:p.pm2_env.args,interpreter:p.pm2_env.exec_interpreter,env:p.pm2_env.env,autorestart:true}))}));
fs.writeFileSync(dir+'/release.json',JSON.stringify({apps:[
 {name:'pharma-backend',cwd:dir,script:dir+'/pharma-server',interpreter:'none',env:{NODE_ENV:'production'},max_memory_restart:'768M'},
 {name:'pharma-frontend',cwd:dir+'/frontend',script:'/root/.bun/bin/bun',args:'start',interpreter:'none',env:{NODE_ENV:'production',PORT:3000,CATALOG_API_URL:'http://127.0.0.1:50051',NODE_OPTIONS:'--max_old_space_size=384'},max_memory_restart:'512M'}
]}));
NODE
rollback() {
 echo "Activation failed; restoring previous application processes" >&2
 pm2 delete pharma-backend pharma-frontend >/dev/null 2>&1 || true
 pm2 start "$release/rollback.json" >/dev/null
 exit 1
}
trap rollback ERR
pm2 delete pharma-backend pharma-frontend >/dev/null 2>&1 || true
pm2 start "$release/release.json" >/dev/null
healthy=0
for attempt in $(seq 1 20); do
 if curl -fsS --max-time 10 http://127.0.0.1:50051/api/catalog/status > "$release/status.json" && curl -fsS --max-time 20 http://127.0.0.1:3000/ >/dev/null; then healthy=1; break; fi
 sleep 2
done
[[ "$healthy" == 1 ]]
trap - ERR
ln -sfn "$release" /var/www/pharma-search-current
pm2 save >/dev/null
printf 'Activated %s\n' "$release"
ENDSSH
