/**
 * Splits credentials out of a camera URL into a Basic auth header.
 *
 * `fetch` ignores `user:pass@host`, and cameras commonly hand you a URL in
 * exactly that form. Kept out of the route handler so it can be tested on its
 * own and so nothing pulls a route into another module.
 */
export function withCredentials(raw: string): { url: string; headers: Record<string, string> } {
  try {
    const u = new URL(raw);
    if (!u.username && !u.password) return { url: raw, headers: {} };
    const token = Buffer.from(
      `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`,
    ).toString("base64");
    u.username = "";
    u.password = "";
    return { url: u.toString(), headers: { authorization: `Basic ${token}` } };
  } catch {
    return { url: raw, headers: {} };
  }
}
