/**
 * The translation between a client that speaks stdio and a server that speaks
 * HTTP.
 *
 * Everything with a decision in it lives here, as one function over strings,
 * so that the cases which are awkward to reach through a real pipe -- a server
 * that answers HTML, a body over the ceiling, a notification that must produce
 * no reply -- are reachable from a test.
 *
 * `src/index.ts` holds the parts that cannot be tested without a process: the
 * pipe, the environment, the exit.
 */

/** What the server said, reduced to what the bridge reasons about. */
export interface Reply {
  status: number;
  body: string;
}

/** Sends one JSON-RPC message to the server and returns its answer. */
export type Send = (body: string) => Promise<Reply>;

/**
 * The server refuses a body over this before parsing it, answering with an id
 * of `null` because it never got far enough to read one. A client matching
 * answers to questions would wait for that one forever, so the bridge applies
 * the same ceiling first and answers with the id it can still see.
 */
export const MAX_BODY_BYTES = 256 * 1024;

interface Message {
  id?: unknown;
  method?: unknown;
}

/** JSON-RPC error as a single line, ready for stdout. */
function errorLine(id: string | number | null, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

/**
 * An id the client can match, or null.
 *
 * A JSON-RPC id is a string or a number. Anything else -- an object, a
 * boolean, a value the client should not have sent -- is not echoed back as
 * itself, because an id that is not an id cannot be matched against anything.
 */
export function idOf(message: unknown): string | number | null {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const id = (message as Message).id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

/**
 * Whether this message must produce no answer.
 *
 * Two things make a notification, and either one is enough. A message without
 * an id is one by definition. A `notifications/*` method is one by name, and
 * the server answers those with `202` and an empty body whatever else is in
 * them -- so a client that puts an id on one is still owed silence.
 *
 * Answering a notification is not a harmless extra: it hands the client a
 * response to a request it never made, and a client that matches the two will
 * either discard it or break on it. The server had this exact fault and fixed
 * it; the bridge is the second place it can happen.
 */
export function isNotification(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  if (Array.isArray(message)) return message.length > 0 && message.every(isNotification);
  const { id, method } = message as Message;
  if (typeof method === "string" && method.startsWith("notifications/")) return true;
  return id === undefined;
}

/**
 * One line in, at most one line out.
 *
 * Returns the text to write to stdout, or `null` when the client is owed
 * nothing. It never throws and never returns anything but a single line of
 * JSON: stdout is the protocol, and one stray byte on it desynchronises every
 * message that follows.
 */
export async function handleLine(
  line: string,
  send: Send,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<string | null> {
  const text = line.trim();
  if (!text) return null;

  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return errorLine(null, -32700, "Parse error: the line sent was not JSON");
  }

  const id = idOf(message);
  const silent = isNotification(message);

  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    return silent
      ? null
      : errorLine(id, -32600, `Request too large: the limit is ${maxBytes} bytes`);
  }

  let reply: Reply;
  try {
    reply = await send(text);
  } catch (cause) {
    if (silent) return null;
    const why = cause instanceof Error ? cause.message : String(cause);
    return errorLine(id, -32603, `Could not reach the Musevate server: ${why}`);
  }

  if (silent) return null;

  if (!reply.body.trim()) {
    return errorLine(id, -32603, `The Musevate server answered ${reply.status} with an empty body`);
  }

  /**
   * Re-serialised rather than forwarded as it arrived.
   *
   * stdio frames messages by newline, so a response that is pretty-printed --
   * or an error page that is not JSON at all -- would be read as several
   * messages, all of them malformed. Parsing it here is what guarantees the
   * one thing this function promises: one line.
   */
  try {
    return JSON.stringify(JSON.parse(reply.body));
  } catch {
    return errorLine(
      id,
      -32603,
      `The Musevate server answered ${reply.status} with something that is not JSON`,
    );
  }
}
