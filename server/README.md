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

## MCP connector for AI assistants

`/mcp` is a remote MCP server (Streamable HTTP) with OAuth 2.1 (dynamic client registration, PKCE, a sign-in
and consent page on the Worker itself). Users add it to Claude Desktop or claude.ai with **Settings, Connectors,
Add custom connector** and the address `https://<worker>/mcp`; they sign in with their PSPP Studio account in
the browser. Other MCP clients that support remote OAuth servers work the same way.

| Tool | What it does |
|---|---|
| `list_documents`, `describe_document`, `get_output` | See the account's documents, their variables and stored output. |
| `run_syntax` | Run PSPP syntax on a document; the result is saved into the document and shows up in the web app. |
| `create_document` | Create a document from CSV text. |
| `reference` | PSPP syntax cheat sheet. |

The PSPP engine (WebAssembly, 2.4 MB) runs in a Durable Object (`EngineDO`): a plain Worker request on the free
plan has a 10 ms CPU limit, too little to start the engine. Connector access tokens (`pat_…`, 7 days, refreshed by
the client) reach only the documents and can be disconnected in Settings, Profile. `test/mcp.mjs` runs the whole
flow against `npm run dev`.

Storage note: documents live in Durable Objects, fine for a small free quota. Large quotas (tens of GB per user)
belong in R2, which costs far less per GB; all MCP document access goes through `src/mcp/docs.ts`.

## API

| Method and path | Purpose |
|---|---|
| `POST /api/register` `{email, password, invite}` | create an account (needs an invitation) |
| `POST /api/login` `{email, password}` | returns `{token}`; send it as `Authorization: Bearer` |
| `GET /api/me`, `POST /api/logout` | account info and quota, end the session |
| `GET/POST /api/projects` | list, create |
| `GET/PATCH/DELETE /api/projects/:id` | metadata, rename, delete |
| `GET /api/tokens`, `DELETE /api/tokens/:id` | connected apps (connector tokens) of the account, revocable |
| `GET/PUT /api/projects/:id/doc` | document blob; `PUT` needs `If-Match: <rev>`, 409 on conflict |
