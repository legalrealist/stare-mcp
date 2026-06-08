import { createHash } from "node:crypto";

// Cursor binding: wrap CL's opaque cursor token with a hash of {query, circuit}
// so that a cursor from query A cannot be reused with query B.
// Format: "qh:{hash}:{cl_cursor}"

export function queryHash(query, circuit) {
  return createHash("sha256")
    .update(`${query || ""}|${circuit || ""}`)
    .digest("hex")
    .slice(0, 8);
}

export function wrapCursor(clCursor, query, circuit) {
  if (!clCursor) return null;
  return `qh:${queryHash(query, circuit)}:${clCursor}`;
}

export function unwrapCursor(cursor, query, circuit) {
  if (!cursor) return { clCursor: null };
  const match = cursor.match(/^qh:([a-f0-9]{8}):(.+)$/);
  if (!match) return { error: "invalid_cursor", message: "Invalid cursor format. Use the cursor value from a previous search_cases response." };
  const [, hash, clCursor] = match;
  if (hash !== queryHash(query, circuit)) {
    return { error: "invalid_cursor", message: "Cursor was issued for a different query/circuit. Start a new search instead." };
  }
  return { clCursor };
}
