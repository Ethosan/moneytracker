// Usage caps and request checks for ledger-ai, kept apart from index.ts so they can be tested
// without Deno or Supabase. The caps themselves are counted in the database by ai_take_call()
// (supabase/schema.sql); this file decides what a request is worth spending a slot on and what
// to answer when the counter says no or can't be reached.

// Per account per hour, per account per day, and all accounts together per day. The per-account
// daily cap sits well below the global one, so one account can't use up the day for everyone.
export const CALL_LIMIT = 120;
export const USER_DAILY_LIMIT = 30;
export const DEFAULT_DAILY_LIMIT = 300;

export type Early = { status: number; body: Record<string, unknown> };

// A request that can't spend the API key is answered before it takes a slot, so malformed or
// empty requests never use up quota. Returns null when the request is worth a slot.
export function checkBody(body: unknown): Early | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { status: 400, body: { error: "Bad request" } };
  const b = body as Record<string, unknown>;
  if (b.action === "review") {
    if (!Array.isArray(b.items) || !b.items.length) return { status: 200, body: { findings: [] } };
    return null;
  }
  if (b.action === "ask") {
    if (!String(b.question || "").trim()) return { status: 400, body: { error: "Ask a question." } };
    return null;
  }
  return { status: 400, body: { error: "Unknown action" } };
}

// What to answer for the result of ai_take_call(). null means the call is allowed. When the
// counter can't be read the answer is 503, never "allowed": an in-memory fallback is per copy of
// the function and resets on every cold start, so it is no cap at all.
export function slotAnswer(slot: unknown, failed: boolean): Early | null {
  if (failed) return { status: 503, body: { error: "The AI assistant can't check its usage limit right now, so it is paused. Try again in a few minutes." } };
  if (slot === "ok") return null;
  if (slot === "user") return { status: 429, body: { error: "Too many AI requests from this account. Try again in a little while." } };
  if (slot === "user_day") return { status: 429, body: { error: "This account has reached today's AI limit. Try again tomorrow." } };
  if (slot === "all") return { status: 429, body: { error: "The AI assistant has reached today's limit. Try again tomorrow." } };
  return { status: 503, body: { error: "The AI assistant can't check its usage limit right now, so it is paused. Try again in a few minutes." } };
}
