#!/bin/bash
# Fetch pages.tsv into pages/ — a plain GET with a browser-ish User-Agent, like the corpus fixtures.
# Plan 261007k. Run from anywhere: bash evals/extraction/comments/fetch.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$here/pages"
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
grep -v '^#' "$here/pages.tsv" | while IFS=$'\t' read -r file url; do
  [ -z "$file" ] && continue
  case "$file" in
    pages/*) ;;
    *) echo "refusing output outside pages/: $file" >&2; exit 1 ;;
  esac
  tmp="$here/$file.tmp"
  if ! curl -fsSL -A "$UA" --max-time 30 -o "$tmp" "$url"; then
    rm -f -- "$tmp"
    echo "FAILED $url" >&2
    exit 1
  fi
  mv -- "$tmp" "$here/$file"
  echo "$file $(wc -c < "$here/$file") $url"
done
