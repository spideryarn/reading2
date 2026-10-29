/**
 * **One mockup, drawn** — its words, its ASCII and its pictures, in the file's
 * order — for the two places that show one: its page, `/admin/mockups/m-…`
 * (AdminMockupsPage.tsx), and the Feedback dialog, where a question naming it
 * opens it in place (MockupsInText.tsx). Plan 261028b, Stage 3; plan 261029g.
 *
 * Read-only GETs under `/api/admin/mockups`, which is behind the server's
 * namespace gate, so a mockup is an admin's to see wherever it is drawn.
 */
import { type ReactNode, useEffect, useState } from "react";

import type { MockupDetail } from "../mockups.js";
import { apiFetch, readJson } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { ReaderFacingError } from "./lib/reader-facing.js";
import { PlainTextBlocks } from "./PlainTextBlocks.js";

export type Load<T> = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; value: T };

/** One GET, read as JSON, for as long as the caller wants `url`. A stale answer is dropped. */
export function useAdminRead<T>(url: string, pick: (body: unknown) => T): Load<T> {
  const [state, setState] = useState<{ url: string; load: Load<T> }>({ url, load: { kind: "loading" } });
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pick` is a module-scope function at every call.
  useEffect(() => {
    let live = true;
    setState({ url, load: { kind: "loading" } });
    void (async () => {
      try {
        const value = pick(await readJson<unknown>(await apiFetch(url)));
        if (live) setState({ url, load: { kind: "ready", value } });
      } catch (e) {
        if (live) setState({ url, load: { kind: "failed", message: describeFetchFailure(e as Error) } });
      }
    })();
    return () => {
      live = false;
    };
  }, [url]);
  return state.url === url ? state.load : { kind: "loading" };
}

export function Waiting<T>({ load, children }: { load: Load<T>; children: (value: T) => ReactNode }) {
  if (load.kind === "loading") return <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">Loading…</p>;
  if (load.kind === "failed") {
    return (
      <p
        role="alert"
        className="tw:m-0 tw:rounded-md tw:border tw:border-destructive/40 tw:bg-destructive/10 tw:p-4 tw:text-sm tw:text-foreground"
      >
        {load.message}
      </p>
    );
  }
  return <>{children(load.value)}</>;
}

export const pickMockup = (body: unknown) => (body as { mockup: MockupDetail }).mockup;

export const mockupUrl = (id: string) => `/api/admin/mockups/${encodeURIComponent(id)}`;

/** The parts, in the file's order. `textClassName` is the paragraphs' look where it is drawn. */
export function MockupBody({ mockup, textClassName }: { mockup: MockupDetail; textClassName: string }) {
  return (
    <>
      {/* Keyed by position: the parts are the file's order and never move. */}
      {mockup.body.map((part, i) =>
        part.kind === "text" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, see above.
          <div key={i} className="tw:flex tw:flex-col tw:gap-3">
            <PlainTextBlocks text={part.text} className={textClassName} />
          </div>
        ) : (
          <MockupImage key={`image-${part.index}`} id={mockup.id} index={part.index} />
        ),
      )}
    </>
  );
}

/**
 * **One picture, through `apiFetch` into a blob URL** — not `<img src=…>`,
 * which sends no `Authorization` header and would get a 401 (GPT Sol's plan
 * review, F2). The same two effects as AdminFeedbackList.tsx § `Screenshot`,
 * and for its reason: one fetches, one owns the URL's lifetime, so the URL is
 * revoked when replaced or unmounted and never while still shown.
 */
function MockupImage({ id, index }: { id: string; index: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setUrl(null);
    setError(null);
    void apiFetch(`${mockupUrl(id)}/images/${index}`)
      .then(async (res) => {
        if (!res.ok) throw new ReaderFacingError(`The image did not load (${res.status}).`);
        const made = URL.createObjectURL(await res.blob());
        if (live) setUrl(made);
        else URL.revokeObjectURL(made);
      })
      .catch((e: Error) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [id, index]);

  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  if (error !== null) {
    return (
      <p
        role="alert"
        className="tw:m-0 tw:rounded-md tw:border tw:border-destructive/40 tw:bg-destructive/10 tw:p-4 tw:text-sm tw:text-foreground"
      >
        {error}
      </p>
    );
  }
  if (url === null) return <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">Loading image…</p>;
  return (
    <img
      src={url}
      alt={`Mockup ${id}, figure ${index + 1}`}
      className="tw:max-w-full tw:h-auto tw:rounded-md tw:border tw:border-border"
    />
  );
}
