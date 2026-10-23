// Panel connection settings for Ello Smart TV.
//
// Fill these in after you register this app in the panel (Apps tab). baseUrl and
// appId aren't secret. appSecret is only a request-signing key — it ships in the
// app and can be extracted, so it is NOT what gates access (the license key +
// the panel's decision are). See src/main/panel/panel-client.ts.
//
// CI can override any of these with env vars (ELLO_PANEL_URL / ELLO_PANEL_APP_ID
// / ELLO_PANEL_APP_SECRET) without editing this file.

export const PANEL_CONFIG = {
  baseUrl: process.env.ELLO_PANEL_URL || 'https://ello-panel.CHANGE-ME.workers.dev',
  appId: process.env.ELLO_PANEL_APP_ID || 'ello-smarttv',
  appSecret: process.env.ELLO_PANEL_APP_SECRET || ''
}

// The gate is active only once it's actually configured. Until then the app
// runs normally (so development isn't blocked). Set baseUrl + appSecret to turn
// it on.
export const PANEL_ENABLED = Boolean(PANEL_CONFIG.appSecret) && !PANEL_CONFIG.baseUrl.includes('CHANGE-ME')

// If the panel can't be reached, block (false) rather than letting users in.
// Flip to true if you'd rather fail open during an outage.
export const PANEL_FAIL_OPEN = false
