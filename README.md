# Musevate MCP server

Generate video from a prompt, from an image, or from a set of reference images,
through one endpoint that routes across the field of AI video models.

**Endpoint:** `https://musevate.com/api/mcp` (streamable-http)
**Registry:** [`com.musevate/mcp`](https://registry.modelcontextprotocol.io/v0/servers?search=musevate) on the official MCP registry
**Website:** [musevate.com](https://musevate.com)

This repository is documentation and the published manifest. The server itself
is hosted; there is nothing to install and nothing to run.

## Connecting

Add `https://musevate.com/api/mcp` as a custom connector. Every method requires
an account, so the first request is refused with `401` and a `WWW-Authenticate`
header pointing at the OAuth metadata -- your client reads that, registers
itself, and sends you to musevate.com to sign in.

Clients that offer a choice should pick **"always required"**. Clients that
prefer a static credential can send an API key from Settings instead:

    Authorization: Bearer mv_live_...

Both routes reach the same tools. Neither is preferred.

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

## What this repository is, and is not

This is the manifest published to the registry and the documentation for using
the hosted server. The product source is not here.

The MIT licence covers **these files** -- the documentation and the manifest.
It is not a licence to the Musevate service, which is a paid product governed
by its own [terms](https://musevate.com/terms).
