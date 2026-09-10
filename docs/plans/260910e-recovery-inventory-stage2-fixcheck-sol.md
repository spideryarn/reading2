F21 / O1 — **closed**  
F22 — **not closed**  
F23 — **closed**  
F24 — **closed**

F22’s starvation case is fixed: 200 junk entries in `processing/`, then 200 in the inbox, are removed from future scans, so the request is reached within three passes. Reserved directories and fresh `.tmp-*` files are excluded from quarantine.

However, a real request can be quarantined. For a correctly named request file, any non-absence `open()` failure—including transient `EMFILE` or `EACCES`—sets `keep = false`, after which `rename()` moves the request into `junk/`. Concrete input: a valid CLI-format request whose file temporarily cannot be opened but whose parent remains writable.

Smallest fix: positively identify request-named symlinks/non-regular entries with `lstat()` and quarantine those; if a request-named regular file cannot be opened, log it and leave it for a later pass.

Regression run: **3 files passed, 107 tests passed**, exit 0. No typecheck was needed.