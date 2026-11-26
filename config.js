// Paste your Supabase project URL and anon (public) key here.
// Supabase dashboard → Project Settings → API.
// The anon key is safe to publish: row level security means each account only sees its own rows.
window.LEDGER_CONFIG = {
  supabaseUrl: 'https://wqpjijgqjhzquncruvlc.supabase.co',
  // Sign in with Google: the OAuth web client ID from Google Cloud (not a secret). Leave empty to hide the button.
  googleClientId: '1014449170509-0pt7ar3hpm2n3nsddi2d449bbn9pcpvf.apps.googleusercontent.com',
  // Bot check on the sign-in email (Cloudflare Turnstile site key, not a secret). Leave empty until Supabase Auth
  // has CAPTCHA switched on with the matching secret key, or sign-in will be refused.
  turnstileSiteKey: '',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxcGppamdxamh6cXVuY3J1dmxjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwNzU4NDIsImV4cCI6MjEwNTY1MTg0Mn0.kln0fgvgF1lPgsARxxJny3KcigjMuayJIy21GrW3yC8'
};
