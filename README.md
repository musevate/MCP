# Musevate MCP server

Generate video from a prompt, from an image, or from a set of reference images,
through one endpoint that routes across the field of AI video models.

**Endpoint:** `https://musevate.com/api/mcp` (streamable-http)
**Bridge:** `musevate-mcp` in this repository — a local stdio server, for clients that cannot speak streamable HTTP
**Registry:** [`com.musevate/mcp`](https://registry.modelcontextprotocol.io/v0/servers?search=musevate) on the official MCP registry
**Website:** [musevate.com](https://musevate.com)

The server is hosted. There are two ways to reach it, and the first is better
whenever your client supports it.

## Connecting directly

Add `https://musevate.com/api/mcp` as a custom connector. Every method requires
an account, so the first request is refused with `401` and a `WWW-Authenticate`
header pointing at the OAuth metadata -- your client reads that, registers
itself, and sends you to musevate.com to sign in.

Clients that offer a choice should pick **"always required"**. Clients that
prefer a static credential can send an API key from Settings instead:

    Authorization: Bearer mv_live_...

Both routes reach the same tools. Neither is preferred.

### By client

**Claude** (web, desktop or mobile) — Settings, Connectors, Add custom
connector, and paste the endpoint. The sign-in happens in the browser.

**Claude Code**

    claude mcp add --transport http musevate https://musevate.com/api/mcp

**ChatGPT** — Settings, Connectors, add a custom connector with the same URL.

**Anything else that speaks streamable HTTP** — point it at the endpoint. If
the client has no OAuth support, give it the header instead:

```json
{
  "mcpServers": {
    "musevate": {
      "type": "http",
      "url": "https://musevate.com/api/mcp",
      "headers": { "Authorization": "Bearer mv_live_..." }
    }
  }
}
```

## Connecting through the local bridge

Some clients only know how to launch a command and talk to it over a pipe. For
those, `musevate-mcp` is a stdio server that forwards to the same endpoint:

```json
{
  "mcpServers": {
    "musevate": {
      "command": "npx",
      "args": ["-y", "github:musevate/MCP"],
      "env": { "MUSEVATE_API_KEY": "mv_live_..." }
    }
  }
}
```

It installs and builds itself from this repository. An npm release under the
name `musevate-mcp` is coming; until it lands, the line above is the one that
works, and it will keep working afterwards.

Create the key at [musevate.com/settings](https://musevate.com/settings). The
bridge cannot run the OAuth flow -- that needs a browser, which a pipe does not
have -- so it takes a key and nothing else.

It holds no logic of its own: no pricing, no retry rules, no opinion about what
the tools do. Adding any would create a second place where "what does this
cost" is decided, and two such places drift apart. It moves bytes and gets the
framing right, which is most of what a bridge gets wrong:

- A notification is answered with silence, never with a response to a request
  the client never made.
- Every answer is re-serialised to exactly one line, so a pretty-printed body
  is not read as several malformed messages.
- A gateway error page, an empty body or a dead network becomes a JSON-RPC
  error carrying the id the client is waiting on -- never raw HTML on the
  protocol channel, and never a hang.

Environment:

| Variable | Default | |
|---|---|---|
| `MUSEVATE_API_KEY` | — | required; `--api-key` also works |
| `MUSEVATE_MCP_URL` | `https://musevate.com/api/mcp` | for testing against another deployment |
| `MUSEVATE_TIMEOUT_MS` | `180000` | above the server's own 120s ceiling |

### Checking it by hand

The transport is plain JSON-RPC over `POST`; there is no session to establish
and no stream to hold open.

```bash
curl -s https://musevate.com/api/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H "authorization: Bearer $MUSEVATE_API_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Without the header that returns `401` and the `WWW-Authenticate` pointing at
`/.well-known/oauth-protected-resource`, which is exactly what a connector
follows to start the sign-in.

[`examples/generate.mjs`](examples/generate.mjs) runs the whole flow — balance,
quote, generate, poll — in about a hundred lines and no dependencies:

```bash
export MUSEVATE_API_KEY=mv_live_...
node examples/generate.mjs "a slow dolly through a neon-lit street at night"
node examples/generate.mjs "the logo turns to face us" https://example.com/logo.png
```

## Tools

| Tool | Cost | What it does |
|---|---|---|
| `list_models` | free | Every model available, with maximum length, the sizes it offers, whether it can generate sound, and what it costs in credits |
| `quote_video` | free | Prices a generation without running it, and names the model that would serve it |
| `generate_video` | **spends credits** | Returns immediately with an id; rendering takes about a minute |
| `check_video` | free | Status, and once finished a link valid for one hour |
| `check_balance` | free | Credits remaining |

### Images

`generate_video` and `quote_video` take images as https URLs, because a tool
call is a JSON object and cannot carry bytes:

- `imageUrl` -- the picture to animate. Supplying one makes the request
  image-to-video: the image is the first frame and the prompt describes what
  happens to it.
- `endImageUrl` -- the frame to finish on. Needs `imageUrl`. Only some models
  publish a field for one.
- `referenceImageUrls` -- up to thirty, in the order the prompt addresses them
  as `@Image1`, `@Image2`. This is reference-to-video and is not combined with
  `imageUrl`.

The mode is derived from what you send rather than set separately, so it cannot
disagree with the images.

**Prefer an image over describing one.** A model asked to draw a specific logo
draws something close to it and no closer; given the logo, it carries it.

### Cost, and not spending it twice

`quote_video` is free and is the right way to answer "what would this cost".
`generate_video` is the one that charges, and says so in its own description so
that an assistant reads it before calling.

An identical call repeated within two minutes returns the generation the first
one started rather than starting a second. To make a deliberate second take,
change the request or pass a new `requestId`.

## Pricing

Credits, prepaid. No subscription required. Every generation is priced before
it runs and refunded automatically if it fails for a technical reason.

Details at [musevate.com/pricing](https://musevate.com/pricing).

## Building the bridge

```bash
npm install
npm test      # builds, then runs the suite
```

`src/bridge.ts` is the whole translation, as one function over strings, so the
cases that are awkward to reach through a real pipe are reachable from a test.
`src/index.ts` holds only what needs a process: the pipe, the environment, the
exit.

## What this repository is, and is not

This is the local bridge, the manifest published to the registry, and the
documentation for using the hosted server.

The product source is not here, and the bridge is not a reimplementation of it:
routing, pricing, the margin floor and the refund rules all live in the service.

The MIT licence covers **these files** -- the bridge, the documentation and the
manifest. It is not a licence to the Musevate service, which is a paid product
governed by its own [terms](https://musevate.com/terms).
