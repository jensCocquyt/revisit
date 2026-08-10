// WHATWG parsing lowercases scheme/host and strips default ports; we only add
// dropping the fragment. Query strings stay untouched.
export function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  return url.toString();
}
