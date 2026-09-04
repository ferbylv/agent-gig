#!/usr/bin/env bash
set -e
cd /workspace/agent-gig
git reset HEAD
rm -f scripts/_install.sh scripts/_restart_api.sh scripts/_run_e2e.sh scripts/_start_api.sh scripts/_git_prep.sh packages/shared/_test_crypto.ts packages/shared/scripts_test.ts
git add -A
git reset -- data/store.json 2>/dev/null || true
git status --short | head -60
ls README.md
