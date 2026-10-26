/**
 * Reads a web page for an agent: only public http(s) addresses (no localhost,
 * private networks or cloud metadata), redirects re-checked at every hop, a
 * size cap, and HTML turned into plain text so the model reads words, not markup.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = Number(process.env.WEB_FETCH_TIMEOUT_MS ?? 20_000);

export class FetchPageError extends Error {}

export type Page = { url: string; status: number; title: string; contentType: string; text: string; truncated: boolean; links: { text: string; url: string }[] };

/** True for addresses an agent must never reach from the server: loopback, private, link-local, metadata. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6);
}

/** Throws unless the URL is http(s) and every address its host resolves to is public. */
export async function checkPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchPageError(`Not a valid address: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchPageError("Only http and https addresses can be read");
  if (url.username || url.password) throw new FetchPageError("Addresses with a user name or password can't be read");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) throw new FetchPageError("That address is on a private network");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addresses.length) throw new FetchPageError(`Couldn't find ${host}`);
  if (addresses.some(isPrivateAddress)) throw new FetchPageError("That address is on a private network");
  return url;
}

export async function fetchPage(raw: string, opts: { maxChars?: number } = {}): Promise<Page> {
  const maxChars = Math.min(opts.maxChars ?? 20_000, 60_000);
  let url = await checkPublicUrl(raw);
  let res: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "AgentsHUB/1.0 (+https://github.com/yahavlapidot-oss/agentshub)", accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" },
    }).catch((e) => {
      throw new FetchPageError(`Couldn't load ${url.href}: ${(e as Error).message}`);
    });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!next) break;
    url = await checkPublicUrl(new URL(next, url).href);
    if (hop === MAX_REDIRECTS) throw new FetchPageError("Too many redirects");
  }
  if (!res) throw new FetchPageError("No response");
  const contentType = res.headers.get("content-type") ?? "";
  if (!/text|json|xml|javascript/.test(contentType) && contentType) {
    return { url: url.href, status: res.status, title: "", contentType, text: `(${contentType}: not a text page, nothing to read)`, truncated: false, links: [] };
  }
  const body = await readCapped(res);
  const html = /html/.test(contentType) || /^\s*</.test(body);
  const text = html ? htmlToText(body) : body;
  return {
    url: url.href,
    status: res.status,
    title: html ? decodeEntities(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim() : "",
    contentType,
    text: text.slice(0, maxChars),
    truncated: text.length > maxChars,
    links: html ? extractLinks(body, url).slice(0, 40) : [],
  };
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    chunks.push(value);
    if (size >= MAX_BYTES) {
      await reader.cancel();
      break;
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Plain text from HTML: drops scripts, styles and tags, keeps line breaks between blocks. */
export function htmlToText(html: string): string {
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  return decodeEntities(
    body
      .replace(/<(script|style|noscript|svg|template|iframe|head)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|hr)\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|header|footer|li|tr|h[1-6]|blockquote|pre|table|ul|ol)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractLinks(html: string, base: URL): { text: string; url: string }[] {
  const out: { text: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\s[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const href = new URL(decodeEntities(m[1]), base).href;
      const text = htmlToText(m[2]).slice(0, 120);
      if (!/^https?:/.test(href) || seen.has(href) || !text) continue;
      seen.add(href);
      out.push({ text, url: href });
    } catch {
      // Not a usable link.
    }
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code < 0x110000 ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}
