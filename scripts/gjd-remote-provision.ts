/**
 * Reading the box's provisioning verdict — the pure half of `gjd-remote provision`.
 *
 * Separated from scripts/gjd-remote.ts so it can be tested without a box, the
 * same way scripts/gjd-remote-tmux.ts is: that file calls `main()` at import
 * time, so nothing in it can be unit-tested at all.
 *
 * Every clause below is one way to report a success that did not happen, and
 * the reason there are five is that `PROVISION OK` in the status file proves
 * none of them on its own. The file holds the LAST run's verdict, so a run that
 * died before `provision.sh` started leaves the previous `PROVISION OK` sitting
 * there looking exactly like this one's. See
 * docs/plans/260901d-split-provisioning-out-of-cloud-init-to-fit-the-user-data-cap.md
 * and docs/reusable/silent-success.md.
 */

export type ProvisionContext = {
  /** The id minted for this run, which `provision.sh` writes into the status file. */
  attempt: string;
  /** The sha256 of the script we uploaded. */
  sha256: string;
  /** Did the remote wrapper exit 0? */
  exitOk: boolean;
};

export type Verdict = { ok: boolean; why: string };

/**
 * Did provisioning succeed, on THIS attempt, from THIS script?
 *
 * Order matters. The attempt check comes before the exit-status check because
 * it is the more specific answer: a non-zero exit *and* a stale attempt id
 * means the run never started, and "provision.sh never started" is a more
 * useful sentence than "it exited non-zero".
 */
export function provisionVerdict(report: string, ctx: ProvisionContext): Verdict {
  const text = report.trim();
  if (text === "") {
    return { ok: false, why: "no status file — provision.sh never got far enough to write one" };
  }

  const attempt = /^attempt:\s*(\S+)/m.exec(text)?.[1];
  const sha = /^script-sha256:\s*(\S+)/m.exec(text)?.[1];
  const failed = text.split("\n").filter((l) => l.startsWith("FAIL"));

  if (attempt !== ctx.attempt) {
    // The clause that matters most, and the only one that can fire on a file
    // saying PROVISION OK. Reached whenever the run died before provision.sh
    // started — an upload that failed, a sudo that was refused, a lock it could
    // not take — which is exactly when the file underneath is a previous run's.
    const seen = attempt === undefined ? "it has no attempt line" : `it says ${attempt}`;
    return { ok: false, why: `the status file is from another run (${seen}) — provision.sh never started` };
  }
  if (/^PROVISION NOT RUN/m.test(text)) {
    // cloud-init's own marker, and it comes before every check below because it
    // is the most useful sentence available: this box has no script-sha256 line
    // and never ran anything, so "it ran a script hashing (unrecorded)" would be
    // true, unhelpful, and read as a mismatch rather than an absence.
    return { ok: false, why: "the box is still only bootstrapped — nothing has provisioned it" };
  }
  if (!ctx.exitOk) {
    return { ok: false, why: "provisioning exited non-zero" };
  }
  if (sha !== ctx.sha256) {
    // A box that ran a different version of the script than the one in this
    // repo. Possible whenever two people provision at once, or when an install
    // step landed something other than what was uploaded.
    return { ok: false, why: `the box ran a script hashing ${sha ?? "(unrecorded)"}, not the one we sent` };
  }
  if (failed.length) {
    return {
      ok: false,
      why: `${failed.length} check${failed.length === 1 ? "" : "s"} failed: ${failed.map((l) => l.replace(/^FAIL\s+/, "")).join(", ")}`,
    };
  }
  if (!/^PROVISION OK$/m.test(text)) {
    return { ok: false, why: "provisioning did not finish — no PROVISION OK" };
  }
  return { ok: true, why: "PROVISION OK — every check on the box passed" };
}

/**
 * What `cloud-init status --wait` said, given its output with `rc=N` appended.
 *
 * The exit codes are not interchangeable and treating them as a boolean is the
 * bug this exists to prevent: 0 is done, 1 is a fatal error, and **2 is "done,
 * but with recoverable errors"** — a box whose packages half-installed. Building
 * on top of that produces a failure hundreds of lines later, in a step that has
 * nothing to do with the real problem.
 */
export function cloudInitVerdict(output: string): Verdict {
  const text = output.trim();
  const rc = /rc=(\d+)\s*$/.exec(text)?.[1];
  if (rc === undefined) return { ok: false, why: "cloud-init status --wait never finished" };
  if (rc === "0") return { ok: true, why: "cloud-init finished" };
  const status = /status:\s*(\S+)/.exec(text)?.[1];
  const detail =
    rc === "2"
      ? "it finished with recoverable errors, which is not a box to build on top of"
      : `exit ${rc}`;
  return { ok: false, why: `cloud-init did not bootstrap cleanly (${status ?? detail})` };
}

/**
 * What a bootstrapped box has, asked directly. Prints `BOOTSTRAP OK` or
 * `BOOTSTRAP MISSING: …` — the same list provision.sh checks on its own first
 * lines, because "bootstrapped" means exactly "provision.sh's preconditions
 * hold", and a second list would be the one that drifts.
 */
export function bootstrapProbeScript(): string {
  return (
    `missing=""; for c in rsync curl gpg jq git flock; do command -v "$c" >/dev/null 2>&1 || missing="$missing $c"; done; ` +
    `sudo test -r /etc/gjd-provision.env || missing="$missing /etc/gjd-provision.env"; ` +
    `if [ -z "$missing" ]; then echo "BOOTSTRAP OK"; else echo "BOOTSTRAP MISSING:$missing"; fi`
  );
}

/**
 * Whether the box is bootstrapped enough to provision — the wait's verdict, read
 * against what is actually on the box.
 *
 * `cloud-init status` reports the FIRST boot and never changes afterwards. The
 * real box's first boot ran the old, pre-split runcmd and recorded `error` for
 * good, and it has been provisioned several times since — so a gate on the
 * verdict alone could never pass there, and on 2026-09-03 it did not. What
 * provisioning needs is a bootstrapped box, and the bootstrap probe asks for
 * the artefacts themselves. (Not the provision status file: every run rewrites
 * it as "started" on its first line, so one failed re-run would have erased the
 * evidence the next one needed.)
 *
 * Two refusals survive on purpose: cloud-init still running (the wait's other
 * job, and artefacts say nothing about *this* boot's progress), and a bad
 * first boot whose artefacts are not all there.
 */
export function cloudInitGate(output: string, bootstrap: string): Verdict {
  const v = cloudInitVerdict(output);
  if (v.ok) return v;
  const finished = /rc=\d+\s*$/.test(output.trim());
  if (!finished) return v;
  if (!/^BOOTSTRAP OK$/m.test(bootstrap)) {
    const missing = /^BOOTSTRAP MISSING:(.*)$/m.exec(bootstrap)?.[1]?.trim();
    return { ok: false, why: `${v.why}${missing ? `, and the bootstrap left out: ${missing}` : ""}` };
  }
  const status = /status:\s*(\S+)/.exec(output)?.[1] ?? "error";
  return {
    ok: true,
    why:
      `cloud-init's first boot ended in "${status}", but everything it was meant to leave behind is here ` +
      `— that, not first-boot history, is what says the box is bootstrapped`,
  };
}

/**
 * The root shell that installs the script and runs it.
 *
 * Built here rather than inline because it is the most quoting-dense thing in
 * the command and every clause in it is load-bearing:
 *
 * - **`install` then hash then run, in ONE shell.** Split across ssh calls
 *   there would be a window between proving which file is at that path and
 *   executing it.
 * - **Installed to `/usr/local/sbin`, never run from where it was staged.**
 *   `provision.sh` bind-mounts the volume over `/home` partway through its own
 *   run, so a script executing from under `/home` would have the ground move
 *   beneath it — and root should not run code out of a user-writable directory.
 * - **`flock`**, so two provisions cannot race on apt, on the log and on the
 *   status file.
 * - **`tee` inside a `pipefail` shell.** `sudo script | tee` puts an
 *   unprivileged `tee` at the end of the pipeline and makes ITS exit status the
 *   one that counts — which is exactly how a dead first boot once reported
 *   success (docs/postmortems/260831f-the-match-that-still-failed.md).
 * - **`GJD_ATTEMPT`**, which is what makes the status file evidence for this run
 *   rather than for whichever run wrote it last.
 */
export function buildProvisionRunner(o: {
  staged: string;
  installed: string;
  sha256: string;
  attempt: string;
  lock: string;
  log: string;
}): string {
  const q = (v: string) => `'${v.replaceAll("'", `'\\''`)}'`;
  return [
    "set -euo pipefail",
    `install -o root -g root -m 0700 ${q(o.staged)} ${q(o.installed)}`,
    `rm -f ${q(o.staged)}`,
    `got=$(sha256sum ${q(o.installed)} | cut -d' ' -f1)`,
    `[ "$got" = ${q(o.sha256)} ] || { echo "FATAL: the installed script hashes $got, not ${o.sha256}" >&2; exit 1; }`,
    `exec flock -w 10 ${q(o.lock)} env GJD_ATTEMPT=${q(o.attempt)} bash -o pipefail -c ${q(`${o.installed} 2>&1 | tee ${o.log}`)}`,
  ].join("\n");
}
