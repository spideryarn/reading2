/**
 * **The owner's added Skim briefs**, as the client reads and writes them — one
 * sentence each, *what are you skimming for?*, and the route planned for it.
 * The default brief (the reader profile with the article's *why you're
 * reading*) is not here: it is the revision's route, read by `useSkim` with no
 * brief. docs/plans/261027d-several-skim-briefs-per-article-and-a-picker-between-them.md.
 *
 * The routes are `/api/skim/:slug/briefs…` (src/routes.ts), owner-only, 404
 * to anybody else. **Planning is not here**: it is the `skim` job named for
 * the brief, which `useSkim(slug, quotes, ideas, brief)` starts through
 * `useStepJob` — the same queue, de-duplication and hold as the default's.
 * One brief's route is read there too, with the default's freshness fields.
 *
 * **The id is minted here**, the way Chat mints a thread's: `?brief=` can name
 * a brief from the first frame, and a create that is sent twice (a retry
 * after a lost answer) is one row, because the server's create is idempotent
 * on the id.
 */
import { useCallback, useEffect, useState } from "react";
import { mintId } from "../ids.js";
import type { SkimBriefList, SkimBriefSummary } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { MalformedReply } from "./lib/reader-facing.js";
import { useOrderedRead } from "./useOrderedRead.js";

const briefsPath = (slug: string) => `/api/skim/${encodeURIComponent(slug)}/briefs`;
const briefPath = (slug: string, id: string) => `${briefsPath(slug)}/${encodeURIComponent(id)}`;

function sendJson(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

/** Every added brief on the article, oldest first. */
export async function listBriefs(slug: string): Promise<SkimBriefSummary[]> {
  const body = await readJson<SkimBriefList>(await apiFetch(briefsPath(slug)));
  if (!Array.isArray(body?.briefs)) throw new MalformedReply("the briefs reply has no list");
  return body.briefs;
}

/**
 * Add a brief, unplanned. `id` is for a retry of the same create; a first
 * press leaves it to be minted. Answers with what the server stored, which
 * trims the sentence.
 */
export async function createBrief(slug: string, brief: string, id: string = mintId()): Promise<SkimBriefSummary> {
  return readJson<SkimBriefSummary>(await apiFetch(briefsPath(slug), sendJson("POST", { id, brief })));
}

/** Change a brief's sentence. Its route is not re-planned here: that is a job. */
export async function editBrief(slug: string, id: string, brief: string): Promise<SkimBriefSummary> {
  return readJson<SkimBriefSummary>(await apiFetch(briefPath(slug, id), sendJson("PATCH", { brief })));
}

/** Delete a brief and its route. A 204; anything else is a sentence `readJson` throws. */
export async function deleteBrief(slug: string, id: string): Promise<void> {
  const res = await apiFetch(briefPath(slug, id), { method: "DELETE" });
  if (!res.ok) await readJson(res);
}

export type BriefsStatus = "idle" | "loading" | "ready" | "error";

export interface SkimBriefs {
  /** `idle` while not asked to read (`enabled` false). */
  status: BriefsStatus;
  briefs: SkimBriefSummary[];
  error: string | null;
  /** Read the list again, trailing a read in flight. Never spends. */
  refresh(): Promise<void>;
  /** `createBrief`, and the list read again after it. */
  create(brief: string): Promise<SkimBriefSummary>;
  edit(id: string, brief: string): Promise<SkimBriefSummary>;
  remove(id: string): Promise<void>;
}

/**
 * **The list, read while `enabled`.** Stage 3 reads it only when `?brief=`
 * names one — to find its sentence, and to tell an unknown id from a real one
 * — so opening Skim on the default costs no request it did not cost before.
 * Every write reads the list again afterwards, whether or not it answered:
 * a write whose answer was lost may still have landed.
 */
export function useSkimBriefs(slug: string, enabled: boolean): SkimBriefs {
  const [state, setState] = useState<{ slug: string; status: BriefsStatus; briefs: SkimBriefSummary[]; error: string | null }>(
    { slug, status: "idle", briefs: [], error: null },
  );
  const load = useCallback(
    async (current: () => boolean) => {
      if (!enabled) return;
      setState((was) => (was.slug === slug && was.status === "ready" ? was : { slug, status: "loading", briefs: [], error: null }));
      try {
        const briefs = await listBriefs(slug);
        if (!current()) return;
        setState({ slug, status: "ready", briefs, error: null });
      } catch (err) {
        if (!current()) return;
        const why = describeFetchFailure(err as Error);
        /* A failed revalidation keeps the list it had, as every read here does. */
        setState((was) =>
          was.slug === slug && was.status === "ready" ? { ...was, error: why } : { slug, status: "error", briefs: [], error: why },
        );
      }
    },
    [slug, enabled],
  );
  const { reload, refresh } = useOrderedRead(load);
  useEffect(() => {
    void reload();
  }, [reload]);

  const after = useCallback(
    async <T,>(write: () => Promise<T>): Promise<T> => {
      try {
        return await write();
      } finally {
        void refresh();
      }
    },
    [refresh],
  );
  const create = useCallback((brief: string) => after(() => createBrief(slug, brief)), [after, slug]);
  const edit = useCallback((id: string, brief: string) => after(() => editBrief(slug, id, brief)), [after, slug]);
  const remove = useCallback((id: string) => after(() => deleteBrief(slug, id)), [after, slug]);

  const mine = state.slug === slug && enabled;
  return {
    status: mine ? state.status : "idle",
    briefs: mine ? state.briefs : [],
    error: mine ? state.error : null,
    refresh,
    create,
    edit,
    remove,
  };
}
