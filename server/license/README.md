# ello Premium licence server

A Cloudflare Worker with a D1 database. It stores the licence keys you sell,
activates them on devices (2 per key by default) and gives the app a signed
token. The app works offline for up to 30 days and renews the token every few
days, so a key you switch off stops working within a few days.

## Set up (once)

1. Install Node.js, then in this folder: `npm install`
2. Sign in to Cloudflare: `npx wrangler login`
3. Make the database: `npx wrangler d1 create ello-license`
   Copy the `database_id` it prints into `wrangler.toml`.
4. Make the tables: `npm run db:init`
5. Add the two secrets:
   - `npx wrangler secret put LICENSE_PRIVATE_KEY`: paste the private signing
     key (the one that matches `PUBLIC_KEY` in `src/main/license.ts`). If you
     ever make a new pair with `npm run keypair`, put the new public key in the
     app too.
   - `npx wrangler secret put ADMIN_TOKEN`: a long random password, for the
     admin page.
6. Publish: `npm run deploy`. It prints the address, e.g.
   `https://ello-license.<you>.workers.dev`. Put it in `LICENSE_SERVER` in
   `src/main/license.ts` and build the app.

## Selling keys

Open `https://<your worker>/admin`, sign in with the admin token, type the
buyer's name or email and click **Make key**. Send them the key
(`ELLO-XXXX-XXXX-XXXX-XXXX`). In ello: Settings → ello Premium → Enter key.

On the admin page you can also see which devices use a key, **Switch off** a
key (refund, sharing) and **Free devices** (someone got a new PC).

## API

| Call | Body | Answer |
|---|---|---|
| `POST /v1/activate` | `{ key, device, deviceName?, platform? }` | `{ token, name }`, or `{ error, message }` with 403/404 |
| `POST /v1/refresh` | same as activate | same |
| `POST /v1/deactivate` | `{ key, device }` | `{ ok }` |
| `GET /v1/admin/keys` | admin | keys and activations |
| `POST /v1/admin/keys` | admin, `{ name, maxDevices?, note? }` | `{ key }` |
| `POST /v1/admin/revoke` | admin, `{ key, revoked? }` | `{ ok }` |
| `POST /v1/admin/reset` | admin, `{ key }` | `{ ok }` |

Admin calls need `Authorization: Bearer <ADMIN_TOKEN>`.

## Local test

Put `LICENSE_PRIVATE_KEY=...` and `ADMIN_TOKEN=...` in `.dev.vars` (not
committed), run `npm run db:init:local` and `npm run dev`, then set
`licenseServer` to `http://127.0.0.1:8787` in ello's settings file.
