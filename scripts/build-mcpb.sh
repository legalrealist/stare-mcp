#!/usr/bin/env bash
# Build the Claude Desktop extension bundle (dist/stare-mcp.mcpb).
# Stages lib/, data/, and production-only node_modules, then packs.
set -euo pipefail

cd "$(dirname "$0")/.."
STAGE=build/mcpb
rm -rf "$STAGE" dist
mkdir -p "$STAGE" dist

cp -R lib data manifest.json package.json package-lock.json COURTS-DB-LICENSE "$STAGE"/
(cd "$STAGE" && npm install --omit=dev --no-audit --no-fund --silent)

npx -y @anthropic-ai/mcpb validate "$STAGE/manifest.json"
npx -y @anthropic-ai/mcpb pack "$STAGE" dist/stare-mcp.mcpb
npx -y @anthropic-ai/mcpb info dist/stare-mcp.mcpb
