#!/bin/bash
# Installs what a session needs before it can run the repo's own checks:
# `npm test`, `npm run lint`, `npm run typecheck`. Typecheck in particular
# fails without a generated Prisma client, which is not in the repository.
set -euo pipefail

# Local machines manage their own dependencies; this is for the web sessions.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

npm install --no-audit --no-fund

# `prisma generate` needs the datasource urls to be set, but never connects —
# these placeholders only satisfy the schema validation. A session that talks to
# a real database sets its own (see docs/dev-environment.md).
DATABASE_URL="${DATABASE_URL:-postgresql://placeholder@localhost:5432/placeholder}" \
DIRECT_URL="${DIRECT_URL:-postgresql://placeholder@localhost:5432/placeholder}" \
  npx prisma generate
