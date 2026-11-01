#!/usr/bin/env bash
# Patch only logging/Referrer-Policy, preserving the server's TLS configuration.
set -euo pipefail
ssh -o BatchMode=yes "${1:-pharma}" bash -s <<'ENDSSH'
set -euo pipefail
config=$(readlink -f /etc/nginx/sites-enabled/pharma-search)
backup="/var/backups/pharma-search/nginx-$(date +%Y%m%d-%H%M%S).conf"
mkdir -p /var/backups/pharma-search
cp "$config" "$backup"
python3 - "$config" <<'PY'
import sys
from pathlib import Path
p=Path(sys.argv[1]);s=p.read_text()
if 'log_format pharma_private ' not in s:
 s='log_format pharma_private \'$remote_addr - [$time_local] "$request_method $uri $server_protocol" $status $body_bytes_sent\';\n'+s
s=s.replace('access_log /var/log/nginx/aposteka.access.log;', 'access_log /var/log/nginx/aposteka.access.log pharma_private;')
if 'Referrer-Policy' not in s:
 s=s.replace('add_header X-Content-Type-Options "nosniff" always;', 'add_header X-Content-Type-Options "nosniff" always;\n    add_header Referrer-Policy "strict-origin-when-cross-origin" always;')
p.write_text(s)
PY
if ! /usr/sbin/nginx -t; then cp "$backup" "$config"; exit 1; fi
systemctl reload nginx
ENDSSH
