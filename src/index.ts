#!/usr/bin/env node
/**
 * musevate-mcp -- a local stdio server that forwards to the hosted Musevate
 * MCP endpoint.
 *
 * The server itself is hosted, and a client that speaks streamable HTTP should
 * point straight at `https://musevate.com/api/mcp` and skip this entirely.
 * This exists for the clients that only launch a command and talk to it over a
 * pipe, which is still most of them.
 *
 * It holds no logic of its own: no pricing, no credentials beyond the one it
 * is handed, no idea what the tools do. Adding any would create a second place
 * where the answer to "what does this cost" is decided, and the two would
 * drift. It moves bytes and gets the framing right.
 */

import { createInterface } from "node:readline";
import { handleLine, type Reply, type Send } from "./bridge.js";

const ENDPOINT = process.env.MUSEVATE_MCP_URL ?? "https://musevate.com/api/mcp";

/** Above the server's own 120s ceiling, so its answer arrives before we give up. */
const TIMEOUT_MS = Number(process.env.MUSEVATE_TIMEOUT_MS ?? 180_000);

const HELP = `musevate-mcp -- stdio bridge to the hosted Musevate MCP server

  MUSEVATE_API_KEY=mv_live_... npx musevate-mcp

Options
  --api-key <key>   the key, if you would rather not use the environment
  --help            this
  --version         the version of this bridge

A key is created at https://musevate.com/settings. Clients that speak
streamable HTTP do not need this bridge: point them at ${ENDPOINT}.
`;

/** The key, from the flag or the environment. Never echoed anywhere. */
function apiKey(argv: string[]): string | null {
  const flag = argv.indexOf("--api-key");
  if (flag !== -1) {
    const value = argv[flag + 1];
    if (value && !value.startsWith("--")) return value.trim();
  }
  return process.env.MUSEVATE_API_KEY?.trim() || null;
}

function sendVia(key: string): Send {
  return async (body: string): Promise<Reply> => {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${key}`,
        "user-agent": "musevate-mcp-bridge",
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: response.status, body: await response.text() };
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return;
  }
  if (argv.includes("--version")) {
    process.stdout.write("1.0.0\n");
    return;
  }

  const key = apiKey(argv);
  if (!key) {
    /**
     * Refused here rather than on the first call.
     *
     * Without a key every tool would fail with the server's 401, which a
     * client reports as "the tools are not working" -- true, and no help at
     * all in finding the setting that is missing.
     */
    process.stderr.write(
      "musevate-mcp: no API key.\n" +
        "  Set MUSEVATE_API_KEY, or pass --api-key.\n" +
        "  Create one at https://musevate.com/settings\n",
    );
    process.exitCode = 78; /* EX_CONFIG */
    return;
  }

  const send = sendVia(key);
  const inFlight = new Set<Promise<void>>();

  /**
   * Lines are answered as they finish, not in the order they arrived.
   *
   * A client is free to send a second request before the first comes back, and
   * generating a video takes about a minute. Handling these one at a time
   * would make every other call wait behind it, so each is tracked and the
   * process stays alive until all of them are done.
   */
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

  lines.on("line", (line) => {
    const work = handleLine(line, send)
      .then((answer) => {
        if (answer !== null) process.stdout.write(answer + "\n");
      })
      .catch((cause) => {
        /* handleLine does not throw; if it ever does, say so and keep serving. */
        process.stderr.write(`musevate-mcp: ${String(cause)}\n`);
      });
    inFlight.add(work);
    void work.finally(() => inFlight.delete(work));
  });

  await new Promise<void>((done) => lines.once("close", () => done()));
  await Promise.allSettled([...inFlight]);
}

main().catch((cause) => {
  process.stderr.write(`musevate-mcp: ${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exitCode = 1;
});
