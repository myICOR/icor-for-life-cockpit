// frontmatter.js - split a markdown file into frontmatter and body, and find
// its wikilinks. YAML is parsed with the `core` schema only (no custom tags, no
// timestamps turned into Date objects), frontmatter over 256 KB is refused, and
// a parse error marks the note `unparsed` but keeps it listed (D2 section 8).
import { parse as parseYaml } from 'yaml';

export const FRONTMATTER_CAP = 256 * 1024;

/**
 * @returns {{ fm: Record<string, unknown>, body: string, unparsed: boolean }}
 */
export function splitFrontmatter(text) {
  if (typeof text !== 'string') return { fm: {}, body: '', unparsed: false };
  const src = text.startsWith('\uFEFF') ? text.slice(1) : text;
  if (!src.startsWith('---')) return { fm: {}, body: src, unparsed: false };
  const firstNl = src.indexOf('\n');
  if (firstNl === -1 || src.slice(0, firstNl).trim() !== '---') {
    return { fm: {}, body: src, unparsed: false };
  }
  const closeRe = /\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/g;
  closeRe.lastIndex = firstNl;
  const m = closeRe.exec(src);
  if (!m) return { fm: {}, body: src, unparsed: true };
  const raw = src.slice(firstNl + 1, m.index);
  const body = src.slice(m.index + m[0].length);
  if (raw.length > FRONTMATTER_CAP) return { fm: {}, body, unparsed: true };
  try {
    const data = parseYaml(raw, { schema: 'core', maxAliasCount: 50, prettyErrors: false, logLevel: 'error' });
    if (data == null) return { fm: {}, body, unparsed: false };
    if (typeof data !== 'object' || Array.isArray(data)) return { fm: {}, body, unparsed: true };
    return { fm: data, body, unparsed: false };
  } catch {
    return { fm: {}, body, unparsed: true };
  }
}

// [[Target]], [[Target|Label]], [[Target#Heading]], ![[embed.png]].
const WIKILINK_RE = /(!?)\[\[([^\[\]\n|#^]+)(?:[#^][^\[\]\n|]*)?(?:\|([^\[\]\n]*))?\]\]/g;

/** Every wikilink in a string: { target, label, embed }. */
export function findWikilinks(text) {
  const out = [];
  if (typeof text !== 'string' || !text.includes('[[')) return out;
  for (const m of text.matchAll(WIKILINK_RE)) {
    const target = m[2].trim();
    if (!target) continue;
    out.push({ target, label: m[3]?.trim() || null, embed: m[1] === '!' });
  }
  return out;
}

/** Wikilinks inside frontmatter values (strings and flat lists of strings). */
export function frontmatterLinks(fm) {
  const out = [];
  for (const [field, value] of Object.entries(fm)) {
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (typeof v !== 'string') continue;
      for (const link of findWikilinks(v)) out.push({ ...link, field });
    }
  }
  return out;
}

/** A frontmatter value as display text (dates and numbers stay as written). */
export function asText(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

/** A wikilink value "[[Name]]" (or "[[folder/Name|x]]") reduced to its name. */
export function linkName(v) {
  const s = asText(v);
  if (!s) return null;
  const l = findWikilinks(s)[0];
  return l ? l.target : s;
}

/** A frontmatter list of wikilinks reduced to names. */
export function linkNames(v) {
  const list = Array.isArray(v) ? v : v == null ? [] : [v];
  return list.map(linkName).filter((x) => typeof x === 'string' && x.length > 0);
}

/** Plain-text excerpt of a markdown body (no links syntax, no headings marks). */
export function excerpt(body, max = 280) {
  const text = String(body || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[\[[^\]]*\]\]/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}...` : text;
}
