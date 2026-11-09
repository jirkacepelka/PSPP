# PSPP Studio MCP server

An [MCP](https://modelcontextprotocol.io) server that lets AI agents load data and run PSPP analyses
**on your own computer**. It runs the same PSPP 2.1.3 engine as the web app (compiled to WebAssembly),
but directly in Node.js: no browser, no web app, no internet, and nothing is uploaded anywhere.
The AI client (Claude Desktop, Claude Code, Cursor, …) starts it as a local process and talks to it over stdio.

This is separate from the web app: it does not control an open browser tab and does not see
the documents in your PSPP Studio account.

## Install

Needs Node.js 20 or newer and a clone of this repository.

```bash
cd mcp
npm install
npm run build
npm test        # starts the server and talks to it like an AI client
```

Spreadsheets (`.xlsx`, `.ods`) need the optional `jsdom` package, which `npm install` adds.

## Connect it to a client

Claude Code:

```bash
claude mcp add pspp-studio -- node /absolute/path/to/PSPP/mcp/dist/index.mjs
```

Claude Desktop, Cursor and others take the same thing in their MCP settings file:

```json
{
  "mcpServers": {
    "pspp-studio": {
      "command": "node",
      "args": ["/absolute/path/to/PSPP/mcp/dist/index.mjs"]
    }
  }
}
```

## Tools

| Tool | What it does |
|---|---|
| `pspp_load` | Load a file (`.sav .zsav .por .csv .tsv .txt .xlsx .ods .json`) or inline CSV text as the active dataset. |
| `pspp_describe` | Variables with type, measure, labels, value labels and missing values, plus a preview of the rows. |
| `pspp_run` | Run PSPP syntax on the active dataset. Tables come back as Markdown. `COMPUTE`, `RECODE`, `SELECT IF`… update the dataset. |
| `pspp_save` | Write the active dataset as `sav zsav por csv tsv xlsx ods json`. |
| `pspp_reference` | A cheat sheet of common PSPP commands for the agent. |

A session works like PSPP itself: one active dataset per server process. Each syntax command must
start on its own line and end with a period.

Example prompt: *"Load `/data/survey.sav`, describe it, compare GPA between the groups with a t-test
and tell me what it shows, including what the test cannot tell us."*

## Notes

- The agent can read and write any path your user can, so use the permission prompts of your client.
- Charts are not rendered in the text output; tables, messages and notes are.
- The engine is found at `web/public/engine/pspp.js`; set `PSPP_ENGINE_PATH` to use another build.
- The extra analyses of the web app (GLM with repeated measures, Cox regression, …) are not exposed yet.
