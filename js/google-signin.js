// Sign in with Google: Google's own button (and its one-tap prompt where the browser offers it)
// hands back a signed ID token in a pop-up, so the page never leaves the app. Supabase checks that
// token and starts a normal session, linked to any existing account with the same email.
// The nonce ties the token to this attempt: Google gets its SHA-256, Supabase gets the original.
window.GoogleSignIn = (function () {
  var script = null;
  function load() {
    if (script) return script;
    script = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = resolve;
      s.onerror = function () { script = null; reject(new Error('Could not load Google sign-in.')); };
      document.head.appendChild(s);
    });
    return script;
  }
  function randomNonce() {
    var b = new Uint8Array(32); crypto.getRandomValues(b);
    return btoa(String.fromCharCode.apply(null, b)).replace(/[+/=]/g, '');
  }
  function sha256Hex(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }
  // Render Google's button into `el`. onToken(idToken, rawNonce) runs after the person picks an account.
  function mount(el, clientId, onToken, opts) {
    opts = opts || {};
    var raw = randomNonce();
    return Promise.all([load(), sha256Hex(raw)]).then(function (r) {
      var id = window.google.accounts.id;
      id.initialize({
        client_id: clientId,
        nonce: r[1],
        ux_mode: 'popup',
        auto_select: false,
        cancel_on_tap_outside: true,
        use_fedcm_for_prompt: true,
        callback: function (resp) { if (resp && resp.credential) onToken(resp.credential, raw); }
      });
      id.renderButton(el, {
        type: 'standard', theme: opts.theme || 'outline', size: 'large', text: 'continue_with',
        shape: 'pill', logo_alignment: 'center', width: Math.min(400, Math.max(200, el.clientWidth || 320))
      });
      if (opts.oneTap) id.prompt();
    });
  }
  function cancel() { try { window.google && window.google.accounts.id.cancel(); } catch (e) { } }
  return { mount: mount, cancel: cancel };
})();
