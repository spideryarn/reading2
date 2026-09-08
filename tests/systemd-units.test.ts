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
import { readFileSync } from "node:fs";
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

  it("binds the tailnet address as well as loopback", () => {
    // Loopback alone is the quiet failure: perfect from the box, and simply
    // unreachable from the phone the tailnet address exists for. So the pair is
    // written out rather than left to a file that could be missing.
    const bind = section(unit, "Service").filter((l) => l.startsWith("Environment=FLEET_BIND="));
    expect(bind).toHaveLength(1);
    expect(bind[0]).toMatch(/^Environment=FLEET_BIND=127\.0\.0\.1,100\.\d+\.\d+\.\d+$/);
  });

  it("lets a different box correct that address without editing the unit", () => {
    // The tailnet address belongs to THIS box. `-` so a box without the file
    // still starts on what the unit says.
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
