#!/usr/bin/env bash
# 本番 DB（public スキーマ）の丸ごとバックアップを Desktop に取る（読み取りのみ）。
#
#   bash scripts/backup-public-schema.sh
#
# pg_dump はローカルに無いので Docker の postgres:17 イメージで動かす（サーバーは PostgreSQL 17）。
# 接続先は .env の DATABASE_URL。Prisma 専用のクエリ引数（pgbouncer=true 等）は libpq が受け付けないので落とし、
# sslmode=require を付ける。パスワードは環境変数でコンテナへ渡し、画面には出さない。
#
# 戻すときは（例）: docker run --rm -v "<フォルダ>:/out" -e DBURL="…" postgres:17-alpine \
#                   pg_restore --clean --if-exists --schema=public -d "$DBURL" /out/<ファイル>.dump
set -euo pipefail

cd "$(dirname "$0")/.."
OUT_DIR="${BACKUP_DIR:-/c/Users/yushink/Desktop/DandoLink_backup}"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
FILE="dandolink_public_${STAMP}.dump"

# .env から DATABASE_URL を読む（クォート付きにも対応）
RAW="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
[ -n "$RAW" ] || { echo "DATABASE_URL が .env にありません"; exit 1; }
BASE="${RAW%%\?*}"
DBURL="${BASE}?sslmode=require"

echo "接続先: $(echo "$BASE" | sed -E 's#://[^@]*@#://***@#')"
echo "出力先: $OUT_DIR/$FILE"

# MSYS のパス変換を止めて、Windows のパスをそのままマウントする
WIN_OUT="$(cygpath -w "$OUT_DIR")"
MSYS_NO_PATHCONV=1 docker run --rm \
  -e DBURL="$DBURL" \
  -v "${WIN_OUT}:/out" \
  postgres:17-alpine \
  sh -c 'pg_dump --schema=public --format=custom --no-owner --no-privileges --file="/out/'"$FILE"'" "$DBURL"'

echo
echo "できたファイル:"
ls -la "$OUT_DIR/$FILE"
echo
echo "中身の確認（表の数）:"
MSYS_NO_PATHCONV=1 docker run --rm -v "${WIN_OUT}:/out" postgres:17-alpine \
  sh -c 'pg_restore --list "/out/'"$FILE"'" | grep -c " TABLE DATA " ; echo "件の表のデータが入っています"'
