/**
 * How much room the OpenRouter key has left this month, in dollars.
 *
 *   npx tsx evals/long-structure/key-room.ts
 *
 * Free: one GET of the key's own record. Prints numbers only, never the key.
 * `run.ts` calls `keyRoom()` before any paid cell and refuses under its floor.
 */
import { loadEnvLocal } from "../../src/env.js";
import { isMain } from "../../src/is-main.js";

export interface KeyRoom {
  limit: number | null;
  usage: number | null;
  limitRemaining: number | null;
}

export async function keyRoom(): Promise<KeyRoom> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set.");
  const response = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` } });
  if (!response.ok) throw new Error(`The key endpoint answered ${response.status}.`);
  const { data } = (await response.json()) as { data?: Record<string, unknown> };
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return { limit: num(data?.limit), usage: num(data?.usage), limitRemaining: num(data?.limit_remaining) };
}

if (isMain(import.meta.url)) {
  loadEnvLocal();
  console.log(JSON.stringify(await keyRoom()));
}
