// @vitest-environment jsdom
/**
 * **The sign-in page's controls** — docs/plans/261001m, for Greg's report
 * spya-p6s5a4: *"we also allow email and password, and that should be apparent.
 * And we need to somehow make it easy for people to both log in and register."*
 *
 * What is pinned: the email form is on screen from the start rather than behind
 * a link; Sign in and Create account are one switch apart and the form really
 * changes (button, password autocomplete, the forgot link); both submit through
 * the form, so `required` and `minLength` hold for either; and the destination
 * the page was given is what a sign-in remembers — and forgets on failure.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signInWithPassword = vi.fn();
const signUp = vi.fn();
const signInWithOAuth = vi.fn();

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
      signInWithPassword,
      signInWithOAuth,
      signUp,
    },
  },
  googleSignInAvailable: async () => true,
  callbackUrl: () => "https://spideryarn.test/auth/callback",
}));

const { SignInControls } = await import("../src/web/SignInControls.js");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RETURN_KEY = "spideryarn:auth-return";

let root: Root | null = null;
let host: HTMLDivElement;

function button(text: RegExp): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((b) => text.test(b.textContent ?? ""));
  if (!found) throw new Error(`no button matching ${text} in: ${host.textContent}`);
  return found;
}

function maybeButton(text: RegExp): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((b) => text.test(b.textContent ?? ""));
}

function field(type: "email" | "password" | "text"): HTMLInputElement {
  const found = host.querySelector<HTMLInputElement>(`input[type="${type}"]`);
  if (!found) throw new Error(`no ${type} box in: ${host.innerHTML}`);
  return found;
}

/** The switch's own half, as opposed to the submit button that may share its words. */
function tab(text: RegExp): HTMLButtonElement {
  const found = [...host.querySelectorAll("button[aria-pressed]")].find((b) =>
    text.test(b.textContent ?? ""),
  );
  if (!found) throw new Error(`no tab matching ${text} in: ${host.textContent}`);
  return found as HTMLButtonElement;
}

function submitButton(): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>('form button[type="submit"]');
  if (!found) throw new Error(`no submit button in: ${host.innerHTML}`);
  return found;
}

/** React tracks the value it last set, so a plain `.value =` is invisible to onChange. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function show(props: { initialTab?: "sign-in" | "create"; returnTo: string }) {
  host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(createElement(SignInControls, props));
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

async function fillAndSubmit(email: string, password: string): Promise<void> {
  await act(async () => type(field("email"), email));
  await act(async () => type(field("password"), password));
  const form = field("email").closest("form");
  if (!form) throw new Error("the email box is not in a form");
  await act(async () => {
    form.requestSubmit();
  });
  await settle();
}

function remembered(): string | null {
  const raw = sessionStorage.getItem(RETURN_KEY);
  return raw ? (JSON.parse(raw) as { path: string }).path : null;
}

beforeEach(() => {
  sessionStorage.clear();
  signInWithPassword.mockReset().mockResolvedValue({ data: {}, error: null });
  signUp.mockReset().mockResolvedValue({ data: { session: null }, error: null });
  signInWithOAuth.mockReset().mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("what is on screen", () => {
  it("shows Google and the email form together, with nothing to open first", async () => {
    await show({ returnTo: "/" });
    expect(button(/continue with google/i)).toBeTruthy();
    expect(field("email")).toBeTruthy();
    expect(field("password")).toBeTruthy();
    expect(maybeButton(/use an email address/i)).toBeUndefined();
  });

  it("starts on Sign in by default", async () => {
    await show({ returnTo: "/" });
    expect(tab(/^sign in$/i).getAttribute("aria-pressed")).toBe("true");
    expect(tab(/^create account$/i).getAttribute("aria-pressed")).toBe("false");
    expect(field("password").autocomplete).toBe("current-password");
    expect(submitButton().textContent).toMatch(/^sign in$/i);
    expect(maybeButton(/forgot/i)).toBeTruthy();
  });

  it("switches to Create account, and the form really changes", async () => {
    await show({ returnTo: "/" });
    await act(async () => tab(/^create account$/i).click());
    expect(tab(/^create account$/i).getAttribute("aria-pressed")).toBe("true");
    expect(field("password").autocomplete).toBe("new-password");
    expect(submitButton().textContent).toMatch(/create account/i);
    expect(maybeButton(/forgot/i)).toBeUndefined();
    expect(host.textContent).toMatch(/at least 8 characters/i);
  });

  it("can start on Create account", async () => {
    await show({ initialTab: "create", returnTo: "/" });
    expect(field("password").autocomplete).toBe("new-password");
  });

  it("can show the password it is hiding", async () => {
    await show({ returnTo: "/" });
    await act(async () => button(/^show$/i).click());
    expect(field("text").id).toBe("signin-password");
    await act(async () => button(/^hide$/i).click());
    expect(field("password")).toBeTruthy();
  });
});

describe("submitting", () => {
  it("signs in with the password, remembering where the page was told to go", async () => {
    await show({ returnTo: "/read/an-essay" });
    await fillAndSubmit("reader@example.com", "a-long-password");
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "reader@example.com",
      password: "a-long-password",
    });
    expect(signUp).not.toHaveBeenCalled();
    expect(remembered()).toBe("/read/an-essay");
  });

  it("creates an account through the same form, to the bare callback", async () => {
    await show({ initialTab: "create", returnTo: "/read/an-essay" });
    await fillAndSubmit("reader@example.com", "a-long-password");
    expect(signUp).toHaveBeenCalledWith({
      email: "reader@example.com",
      password: "a-long-password",
      options: { emailRedirectTo: "https://spideryarn.test/auth/callback" },
    });
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(remembered()).toBe("/read/an-essay");
    expect(host.textContent).toContain("[auth-confirm]");
  });

  /* The reason Create account is the form's submit button now rather than a
     side button that called `signUp` itself: the form's own constraints apply. */
  it("does not create an account with an empty password", async () => {
    await show({ initialTab: "create", returnTo: "/" });
    await fillAndSubmit("reader@example.com", "");
    expect(signUp).not.toHaveBeenCalled();
  });

  /* jsdom does not enforce `minLength` (the spec applies it only to a value the
     user edited, and jsdom has no user), so the short case is pinned as the
     constraint being on the box the submit button validates, not as a refusal. */
  it("puts the eight-character floor on the box the Create account button submits", async () => {
    await show({ initialTab: "create", returnTo: "/" });
    expect(field("password").minLength).toBe(8);
    expect(field("password").required).toBe(true);
    expect(submitButton().form).toBe(field("password").form);
  });

  it("forgets the destination when the sign-in is refused", async () => {
    signInWithPassword.mockResolvedValue({
      data: {},
      error: new Error("Invalid login credentials"),
    });
    await show({ returnTo: "/read/an-essay" });
    await fillAndSubmit("reader@example.com", "a-long-password");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Invalid login");
    expect(remembered()).toBeNull();
  });

  it("forgets the destination when an account cannot be created", async () => {
    signUp.mockResolvedValue({ data: {}, error: new Error("User already registered") });
    await show({ initialTab: "create", returnTo: "/read/an-essay" });
    await fillAndSubmit("reader@example.com", "a-long-password");
    expect(remembered()).toBeNull();
  });

  it("remembers the destination on the way out to Google", async () => {
    await show({ returnTo: "/read/an-essay" });
    await act(async () => button(/continue with google/i).click());
    await settle();
    expect(signInWithOAuth).toHaveBeenCalled();
    expect(remembered()).toBe("/read/an-essay");
  });

  it("forgets the destination when Google refuses to start", async () => {
    signInWithOAuth.mockResolvedValue({ data: {}, error: new Error("nope") });
    await show({ returnTo: "/read/an-essay" });
    await act(async () => button(/continue with google/i).click());
    await settle();
    expect(remembered()).toBeNull();
  });
});
