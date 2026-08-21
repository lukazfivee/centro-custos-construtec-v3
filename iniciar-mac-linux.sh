#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Instale o Node.js LTS antes de continuar: https://nodejs.org"
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Edite o arquivo .env, escolha as senhas e execute este script novamente."
  exit 1
fi

if [ ! -d node_modules/@electric-sql/pglite ]; then
  npm install --no-audit --no-fund
fi

node server.js
