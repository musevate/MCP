import { test } from "node:test";
import assert from "node:assert/strict";
import { handleLine, idOf, isNotification } from "../dist/bridge.js";

/** A server that always answers the same thing, and records what it was sent. */
function server(reply) {
  const seen = [];
  const send = async (body) => {
    seen.push(body);
    if (typeof reply === "function") return reply(body);
    return reply;
  };
  return { send, seen };
}

const ok = (body) => ({ status: 200, body });

test("forwards a request and returns the server's answer", async () => {
  const { send, seen } = server(ok('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}'));
  const out = await handleLine('{"jsonrpc":"2.0","id":1,"method":"tools/list"}', send);
  assert.equal(seen.length, 1);
  assert.deepEqual(JSON.parse(out), { jsonrpc: "2.0", id: 1, result: { tools: [] } });
});

test("a notification is forwarded and answered with nothing", async () => {
  const { send, seen } = server({ status: 202, body: "" });
  const out = await handleLine('{"jsonrpc":"2.0","method":"notifications/initialized"}', send);
  assert.equal(out, null, "a notification must not produce a line on stdout");
  assert.equal(seen.length, 1, "but it must still reach the server");
});

test("a notifications/* method carrying an id is still owed silence", async () => {
  const { send } = server({ status: 202, body: "" });
  const out = await handleLine('{"jsonrpc":"2.0","id":7,"method":"notifications/cancelled"}', send);
  assert.equal(out, null);
});

test("a message with no id is a notification", () => {
  assert.equal(isNotification({ jsonrpc: "2.0", method: "ping" }), true);
  assert.equal(isNotification({ jsonrpc: "2.0", id: 1, method: "ping" }), false);
});

test("a line that is not JSON becomes a parse error, not a crash", async () => {
  const { send, seen } = server(ok("{}"));
  const out = await handleLine("this is not json", send);
  assert.equal(seen.length, 0, "nothing malformed is forwarded");
  assert.equal(JSON.parse(out).error.code, -32700);
});

test("a blank line produces nothing", async () => {
  const { send, seen } = server(ok("{}"));
  assert.equal(await handleLine("   ", send), null);
  assert.equal(seen.length, 0);
});

test("an oversize request is refused locally, keeping the id the server would lose", async () => {
  const { send, seen } = server(ok("{}"));
  const huge = JSON.stringify({
    jsonrpc: "2.0",
    id: "abc",
    method: "tools/call",
    params: { prompt: "x".repeat(2000) },
  });
  const out = await handleLine(huge, send, 500);
  assert.equal(seen.length, 0, "the ceiling is applied before the network");
  const answer = JSON.parse(out);
  assert.equal(answer.error.code, -32600);
  assert.equal(answer.id, "abc", "the client must be able to match this to its request");
});

test("an HTML error page never reaches stdout", async () => {
  const { send } = server({ status: 502, body: "<html><body>Bad gateway</body></html>" });
  const out = await handleLine('{"jsonrpc":"2.0","id":1,"method":"tools/list"}', send);
  assert.doesNotThrow(() => JSON.parse(out), "stdout must stay parseable");
  assert.ok(!out.includes("<html>"), "no HTML on the protocol channel");
  assert.equal(JSON.parse(out).error.code, -32603);
  assert.match(JSON.parse(out).error.message, /502/);
});

test("a pretty-printed answer is flattened to a single line", async () => {
  const pretty = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }, null, 2);
  assert.ok(pretty.includes("\n"), "the fixture must actually span lines");
  const { send } = server(ok(pretty));
  const out = await handleLine('{"jsonrpc":"2.0","id":1,"method":"tools/list"}', send);
  assert.ok(!out.includes("\n"), "stdio frames on newlines; one message is one line");
  assert.equal(JSON.parse(out).result.ok, true);
});

test("an empty body for a real request is reported, not written as nothing", async () => {
  const { send } = server({ status: 204, body: "" });
  const out = await handleLine('{"jsonrpc":"2.0","id":1,"method":"tools/list"}', send);
  assert.equal(JSON.parse(out).error.code, -32603);
  assert.equal(JSON.parse(out).id, 1);
});

test("a network failure answers the client instead of throwing", async () => {
  const send = async () => {
    throw new Error("getaddrinfo ENOTFOUND musevate.com");
  };
  const out = await handleLine('{"jsonrpc":"2.0","id":9,"method":"tools/list"}', send);
  const answer = JSON.parse(out);
  assert.equal(answer.id, 9);
  assert.equal(answer.error.code, -32603);
  assert.match(answer.error.message, /ENOTFOUND/);
});

test("a network failure on a notification stays silent", async () => {
  const send = async () => {
    throw new Error("offline");
  };
  assert.equal(await handleLine('{"jsonrpc":"2.0","method":"notifications/x"}', send), null);
});

test("the server's 401 reaches the client with its own wording", async () => {
  const body =
    '{"jsonrpc":"2.0","id":1,"error":{"code":-32001,"message":"Not authorised. Sign in through your assistant\'s connector settings, or send an API key from Settings as: Authorization: Bearer mv_live_…"}}';
  const { send } = server({ status: 401, body });
  const out = await handleLine('{"jsonrpc":"2.0","id":1,"method":"tools/list"}', send);
  assert.match(JSON.parse(out).error.message, /mv_live_/, "the instruction must survive the bridge");
  assert.equal(JSON.parse(out).error.code, -32001);
});

test("an id that is not a string or number is not echoed back as one", () => {
  assert.equal(idOf({ id: { nested: true } }), null);
  assert.equal(idOf({ id: "abc" }), "abc");
  assert.equal(idOf({ id: 0 }), 0);
});

test("every answer is exactly one line", async () => {
  const cases = [
    ["not json", ok("{}")],
    ['{"jsonrpc":"2.0","id":1,"method":"tools/list"}', { status: 502, body: "<html>\n<b>x</b>\n" }],
    ['{"jsonrpc":"2.0","id":1,"method":"tools/list"}', { status: 200, body: "" }],
  ];
  for (const [line, reply] of cases) {
    const { send } = server(reply);
    const out = await handleLine(line, send);
    assert.ok(out !== null && !out.includes("\n"), `left a newline in: ${out}`);
  }
});
