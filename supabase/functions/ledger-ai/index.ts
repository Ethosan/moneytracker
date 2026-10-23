// 20bucks AI: reviews new entries for likely mistakes, answers questions about your spending,
// and proposes changes from the Ask chat. A proposal is only data: the app shows it with an
// Apply button and nothing in the ledger changes until the owner taps it.
// The API key lives here as a Supabase secret, never in the app. While OPEN_TO_ALL is true
// any signed-in account can use it (each capped at CALL_LIMIT calls an hour); set it to false
// to allow only the accounts on the AI_ALLOWED_IDS allowlist, since sign-in creates an
// account for anyone and an open function lets a stranger spend the key.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   MISTRAL_API_KEY     to use Mistral (the default when it is set)
//   ANTHROPIC_API_KEY   to use Claude
//   AI_PROVIDER         optional: "mistral" or "anthropic", to choose when both keys are set
//   MISTRAL_MODEL       optional, default mistral-small-latest
//   ANTHROPIC_MODEL     optional, default claude-opus-5-5
//   AI_DAILY_LIMIT      optional, AI calls per day for all accounts together (default 300)
//   AI_ALLOWED_IDS      comma-separated user ids allowed to call this function when
//                       OPEN_TO_ALL is false (Supabase dashboard -> Authentication -> Users
//                       -> copy the UUID); with it unset the function then answers nobody.
// Exact versions, each at least two weeks old when pinned: a fresh release can carry a
// compromised package, and an unpinned import pulls whatever was published that hour.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import Anthropic from "npm:@anthropic-ai/sdk@0.132.1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

type Item = { i: number; d: string; t: string; amt: number; cat: string; note: string };
type Turn = { role: "user" | "assistant"; content: string };

const REVIEW_SYSTEM = `You check a personal spending log (Singapore dollars) for likely data-entry mistakes.
Each entry has an index i, date d, type t (exp = spending, inc = income), amount amt, category cat and note.
When the owner's usual patterns are provided, compare each entry with them. An entry that matches the
usual type, amount and category is a habit, not a mistake: a subscription that is always the same amount
is fine. A note that is usually income is income even if the note sounds like an expense, and a category
the owner usually uses for income is an income category even if its name sounds like an expense.
Each category also has a type the owner set (income or spending); an entry whose type matches its category's type is correct.
Flag only entries that are probably wrong: a category that clearly does not fit the note, an amount that looks
like a typo for that kind of purchase, income logged as spending or the reverse, or a note that contradicts the
amount. Unusual but plausible spending is not a mistake. When unsure, leave it out; an empty list is a good answer.
For a category fix, use a name exactly as it appears in the allowed categories. Write each issue as one short,
plain sentence addressed to the owner.
Reply with JSON only: {"findings":[{"i":0,"issue":"...","cat":"optional category","amt":optional number}]}`;

const ASK_SYSTEM = `You answer questions about the owner's personal finances using only the data provided: a current snapshot,
exact totals worked out for you, and every transaction and entry. For any sum, use the exact totals rather than adding rows yourself;
use the rows to look up specific purchases, dates and patterns. Savings means income minus spending: every month has a Saved line
and averages are given, so answer "how much should I save" questions from those numbers.
Amounts are Singapore dollars unless marked US$.
This is a conversation: a short follow-up ("break it down", "I mean the prop firms", "and last month?") is about
the topic of the previous messages, so answer it in that context instead of starting over.
When asked for a breakdown, list every item with its own numbers (for prop firms: each firm's fees paid,
payouts received and net result; by month when asked), then a one-line total. Use short lists, bold the key
figure, and add one sentence of interpretation (is it worth it, what stands out). For a breakdown with several
rows, use a markdown table (a header row, a |---| separator row, one row per item); the app renders it. You may
show a formula in LaTeX, but only wrapped in double dollar signs ($$...$$) or backslash parentheses, never single
$ signs around math, because amounts are written with $ (like $500). Never use LaTeX tabular.
If the summary does not contain what is needed, say exactly what is missing instead of guessing.

You can propose changes to transactions: adding one, editing one, or deleting one. Propose them when the owner asks
you to log, fix, move, recategorise or remove something, or when they agree to a fix you suggested. Do not propose
changes they did not ask for. Nothing changes when you propose: the app shows each change with an Apply button and
the owner decides, so say so in one short line ("Tap Apply to make the change.") and never claim it is already done.
Write your answer first, then put the changes at the very end in a fenced block tagged changes, holding a JSON array:
\`\`\`changes
[{"op":"add","d":"2026-10-21","t":"exp","amt":12.5,"cat":"<exact category>","note":"Lunch","why":"short reason"},
 {"op":"edit","id":"<id from the ledger>","amt":15,"cat":"<exact category>","note":"...","d":"YYYY-MM-DD","t":"exp","why":"..."},
 {"op":"delete","id":"<id from the ledger>","why":"..."}]
\`\`\`
For add: d, t (exp or inc), amt and cat are required; note and acct (a wallet from the WALLETS list) are optional;
d defaults to today. For edit: id, plus only the fields that change. For delete: id. Use ids exactly as they appear in
the id column of the transactions; rows without an id cannot be changed from here (fees, investment mirrors,
transfers), so tell the owner to change those in the app. Categories must be written exactly as in the CATEGORIES list,
emoji included, and match the type (spending categories for exp, income categories for inc). At most 20 changes.
Leave the block out entirely when there is nothing to change.`;

function provider() {
  const want = (Deno.env.get("AI_PROVIDER") || "").toLowerCase();
  if (want === "anthropic" || (!Deno.env.get("MISTRAL_API_KEY") && Deno.env.get("ANTHROPIC_API_KEY"))) return "anthropic";
  return "mistral";
}

async function mistral(system: string, messages: Turn[], asJson: boolean) {
  const key = Deno.env.get("MISTRAL_API_KEY");
  if (!key) throw new Error("MISTRAL_API_KEY is not set in the function's secrets.");
  const model = Deno.env.get("MISTRAL_MODEL") || "mistral-small-latest";
  const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, ...messages],
      temperature: 0.2,
      max_tokens: 2000,
      ...(asJson ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!r.ok) throw new Error(`Mistral ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  return { text: String(data.choices?.[0]?.message?.content ?? ""), model, cut: data.choices?.[0]?.finish_reason === "length" };
}

async function claude(system: string, messages: Turn[]) {
  if (!Deno.env.get("ANTHROPIC_API_KEY")) throw new Error("ANTHROPIC_API_KEY is not set in the function's secrets.");
  const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-opus-5-5";
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model,
    max_tokens: 16000,
    system,
    messages,
    output_config: { effort: "low" },
    // on a policy decline the API retries on a fallback model inside the same call
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);
  if (response.stop_reason === "refusal") throw new Error("The model declined this request.");
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return { text, model: response.model, cut: response.stop_reason === "max_tokens" };
}

async function complete(system: string, messages: Turn[], asJson: boolean) {
  return provider() === "anthropic" ? await claude(system, messages) : await mistral(system, messages, asJson);
}

function firstJson(text: string) {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}


// The whole ledger, read here with the signed-in user's own session (row level security
// limits it to their rows), so every question can use all of it without the phone sending it.
// Exact totals are worked out here: language models are unreliable at adding up long lists.
type Tx = { id?: string; feeOf?: string; propOf?: string; d: string; t: string; amt: number; cat?: string; sub?: string; note?: string; acct?: string; pm?: string; plp?: string; tags?: string[]; split?: { mine: number; person: string }; from?: string; to?: string; inst?: { n: number; fee?: number } };
const r2 = (n: number) => Math.round(n * 100) / 100;
const plainCat = (c = "") => c.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, "");
// Budget for the whole prompt (rows + snapshot + history), in characters. The rows are
// mostly dates, amounts and ids, which come to about 2.5 characters per token, so this keeps
// a full prompt near 100k tokens: inside mistral-small's 128k context with room for the answer.
const PROMPT_BUDGET = 250000;

async function fullLedger(sb: SupabaseClient, rowLimit: number) {
  const { data, error } = await sb.from("ledger_docs").select("id,body");
  if (error) throw new Error("Couldn't read your ledger: " + error.message);
  const doc: Record<string, any> = {};
  (data || []).forEach((d: { id: string; body: any }) => { doc[d.id] = d.body || {}; });
  const tx: Tx[] = Object.keys(doc).filter((k) => k.startsWith("tx-")).flatMap((k) => doc[k].items || []).filter((x: Tx) => x && x.d)
    .sort((a: Tx, b: Tx) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const mine = (x: Tx) => (x.t === "exp" && x.split && x.split.mine >= 0 ? x.split.mine : x.amt);
  const meta = doc.meta || {}, out: string[] = [];
  // what a proposed change may refer to: editable rows, the owner's categories and wallets
  const ids = new Set(tx.filter((x) => x.id && !x.feeOf && !x.propOf && (x.t === "exp" || x.t === "inc")).map((x) => x.id as string));
  // each editable row's current type and category, so an edit that changes only one of them
  // can still be checked against the other
  const byId = new Map<string, { t: string; cat: string }>(tx.filter((x) => x.id && ids.has(x.id as string)).map((x) => [x.id as string, { t: x.t, cat: x.cat || "" }]));
  const cats = new Map<string, string>(((meta.cats || []) as any[]).filter((c) => c && c.name).map((c) => [String(c.name), c.type === "inc" ? "inc" : "exp"]));
  const accts = new Set<string>(((meta.accounts || []) as any[]).filter((a) => a && a.name && !a.liability).map((a) => String(a.name)));

  // exact totals
  const byMonth: Record<string, Record<string, number>> = {}, inMonth: Record<string, Record<string, number>> = {}, byYear: Record<string, { spent: number; income: number }> = {}, notes: Record<string, { n: number; s: number; cat: string }> = {};
  tx.forEach((x) => {
    const m = x.d.slice(0, 7), y = x.d.slice(0, 4), c = plainCat(x.cat);
    byYear[y] = byYear[y] || { spent: 0, income: 0 };
    if (x.t === "exp") {
      (byMonth[m] = byMonth[m] || {})[c] = r2((byMonth[m][c] || 0) + mine(x)); byYear[y].spent += mine(x);
      const k = (x.note || "").trim(); if (k) { const o = notes[k] = notes[k] || { n: 0, s: 0, cat: c }; o.n++; o.s += mine(x); }
    } else if (x.t === "inc") { (inMonth[m] = inMonth[m] || {})[c] = r2((inMonth[m][c] || 0) + x.amt); byYear[y].income += x.amt; }
  });
  out.push("EXACT TOTALS (use these numbers rather than adding rows yourself)");
  Object.keys(byYear).sort().forEach((y) => out.push(`Year ${y}: spent ${r2(byYear[y].spent)}, income ${r2(byYear[y].income)}`));
  Object.keys(byMonth).sort().forEach((m) => {
    const c = byMonth[m], tot = r2(Object.values(c).reduce((a, b) => a + b, 0));
    out.push(`Spent ${m}: total ${tot}; ` + Object.keys(c).sort((a, b) => c[b] - c[a]).map((k) => `${k} ${c[k]}`).join(", "));
  });
  Object.keys(inMonth).sort().forEach((m) => { const c = inMonth[m]; out.push(`Income ${m}: ` + Object.keys(c).map((k) => `${k} ${c[k]}`).join(", ")); });
  // savings per month (income minus spending) and the averages a savings-goal question needs
  const saved: Record<string, number> = {};
  Object.keys(inMonth).forEach((m) => { saved[m] = Object.values(inMonth[m]).reduce((a, b) => a + b, 0); });
  Object.keys(byMonth).forEach((m) => { saved[m] = (saved[m] || 0) - Object.values(byMonth[m]).reduce((a, b) => a + b, 0); });
  Object.keys(saved).sort().forEach((m) => out.push(`Saved ${m}: ${r2(saved[m])} (income minus spending)`));
  const last12 = Object.keys(saved).sort().slice(-12);
  if (last12.length) {
    const ai = last12.reduce((a, m) => a + Object.values(inMonth[m] || {}).reduce((x, y) => x + y, 0), 0) / last12.length;
    const as = last12.reduce((a, m) => a + Object.values(byMonth[m] || {}).reduce((x, y) => x + y, 0), 0) / last12.length;
    out.push(`Averages over the last ${last12.length} months with entries: income ${r2(ai)}, spent ${r2(as)}, saved ${r2(ai - as)}` + (ai > 0.005 ? ` (${Math.round(((ai - as) / ai) * 100)}% of income)` : "") + ".");
  }
  const topNotes = Object.keys(notes).sort((a, b) => notes[b].s - notes[a].s).slice(0, 40);
  if (topNotes.length) out.push("Biggest notes, all time: " + topNotes.map((k) => `${k} (${notes[k].cat}) ${notes[k].n}x ${r2(notes[k].s)}`).join("; "));

  // investments, prop firms and poker, per account
  const venues = meta.venues || {}, led = (doc.ledger && doc.ledger.entries) || [];
  const perV: Record<string, { type: string; inn: number; outv: number; n: number; last: string }> = {};
  led.forEach((e: any) => {
    const v = perV[e.venue] = perV[e.venue] || { type: (venues[e.venue] && venues[e.venue].type) || "broker", inn: 0, outv: 0, n: 0, last: "" };
    if (e.f === "in") v.inn += e.amt; else if (e.f === "out") v.outv += e.amt; v.n++; if (e.d > v.last) v.last = e.d;
  });
  Object.keys(perV).forEach((k) => { const v = perV[k]; out.push(`${v.type} ${k}: paid in ${r2(v.inn)}, taken out ${r2(v.outv)}, net ${r2(v.outv - v.inn)} (cash basis), ${v.n} entries, last ${v.last}`); });

  // the rows themselves
  const rows: string[] = [];
  rows.push("\nINVESTMENT, PROP FIRM AND POKER ENTRIES: date | account | in (money paid in / fee / buy-in) or out (money taken out / payout / win) or bal (balance) | amount | note");
  // these sections are capped too, newest kept, so they can never crowd out every transaction
  const newest = (list: any[], n: number, what: string) => {
    if (list.length > n) rows.push(`(${list.length - n} older ${what} left out to fit; the totals above still include them)`);
    return list.slice(-n);
  };
  newest(led.slice().sort((a: any, b: any) => (a.d < b.d ? -1 : 1)), 400, "entries")
    .forEach((e: any) => rows.push(`${e.d} | ${e.venue} | ${e.f} | ${r2(e.amt)} | ${e.note || ""}`));
  const debts = (doc.debts && doc.debts.entries) || [];
  if (debts.length) {
    rows.push("\nMONEY BETWEEN PEOPLE: date | person | amount (positive: they owe me) | note");
    newest(debts.slice().sort((a: any, b: any) => (a.d < b.d ? -1 : 1)), 300, "entries")
      .forEach((x: any) => rows.push(`${x.d} | ${x.person} | ${r2(x.amt)} | ${x.note || ""}`));
  }
  const bills = (doc.bills && doc.bills.entries) || [];
  if (bills.length) {
    rows.push("\nPAYLATER BILLS: provider | period from | instalments | fee | payments (date amount)");
    bills.forEach((b: any) => rows.push(`${b.prov || "GrabPay Later"} | ${b.from} | ${b.n || 1} | ${b.fee || 0} | ${(b.payments || []).map((p: any) => p.d + " " + p.amt).join(", ")}`));
  }
  const checks = ((doc.checks && doc.checks.entries) || []).slice().sort((a: any, b: any) => (a.d < b.d ? -1 : 1));
  if (checks.length) {
    rows.push("\nBALANCE COUNTS (real balances I counted; between two counts each wallet should move by exactly what I logged on it): date | wallet amounts | what my logs said at the time");
    newest(checks, 200, "counts").forEach((c: any) => rows.push(`${c.d} | ${Object.keys(c.lines || {}).map((k) => `${k} ${r2(+c.lines[k])}`).join(", ")} | ${c.exp ? Object.keys(c.exp).map((k) => `${k} ${r2(+c.exp[k])}`).join(", ") : ""}`));
  }
  if ((meta.subs || []).length) rows.push("\nSUBSCRIPTIONS: " + meta.subs.map((s: any) => `${s.name} ${s.amt} every ${s.cycle || 1} month(s), next ${s.next || "?"}${s.active === false ? " (stopped)" : ""}`).join("; "));
  if ((meta.budgets || []).length) rows.push("BUDGETS (monthly): " + meta.budgets.map((b: any) => `${String(b.key).slice(4)} ${b.amt}`).join(", "));
  if (cats.size) rows.push("\nCATEGORIES (write them exactly like this in changes): " + [...cats].map(([n, t]) => `${n} (${t === "inc" ? "income" : "spending"})`).join(", "));
  if (accts.size) rows.push("WALLETS: " + [...accts].join(", "));
  rows.push("\nTRANSACTIONS, oldest first: date | type (exp spending, inc income, xfer transfer, adj adjustment) | amount | my share if split | category | subcategory | note | paid with | tags | id (blank: cannot be changed from the chat)");
  const txRows = tx.map((x) => [x.d, x.t, r2(x.amt), x.split ? `${r2(x.split.mine)} (rest owed by ${x.split.person})` : "", plainCat(x.cat), x.sub || "", x.note || "",
    x.t === "xfer" ? `${x.from || "?"} -> ${x.to || "?"}` : x.pm === "later" ? `PayLater ${x.plp || "GrabPay Later"}${x.inst && x.inst.n > 1 ? " in " + x.inst.n + " instalments" : ""}` : x.acct || "", (x.tags || []).join("/"), x.id && ids.has(x.id) ? x.id : ""].join(" | "));
  // keep the newest rows when it's too much to send
  let used = out.join("\n").length + rows.join("\n").length, keepFrom = 0;
  for (let i = txRows.length - 1; i >= 0; i--) { used += txRows[i].length + 1; if (used > rowLimit) { keepFrom = i + 1; break; } }
  if (keepFrom >= txRows.length && txRows.length) rows.push(`(all ${txRows.length} transactions are left out to fit; the totals above still include them)`);
  else if (keepFrom > 0) rows.push(`(${keepFrom} older transactions before ${tx[keepFrom].d} are left out to fit; the totals above still include them)`);
  rows.push(...txRows.slice(keepFrom));
  return { text: out.join("\n") + "\n" + rows.join("\n"), ids, byId, cats, accts };
}

// The changes block at the end of an answer, checked against the ledger: unknown ids, made-up
// categories, impossible dates and amounts are dropped, so the app only ever shows real proposals.
type Change = { op: "add" | "edit" | "delete"; id?: string; d?: string; t?: "exp" | "inc"; amt?: number; cat?: string; note?: string; acct?: string; why?: string };
function takeChanges(text: string, L: { ids: Set<string>; byId: Map<string, { t: string; cat: string }>; cats: Map<string, string>; accts: Set<string> }) {
  // the block can sit anywhere (models often add a line after it), or be cut off at the end
  const m = text.match(/```changes\s*([\s\S]*?)```/) || text.match(/```changes\s*([\s\S]*)$/);
  if (!m) return { answer: text.trim(), changes: [] as Change[] };
  const answer = (text.slice(0, m.index) + text.slice((m.index || 0) + m[0].length)).trim();
  const none = (why: string) => ({ answer: (answer ? answer + "\n\n" : "") + "*" + why + "*", changes: [] as Change[] });
  let raw: unknown;
  try { raw = JSON.parse(m[1].trim()); } catch { return none("The proposed changes didn't come through in full, so none are shown. Ask again to get them."); }
  // categories as the model writes them often lose or gain the emoji; match on the name
  const catKey = (c: string) => plainCat(c).replace(/️/g, "").trim().toLowerCase();
  const catByKey = new Map<string, string>([...L.cats.keys()].map((n) => [catKey(n), n]));
  const findCat = (c: unknown) => typeof c !== "string" ? undefined : L.cats.has(c) ? c : catByKey.get(catKey(c));
  const okDate = (d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + "T00:00:00Z")) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;
  const okAmt = (a: unknown) => typeof a === "number" && isFinite(a) && a > 0 && a < 1e7;
  const str = (v: unknown, n: number) => String(v).replace(/\s+/g, " ").trim().slice(0, n);
  const changes: Change[] = [];
  for (const c of (Array.isArray(raw) ? raw : []).slice(0, 20) as any[]) {
    if (!c || typeof c !== "object") continue;
    const why = typeof c.why === "string" ? str(c.why, 200) : undefined;
    if (c.op === "delete") { if (L.ids.has(c.id)) changes.push({ op: "delete", id: c.id, why }); continue; }
    if (c.op !== "add" && c.op !== "edit") continue;
    const o: Change = { op: c.op, why };
    if (c.op === "edit") { if (!L.ids.has(c.id)) continue; o.id = c.id; }
    if (c.t === "exp" || c.t === "inc") o.t = c.t;
    if (c.d != null) { if (!okDate(c.d)) continue; o.d = c.d; }
    if (c.amt != null) { if (!okAmt(c.amt)) continue; o.amt = Math.round(c.amt * 100) / 100; }
    if (c.cat != null) { const cat = findCat(c.cat); if (!cat) continue; o.cat = cat; }
    if (typeof c.note === "string") o.note = str(c.note, 120);
    if (typeof c.acct === "string" && L.accts.has(c.acct)) o.acct = c.acct;
    if (o.op === "add") {
      if (!o.amt || !o.cat) continue;
      o.t = o.t || (L.cats.get(o.cat) as "exp" | "inc");
    }
    // a category of the other type would file spending as income or the reverse; for an edit
    // that changes only one of the two, check against what the entry has now
    const cur = o.op === "edit" ? L.byId.get(o.id as string) : undefined;
    const effT = o.t ?? cur?.t, effCat = o.cat ?? cur?.cat;
    if (effCat && effT && L.cats.has(effCat) && L.cats.get(effCat) !== effT) continue;
    if (o.op === "edit" && o.t == null && o.d == null && o.amt == null && o.cat == null && o.note == null && o.acct == null) continue;
    changes.push(o);
  }
  if (!changes.length && Array.isArray(raw) && raw.length) return none("None of the proposed changes matched your ledger, so nothing is shown.");
  return { answer, changes };
}

// Usage caps: the AI spends the owner's API credits and the app is shared. Each call is recorded
// by the ai_take_call() database function, so the caps hold across cold starts and copies of this
// function: CALL_LIMIT per account per hour, and DAILY_LIMIT for all accounts together (the
// AI_DAILY_LIMIT secret overrides it). A monthly spending limit in the Mistral console is the backstop.
const CALL_LIMIT = 120;
const DAILY_LIMIT = Number(Deno.env.get("AI_DAILY_LIMIT")) || 300;
// Fallback cap kept in memory, used only if the database function can't be reached.
const CALLS = new Map<string, { n: number; reset: number }>();
const CALL_WINDOW_MS = 3600000;
// The owner's choice for now (2026-10-21): every signed-in account may use the assistant.
const OPEN_TO_ALL = true;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // only a signed-in user of this project may spend the API key
  const auth = req.headers.get("Authorization") || "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return json({ error: "Sign in first." }, 401);

  // With OPEN_TO_ALL off, only the allowlist may spend the API key: anyone can create an
  // account on the project, so "any signed-in user" is not a gate.
  if (!OPEN_TO_ALL) {
    const allowed = (Deno.env.get("AI_ALLOWED_IDS") || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!allowed.length) return json({ error: "The AI assistant is not enabled. The owner can allow an account by setting the AI_ALLOWED_IDS secret (see the README)." }, 403);
    if (!allowed.includes(user.id)) return json({ error: "The AI assistant is not enabled for this account." }, 403);
  }

  const { data: slot, error: slotErr } = await sb.rpc("ai_take_call", { per_user_hour: CALL_LIMIT, all_users_day: DAILY_LIMIT });
  if (slotErr) {
    console.error("ai_take_call failed, using the in-memory cap:", slotErr.message);
    const now = Date.now();
    const rec = CALLS.get(user.id);
    if (rec && rec.reset > now) { if (rec.n >= CALL_LIMIT) return json({ error: "Too many AI requests. Try again in a little while." }, 429); rec.n++; }
    else CALLS.set(user.id, { n: 1, reset: now + CALL_WINDOW_MS });
    if (CALLS.size > 1000) { for (const [k, v] of CALLS) { if (v.reset <= now) CALLS.delete(k); } }
  } else if (slot === "user") {
    return json({ error: "Too many AI requests from this account. Try again in a little while." }, 429);
  } else if (slot === "all") {
    return json({ error: "The AI assistant has reached today's limit. Try again tomorrow." }, 429);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  try {
    if (body.action === "review") {
      // capped field by field, so a request can't pad the prompt with huge notes
      const items: Item[] = (Array.isArray(body.items) ? body.items : []).slice(0, 200).map((x: any) => ({
        i: Number(x && x.i), d: String((x && x.d) || "").slice(0, 10), t: x && x.t === "inc" ? "inc" : "exp",
        amt: Math.round((Number(x && x.amt) || 0) * 100) / 100, cat: String((x && x.cat) || "").slice(0, 80), note: String((x && x.note) || "").slice(0, 200),
      }));
      // Categories arrive as {name, type} so the model knows which are income and which are
      // spending; plain strings (older app versions) are still accepted.
      const catsRaw = (Array.isArray(body.cats) ? body.cats : []).slice(0, 100).map((c: any) =>
        typeof c === "string" ? { name: c, t: "" } : { name: String((c && c.name) || ""), t: (c && c.t) === "inc" ? "inc" : (c && c.t) === "exp" ? "exp" : "" }
      ).filter((c) => c.name);
      const cats = catsRaw.map((c) => c.name);
      const catTypes = catsRaw.filter((c) => c.t).map((c) => `${c.name} = ${c.t === "inc" ? "income" : "spending"}`).join(", ");
      if (!items.length) return json({ findings: [] });
      // Usual patterns computed on the phone from the owner's older entries: per note the usual type,
      // amount and category, per category the usual type. They tell the model what normal looks like, so a
      // steady subscription or income under an expense-sounding category is not flagged.
      const rawHist: any = (body.history && typeof body.history === "object") ? body.history : {};
      const histNotes = (Array.isArray(rawHist.notes) ? rawHist.notes : []).slice(0, 100).map((h: any) => ({
        note: String((h && h.note) || "").slice(0, 80),
        t: h && h.t === "inc" ? "inc" : "exp",
        amt: Math.round((Number(h && h.amt) || 0) * 100) / 100,
        cat: String((h && h.cat) || "").slice(0, 60),
        n: Math.round(Number(h && h.n) || 0),
      })).filter((h) => h.note && h.amt > 0 && h.n > 0);
      const histCats = (Array.isArray(rawHist.cats) ? rawHist.cats : []).slice(0, 100).map((h: any) => ({
        cat: String((h && h.cat) || "").slice(0, 60),
        t: h && h.t === "inc" ? "inc" : "exp",
        n: Math.round(Number(h && h.n) || 0),
      })).filter((h) => h.cat && h.n > 0);
      const histBlock = (histNotes.length || histCats.length)
        ? "\nThe owner's usual patterns, from their own past entries. Notes (note, usual type, usual amount, usual category, times seen):\n" + histNotes.map((h) => JSON.stringify(h)).join("\n") + (histCats.length ? "\nCategories (category, usual type, times seen):\n" + histCats.map((h) => JSON.stringify(h)).join("\n") : "")
        : "";
      const prompt = `Allowed categories: ${JSON.stringify(cats)}${catTypes ? `\nCategory types (income or spending, as the owner set them): ${catTypes}` : ""}\nEntries:\n${items.map((x) => JSON.stringify(x)).join("\n")}${histBlock}`;
      const out = await complete(REVIEW_SYSTEM, [{ role: "user", content: prompt }], true);
      const parsed = firstJson(out.text);
      // An unreadable or cut-off reply is an error, not "nothing found": the app then keeps these
      // entries for the next review instead of marking them as checked.
      if (out.cut || !parsed || !Array.isArray(parsed.findings)) throw new Error("The review's reply was cut off or couldn't be read, so these entries will be checked next time.");
      const valid = new Set(items.map((x) => x.i)), catSet = new Set(cats);
      const findings = (Array.isArray(parsed?.findings) ? parsed.findings : [])
        .filter((f: { i: unknown; issue: unknown }) => valid.has(Number(f.i)) && typeof f.issue === "string")
        .slice(0, 50)
        .map((f: { i: unknown; issue: string; cat?: unknown; amt?: unknown }) => ({
          i: Number(f.i),
          issue: f.issue.slice(0, 300),
          ...(typeof f.cat === "string" && catSet.has(f.cat) ? { cat: f.cat } : {}),
          ...(typeof f.amt === "number" && f.amt > 0 && f.amt < 1e7 ? { amt: Math.round(f.amt * 100) / 100 } : {}),
        }));
      return json({ findings, provider: provider(), model: out.model });
    }
    if (body.action === "ask") {
      const question = String(body.question || "").slice(0, 1000).trim();
      const context = String(body.context || "").slice(0, 100000);
      const history = (Array.isArray(body.history) ? body.history : []).slice(-10)
        .filter((m: Turn) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map((m: Turn) => ({ role: m.role, content: m.content.slice(0, 2000) }));
      if (!question) return json({ error: "Ask a question." }, 400);
      // rows get whatever is left of the prompt budget after the snapshot and history
      const ledger = await fullLedger(sb, Math.max(20000, PROMPT_BUDGET - context.length - history.reduce((a, m) => a + m.content.length, 0)));
      const messages: Turn[] = [
        { role: "user", content: `My finances. Amounts in SGD.\n\nCURRENT SNAPSHOT (live balances and recent months, from the app):\n${context}\n\nFULL LEDGER:\n${ledger.text}` },
        { role: "assistant", content: "Got it. What would you like to know?" },
        ...history,
        { role: "user", content: question },
      ];
      const out = await complete(ASK_SYSTEM, messages, false);
      const taken = takeChanges(out.text, ledger), changes = taken.changes;
      const answer = out.cut ? taken.answer + "\n\n*The answer hit the length limit and was cut off. Ask for less at once, or ask it to continue.*" : taken.answer;
      return json({ answer, changes, provider: provider(), model: out.model });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
