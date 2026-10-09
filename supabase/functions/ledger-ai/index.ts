// Ledger AI: reviews new entries for likely mistakes and answers questions about your spending.
// The API key lives here as a Supabase secret, never in the app. Only signed-in users can call it.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   MISTRAL_API_KEY     to use Mistral (the default when it is set)
//   ANTHROPIC_API_KEY   to use Claude
//   AI_PROVIDER         optional: "mistral" or "anthropic", to choose when both keys are set
//   MISTRAL_MODEL       optional, default mistral-small-latest
//   ANTHROPIC_MODEL     optional, default claude-opus-5-5
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

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
Flag only entries that are probably wrong: a category that clearly does not fit the note, an amount that looks
like a typo for that kind of purchase, income logged as spending or the reverse, or a note that contradicts the
amount. Unusual but plausible spending is not a mistake. When unsure, leave it out; an empty list is a good answer.
For a category fix, use a name exactly as it appears in the allowed categories. Write each issue as one short,
plain sentence addressed to the owner.
Reply with JSON only: {"findings":[{"i":0,"issue":"...","cat":"optional category","amt":optional number}]}`;

const ASK_SYSTEM = `You answer questions about the owner's personal finances using only the summary provided.
Amounts are Singapore dollars unless marked US$.
This is a conversation: a short follow-up ("break it down", "I mean the prop firms", "and last month?") is about
the topic of the previous messages, so answer it in that context instead of starting over.
When asked for a breakdown, list every item with its own numbers (for prop firms: each firm's fees paid,
payouts received and net result; by month when asked), then a one-line total. Use short lists, bold the key
figure, and add one sentence of interpretation (is it worth it, what stands out).
If the summary does not contain what is needed, say exactly what is missing instead of guessing. You cannot change
any data; if a change would help, say what to change and the owner will do it in the app.`;

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
  return { text: String(data.choices?.[0]?.message?.content ?? ""), model };
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
  return { text, model: response.model };
}

async function complete(system: string, messages: Turn[], asJson: boolean) {
  return provider() === "anthropic" ? await claude(system, messages) : await mistral(system, messages, asJson);
}

function firstJson(text: string) {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // only a signed-in user of this project may spend the API key
  const auth = req.headers.get("Authorization") || "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return json({ error: "Sign in first." }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  try {
    if (body.action === "review") {
      const items = (Array.isArray(body.items) ? body.items : []).slice(0, 200) as Item[];
      const cats = (Array.isArray(body.cats) ? body.cats : []).slice(0, 100).map(String);
      if (!items.length) return json({ findings: [] });
      const prompt = `Allowed categories: ${JSON.stringify(cats)}\nEntries:\n${items.map((x) => JSON.stringify(x)).join("\n")}`;
      const out = await complete(REVIEW_SYSTEM, [{ role: "user", content: prompt }], true);
      const parsed = firstJson(out.text);
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
      const context = String(body.context || "").slice(0, 40000);
      const history = (Array.isArray(body.history) ? body.history : []).slice(-10)
        .filter((m: Turn) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map((m: Turn) => ({ role: m.role, content: m.content.slice(0, 2000) }));
      if (!question) return json({ error: "Ask a question." }, 400);
      const messages: Turn[] = [
        { role: "user", content: `Summary of my finances:\n${context}` },
        { role: "assistant", content: "Got it. What would you like to know?" },
        ...history,
        { role: "user", content: question },
      ];
      const out = await complete(ASK_SYSTEM, messages, false);
      return json({ answer: out.text.trim(), provider: provider(), model: out.model });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
