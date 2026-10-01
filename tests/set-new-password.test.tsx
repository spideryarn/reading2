// @vitest-environment jsdom
/**
 * `SetNewPassword` — the form a password-recovery link lands on, inside
 * AuthCallback. docs/plans/261001i-password-reset.md.
 *
 * The reader is already signed in by the recovery link when this renders; what
 * it owes them is that the password they typed is the one that gets set, and
 * that a refusal keeps them on the form rather than sending them on as if it
 * had worked.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateUser = vi.fn();
const navigate = vi.fn();

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: { auth: { updateUser } },
}));

vi.mock("../src/web/router.js", async (real) => ({
  ...(await real<Record<string, unknown>>()),
  navigate,
}));

const { SetNewPassword } = await import("../src/web/SetNewPassword.js");
const { LIBRARY_HREF } = await import("../src/web/router.js");

let root: Root | null = null;
let host: HTMLDivElement;

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function fill(first: string, second: string): Promise<void> {
  host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(createElement(SetNewPassword));
  });
  const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="password"]')];
  expect(boxes).toHaveLength(2);
  const [a, b] = boxes as [HTMLInputElement, HTMLInputElement];
  expect(a.autocomplete).toBe("new-password");
  await act(async () => {
    type(a, first);
    type(b, second);
  });
  await act(async () => {
    a.closest("form")?.requestSubmit();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  updateUser.mockReset();
  navigate.mockReset();
  updateUser.mockResolvedValue({ data: { user: {} }, error: null });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("choosing a new password", () => {
  it("sets the password typed, and goes to the shelf", async () => {
    await fill("a-new-password", "a-new-password");
    expect(updateUser).toHaveBeenCalledWith({ password: "a-new-password" });
    expect(navigate).toHaveBeenCalledWith(LIBRARY_HREF, { replace: true });
  });

  it("refuses two different passwords without asking Supabase", async () => {
    await fill("a-new-password", "a-new-passwrod");
    expect(updateUser).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("[auth-password-mismatch]");
  });

  /**
   * `updateUser` rethrows what is not an Auth error — a dropped connection,
   * blocked storage — rather than returning it. GPT Sol, plan review, finding 5.
   */
  it("stays on the form, usable, when the call throws", async () => {
    updateUser.mockRejectedValue(new TypeError("Failed to fetch"));
    await fill("a-new-password", "a-new-password");
    expect(navigate).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("[auth-password-set]");
    const submit = host.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submit?.disabled).toBe(false);
  });

  it("stays on the form when Supabase refuses", async () => {
    updateUser.mockResolvedValue({
      data: { user: null },
      error: new Error("New password should be different from the old password."),
    });
    await fill("the-old-password", "the-old-password");
    expect(navigate).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("different from the old");
    expect(host.querySelectorAll('input[type="password"]')).toHaveLength(2);
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  });
});
