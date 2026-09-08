/**
 * The two box services, and the one thing that can quietly stop being true
 * about them.
 *
 * `gjd-remote provision` copies **`provision.sh` alone** to the box — nothing
 * else in the repo travels with it — so the unit files have to be embedded in
 * that script as heredocs. That leaves two copies of each unit: the readable
 * one under `infra/hetzner/systemd/` and the one that actually reaches the box.
 * Two copies of a fact is how one of them goes stale, and the stale one here is
 * invisible: the repo file would say `Restart=always` while the box ran
 * something else, and nothing on either side would complain.
 *
 * So the drift check is the point of this file. The invariant assertions
 * underneath it are about the two mistakes that make a unit *look* installed
 * while it does not survive a reboot:
 *
 * - **`WantedBy=multi-user.target`, and a `User=` line.** A systemd USER unit
 *   reports `enabled` exactly like a system one and still does not start at
 *   boot unless lingering is on for the account — nothing in this repo enables
 *   lingering, so the box would come back up with the Overseer down and no page
 *   to say so.
 * - **`StartLimit*` in `[Unit]`, never `[Service]`.** systemd moved those keys
 *   in v229 and **ignores them silently** in `[Service]`, which turns a
 *   deliberate "crash-loop visibly and then stop" into "restart for ever".
 *
 * docs/plans/260908b-overseer-store-and-clock.md § S5.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const PROVISION = readFileSync(`${REPO}infra/hetzner/provision.sh`, "utf8");

/** The units this box runs, and the heredoc delimiter each is spliced under. */
const UNITS = [
  { file: "overseer.service", delimiter: "OVERSEER_UNIT" },
  { file: "fleet-dashboard.service", delimiter: "FLEET_DASHBOARD_UNIT" },
] as const;

function unitFromRepo(file: string): string {
  return readFileSync(`${REPO}infra/hetzner/systemd/${file}`, "utf8");
}

/**
 * The heredoc body `provision.sh` will write to `/etc/systemd/system/`.
 *
 * Bash's own rule for the terminator — the delimiter alone at column zero —
 * rather than a lax one: accepting an indented terminator would let this find a
 * shorter body than the box gets, and then compare that against the repo file
 * and call them equal.
 */
function heredocBody(script: string, delimiter: string): string {
  const open = `<<'${delimiter}'\n`;
  const at = script.indexOf(open);
  if (at === -1) throw new Error(`no heredoc <<'${delimiter}' in provision.sh`);
  const bodyStart = at + open.length;
  const end = script.indexOf(`\n${delimiter}\n`, bodyStart - 1);
  if (end === -1) throw new Error(`heredoc <<'${delimiter}' is never terminated at column zero`);
  return script.slice(bodyStart, end + 1);
}

/**
 * The keys of one ini section, in order, as `key=value` strings.
 *
 * Comments and blank lines dropped; every unit file here is thick with comments
 * and a key that only appears inside one would be a key systemd never reads.
 */
function section(unit: string, name: string): string[] {
  const lines = unit.split("\n");
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inside = trimmed === `[${name}]`;
      continue;
    }
    if (!inside || trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    out.push(trimmed);
  }
  return out;
}

describe("heredocBody", () => {
  it("takes the body up to a terminator at column zero", () => {
    expect(heredocBody("x <<'D'\nalpha\nbeta\nD\ny\n", "D")).toBe("alpha\nbeta\n");
  });

  it("does not accept an indented terminator, which bash would not either", () => {
    expect(() => heredocBody("x <<'D'\nalpha\n  D\n", "D")).toThrow(/never terminated/);
  });
});

describe("section", () => {
  it("returns only the named section's keys, without comments", () => {
    const ini = "[Unit]\n# a comment\nDescription=x\n\n[Service]\nUser=greg\n";
    expect(section(ini, "Unit")).toEqual(["Description=x"]);
    expect(section(ini, "Service")).toEqual(["User=greg"]);
  });

  it("is empty for a section that is not there", () => {
    expect(section("[Unit]\nDescription=x\n", "Install")).toEqual([]);
  });
});

describe.each(UNITS)("$file", ({ file, delimiter }) => {
  const unit = unitFromRepo(file);

  it("is byte-for-byte what provision.sh will install", () => {
    // Not `toContain`, and not a normalised comparison: a trailing-whitespace
    // difference is still two files, and the next person to edit one of them
    // would be editing whichever one they happened to open.
    expect(heredocBody(PROVISION, delimiter)).toBe(unit);
  });

  it("is a system unit that starts at boot", () => {
    expect(section(unit, "Install")).toContain("WantedBy=multi-user.target");
  });

  it("runs as the provisioning user rather than as root", () => {
    expect(section(unit, "Service")).toContain("User=@USER@");
  });

  it("restarts always, not on-failure", () => {
    expect(section(unit, "Service")).toContain("Restart=always");
  });

  it("rate-limits restarts in [Unit], where systemd reads those keys", () => {
    const startLimits = (key: string) => ({
      unit: section(unit, "Unit").filter((l) => l.startsWith(`${key}=`)),
      service: section(unit, "Service").filter((l) => l.startsWith(`${key}=`)),
    });
    for (const key of ["StartLimitBurst", "StartLimitIntervalSec"]) {
      const found = startLimits(key);
      expect(found.unit).toHaveLength(1);
      // In [Service] systemd ignores it WITHOUT SAYING SO, so a unit with the
      // key in the wrong place reads as rate-limited and is not.
      expect(found.service).toEqual([]);
    }
  });

  it("runs out of the primary checkout and never a worktree", () => {
    const service = section(unit, "Service");
    const execStart = service.filter((l) => l.startsWith("ExecStart="));
    expect(execStart).toHaveLength(1);
    // Spelled out rather than built from the file: an expectation computed from
    // the thing under test holds for any value of it.
    expect(execStart[0]).toMatch(/^ExecStart=\/home\/@USER@\/code\/spideryarn2\/node_modules\/\.bin\/tsx /);
    expect(service).toContain("WorkingDirectory=/home/@USER@/code/spideryarn2");
    expect(unit).not.toMatch(/worktrees\//);
  });
});

describe("the overseer watchdog service and timer", () => {
  // Not folded into `UNITS`/`describe.each` above: that block's shared
  // assertions assume a long-running Restart=always daemon (Restart=always,
  // WantedBy=multi-user.target in [Install]), and the watchdog is
  // deliberately the opposite of that -- a oneshot check triggered by its
  // timer, with no [Install] section of its own. Forcing it through the same
  // assertions would mean giving it Restart=always, which is exactly the
  // mistake the service file's own comment warns against: it would fight the
  // timer over who decides "run this again".
  const service = unitFromRepo("overseer-watchdog.service");
  const timer = unitFromRepo("overseer-watchdog.timer");

  it("service is byte-for-byte what provision.sh will install", () => {
    expect(heredocBody(PROVISION, "OVERSEER_WATCHDOG_SERVICE_UNIT")).toBe(service);
  });

  it("timer is byte-for-byte what provision.sh will install", () => {
    expect(heredocBody(PROVISION, "OVERSEER_WATCHDOG_TIMER_UNIT")).toBe(timer);
  });

  it("service is a SYSTEM unit, not a user one", () => {
    // Same reasoning as overseer.service: a user unit needs
    // `loginctl enable-linger`, which nothing in this repo enables, so a
    // user-level watchdog would be dead exactly when it is needed -- after a
    // reboot, before anyone has logged in.
    expect(section(service, "Service")).toContain("User=@USER@");
  });

  it("service is oneshot and does not fight the timer with its own Restart=", () => {
    expect(section(service, "Service")).toContain("Type=oneshot");
    expect(section(service, "Service").some((l) => l.startsWith("Restart="))).toBe(false);
  });

  it("service has no [Install] section -- only the timer is ever enabled", () => {
    expect(section(service, "Install")).toEqual([]);
  });

  it("service runs out of the primary checkout and never a worktree", () => {
    const lines = section(service, "Service");
    const execStart = lines.filter((l) => l.startsWith("ExecStart="));
    expect(execStart).toHaveLength(1);
    expect(execStart[0]).toMatch(/^ExecStart=\/home\/@USER@\/code\/spideryarn2\/node_modules\/\.bin\/tsx /);
    expect(lines).toContain("WorkingDirectory=/home/@USER@/code/spideryarn2");
    expect(service).not.toMatch(/worktrees\//);
  });

  it("service names an absolute store, because a relative one is refused at startup", () => {
    expect(section(service, "Service")).toContain("Environment=OVERSEER_STORE_DIR=/home/@USER@/.overseer");
  });

  it("service's doc comment says what this is NOT -- the off-box dead-man check", () => {
    // A29/A27 in overseer-direction.md: a local timer disappears with the box
    // on power loss, and nothing here closes that. The unit file is exactly
    // the place someone reads once and assumes more coverage than exists.
    expect(service).toMatch(/NOT THE OFF-BOX DEAD-MAN CHECK/);
    expect(service).toMatch(/A27/);
  });

  it("timer is installed by enabling the TIMER, not the service", () => {
    expect(section(timer, "Install")).toContain("WantedBy=timers.target");
    expect(section(timer, "Unit")).not.toContain("WantedBy=multi-user.target");
  });

  it("timer names the service it triggers", () => {
    expect(section(timer, "Timer")).toContain("Unit=overseer-watchdog.service");
  });

  it("timer catches up missed runs rather than skipping them", () => {
    // overseer-direction.md § "The scheduler": missed runs come out better
    // than either systemd's OnCalendar= one-shot catch-up or cron's silent
    // skip, so this is the same choice made for the store's own interval
    // scheduling.
    expect(section(timer, "Timer")).toContain("Persistent=true");
  });

  it("timer parses as a valid systemd unit", () => {
    expect(section(timer, "Timer").some((l) => l.startsWith("OnUnitActiveSec="))).toBe(true);
  });

  it("provision.sh enables the watchdog timer, not just installs it", () => {
    expect(PROVISION).toContain("systemctl enable overseer-watchdog.timer");
  });
});

describe("the overseer unit", () => {
  const unit = unitFromRepo("overseer.service");

  it("names an absolute store, because a relative one is refused at startup", () => {
    // tools/overseer/store.ts throws on a relative OVERSEER_STORE_DIR: relative
    // resolves per working directory, which is two stores and two histories.
    expect(section(unit, "Service")).toContain("Environment=OVERSEER_STORE_DIR=/home/@USER@/.overseer");
  });

  it("stops with SIGTERM, so the daemon can write its stopping note", () => {
    expect(section(unit, "Service")).toContain("KillSignal=SIGTERM");
  });
});

describe("the fleet dashboard unit", () => {
  const unit = unitFromRepo("fleet-dashboard.service");

  it("falls back to loopback ALONE, naming no tailnet address anywhere", () => {
    // THE P1, GUARDED. This unit used to carry `127.0.0.1,100.92.255.119`,
    // under a comment claiming "a box without the file still starts on what is
    // written here". It starts and then dies, and the chain is entirely inside
    // this repo:
    //
    //   provision.sh installs Tailscale WITHOUT logging in (`tailscale up`
    //   needs a browser, and a provisioning run has none) → `tailscale ip -4`
    //   prints nothing → no /etc/fleet-dashboard.env is written → the `-` on
    //   EnvironmentFile makes that fine and the unit's OWN value is what starts
    //   → that value names a tailnet address belonging to a different machine →
    //   tools/fleet/server.ts treats a bind it cannot take as FATAL, by design,
    //   so the whole server exits, INCLUDING the loopback listener that would
    //   have worked.
    //
    // 127.0.0.1 is the one address that is correct on every box and cannot fail
    // to bind. The tailnet address is per-machine and arrives from the file.
    // Found by a cross-family review, 2026-09-08.
    const bind = section(unit, "Service").filter((l) => l.startsWith("Environment=FLEET_BIND="));
    expect(bind).toEqual(["Environment=FLEET_BIND=127.0.0.1"]);
    // Not only the key. A tailnet address in a COMMENT is a second copy of a
    // per-machine fact sitting one paste away from the key, which is how the
    // first one got there.
    const quads = [...unit.matchAll(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g)].map((m) => m[0]);
    // An expectation that finds nothing proves nothing: the regex must still be
    // matching the address it is asserting about.
    expect(quads.length).toBeGreaterThan(0);
    expect([...new Set(quads)]).toEqual(["127.0.0.1"]);
  });

  it("takes the tailnet address only from the per-box env file", () => {
    // The tailnet address belongs to ONE box. `-` so a box that has not been
    // `tailscale up`'d starts anyway — on loopback, which always binds.
    expect(section(unit, "Service")).toContain("EnvironmentFile=-/etc/fleet-dashboard.env");
  });

  it("never binds a wildcard", () => {
    // The Hetzner firewall would still refuse the traffic; the habit is the
    // thing that eventually gets it wrong. `parseBinds` refuses one at startup.
    expect(unit).not.toMatch(/0\.0\.0\.0/);
  });

  it("does not name FLEET_ACT_ENABLED, in any form", () => {
    // Enacted actions — removing a worktree, killing a session — are gated
    // behind it, and it stays unset until tools/fleet/routes-actions.ts has had
    // a GPT Sol review. A unit that named it even as false is one edit away
    // from enabling it, and a unit file is exactly the sort of file somebody
    // skims and completes helpfully. The comment saying so is what stops that,
    // so `FLEET_ACT_ENABLED` does appear in the file — as prose, never as a key.
    expect(section(unit, "Service").join("\n")).not.toContain("FLEET_ACT_ENABLED");
    expect(section(unit, "Unit").join("\n")).not.toContain("FLEET_ACT_ENABLED");
    // And the comment that explains the absence is itself the guard.
    expect(unit).toContain("FLEET_ACT_ENABLED");
  });

  it("builds the gitignored client on every start, unconditionally and without a `-`", () => {
    // No `git pull` can supply tools/fleet/web/dist, and server.ts exits 2
    // without it, so a checkout that has never been built comes up dead after
    // every reboot with nothing watching.
    //
    // THIS ASSERTION WAS REVERSED ON 2026-09-08, and the reversal is the point
    // of the comment. It used to require a `test -f` guard, on the reasoning
    // that Restart=always plus RestartSec=10 makes an unconditional build a
    // vite build every ten seconds through a crash loop. Then the build was
    // timed: 1.9 seconds. The guard was bought against a cost nobody had
    // measured, and it was paid for with the failure that has no alarm — a
    // `dev` that moves the client without a rebuild leaves the old bundle in
    // place and this unit serves a STALE page against a newer server, silently.
    // A missing build fails loudly; a stale one does not.
    //
    // The guard also did not prevent the loop it was named for: a FAILED build
    // never writes index.html, so `test -f` never short-circuits and every
    // retry rebuilt anyway.
    const pre = section(unit, "Service").filter((l) => l.startsWith("ExecStartPre="));
    expect(pre).toHaveLength(1);
    expect(pre[0]).toContain("build:fleet");
    // Not conditional: the bundle must be a function of the checkout, not of
    // who last remembered to run a command.
    expect(pre[0]).not.toContain("test -f");
    // No `-` prefix. A client that will not build fails the start loudly rather
    // than quietly serving the previous bundle.
    expect(pre[0]).not.toMatch(/^ExecStartPre=-/);
  });

  it("waits for tailscaled, because a bind it cannot take is fatal", () => {
    expect(section(unit, "Unit").join("\n")).toContain("tailscaled.service");
  });
});

/**
 * The `case` in `provision.sh` that writes — or removes — the per-box env file
 * the unit's tailnet address comes from, lifted out so it can actually be RUN.
 *
 * Asserting on the text of a shell branch is how you get a green test beside a
 * branch that does nothing, so this returns the real code and the tests below
 * execute it against a fake `/etc` with a stubbed `tailscale`.
 */
function fleetEnvBlock(script: string): string {
  const start = script.indexOf("\nfleet_ip=");
  if (start === -1) throw new Error("no `fleet_ip=` assignment in provision.sh — this test has drifted from the file");
  const end = script.indexOf("\nesac\n", start);
  if (end === -1) throw new Error("the fleet env `case` is never closed by `esac` at column zero");
  return `${script.slice(start + 1, end)}\nesac\n`;
}

/**
 * That block, pointed at a throwaway directory instead of the real `/etc`.
 *
 * The substitution is counted rather than assumed: a rename that stopped it
 * matching would otherwise leave these tests running the block against the
 * BOX'S OWN `/etc`, where they would pass while touching a file they must never
 * touch.
 */
function fleetEnvBlockAgainst(fakeEtc: string): string {
  const block = fleetEnvBlock(PROVISION);
  const hits = block.split("/etc/").length - 1;
  if (hits < 2) {
    throw new Error(`the fleet env block names /etc/ only ${hits} time(s) — refusing to run it, since it would reach the real one`);
  }
  return block.split("/etc/").join(`${fakeEtc}/`);
}

/** A fake `/etc`, and a `tailscale` on PATH that prints `ip` (or nothing). */
function runFleetEnvBlock(ip: string, existingEnvFile: string | null) {
  const root = mkdtempSync(path.join(tmpdir(), "systemd-units-fleet-"));
  const etc = path.join(root, "etc");
  const bin = path.join(root, "bin");
  mkdirSync(etc);
  mkdirSync(bin);
  const envFile = path.join(etc, "fleet-dashboard.env");
  if (existingEnvFile !== null) writeFileSync(envFile, existingEnvFile);
  const tailscale = ip === "" ? "exit 0" : `printf '%s\\n' '${ip}'`;
  writeFileSync(path.join(bin, "tailscale"), `#!/bin/sh\n${tailscale}\n`, { mode: 0o755 });
  // `chown root:root` is in the write branch and cannot succeed unprivileged.
  // Stubbed rather than cut out of the block: what is under test is the
  // branching and the file it leaves behind, not whether chown works.
  writeFileSync(path.join(bin, "chown"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  // `-e`, like provision.sh itself, so a step that fails fails the test rather
  // than being stepped over.
  const run = spawnSync("bash", ["-eu", "-c", fleetEnvBlockAgainst(etc)], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
  });
  return { run, exists: () => existsSync(envFile), body: () => (existsSync(envFile) ? readFileSync(envFile, "utf8") : null) };
}

describe("provision.sh's fleet-dashboard env file", () => {
  it("writes the tailnet address it was given, alongside loopback", () => {
    const { run, body } = runFleetEnvBlock("100.64.0.7", null);
    expect(run.status, run.stderr).toBe(0);
    expect(body()).toBe("FLEET_BIND=127.0.0.1,100.64.0.7\n");
  });

  it("REMOVES a stale file when there is no tailnet address yet", () => {
    // The same P1 with a longer fuse. Provisioning deliberately does not log
    // Tailscale in, so this branch is what every run on a re-imaged or
    // re-provisioned box takes — and a file left behind names the PREVIOUS
    // machine's address, which this one cannot bind, which kills the whole
    // server rather than one listener. Leaving it alone was the original bug.
    const { run, exists } = runFleetEnvBlock("", "FLEET_BIND=127.0.0.1,100.99.99.99\n");
    expect(run.status, run.stderr).toBe(0);
    expect(exists()).toBe(false);
  });

  it("is content for there to be no file at all", () => {
    // Nothing to remove is the ordinary state of a new box, not an error: the
    // unit falls back to loopback, which always binds.
    const { run, exists } = runFleetEnvBlock("", null);
    expect(run.status, run.stderr).toBe(0);
    expect(exists()).toBe(false);
  });

  it("does not abort the whole provisioning run over a DIRECTORY of that name", () => {
    // `rm -f` on a directory fails, and under `set -e` that would take down a
    // provisioning run over a file that is only ever an optional override.
    const root = mkdtempSync(path.join(tmpdir(), "systemd-units-fleet-dir-"));
    const etc = path.join(root, "etc");
    const bin = path.join(root, "bin");
    mkdirSync(etc);
    mkdirSync(bin);
    mkdirSync(path.join(etc, "fleet-dashboard.env"));
    writeFileSync(path.join(bin, "tailscale"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const run = spawnSync("bash", ["-eu", "-c", fleetEnvBlockAgainst(etc)], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    });
    expect(run.status, run.stderr).toBe(0);
  });
});

describe("the documented path back to a tailnet bind", () => {
  // EnvironmentFile is read when the service STARTS, so an ExecStartPre that
  // wrote the file would take effect only on the NEXT start — the mechanism
  // that looks obvious cannot work. The regeneration step is therefore a
  // DOCUMENTED one, which makes the doc load-bearing, which is why it gets a
  // test: an undocumented step is a box that stays unreachable from the phone.
  const doc = readFileSync(`${REPO}docs/project/hetzner-remote-server-box.md`, "utf8");

  it("tells the reader how to regenerate the env file after `tailscale up`", () => {
    expect(doc).toContain("tailscale ip -4");
    expect(doc).toContain("/etc/fleet-dashboard.env");
    expect(doc).toContain("systemctl restart fleet-dashboard");
  });

  it("puts the write BEFORE the restart, so the first start binds the tailnet", () => {
    // The other order needs two starts, and the first one looks like a failure.
    const write = doc.indexOf("/etc/fleet-dashboard.env");
    const restart = doc.indexOf("systemctl restart fleet-dashboard");
    expect(write).toBeGreaterThan(-1);
    expect(restart).toBeGreaterThan(write);
  });
});
