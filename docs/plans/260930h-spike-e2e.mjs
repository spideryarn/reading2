// Spike: a real sign-up confirmation and a real password reset, end to end, through the
// templates, against the throwaway stack in this directory. Same client options as the app
// (flowType pkce, emailRedirectTo = /auth/callback).
import { createClient } from "/home/greg/code/spideryarn2/.claude/worktrees/fb6s-auth-emails/node_modules/@supabase/supabase-js/dist/index.mjs";

const API = process.env.SPIKE_API ?? "http://127.0.0.1:55621";
const KEY = process.env.SPIKE_KEY;
const MAIL = process.env.SPIKE_MAIL ?? "http://127.0.0.1:55644";
const CALLBACK = process.env.SPIKE_CALLBACK ?? "http://127.0.0.1:5999/auth/callback";

const mem = new Map();
const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
const sb = createClient(API, KEY, { auth: { flowType: "pkce", storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false } });

const email = `spike-${Date.now()}@example.com`;
const fail = (m) => { console.error("FAIL:", m); process.exit(1); };

async function latestTo(addr, after) {
  for (let i = 0; i < 40; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent("to:" + addr)}`)).json();
    const msgs = (list.messages ?? []).filter((m) => !after.has(m.ID));
    if (msgs.length) {
      const m = await (await fetch(`${MAIL}/api/v1/message/${msgs[0].ID}`)).json();
      after.add(m.ID);
      return m;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  fail(`no mail to ${addr}`);
}

function button(html) {
  const m = /bgcolor="#DB8A45"[^>]*><a href="([^"]+)"/.exec(html);
  if (!m) fail("no orange button in the email");
  return m[1].replace(/&amp;/g, "&");
}

async function follow(link, label) {
  const res = await fetch(link, { redirect: "manual" });
  const loc = res.headers.get("location");
  console.log(`${label}: ${res.status} -> ${loc?.replace(/code=[^&]+/, "code=<…>")}`);
  if (!loc?.startsWith(CALLBACK)) fail(`${label} did not return to the callback`);
  const code = new URL(loc).searchParams.get("code");
  if (!code) fail(`${label}: no ?code= on the return`);
  return code;
}

const seen = new Set();

// 1. Sign up.
const up = await sb.auth.signUp({ email, password: "first-Password-1", options: { emailRedirectTo: CALLBACK } });
if (up.error) fail(up.error.message);
if (up.data.session) fail("signUp returned a session: confirmations are not on, so no email was tested");
const c = await latestTo(email, seen);
console.log(`confirmation subject: ${c.Subject}`);
if (c.Subject !== "Confirm your email for Spideryarn") fail("subject is not ours");
if (!c.HTML.includes("Confirm my email")) fail("body is not ours");
const cCode = await follow(button(c.HTML), "confirmation link");
const ex = await sb.auth.exchangeCodeForSession(cCode);
if (ex.error) fail(ex.error.message);
console.log(`confirmed: ${ex.data.user.email} email_confirmed_at=${ex.data.user.email_confirmed_at}`);
await sb.auth.signOut();

// 2. Reset the password.
const rp = await sb.auth.resetPasswordForEmail(email, { redirectTo: CALLBACK });
if (rp.error) fail(rp.error.message);
const r = await latestTo(email, seen);
console.log(`recovery subject: ${r.Subject}`);
if (r.Subject !== "Continue to Spideryarn") fail("subject is not ours");
if (!r.HTML.includes(">Continue</a>")) fail("body is not ours");
const rCode = await follow(button(r.HTML), "recovery link");
const rex = await sb.auth.exchangeCodeForSession(rCode);
if (rex.error) fail(rex.error.message);
const upd = await sb.auth.updateUser({ password: "second-Password-2" });
if (upd.error) fail(upd.error.message);
await sb.auth.signOut();
const old = await sb.auth.signInWithPassword({ email, password: "first-Password-1" });
if (!old.error) fail("the old password still works");
const nu = await sb.auth.signInWithPassword({ email, password: "second-Password-2" });
if (nu.error) fail(nu.error.message);
console.log("reset: old password refused, new password signs in");

// 3. A reset the way the dashboard sends one: /recover with no PKCE challenge.
await fetch(`${API}/auth/v1/recover`, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ email }) });
const d = await latestTo(email, seen);
const dres = await fetch(button(d.HTML), { redirect: "manual" });
const dloc = dres.headers.get("location") ?? "";
console.log(`dashboard-style recovery link: ${dres.status} -> ${dloc.replace(/(access_token|refresh_token)=[^&]+/g, "$1=<…>")}`);
if (!dloc.includes("#access_token=") || !dloc.includes("type=recovery") || dloc.includes("code=")) fail("expected an implicit-flow fragment");
console.log("dashboard-style reset: implicit fragment, no ?code= (which a flowType pkce client refuses)");
console.log("PASS");
