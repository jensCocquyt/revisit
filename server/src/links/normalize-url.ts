// Same page, same item: drops the fragment and campaign tracking parameters.
export function normalizeLinkUrl(input: string): string | undefined {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  url.hash = "";
  for (const name of [...url.searchParams.keys()]) {
    if (name.toLowerCase().startsWith("utm_")) url.searchParams.delete(name);
  }
  return url.toString();
}
