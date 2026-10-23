/*!
 * Feedback Widget — cross-project feedback for Ethan's sites.
 *
 * Usage:
 *   <script src="/feedback-widget.js"
 *     data-project="dispatchsaf"
 *     data-supabase-url="https://wqpjijgqjhzquncruvlc.supabase.co"
 *     data-supabase-key="eyJhbGciOi..."
 *     data-button-label="Send feedback"
 *     data-accent="#6366f1"></script>
 *
 * Self-contained: injects its own CSS, no external dependencies.
 * Submits via Supabase REST API (PostgREST) using fetch().
 */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;

  var cfg = {
    project: script.getAttribute("data-project") || "unknown",
    supabaseUrl: (script.getAttribute("data-supabase-url") || "").replace(/\/$/, ""),
    supabaseKey: script.getAttribute("data-supabase-key") || "",
    buttonLabel: script.getAttribute("data-button-label") || "Feedback",
    accent: script.getAttribute("data-accent") || "#6366f1",
  };

  if (!cfg.supabaseUrl || !cfg.supabaseKey) {
    console.warn("[feedback-widget] Missing data-supabase-url or data-supabase-key");
    return;
  }

  /* ---- injected styles ---- */
  var css = [
    ":root{--fbw-accent:" + cfg.accent + "}",
    ".fbw-reset{all:initial;box-sizing:border-box;font-family:inherit}",
    "#fbw-root{position:fixed;bottom:20px;right:20px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}",
    "#fbw-root *{box-sizing:border-box;margin:0;padding:0}",
    ".fbw-btn{display:flex;align-items:center;justify-content:center;gap:6px;height:48px;min-width:48px;padding:0 14px;border:none;border-radius:24px;background:var(--fbw-accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.22),0 1px 3px rgba(0,0,0,.14);transition:transform .15s ease-out,box-shadow .15s ease-out;user-select:none;-webkit-tap-highlight-color:transparent}",
    ".fbw-btn:hover{box-shadow:0 6px 20px rgba(0,0,0,.28),0 2px 6px rgba(0,0,0,.16)}",
    ".fbw-btn:active{transform:scale(.94)}",
    ".fbw-btn svg{width:20px;height:20px;flex:none}",
    ".fbw-btn span{white-space:nowrap}",
    "@media (max-width:480px){.fbw-btn span{display:none}.fbw-btn{width:48px;padding:0}}",
    ".fbw-backdrop{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.4);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);opacity:0;pointer-events:none;transition:opacity .2s ease-out}",
    ".fbw-backdrop.fbw-open{opacity:1;pointer-events:auto}",
    ".fbw-modal{position:fixed;z-index:2147483647;top:50%;left:50%;width:calc(100% - 32px);max-width:440px;max-height:calc(100% - 48px);overflow-y:auto;background:#fff;color:#1a1a1a;border-radius:16px;box-shadow:0 24px 64px rgba(0,0,0,.3),0 4px 16px rgba(0,0,0,.15);transform:translate(-50%,-50%) scale(.92);opacity:0;pointer-events:none;transition:transform .22s cubic-bezier(.16,1,.3,1),opacity .18s ease-out}",
    ".fbw-modal.fbw-open{transform:translate(-50%,-50%) scale(1);opacity:1;pointer-events:auto}",
    "@media (prefers-color-scheme:dark){.fbw-modal{background:#1c1c1e;color:#f0f0f0}}",
    ".fbw-head{display:flex;align-items:center;justify-content:space-between;padding:18px 20px 0}",
    ".fbw-title{font-size:17px;font-weight:700;letter-spacing:-.01em}",
    ".fbw-close{display:flex;align-items:center;justify-content:center;width:32px;height:32px;border:none;border-radius:16px;background:transparent;color:#888;cursor:pointer;transition:background .12s ease-out,color .12s ease-out;-webkit-tap-highlight-color:transparent}",
    ".fbw-close:hover{background:rgba(0,0,0,.06);color:#333}",
    "@media (prefers-color-scheme:dark){.fbw-close{color:#888}.fbw-close:hover{background:rgba(255,255,255,.08);color:#ddd}}",
    ".fbw-close:active{transform:scale(.92)}",
    ".fbw-close svg{width:18px;height:18px}",
    ".fbw-body{padding:14px 20px 20px}",
    ".fbw-label{display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:#555}",
    "@media (prefers-color-scheme:dark){.fbw-label{color:#aaa}}",
    ".fbw-label .fbw-opt{font-weight:400;color:#999}",
    ".fbw-textarea{width:100%;min-height:110px;resize:vertical;padding:10px 12px;border:1px solid #ddd;border-radius:10px;font-size:14px;font-family:inherit;line-height:1.5;color:inherit;background:#fafafa;transition:border-color .12s ease-out,box-shadow .12s ease-out;-webkit-appearance:none;appearance:none}",
    ".fbw-textarea:focus{outline:none;border-color:var(--fbw-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--fbw-accent) 18%,transparent);background:#fff}",
    "@media (prefers-color-scheme:dark){.fbw-textarea{background:#2a2a2c;border-color:#3a3a3c}.fbw-textarea:focus{background:#2a2a2c}}",
    ".fbw-input{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:10px;font-size:14px;font-family:inherit;color:inherit;background:#fafafa;transition:border-color .12s ease-out,box-shadow .12s ease-out;-webkit-appearance:none;appearance:none}",
    ".fbw-input:focus{outline:none;border-color:var(--fbw-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--fbw-accent) 18%,transparent);background:#fff}",
    "@media (prefers-color-scheme:dark){.fbw-input{background:#2a2a2c;border-color:#3a3a3c}.fbw-input:focus{background:#2a2a2c}}",
    ".fbw-field{margin-bottom:14px}",
    ".fbw-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:4px}",
    ".fbw-cancel{padding:9px 16px;border:1px solid #ddd;border-radius:10px;background:transparent;color:#666;font-size:14px;font-weight:500;cursor:pointer;transition:background .12s ease-out;-webkit-tap-highlight-color:transparent}",
    ".fbw-cancel:hover{background:rgba(0,0,0,.04)}",
    "@media (prefers-color-scheme:dark){.fbw-cancel{border-color:#3a3a3c;color:#aaa}.fbw-cancel:hover{background:rgba(255,255,255,.06)}}",
    ".fbw-cancel:active{transform:scale(.97)}",
    ".fbw-submit{padding:9px 20px;border:none;border-radius:10px;background:var(--fbw-accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer;transition:opacity .12s ease-out,transform .12s ease-out;-webkit-tap-highlight-color:transparent}",
    ".fbw-submit:hover{opacity:.9}",
    ".fbw-submit:active{transform:scale(.97)}",
    ".fbw-submit:disabled{opacity:.55;cursor:default;transform:none}",
    ".fbw-status{font-size:13px;margin-top:10px;min-height:18px;text-align:right}",
    ".fbw-status.fbw-ok{color:#16a34a}",
    ".fbw-status.fbw-err{color:#dc2626}",
    "@media (prefers-reduced-motion:reduce){#fbw-root *,.fbw-backdrop,.fbw-modal{transition:none!important}}",
  ].join("\n");

  var styleEl = document.createElement("style");
  styleEl.id = "fbw-styles";
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ---- DOM ---- */
  var root = document.createElement("div");
  root.id = "fbw-root";

  var backdrop = document.createElement("div");
  backdrop.className = "fbw-backdrop";
  backdrop.setAttribute("aria-hidden", "true");

  var modal = document.createElement("div");
  modal.className = "fbw-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "fbw-title");

  var isOpen = false;
  var lastFocus = null;

  // Chat bubble icon
  var iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  var btn = document.createElement("button");
  btn.className = "fbw-btn";
  btn.type = "button";
  btn.setAttribute("aria-label", cfg.buttonLabel);
  btn.innerHTML = iconSvg + "<span>" + escapeHtml(cfg.buttonLabel) + "</span>";

  var head = document.createElement("div");
  head.className = "fbw-head";

  var title = document.createElement("div");
  title.className = "fbw-title";
  title.id = "fbw-title";
  title.textContent = "Send feedback";

  var closeBtn = document.createElement("button");
  closeBtn.className = "fbw-close";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label",
