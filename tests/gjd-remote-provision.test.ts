/**
 * Reading the box's provisioning verdict.
 *
 * `provision.sh` stopped travelling in cloud-init on 2026-09-01 — `user_data` is
 * capped at 32 KiB and the script is 67 KiB base64'd — so `gjd-remote provision`
 * copies it up and runs it. That moves a stale-success hazard one level out: the
 * status file on the box holds the LAST run's verdict, so a run that dies before
 * `provision.sh` starts leaves the previous `PROVISION OK` sitting there, and a
 * caller that reads the file for a `PROVISION OK` would report this run as a
 * success on the strength of the last one.
 *
 * Hence the attempt id, and hence these cases. The rule they hold: **the status
 * file is evidence only for the run that wrote it.** See
 * docs/plans/260901d-split-provisioning-out-of-cloud-init-to-fit-the-user-data-cap.md
 * and docs/reusable/silent-success.md.
 */
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildProvisionRunner, cloudInitVerdict, provisionVerdict } from "../scripts/gjd-remote-provision.js";

const ATTEMPT = "3f1c0b6e-0a4d-4a1e-9f77-2c8b5a0d1e42";
const SHA = "a".repeat(64);
const CTX = { attempt: ATTEMPT, sha256: SHA, exitOk: true };

/** What provision.sh writes when everything worked. */
function statusFile(over: { attempt?: string; sha?: string; report?: string[]; verdict?: string } = {}): string {
  return [
    "ran: 2026-09-01T00:11:02+00:00",
    `attempt: ${over.attempt ?? ATTEMPT}`,
    `script-sha256: ${over.sha ?? SHA}`,
    ...(over.report ?? ["ok   node is the wanted major", "ok   claude runs"]),
    over.verdict ?? "PROVISION OK",
  ].join("\n");
}

describe("provisionVerdict", () => {
  it("passes on this run's own PROVISION OK", () => {
    const v = provisionVerdict(statusFile(), CTX);
    expect(v.ok).toBe(true);
    expect(v.why).toContain("PROVISION OK");
  });

  it("REFUSES a PROVISION OK left behind by an earlier run", () => {
    // The whole reason the attempt id exists. Every other signal here says
    // success: the file is well-formed, the hash matches, there are no FAIL
    // lines, and it ends in PROVISION OK. Only the attempt id knows that
    // nothing ran this time.
    const stale = statusFile({ attempt: "11111111-2222-3333-4444-555555555555" });
    const v = provisionVerdict(stale, { ...CTX, exitOk: false });
    expect(v.ok).toBe(false);
    expect(v.why).toContain("never started");
  });

  it("refuses a status file written before the attempt id existed", () => {
    // Every box provisioned before 2026-09-01 has one of these. It must not
    // read as success, and it must not read as a crash either.
    const old = ["ran: 2026-08-31T19:04:00+00:00", `script-sha256: ${SHA}`, "PROVISION OK"].join("\n");
    const v = provisionVerdict(old, CTX);
    expect(v.ok).toBe(false);
    expect(v.why).toContain("no attempt line");
  });

  it("refuses when the wrapper exited non-zero, even on a matching attempt", () => {
    // provision.sh got far enough to stamp the file, then died somewhere the
    // status write could not reach — a kill, a disk error, the ssh dropping.
    const v = provisionVerdict(statusFile(), { ...CTX, exitOk: false });
    expect(v.ok).toBe(false);
    expect(v.why).toContain("non-zero");
  });

  it("refuses when the box ran a different script than the one we sent", () => {
    const v = provisionVerdict(statusFile({ sha: "b".repeat(64) }), CTX);
    expect(v.ok).toBe(false);
    expect(v.why).toContain("not the one we sent");
  });

  it("names the failed checks rather than counting to one", () => {
    const v = provisionVerdict(
      statusFile({
        report: ["ok   node is the wanted major", "FAIL docker daemon runs", "FAIL supabase cli pinned"],
        verdict: "PROVISION INCOMPLETE",
      }),
      CTX,
    );
    expect(v.ok).toBe(false);
    expect(v.why).toContain("docker daemon runs");
    expect(v.why).toContain("supabase cli pinned");
    expect(v.why).toContain("2 checks failed");
  });

  it("refuses a run that stopped in the middle", () => {
    // provision.sh stamps PROVISION INCOMPLETE before anything fallible runs, so
    // this is what a box looks like while it is still being built, and what it
    // is left as if the build is interrupted.
    const v = provisionVerdict(statusFile({ verdict: "PROVISION INCOMPLETE (started, has not finished)" }), CTX);
    expect(v.ok).toBe(false);
    expect(v.why).toContain("no PROVISION OK");
  });

  it("refuses an empty status file", () => {
    expect(provisionVerdict("", CTX).ok).toBe(false);
    expect(provisionVerdict("   \n  ", CTX).why).toContain("no status file");
  });

  it("refuses cloud-init's bootstrapped marker", () => {
    // What a fresh box carries. It has no FAIL lines in it, which is how it
    // would read as healthy to anything that only counts failures.
    const marker = [
      "ran: 2026-09-01T00:00:00+00:00",
      "attempt: none",
      "PROVISION NOT RUN (cloud-init bootstrapped this box; run: gjd-remote provision)",
    ].join("\n");
    const v = provisionVerdict(marker, CTX);
    expect(v.ok).toBe(false);
    // Caught by the attempt id first, which is the right answer: from this
    // caller's point of view nothing ran.
    expect(v.why).toContain("never started");
    // And on its own terms too, for a caller that minted `none`.
    expect(provisionVerdict(marker, { ...CTX, attempt: "none" }).why).toContain("bootstrapped");
  });

  it("does not accept PROVISION OK appearing inside a line", () => {
    // The verdict is a whole line. A check named after it, or a log line
    // quoting it, must not be mistaken for the verdict itself.
    const v = provisionVerdict(statusFile({ verdict: "ok   said PROVISION OK once" }), CTX);
    expect(v.ok).toBe(false);
  });
});

describe("cloudInitVerdict", () => {
  it("passes on exit 0", () => {
    expect(cloudInitVerdict("status: done\nrc=0").ok).toBe(true);
  });

  it("REFUSES exit 2 — done, with recoverable errors", () => {
    // The clause worth having. `cloud-init status --wait` exits 2 when it
    // finished but something went wrong on the way, which is a box with
    // half its packages. Treating the exit code as a boolean, or matching on
    // the word "done", would call this ready.
    const v = cloudInitVerdict("status: degraded done\ndetail: some errors\nrc=2");
    expect(v.ok).toBe(false);
    expect(v.why).toContain("degraded");
  });

  it("refuses a fatal error", () => {
    expect(cloudInitVerdict("status: error\nrc=1").ok).toBe(false);
  });

  it("refuses when it never finished", () => {
    // No rc line at all: the ssh timed out while cloud-init was still waiting.
    // Distinct from a failure, and the message says so.
    const v = cloudInitVerdict("status: running");
    expect(v.ok).toBe(false);
    expect(v.why).toContain("never finished");
  });
});

describe("buildProvisionRunner", () => {
  const ARGS = {
    staged: "/tmp/gjd-provision.123.sh",
    installed: "/usr/local/sbin/provision.sh",
    sha256: SHA,
    attempt: ATTEMPT,
    lock: "/var/lock/gjd-provision.lock",
    log: "/var/log/provision.log",
  };

  it("is valid bash", () => {
    expect(spawnSync("bash", ["-n"], { input: buildProvisionRunner(ARGS) }).status).toBe(0);
  });

  it("runs the INSTALLED path, never the staged one", () => {
    // provision.sh bind-mounts the volume over /home partway through its own
    // run. A script executing from a staged copy under /home would have $0
    // change meaning underneath it, and root would be running code from a
    // user-writable directory.
    const script = buildProvisionRunner(ARGS);
    const last = script.trim().split("\n").at(-1) ?? "";
    expect(last).toContain(ARGS.installed);
    expect(last).not.toContain(ARGS.staged);
  });

  it("hashes the installed file, not the uploaded one", () => {
    expect(buildProvisionRunner(ARGS)).toContain(`sha256sum '${ARGS.installed}'`);
  });

  it("keeps tee inside a pipefail shell", () => {
    // `sudo script | tee` puts an unprivileged tee at the end of the pipeline
    // and makes ITS status the one that counts — which is how a dead first boot
    // once reported success.
    const script = buildProvisionRunner(ARGS);
    expect(script).toContain("bash -o pipefail -c");
    const teeLine = script.split("\n").find((l) => l.includes("tee")) ?? "";
    expect(teeLine.indexOf("pipefail")).toBeLessThan(teeLine.indexOf("tee"));
  });

  it("takes the lock and passes the attempt id", () => {
    const script = buildProvisionRunner(ARGS);
    expect(script).toContain(`flock -w 10 '${ARGS.lock}'`);
    expect(script).toContain(`GJD_ATTEMPT='${ARGS.attempt}'`);
  });

  it("survives a single quote in every value it interpolates", () => {
    // None of these values can contain a quote today. The case is here because
    // the failure would not be a syntax error somebody notices in review — it
    // would be a shell command ending early and running something else, as root.
    const nasty = "/tmp/it's a $(echo hi) 'file'.sh";
    const script = buildProvisionRunner({ ...ARGS, staged: nasty, attempt: "a'b" });
    expect(spawnSync("bash", ["-n"], { input: script }).status).toBe(0);

    // Parsing is not the claim. Run it for real, with the commands it calls
    // shadowed by functions that print their arguments back, so the VALUES can
    // be compared — `bash -n` is happy with quoting that loses half a path.
    const harness = [
      `install() { printf 'STAGED<%s>\\n' "$7"; }`,
      "rm() { :; }",
      `sha256sum() { printf '%s  x\\n' '${SHA}'; }`,
      `flock() { printf 'ATTEMPT<%s>\\n' "$5"; }`,
      script.replace(/^exec /m, ""),
    ].join("\n");
    const out = spawnSync("bash", ["-c", harness], { encoding: "utf8" }).stdout ?? "";

    expect(out).toContain(`STAGED<${nasty}>`);
    expect(out).toContain("ATTEMPT<GJD_ATTEMPT=a'b>");
    // And the substitution stayed a string. If this ever fails, the quoting is
    // executing whatever is in a path, in a root shell.
    expect(out).toContain("$(echo hi)");
  });
});
