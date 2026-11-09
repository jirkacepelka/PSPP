# PSPP Studio MCP server

An [MCP](https://modelcontextprotocol.io) server that lets AI agents work with **the documents in your
PSPP Studio account**: open a dataset, run PSPP analyses and have the results appear in the web app.
It is a feature for **registered users only**: every tool except the cheat sheet needs a personal
access token from your account.

How it works: the AI client (Claude Desktop, Claude Code, Cursor, …) starts this server as a local
process. The PSPP 2.1.3 engine (WebAssembly) runs inside it, on your computer, in Node.js, without a browser.
The server only uses the internet to read and write your account's documents through the PSPP Studio API.
Results of `pspp_run` are appended to the open document, so you see them in the web app within about 30 seconds.

## Install

Needs Node.js 20 or newer and a clone of this repository.

```bash
cd mcp
npm install
npm run build
npm test        # starts the server and talks to it like an AI client
```

Spreadsheets (`.xlsx`, `.ods`) need the optional `jsdom` package, which `npm install` adds.

## Create an access token

Sign in to PSPP Studio, open **Settings > Profile > AI agents**, name a token and create it. It is shown once.
Each token gives full access to your documents (not to settings or sign-out), expires after 90 days and can be
revoked there at any time.

## Connect it to a client

Claude Code:

```bash
claude mcp add pspp-studio -e PSPP_STUDIO_TOKEN=pat_... -- node /absolute/path/to/PSPP/mcp/dist/index.mjs
```

Claude Desktop, Cursor and others take the same thing in their MCP settings file:

```json
{
  "mcpServers": {
    "pspp-studio": {
      "command": "node",
      "args": ["/absolute/path/to/PSPP/mcp/dist/index.mjs"],
      "env": { "PSPP_STUDIO_TOKEN": "pat_..." }
    }
  }
}
```

## Tools

| Tool | What it does |
|---|---|
| `account_documents` | List the documents in your account. |
| `account_open` | Open one: its dataset becomes the active dataset; later results are saved into it. |
| `account_create` | Save the active dataset as a new document and open it. |
| `pspp_load` | Load a local file (`.sav .zsav .por .csv .tsv .txt .xlsx .ods .json`) or inline CSV as the active dataset. Detaches from any open document. |
| `pspp_describe` | Variables with type, measure, labels, value labels and missing values, plus a preview of the rows. |
| `pspp_run` | Run PSPP syntax. Tables come back as Markdown. `COMPUTE`, `RECODE`, `SELECT IF`… update the dataset. With a document open, the result is saved into it. |
| `pspp_save` | Write the active dataset to a local file as `sav zsav por csv tsv xlsx ods json`. |
| `pspp_reference` | A cheat sheet of common PSPP commands for the agent. |

If the document was changed in the web app while the agent worked, the result is not saved and the agent is told to
open it again, so nothing is overwritten.

A session works like PSPP itself: one active dataset per server process. Each syntax command must
start on its own line and end with a period.

Example prompt: *"Load `/data/survey.sav`, describe it, compare GPA between the groups with a t-test
and tell me what it shows, including what the test cannot tell us."*

## Notes

- Environment variables: `PSPP_STUDIO_TOKEN` (required), `PSPP_STUDIO_API` (API address, defaults to the public server).
- The agent can read and write any path your user can, so use the permission prompts of your client.
- Charts are not rendered in the text output; tables, messages and notes are.
- The engine is found at `web/public/engine/pspp.js`; set `PSPP_ENGINE_PATH` to use another build.
- The extra analyses of the web app (GLM with repeated measures, Cox regression, …) are not exposed yet.
