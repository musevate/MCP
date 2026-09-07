#!/usr/bin/env node
/**
 * The whole flow against the hosted server: price it, generate it, wait for it.
 *
 * Nothing to install. Node 18 or newer, because it uses the built-in fetch.
 *
 *   export MUSEVATE_API_KEY=mv_live_...
 *   node examples/generate.mjs "a slow dolly through a neon-lit street at night"
 *
 * Pass image URLs after the prompt and the mode follows from what you sent:
 *
 *   node examples/generate.mjs "the logo turns to face us" https://example.com/logo.png
 *
 * One image is image-to-video. Two or more are reference-to-video, and the
 * prompt addresses them as @Image1, @Image2 in the order given.
 *
 * Note that tool results here are prose, not JSON — they are written for an
 * assistant to read aloud. A script wanting the id has to pick it out of the
 * sentence, which is what `generationId` below does.
 */

// A refused call is an ordinary outcome here, not a bug in the script, so it
// gets a sentence rather than a stack trace.
process.on("unhandledRejection", (err) => {
  console.error("\n" + (err?.message ?? err));
  process.exit(1);
});

const ENDPOINT = "https://musevate.com/api/mcp";
const KEY = process.env.MUSEVATE_API_KEY;

if (!KEY) {
  console.error("Set MUSEVATE_API_KEY first — Settings, on musevate.com.");
  process.exit(1);
}

const [prompt, ...imageUrls] = process.argv.slice(2);
if (!prompt) {
  console.error('Usage: node examples/generate.mjs "<prompt>" [imageUrl ...]');
  process.exit(1);
}

let nextId = 1;

/**
 * One JSON-RPC call.
 *
 * A JSON-RPC error is not an HTTP error: the request arrived, and the answer is
 * no. Both end up thrown so a caller has one thing to catch.
 */
async function call(method, params) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });

  if (res.status === 401) throw new Error("Not authorised — check MUSEVATE_API_KEY.");

  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

/** A tool's answer, as the text it is. `isError` marks a refusal, not a crash. */
async function tool(name, args = {}) {
  const res = await call("tools/call", { name, arguments: args });
  const said = (res.content ?? []).find((c) => c.type === "text")?.text ?? "";
  return { text: said, isError: Boolean(res.isError) };
}

const generationId = (said) => said.match(/Generation id: ([0-9a-f-]{36})/i)?.[1] ?? null;

const request = { prompt, durationSeconds: 5, resolution: "720p", quality: "quality" };
if (imageUrls.length === 1) request.imageUrl = imageUrls[0];
else if (imageUrls.length > 1) request.referenceImageUrls = imageUrls;

async function main() {
  await call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "musevate-example", version: "1.0.0" },
  });

  console.log((await tool("check_balance")).text);

  // Free, and the only honest way to know the cost before committing to it.
  const quote = await tool("quote_video", request);
  console.log("\n--- quote ---\n" + quote.text);

  console.log("\n--- generating, this spends credits ---");
  const started = await tool("generate_video", request);
  console.log(started.text);

  const id = generationId(started.text);
  if (!id) return started.isError ? 1 : 0; // refused, or said something we cannot poll

  // About a minute is typical, and check_video itself says thirty seconds, so
  // polling faster than that only adds requests.
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((r) => setTimeout(r, 15000));
    const status = await tool("check_video", { id });

    if (status.text.startsWith("Finished")) {
      console.log("\n" + status.text);
      return 0;
    }
    if (status.text.startsWith("Failed")) {
      console.log("\n" + status.text);
      return 1;
    }
    process.stdout.write(`\r${status.text.replace(/\n/g, " ")}   `);
  }

  console.log(`\n\nStill rendering. Collect it later with check_video and this id: ${id}`);
  return 0;
}

// exitCode rather than exit(): the process ends once the socket has closed,
// which on Windows is the difference between a clean exit and a libuv assertion.
main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error("\n" + (err?.message ?? err));
    process.exitCode = 1;
  },
);
