/**
 * Ingestion hygiene — clean raw scraped data at the source so garbage never enters
 * the DB (vs fixing it in post-processing). Used by the import chokepoint and the
 * sitemap/API scraper helpers.
 *
 *  - decodeEntities: full HTML-entity decode incl. Serbian Latin named entities
 *    (&scaron; -> š) + numeric/hex, so titles don't become mojibake ("scaron").
 *  - cleanTitle: decode + strip trailing vendor-name / shop-URL suffixes that leak
 *    from og:title / listing markup ("... - Apoteka Milica", "... | apothecary.rs").
 *  - isLikelyProduct: reject non-products (no price, category/condition pages).
 */

// Named HTML entities seen in Serbian pharmacy markup. ISO-8859-2 Latin letters are
// the important ones (their absence caused the "scaron"/"rsquo" tokens).
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  // Serbian Latin
  scaron: 'š', Scaron: 'Š', zcaron: 'ž', Zcaron: 'Ž',
  ccaron: 'č', Ccaron: 'Č', cacute: 'ć', Cacute: 'Ć',
  dstrok: 'đ', Dstrok: 'Đ',
  // punctuation / typography
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  ndash: '–', mdash: '—', hellip: '…', middot: '·',
  deg: '°', times: '×', reg: '®', trade: '™', copy: '©', plusmn: '±', euro: '€',
  micro: 'µ', sup2: '²', sup3: '³', frac12: '½', frac14: '¼', frac34: '¾',
  // Latin-1 accented letters (appear in imported brand/ingredient names)
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å',
  egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë', igrave: 'ì', iacute: 'í',
  icirc: 'î', iuml: 'ï', ntilde: 'ñ', ograve: 'ò', oacute: 'ó', ocirc: 'ô',
  otilde: 'õ', ouml: 'ö', ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü',
  yacute: 'ý', ccedil: 'ç', szlig: 'ß',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Auml: 'Ä', Egrave: 'È', Eacute: 'É',
  Ecirc: 'Ê', Iacute: 'Í', Ntilde: 'Ñ', Oacute: 'Ó', Ocirc: 'Ô', Ouml: 'Ö',
  Uacute: 'Ú', Uuml: 'Ü', Ccedil: 'Ç',
};

function decodeOnce(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (full, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0) {
        try { return String.fromCodePoint(code); } catch { return full; }
      }
      return full;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : full;
  });
}

export function decodeEntities(input: string): string {
  if (!input) return '';
  // Two passes handle double-encoded markup ("&amp;amp;" -> "&amp;" -> "&").
  const once = decodeOnce(input);
  return once.includes('&') ? decodeOnce(once) : once;
}

// Trailing vendor-name / shop-URL suffixes that leak into scraped titles. Anchored
// to the END so we never strip real product content from the middle of a title.
const VENDOR_SUFFIX_PATTERNS: RegExp[] = [
  /\s*[|–—-]\s*[A-Za-z0-9.\- ]*\.(rs|com|net|co\.rs)\s*$/i, // "... | apothecary.rs"
  /\s*[|–—-]\s*apoteka\s+[\p{L}\d.\- ]+$/iu,                 // "... - Apoteka Milica"
  /\s*[|–—-]\s*(apothecary|apoteka|eapoteka|gymbeam)\s*$/i,  // bare shop name
];

export function cleanTitle(input: string): string {
  if (!input) return '';
  let t = decodeEntities(input);
  for (const re of VENDOR_SUFFIX_PATTERNS) t = t.replace(re, '');
  // collapse whitespace (incl. NBSP/zero-width already decoded) and trim
  t = t.replace(/[ ​]/g, ' ').replace(/\s+/g, ' ').trim();
  return t;
}

// A row is a real, purchasable product if it has a positive price and a non-trivial
// title. Zero/absent price rows are out-of-stock entries or scrape artifacts
// (category/condition landing pages) — they are filtered from search anyway, so we
// keep them out of the DB entirely. (The import's per-vendor delist ratio guard
// prevents a broken price selector from mass-delisting an otherwise good vendor.)
// Titles that are obviously test/placeholder rows, not real products.
const JUNK_TITLE_RE = /^(test\b|testtest|placeholder|lorem ipsum|undefined|null|n\/a)$/i;

export function isLikelyProduct(title: string, price: number): boolean {
  // price <= 1 RSD is a sentinel for an unpriced/placeholder product (scrapers emit "1"
  // when they fail to read a price) — drop it like price 0 rather than show a 1-dinar item.
  if (!Number.isFinite(price) || price <= 1) return false;
  if (!title || title.trim().length < 3) return false;
  if (JUNK_TITLE_RE.test(title.trim())) return false;
  return true;
}

// isResolvableProductLink rejects category/listing/brand URLs (not a product detail page)
// and malformed double-prefixed links, so a vendor whose scraper emits the wrong href
// doesn't strand many products on one dead/category URL (Herba, E-Apoteka, Shopmania).
export function isResolvableProductLink(link: string | undefined | null): boolean {
  if (!link) return true; // missing link is handled elsewhere; don't drop the product here
  const l = link.trim();
  // double-prefixed host (shopmania bug): "https://x.rshttps://x.rs/..."
  if ((l.match(/https?:\/\//g) || []).length > 1) return false;
  // bare category/brand listing pages with no product slug
  if (/\/sr\/(cajevi|brendovi|kozmetika|lekovi|proizvod)\/?$/i.test(l)) return false;
  if (/\/proizvodjaci\//i.test(l)) return false;
  return true;
}
