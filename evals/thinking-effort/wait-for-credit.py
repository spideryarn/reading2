"""Print one line and exit once the OpenRouter account has more than $5 of credit.

Read-only (GET /api/v1/credits). Used to resume the thinking-effort eval after
the account ran dry on 2026-10-01.
    python3 evals/thinking-effort/wait-for-credit.py
"""
import json
import time
import urllib.request

key = ""
for line in open(".env.local"):
    if line.startswith("OPENROUTER_API_KEY="):
        key = line.split("=", 1)[1].strip().strip('"')

while True:
    try:
        req = urllib.request.Request(
            "https://openrouter.ai/api/v1/credits", headers={"Authorization": f"Bearer {key}"}
        )
        data = json.load(urllib.request.urlopen(req, timeout=30))["data"]
        balance = data["total_credits"] - data["total_usage"]
        if balance > 5:
            print(f"credit back: ${balance:.2f}", flush=True)
            break
    except Exception:
        pass
    time.sleep(120)
