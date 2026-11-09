# PSPP Studio server (optional accounts)

A small Cloudflare Worker that adds optional, invitation-only accounts and cloud projects.
It runs on the Cloudflare **free plan** and needs no payment card:

- **D1** (SQLite): users, invitations, sessions and the project index.
- **Durable Object** (SQLite-backed, one per project): the project document, stored as an opaque blob
  with a revision number, so two devices cannot silently overwrite each other.
- R2 is deliberately not used (Cloudflare asks for a card to enable it).

Data is protected by HTTPS in transit and by Cloudflare encryption at rest. It is **not** end-to-end
encrypted: the operator could read it. Users who need that keep working locally, without an account.

## Deploy (once)

```bash
cd server
npm install
npx wrangler login
npx wrangler d1 create pspp-studio        # already created for the demo deployment; put your own database_id in wrangler.toml
npm run migrate:remote
npx wrangler secret put ADMIN_KEY         # any long random string, used to create invitations
npm run deploy                            # prints https://pspp-studio-api.<you>.workers.dev
```

Add the web app origin to `ALLOWED_ORIGINS` in `wrangler.toml` if it differs.

## Invitations

```bash
curl -X POST https://<worker>/api/admin/invites -H "x-admin-key: $ADMIN_KEY" -d '{"count":5,"days":14}'
```

Each code works once. `MAX_USERS` (default 30) caps the beta, `USER_QUOTA_BYTES` and
`PROJECT_MAX_BYTES` cap storage, which keeps usage inside the free tier.

## Local development

```bash
echo 'ADMIN_KEY=devkey' > .dev.vars
npm run migrate:local
npm run dev            # http://localhost:8787
```

## API

| Method and path | Purpose |
|---|---|
| `POST /api/register` `{email, password, invite}` | create an account (needs an invitation) |
| `POST /api/login` `{email, password}` | returns `{token}`; send it as `Authorization: Bearer` |
| `GET /api/me`, `POST /api/logout` | account info and quota, end the session |
| `GET/POST /api/projects` | list, create |
| `GET/PATCH/DELETE /api/projects/:id` | metadata, rename, delete |
| `GET/PUT /api/projects/:id/doc` | document blob; `PUT` needs `If-Match: <rev>`, 409 on conflict |
