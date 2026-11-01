#!/usr/bin/env bash
# Install the full pipeline on this Mac at 03:00 host time (Europe/Belgrade).
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AGENT_PATH="$HOME/Library/LaunchAgents/rs.aposteka.catalog.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$REPO_ROOT/cache"
python3 - "$REPO_ROOT" "$AGENT_PATH" "$HOME" <<'PY'
import plistlib,sys
root,dest,home=sys.argv[1:]
with open(dest,'wb') as f:
 plistlib.dump({'Label':'rs.aposteka.catalog','ProgramArguments':['/bin/bash',root+'/deploy/scrapers/run-pipeline.sh'],'WorkingDirectory':root,
 'StartCalendarInterval':{'Hour':3,'Minute':0},'EnvironmentVariables':{'PATH':home+'/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin','SYNC':'1','TZ':'Europe/Belgrade','SKIP_CANONICALIZE':'1','SCRAPER_ALERT_WEBHOOK':''},
 'StandardOutPath':root+'/cache/scheduled-pipeline.log','StandardErrorPath':root+'/cache/scheduled-pipeline-error.log','ProcessType':'Background'},f)
PY
plutil -lint "$AGENT_PATH"
launchctl bootout "gui/$(id -u)" "$AGENT_PATH" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$AGENT_PATH"
launchctl print "gui/$(id -u)/rs.aposteka.catalog" | head -28

HEALTH_AGENT="$HOME/Library/LaunchAgents/rs.aposteka.health.plist"
python3 - "$REPO_ROOT" "$HEALTH_AGENT" "$HOME" <<'PYHEALTH'
import plistlib,sys
root,dest,home=sys.argv[1:]
with open(dest,'wb') as f:
 plistlib.dump({'Label':'rs.aposteka.health','ProgramArguments':[home+'/.bun/bin/bun','catalog-health.ts','--check'],
 'WorkingDirectory':root+'/scrapers','StartCalendarInterval':{'Hour':12,'Minute':0},
 'EnvironmentVariables':{'PATH':home+'/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin','TZ':'Europe/Belgrade'},
 'StandardOutPath':root+'/cache/scheduled-source-health.json','StandardErrorPath':root+'/cache/scheduled-source-health-error.log','ProcessType':'Background'},f)
PYHEALTH
plutil -lint "$HEALTH_AGENT"
launchctl bootout "gui/$(id -u)" "$HEALTH_AGENT" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$HEALTH_AGENT"
launchctl print "gui/$(id -u)/rs.aposteka.health" | head -18
