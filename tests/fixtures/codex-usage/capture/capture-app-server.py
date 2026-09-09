"""Capture one live `account/rateLimits/read` reply as a test fixture.

Redacts the account id and the reset-credit ids: the fixture is checked in, and
neither is needed to test the parsing. Everything shape-bearing is kept verbatim.
"""
import json
import subprocess
import sys
import threading
import time

out = sys.argv[1]
redact = "--raw" not in sys.argv
res = {}
p = subprocess.Popen(
    ["codex", "app-server", "--listen", "stdio://"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    text=True, bufsize=1,
)


def send(o):
    p.stdin.write(json.dumps(o) + "\n")
    p.stdin.flush()


def read():
    for line in p.stdout:
        try:
            o = json.loads(line)
        except Exception:
            continue
        if o.get("id") in (1, 2):
            res[o["id"]] = o


threading.Thread(target=read, daemon=True).start()
send({"jsonrpc": "2.0", "id": 1, "method": "initialize",
      "params": {"clientInfo": {"name": "overseer", "version": "0.0.1", "title": "overseer"}}})
t = time.time()
while 1 not in res and time.time() - t < 20:
    time.sleep(0.02)
send({"jsonrpc": "2.0", "method": "initialized", "params": {}})
send({"jsonrpc": "2.0", "id": 2, "method": "account/rateLimits/read", "params": {}})
t = time.time()
while 2 not in res and time.time() - t < 25:
    time.sleep(0.02)
p.kill()

reply = res.get(2)
if reply is None:
    print("no reply within the timeout", file=sys.stderr)
    raise SystemExit(1)
if redact:
    r = reply.get("result", {})
    if r.get("accountId"):
        r["accountId"] = "00000000-0000-0000-0000-000000000000"
    credits = (r.get("rateLimitResetCredits") or {}).get("credits")
    if isinstance(credits, list):
        for i, c in enumerate(credits):
            c["id"] = "RateLimitResetCredit_%032x" % (i + 1)

with open(out, "w", encoding="utf-8") as f:
    json.dump(reply, f, indent=2, sort_keys=True)
    f.write("\n")
print("wrote", out)
