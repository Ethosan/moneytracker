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
    ":where(#fbw-root) *{box-sizing:border-box;margin:0;padding:0}",
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
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  head.appendChild(title);
  head.appendChild(closeBtn);

  var form = document.createElement("form");
  form.className = "fbw-body";
  form.noValidate = true;
  form.innerHTML =
    '<div class="fbw-field"><label class="fbw-label" for="fbw-message">What’s on your mind?</label>' +
    '<textarea class="fbw-textarea" id="fbw-message" maxlength="4000" placeholder="A bug, an idea, anything"></textarea></div>' +
    '<div class="fbw-field"><label class="fbw-label" for="fbw-email">Email <span class="fbw-opt">(optional, if you want a reply)</span></label>' +
    '<input class="fbw-input" id="fbw-email" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com"></div>' +
    '<div class="fbw-actions"><button class="fbw-cancel" type="button">Cancel</button><button class="fbw-submit" type="submit">Send</button></div>' +
    '<p class="fbw-status" role="status" aria-live="polite"></p>';

  modal.appendChild(head);
  modal.appendChild(form);
  modal.inert = true;

  btn.setAttribute("aria-haspopup", "dialog");
  btn.setAttribute("aria-expanded", "false");

  var textarea = form.querySelector("#fbw-message");
  var emailInput = form.querySelector("#fbw-email");
  var cancelBtn = form.querySelector(".fbw-cancel");
  var submitBtn = form.querySelector(".fbw-submit");
  var statusEl = form.querySelector(".fbw-status");
  var sending = false;
  var closeTimer = null;

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "fbw-status" + (kind ? " fbw-" + kind : "");
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    lastFocus = document.activeElement;
    modal.inert = false;
    backdrop.classList.add("fbw-open");
    modal.classList.add("fbw-open");
    btn.setAttribute("aria-expanded", "true");
    setTimeout(function () { textarea.focus(); }, 50);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    clearTimeout(closeTimer);
    modal.inert = true;
    backdrop.classList.remove("fbw-open");
    modal.classList.remove("fbw-open");
    btn.setAttribute("aria-expanded", "false");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function focusables() {
    return Array.prototype.filter.call(
      modal.querySelectorAll("button, textarea, input"),
      function (el) { return !el.disabled; }
    );
  }

  btn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  backdrop.addEventListener("click", close);

  document.addEventListener("keydown", function (e) {
    if (!isOpen) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      var els = focusables();
      var first = els[0];
      var last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (sending) return;

    var message = textarea.value.trim();
    var email = emailInput.value.trim();
    if (!message) {
      setStatus("Write a message first.", "err");
      textarea.focus();
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus("That email doesn’t look right.", "err");
      emailInput.focus();
      return;
    }

    sending = true;
    submitBtn.disabled = true;
    setStatus("Sending…");

    var headers = {
      apikey: cfg.supabaseKey,
      "Content-Type": "application/json",
      // The anon role can insert but not read rows back, so ask for no body.
      Prefer: "return=minimal",
    };
    // Legacy anon keys are JWTs and go in Authorization too; publishable keys must not.
    if (/^eyJ/.test(cfg.supabaseKey)) headers.Authorization = "Bearer " + cfg.supabaseKey;

    fetch(cfg.supabaseUrl + "/rest/v1/feedback", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        project: cfg.project,
        message: message.slice(0, 4000),
        email: email || null,
        // Origin and path only: query strings and hashes can carry sign-in tokens.
        page_url: location.origin + location.pathname,
        user_agent: (navigator.userAgent || "").slice(0, 500),
      }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        textarea.value = "";
        emailInput.value = "";
        setStatus("Thanks, it’s sent.", "ok");
        closeTimer = setTimeout(function () {
          close();
          setStatus("");
        }, 1600);
      })
      .catch(function (err) {
        console.warn("[feedback-widget] Send failed:", err);
        setStatus("Couldn’t send. Check your connection and try again.", "err");
      })
      .then(function () {
        sending = false;
        submitBtn.disabled = false;
      });
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function mount() {
    root.appendChild(backdrop);
    root.appendChild(modal);
    root.appendChild(btn);
    document.body.appendChild(root);
  }

  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
