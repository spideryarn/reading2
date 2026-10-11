/**
 * **Every article, and moving one** — the data layer of `/admin/articles`.
 * docs/plans/261011n-author-gift-link-and-article-ownership-transfer.md § D4.
 *
 * One `GET /api/admin/articles` for the table; the transfer's preview
 * (`GET …/:id/transfer`) and the transfer itself (`POST`) are asked when the
 * confirmation needs them, and the accounts to choose from
 * (`GET /api/admin/users`) once, the first time a confirmation opens. A
 * refusal comes back in the server's words (`describeFetchFailure`), which is
 * what the page shows.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { AdminArticles, TransferDone, TransferPreview, TransferRequest } from "../admin-articles.js";
import type { AdminUser } from "../admin.js";
import { apiFetch, readJson } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";

const PATH = "/api/admin/articles";

/** One answer, or the sentence that says why not. */
export type Asked<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

/** The accounts a confirmation offers, as much of each as it shows. */
export type AccountChoice = Pick<AdminUser, "id" | "email" | "emailConfirmedAt">;

export interface UseAdminArticles {
  /** `null` while the first read is in flight — not "no articles". */
  readonly list: AdminArticles | null;
  readonly error: string | null;
  readonly loading: boolean;
  readonly reload: () => Promise<void>;
  readonly preview: (articleId: string) => Promise<Asked<TransferPreview>>;
  readonly transfer: (articleId: string, body: TransferRequest) => Promise<Asked<TransferDone>>;
  /** Read once, on the first call; a failure is answered and not kept, so the next call asks again. */
  readonly accounts: () => Promise<Asked<readonly AccountChoice[]>>;
}

function ask<T>(path: string, init?: RequestInit): Promise<Asked<T>> {
  return apiFetch(path, init)
    .then((r) => readJson<T>(r))
    .then(
      (value): Asked<T> => ({ ok: true, value }),
      (e: Error): Asked<T> => ({ ok: false, message: describeFetchFailure(e) }),
    );
}

const transferPath = (articleId: string) => `${PATH}/${encodeURIComponent(articleId)}/transfer`;

export function useAdminArticles(): UseAdminArticles {
  const [list, setList] = useState<AdminArticles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /* A read still in flight must not overwrite the one a transfer started. */
  const generation = useRef(0);
  const accountsRead = useRef<Promise<Asked<readonly AccountChoice[]>> | null>(null);

  const reload = useCallback(() => {
    const mine = ++generation.current;
    setLoading(true);
    return apiFetch(PATH)
      .then((r) => readJson<AdminArticles>(r))
      .then((body) => {
        if (mine !== generation.current) return;
        setList(body);
        setError(null);
      })
      .catch((e: Error) => {
        if (mine !== generation.current) return;
        /* The old list stays, and the page says it may be stale. */
        setError(describeFetchFailure(e));
      })
      .finally(() => {
        if (mine === generation.current) setLoading(false);
      });
  }, []);

  useEffect(() => void reload(), [reload]);

  const preview = useCallback((articleId: string) => ask<TransferPreview>(transferPath(articleId)), []);

  const transfer = useCallback(
    (articleId: string, body: TransferRequest) =>
      ask<TransferDone>(transferPath(articleId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    [],
  );

  const accounts = useCallback(() => {
    if (!accountsRead.current) {
      const read = ask<{ users: AdminUser[] }>("/api/admin/users").then(
        (answer): Asked<readonly AccountChoice[]> => {
          if (!answer.ok) {
            accountsRead.current = null;
            return answer;
          }
          return {
            ok: true,
            value: answer.value.users
              .map(
                (u): AccountChoice => ({
                  id: u.id,
                  email: u.email,
                  ...(u.emailConfirmedAt ? { emailConfirmedAt: u.emailConfirmedAt } : {}),
                }),
              )
              .sort((a, b) => a.email.localeCompare(b.email)),
          };
        },
      );
      accountsRead.current = read;
    }
    return accountsRead.current;
  }, []);

  return { list, error, loading, reload, preview, transfer, accounts };
}
