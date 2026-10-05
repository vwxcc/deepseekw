#!/bin/bash
# Commit and push to GitHub using GITHUB_TOKEN from .env (never hard-coded).
cd /DATA/AppData/chatstudio-v2 || exit 1
TOKEN=$(grep '^GITHUB_TOKEN=' .env 2>/dev/null | cut -d= -f2-)
[ -z "$TOKEN" ] && { echo "no GITHUB_TOKEN in .env"; exit 1; }
URL="https://vwxcc:${TOKEN}@github.com/vwxcc/deepseekw.git"
docker commit chatstudio-v2 chatstudio-v2:latest >/dev/null 2>&1
git add -A
git -c user.email=agent@chatstudio.local -c user.name=ChatStudio \
    commit -q -m "${1:-update}" 2>/dev/null || true
git fetch "$URL" main --quiet 2>/dev/null || true
git push "$URL" HEAD:main --force 2>&1 | sed -e 's#https://[^@]*@#https://***@#g'
