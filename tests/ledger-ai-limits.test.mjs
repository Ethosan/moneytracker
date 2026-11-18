// The usage caps of ledger-ai (supabase/functions/ledger-ai/limits.ts): the per-account daily cap
// sits well below the global one, a counter that can't be read refuses instead of allowing, and a
// request that can't spend the key is answered before it takes a slot.
import test from "node:test";
import assert from "node:assert/strict";
import { checkBody, slotAnswer, CALL_LIMIT, USER_DAILY_LIMIT, DEFAULT_DAILY_LIMIT } from "../supabase/functions/ledger-ai/limits.ts";
import { readFileSync } from "node:fs";

test("one account's daily cap is well below the global daily cap", () => {
  assert.ok(USER_DAILY_LIMIT * 5 <= DEFAULT_DAILY_LIMIT, "a handful of accounts must not be able to use up the day");
  assert.ok(USER_DAILY_LIMIT < CALL_LIMIT * 24);
});

test("a counter that cannot be read fails closed with 503", () => {
  assert.equal(slotAnswer(null, true).status, 503);
  assert.equal(slotAnswer("ok", true).status, 503, "an error wins even when a stale value came back");
  assert.equal(slotAnswer(undefined, false).status, 503, "an unknown answer is not permission");
  assert.equal(slotAnswer("maybe", false).status, 503);
});

test("each counter answer maps to the right status", () => {
  assert.equal(slotAnswer("ok", false), null);
  assert.equal(slotAnswer("user", false).status, 429);
  assert.equal(slotAnswer("user_day", false).status, 429);
  assert.match(slotAnswer("user_day", false).body.error, /today/);
  assert.equal(slotAnswer("all", false).status, 429);
});

test("bad or empty requests are answered before a slot is taken", () => {
  assert.equal(checkBody(null).status, 400);
  assert.equal(checkBody([]).status, 400);
  assert.equal(checkBody({}).status, 400);
  assert.equal(checkBody({ action: "nope" }).status, 400);
  assert.equal(checkBody({ action: "ask", question: "   " }).status, 400);
  assert.equal(checkBody({ action: "ask" }).status, 400);
  assert.deepEqual(checkBody({ action: "review", items: [] }), { status: 200, body: { findings: [] } });
  assert.deepEqual(checkBody({ action: "review" }), { status: 200, body: { findings: [] } });
});

test("good requests are worth a slot", () => {
  assert.equal(checkBody({ action: "ask", question: "how much on food?" }), null);
  assert.equal(checkBody({ action: "review", items: [{ i: 0 }] }), null);
});

test("index.ts takes the slot after the body check and has no in-memory fallback", () => {
  const src = readFileSync(new URL("../supabase/functions/ledger-ai/index.ts", import.meta.url), "utf8");
  assert.ok(src.indexOf("checkBody(body)") > 0 && src.indexOf("checkBody(body)") < src.indexOf('rpc("ai_take_call"'));
  assert.ok(!/CALLS\.(get|set)/.test(src), "the per-copy in-memory cap fails open");
  assert.match(src, /per_user_day/);
});
