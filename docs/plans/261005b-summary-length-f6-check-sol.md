Reviewed `19b6be057`. No findings within this fix’s scope.

The compatibility claim holds: `/1`–`/8` and absent-field rows retain the old hash for reads and unforced jobs. New `/9` rows use the band-aware hash consistently. Metadata’s older-prompt “not current” result predates this fix.

All four permitted suites passed: **188 tests**. An additional **140-case matrix** passed across legacy versions, absent fields, nullable metadata and band boundaries, with changed-text negative controls. Production paths were inspected; no database or network calls were made. No files changed.

APPROVE