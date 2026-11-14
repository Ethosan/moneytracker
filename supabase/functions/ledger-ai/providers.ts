// Which AI answers, with which model, and who steps in when it fails. Plain functions of the
// function's secrets (passed in as `env`), so the choice is tested without Deno
// (tests/ledger-ai-deepseek.test.mjs).
//
// DeepSeek is the default whenever LLM_API_KEY is set (Ethan, 14 Nov 2026, replacing Mistral):
//   ask     deepseek-v4-pro   the job where every sum must be right; Pro replaces Mistral Large
//                             ($1.32/M in, $3.96/M out at peak, half that off-peak)
//   review  deepseek-flash    the weekly mistake check, one JSON reply ($0.30/M in, $1.20/M out)
// LLM_MODEL_ASK / LLM_MODEL_REVIEW set one job's model, LLM_MODEL both. A Mistral or Claude model
// name left in one of those is never sent to DeepSeek: the job's default is used instead.
// Thinking is off (thinking: {type: "disabled"}): with it on, DeepSeek wants each round's
// reasoning_content sent back between tool calls, and the thinking eats max_tokens.

export type Env = (name: string) => string | undefined;
export type Provider = "deepseek" | "mistral" | "anthropic";
export type Job = "ask" | "review";

export const KEY_OF: Record<Provider, string> = { deepseek: "LLM_API_KEY", mistral: "MISTRAL_API_KEY", anthropic: "ANTHROPIC_API_KEY" };
export const NAME_OF: Record<Provider, string> = { deepseek: "DeepSeek", mistral: "Mistral", anthropic: "Claude" };

const get = (env: Env, k: string) => (env(k) || "").trim();
const has = (env: Env, p: Provider) => !!get(env, KEY_OF[p]);

// AI_PROVIDER picks when it names one of the three; otherwise DeepSeek when its key is set, then
// Mistral, then Claude when its key is the only one (as before DeepSeek came in).
export function provider(env: Env): Provider {
  const want = get(env, "AI_PROVIDER").toLowerCase();
  if (want === "deepseek" || want === "mistral" || want === "anthropic") return want;
  if (has(env, "deepseek")) return "deepseek";
  if (!has(env, "mistral") && has(env, "anthropic")) return "anthropic";
  return "mistral";
}

// Who answers when the chosen provider fails (down, out of credit, a bad key): the others with a
// key, DeepSeek before Mistral. Claude is never a fallback, as before (its stored key is invalid).
export function fallbacks(env: Env, first: Provider): Provider[] {
  return (["deepseek", "mistral"] as Provider[]).filter((p) => p !== first && has(env, p));
}

// The chosen provider, then each fallback with a key, until one answers; the last failure is
// thrown. `skipped` says who failed and why, for the steps the owner sees under the answer.
export async function firstThatAnswers<T>(env: Env, job: string, attempt: (p: Provider) => Promise<T>, log: (...a: unknown[]) => void = console.error) {
  const first = provider(env), order = [first, ...fallbacks(env, first)];
  const skipped: string[] = [];
  for (let i = 0; ; i++) {
    try { return { out: await attempt(order[i]), used: order[i], skipped }; }
    catch (e) {
      if (i === order.length - 1) throw e;
      const why = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 90);
      log(`${job}: ${NAME_OF[order[i]]} failed, trying ${NAME_OF[order[i + 1]]}:`, why);
      skipped.push(`${NAME_OF[order[i]]} was unavailable (${why}); answered with ${NAME_OF[order[i + 1]]}`);
    }
  }
}

export const DEEPSEEK_BASE ="https://api.deepseek.com";
export const DEEPSEEK_DEFAULT: Record<Job, string> = { ask: "deepseek-v4-pro", review: "deepseek-flash" };
export const DEEPSEEK_FALLBACK = "deepseek-flash";
const NOT_DEEPSEEK = /^(mistral|magistral|ministral|codestral|devstral|pixtral|open-mi|claude)/i;

export function deepseekModel(env: Env, job: Job): string {
  for (const k of [`LLM_MODEL_${job.toUpperCase()}`, "LLM_MODEL"]) {
    const v = get(env, k);
    if (v && !NOT_DEEPSEEK.test(v)) return v;
  }
  return DEEPSEEK_DEFAULT[job];
}
export const deepseekBase = (env: Env) => (get(env, "LLM_BASE_URL") || DEEPSEEK_BASE).replace(/\/+$/, "");
// The thinking switch goes only to DeepSeek's own API: another OpenAI-style server behind
// LLM_BASE_URL may refuse a field it does not know.
export function deepseekExtra(base: string): Record<string, unknown> {
  let host = "";
  try { host = new URL(base).host; } catch { /* not a URL: no extra field */ }
  return /(^|\.)deepseek\.com$/.test(host) ? { thinking: { type: "disabled" } } : {};
}
// The Ask model refused (a retired or mistyped name, a model not on the account): try Flash.
// A bad key (401), no balance (402) or a rate limit (429) would fail on Flash too.
export const modelRefused = (e: unknown) => /^DeepSeek (400|404|422)\b/.test(e instanceof Error ? e.message : String(e));

export const MISTRAL_FALLBACK = "mistral-small-latest";
export const mistralModel = (env: Env) => get(env, "MISTRAL_MODEL") || "mistral-large-latest";
export const claudeModel = (env: Env) => get(env, "ANTHROPIC_MODEL") || "claude-sonnet-5-5";
