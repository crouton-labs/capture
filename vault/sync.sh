#!/usr/bin/env bash
# Refresh capture's forked vault lib SOURCE from a northlight-vault checkout.
# Source-only: .ts files (minus proofs), no .md/.json/benchmarks/tapline.
# Nothing built or committed beyond .ts source + this script + tsconfig.json.
set -euo pipefail
NL_VAULT="${NL_VAULT:-$HOME/Code/northlight/northlight-vault}"
[ -d "$NL_VAULT/libs/_runtime" ] || { echo "northlight-vault not found at \$NL_VAULT=$NL_VAULT" >&2; exit 1; }
DEST="$(cd "$(dirname "$0")" && pwd)/libs"
rsync -am --delete \
  --include='*/' \
  --exclude='proofs*.ts' \
  --include='*.ts' \
  --exclude='*' \
  "$NL_VAULT/libs/" "$DEST/"
echo "Synced $(find "$DEST" -name '*.ts' | wc -l | tr -d ' ') .ts files into vault/libs/"
