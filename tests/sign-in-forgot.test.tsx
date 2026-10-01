// @vitest-environment jsdom
/**
 * **"Forgot your password?"** on the sign-in form, which did not exist until
 * docs/plans/261001i-password-reset.md.
 *
 * What is pinned: the request goes to the bare callback, never the current page
 * (docs/project/auth.md, point 4); the sent sentence does not say whether an
 * account exists; a refusal is shown instead of the sent sentence. Prose is
 * free to change — the bracketed codes are what copy.md keeps stable.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resetPasswordForEmail = vi.fn();

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail,
      signInWithPassword: async () => ({ data: {}, error: null }),
      signInWithOAuth: async () => ({ data: {}, error: null }),
      signUp: async () => ({ data: {}, error: null }),
    },
  },
  googleSignInAvailable: async () => true,
  callbackUrl: () => "https://spideryarn.test/auth/callback",
}));

const { SignInControls } = await import("../src/web/SignInControls.js");

let root: Root | null = null;
let host: HTMLDivElement;

function button(text: RegExp): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((b) => text.test(b.textContent ?? ""));
  if (!found) throw new Error(`no button matching ${text} in: ${host.textContent}`);
  return found;
}

/** React tracks the value it last set, so a plain `.value =` is invisible to onChange. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function openForgot(): Promise<void> {
  host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(createElement(SignInControls, { returnTo: "/" }));
  });
  await act(async () => button(/forgot/i).click());
}

async function send(email: string): Promise<void> {
  const box = host.querySelector<HTMLInputElement>('input[type="email"]');
  if (!box) throw new Error("no email box");
  await act(async () => type(box, email));
  const form = box.closest("form");
  if (!form) throw new Error("the email box is not in a form");
  await act(async () => {
    form.requestSubmit();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  resetPasswordForEmail.mockReset();
  resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("forgot your password", () => {
  it("asks only for an email address", async () => {
    await openForgot();
    expect(host.querySelector('input[type="password"]')).toBeNull();
    expect(host.querySelector('input[type="email"]')).not.toBeNull();
  });

  it("sends the reset to the bare callback", async () => {
    await openForgot();
    await send("reader@example.com");
    expect(resetPasswordForEmail).toHaveBeenCalledWith("reader@example.com", {
      redirectTo: "https://spideryarn.test/auth/callback",
    });
    expect(host.textContent).toContain("[auth-reset-sent]");
  });

  it("does not claim the address has an account", async () => {
    await openForgot();
    await send("reader@example.com");
    expect(host.textContent).toContain(
      "If there is a Spideryarn account for reader@example.com",
    );
    expect(host.textContent).not.toMatch(/we found|your account exists|no account/i);
  });

  it("shows a refusal and not the sent sentence", async () => {
    resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: new Error("For security purposes, you can only request this after 60 seconds."),
    });
    await openForgot();
    await send("reader@example.com");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("60 seconds");
    expect(host.textContent).not.toContain("[auth-reset-sent]");
    expect(button(/send reset link/i).disabled).toBe(false);
  });

  /** Blocked storage: the SDK writes the PKCE verifier first, and throws. */
  it("shows a thrown failure and lets the reader try again", async () => {
    resetPasswordForEmail.mockRejectedValue(new Error("The operation is insecure."));
    await openForgot();
    await send("reader@example.com");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).not.toContain("[auth-reset-sent]");
    expect(button(/send reset link/i).disabled).toBe(false);
  });

  it("goes back to the sign-in form", async () => {
    await openForgot();
    await act(async () => button(/back to sign in/i).click());
    expect(host.querySelector('input[type="password"]')).not.toBeNull();
  });
});
