/**
 * **The Ideas read, in the flat fields its sibling hooks still publish.**
 *
 * `useIdeasRead` keeps one `Read<IdeasAnswer>` (src/web/read-state.ts) where
 * the other artefact hooks keep a status word, the artefact, flags and an error
 * string. The tables that walk every hook through one sequence
 * (read-error-matrix, none-yet-is-not-a-404-hooks, artefact-read-hooks) read
 * those fields by name, so the Ideas row goes through `flat`; and the tests that
 * pose an owner by hand build its read with `ideasReadFrom`. Both are how a
 * test reads or poses the state — neither changes what any test asserts.
 */
import type { Ideas } from "../../src/types.js";
import { answerOf, failureOf, type Read, statusOf } from "../../src/web/read-state.js";
import type { IdeasAnswer } from "../../src/web/useIdeas.js";

export interface IdeasFields {
  status: "loading" | "none" | "ready" | "error";
  ideas: Ideas | null;
  stale: boolean;
  outdated: boolean;
  profiled: boolean;
  profileChanged: boolean;
  error: string | null;
}

export function ideasFields(read: Read<IdeasAnswer>): IdeasFields {
  const answer = answerOf(read);
  return {
    status: statusOf(read),
    ideas: answer?.ideas ?? null,
    stale: answer?.stale ?? false,
    outdated: answer?.outdated ?? false,
    profiled: answer?.profiled ?? false,
    profileChanged: answer?.profileChanged ?? false,
    error: failureOf(read),
  };
}

/** A hook's return with the flat fields beside it. */
export function flat<V extends { read: Read<IdeasAnswer> }>(view: V): V & IdeasFields {
  return { ...view, ...ideasFields(view.read) };
}

const NO_IDEAS = { ideas: [] } as unknown as Ideas;

/**
 * A read posed from the flat fields. `ready` with no artefact named gets an
 * empty one: the type has no "ready, and nothing" to pose.
 */
export function ideasReadFrom(fields: Partial<IdeasFields>): Read<IdeasAnswer> {
  const status = fields.status ?? "none";
  if (status === "loading") return { kind: "asking" };
  if (status === "error") return { kind: "failed", error: fields.error ?? "The read failed." };
  return {
    kind: "known",
    answer:
      status === "none"
        ? null
        : {
            ideas: fields.ideas ?? NO_IDEAS,
            stale: fields.stale ?? false,
            outdated: fields.outdated ?? false,
            profiled: fields.profiled ?? false,
            profileChanged: fields.profileChanged ?? false,
          },
    recheck: fields.error ?? null,
  };
}
