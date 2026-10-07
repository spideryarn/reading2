/**
 * **An AI app asking to act as you** — `/oauth/consent`, the page Supabase's
 * OAuth server sends the browser to during a connector's sign-in.
 * docs/plans/261007p-mcp-remote-sign-in-with-oauth.md, stage 1.
 *
 * Supabase does the protocol: the client, the code, the tokens. This page
 * does the one thing only a person can: read who is asking and say yes or no.
 * So it shows three facts and explains both tool and account access; nothing is taken on
 * trust:
 *
 * - **the name the app registered**, labelled as what it *calls itself*,
 *   because it is whatever its registrant typed;
 * - **the whole host it will send you back to**, `URL.host` and not a
 *   shortened form — `claude.ai.attacker.example` must read as itself;
 * - **the account it will act as**, from Supabase's answer rather than from
 *   the page's own session, since that is the account the token is for.
 *
 * Reached signed in only: App.tsx sends a stranger to `/login` with this whole
 * address as `next`, so the `authorization_id` comes back with them.
 *
 * Allow and Deny pass `skipBrowserRedirect` and follow the answer themselves
 * (`leave`), so the redirect is one decision in one place, refused if it is not
 * a web address, and a test can watch it.
 */
import { useEffect, useRef, useState } from "react";

import { OAUTH_FAILED, OAUTH_NO_REQUEST } from "../messages.js";
import { isWebUrl } from "../urls.js";
import { Button } from "./components/ui/button.js";
import { supabase } from "./lib/supabase.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { useAddress } from "./router.js";

/** What the tools permit; the broader sign-in credential is explained below. */
export const CONSENT_WHAT_IT_CAN_DO =
  "It will be able to do what you can do on Spideryarn through its tools: read and organise your " +
  "shelf, import articles, and, as the administrator, look up readers and gift vouchers. These tools cannot " +
  "send email, publish, or hand over a private link: those need you, in the Mac app or on the site.";

interface Request {
  readonly clientName: string;
  readonly redirectHost: string;
  readonly email: string;
}

type State =
  | { kind: "loading" }
  | { kind: "ask"; request: Request }
  | { kind: "deciding"; request: Request }
  | { kind: "leaving" }
  | { kind: "failed"; message: string };

/** A redirect we will follow: a web address, and nothing else Supabase could hand back. */
function redirectOf(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("redirect_url" in data)) return null;
  const url = (data as { redirect_url?: unknown }).redirect_url;
  return typeof url === "string" && isWebUrl(url) ? url : null;
}

function requestOf(data: unknown): Request | null {
  if (!data || typeof data !== "object" || !("authorization_id" in data)) return null;
  const d = data as {
    redirect_uri?: unknown;
    client?: { name?: unknown };
    user?: { email?: unknown };
  };
  if (typeof d.redirect_uri !== "string" || !isWebUrl(d.redirect_uri)) return null;
  const email = d.user?.email;
  if (typeof email !== "string" || email === "") return null;
  const name = d.client?.name;
  return {
    clientName: typeof name === "string" && name.trim() !== "" ? name : "(no name)",
    redirectHost: new URL(d.redirect_uri).host,
    email,
  };
}

export function OAuthConsentPage({
  leave = (url: string) => window.location.assign(url),
}: {
  /** Where the browser goes once Supabase has answered. A seam for the tests. */
  leave?: (url: string) => void;
}) {
  useDocumentTitle(pageTitle({ kind: "oauth-consent" }));
  const address = useAddress();
  const id = new URLSearchParams(address.split("?")[1] ?? "").get("authorization_id") ?? "";
  const initialState = (): State =>
    id === "" ? { kind: "failed", message: OAUTH_NO_REQUEST } : { kind: "loading" };
  const [loaded, setLoaded] = useState(() => ({ id, state: initialState() }));
  // Hide the old request during render, before the new effect has run.
  const state = loaded.id === id ? loaded.state : initialState();
  const setState = (next: State) => setLoaded({ id, state: next });
  const active = useRef<{ id: string; live: boolean } | null>(null);
  const stillCurrent = (lifetime: { id: string; live: boolean } | null) =>
    lifetime?.live === true && active.current === lifetime &&
    new URLSearchParams(location.search).get("authorization_id") === lifetime.id;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `leave` is a seam, not state — the request is read once per id.
  useEffect(() => {
    const lifetime = { id, live: true };
    active.current = lifetime;
    setState(initialState());
    if (id === "") return () => { lifetime.live = false; };
    void (async () => {
      let next: State;
      try {
        const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
        const request = error ? null : requestOf(data);
        const redirect = error || request ? null : redirectOf(data);
        if (redirect) {
          if (stillCurrent(lifetime)) leave(redirect);
          next = { kind: "leaving" };
        } else {
          next = request ? { kind: "ask", request } : { kind: "failed", message: OAUTH_FAILED };
        }
      } catch {
        next = { kind: "failed", message: OAUTH_FAILED };
      }
      if (stillCurrent(lifetime)) setState(next);
    })();
    return () => {
      lifetime.live = false;
    };
  }, [id]);

  async function decide(allow: boolean): Promise<void> {
    const request = active.current;
    const stillHere = () => stillCurrent(request);
    if (state.kind !== "ask" || request?.id !== id || !stillHere()) return;
    setState({ kind: "deciding", request: state.request });
    try {
      const options = { skipBrowserRedirect: true };
      const { data, error } = allow
        ? await supabase.auth.oauth.approveAuthorization(id, options)
        : await supabase.auth.oauth.denyAuthorization(id, options);
      if (!stillHere()) return;
      const redirect = error ? null : redirectOf(data);
      if (redirect) {
        setState({ kind: "leaving" });
        leave(redirect);
        return;
      }
    } catch {
      /* Falls through to the same sentence as a refusal. */
    }
    if (stillHere()) setState({ kind: "failed", message: OAUTH_FAILED });
  }

  return (
    <main className="tw:mx-auto tw:max-w-xl tw:px-6 tw:pt-24 tw:font-sans">
      <h1 className="tw:m-0 tw:mb-3 tw:font-prose tw:text-2xl tw:text-foreground">
        An app wants to use Spideryarn as you
      </h1>
      {state.kind === "failed" && (
        <p className="gloss-error" role="alert">
          {state.message}
        </p>
      )}
      {(state.kind === "loading" || state.kind === "leaving") && (
        <p className="tw:m-0 tw:text-sm tw:text-ink-faint">
          {state.kind === "loading" ? "Reading the request…" : "Taking you back to the app…"}
        </p>
      )}
      {(state.kind === "ask" || state.kind === "deciding") && (
        <>
          <dl className="tw:m-0 tw:mb-4 tw:grid tw:grid-cols-[auto_1fr] tw:gap-x-4 tw:gap-y-1 tw:text-sm">
            <dt className="tw:text-ink-faint">It calls itself</dt>
            <dd className="tw:m-0 tw:break-words tw:text-foreground">{state.request.clientName}</dd>
            <dt className="tw:text-ink-faint">It will send you back to</dt>
            <dd className="tw:m-0 tw:break-all tw:text-foreground">{state.request.redirectHost}</dd>
            <dt className="tw:text-ink-faint">As your account</dt>
            <dd className="tw:m-0 tw:break-all tw:text-foreground">{state.request.email}</dd>
          </dl>
          <p className="tw:m-0 tw:mb-3 tw:text-sm tw:text-muted-foreground">{CONSENT_WHAT_IT_CAN_DO}</p>
          <p className="tw:m-0 tw:mb-3 tw:text-sm tw:text-muted-foreground">
            Allowing gives the app a sign-in to your account. Spideryarn only lets that sign-in use
            the tools above, but while it lasts it could also change your account settings, such as
            your password, unless a change needs a code from your email.
          </p>
          <p className="tw:m-0 tw:mb-5 tw:text-sm tw:text-ink-faint">
            The name is whatever the app's maker registered. If you did not just add Spideryarn
            to an app yourself, or the address above is not one you expect, choose Deny.
          </p>
          <div className="tw:flex tw:flex-wrap tw:gap-2">
            <Button type="button" disabled={state.kind === "deciding"} onClick={() => void decide(true)}>
              Allow
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={state.kind === "deciding"}
              onClick={() => void decide(false)}
            >
              Deny
            </Button>
          </div>
        </>
      )}
    </main>
  );
}
