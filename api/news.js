// Vercel Serverless Function: /api/news
// ─────────────────────────────────────────────────────────────
// - Fetches RSS feeds server-side (no CORS proxy needed)
// - Runs news_selector.js scoring/filter
// - Returns a JSON payload the browser can render directly
//
// Cached by Vercel's edge CDN for 10 min (s-maxage=600)
// so multiple visitors don't hammer the upstream feeds.

import { filterArticles } from '../news_selector.js';

const FEEDS = [
  {
    name: 'FAA',
    url: 'https://news.google.com/rss/search?q=FAA+(UAS+OR+drone+OR+eVTOL+OR+%22advanced+air+mobility%22)+when:14d&hl=en-US&gl=US&ceid=US:en',
    region: 'us',
  },
  {
    name: 'EASA',
    url: 'https://news.google.com/rss/search?q=EASA+(UAS+OR+drone+OR+eVTOL+OR+%22air+mobility%22+OR+U-space)+when:14d&hl=en&gl=US&ceid=US:en',
    region: 'eu',
  },
  {
    name: 'Google News (Global)',
    url: 'https://news.google.com/rss/search?q=(%22eVTOL%22+OR+%22air+taxi%22+OR+%22advanced+air+mobility%22+OR+UAS+OR+UAM+OR+BVLOS+OR+vertiport)+when:7d&hl=en&gl=US&ceid=US:en',
    region: 'global',
  },
  {
    name: 'Google News (JP)',
    url: 'https://news.google.com/rss/search?q=(ドローン+OR+%22空飛ぶクルマ%22+OR+eVTOL+OR+UAS+OR+無人航空機)+when:14d&hl=ja&gl=JP&ceid=JP:ja',
    region: 'jp',
  },
  {
    name: 'Google News (JP 政策/実証)',
    url: 'https://news.google.com/rss/search?q=(ドローン+OR+無人航空機+OR+%22空飛ぶクルマ%22+OR+eVTOL)+(国交省+OR+航空局+OR+JCAB+OR+レベル4+OR+特定飛行+OR+実証+OR+資金調達+OR+提携)+when:30d&hl=ja&gl=JP&ceid=JP:ja',
    region: 'jp',
  },
  {
    name: 'Google News (JP 経済メディア)',
    url: 'https://news.google.com/rss/search?q=(site:nikkei.com+OR+site:xtech.nikkei.com+OR+site:itmedia.co.jp+OR+site:impress.co.jp+OR+site:toyokeizai.net)+(ドローン+OR+eVTOL+OR+%22空飛ぶクルマ%22+OR+無人航空機)+when:30d&hl=ja&gl=JP&ceid=JP:ja',
    region: 'jp',
  },
  {
    name: 'Google News (JP ドローン専門)',
    url: 'https://news.google.com/rss/search?q=(site:drone.jp+OR+site:dronejournal.jp+OR+site:dronetimes.com+OR+%22ドローンジャーナル%22+OR+%22Drone.jp%22)+(ドローン+OR+eVTOL+OR+BVLOS+OR+レベル4+OR+無人航空機+OR+UAS)+when:60d&hl=ja&gl=JP&ceid=JP:ja',
    region: 'jp',
  },
  {
    name: 'Google News (JP 事業者/実装)',
    url: 'https://news.google.com/rss/search?q=(ドローン+OR+eVTOL+OR+%22空飛ぶクルマ%22)+(SkyDrive+OR+JAL+OR+ANA+OR+トヨタ+OR+スズキ+OR+丸紅+OR+KDDI+OR+楽天+OR+物流+OR+配送+OR+点検+OR+測量)+when:30d&hl=ja&gl=JP&ceid=JP:ja',
    region: 'jp',
  },
  {
    name: 'ASTM',
    url: 'https://news.google.com/rss/search?q=(site:astm.org+OR+ASTM)+(F3411+OR+F38+OR+UAS+OR+drone+OR+BVLOS)+when:30d&hl=en&gl=US&ceid=US:en',
    region: 'world',
  },
  {
    name: 'ISO TC20/SC16',
    url: 'https://news.google.com/rss/search?q=(site:iso.org+OR+%22ISO+21895%22+OR+%22ISO+23629%22)+(UAS+OR+UAV+OR+drone+OR+unmanned)+when:30d&hl=en&gl=US&ceid=US:en',
    region: 'world',
  },
  {
    name: 'EUROCAE',
    url: 'https://news.google.com/rss/search?q=(site:eurocae.net+OR+EUROCAE)+(ED-269+OR+ED-270+OR+WG-73+OR+WG-105+OR+drone+OR+UAS)+when:30d&hl=en&gl=US&ceid=US:en',
    region: 'eu',
  },
  {
    name: 'RTCA',
    url: 'https://news.google.com/rss/search?q=(site:rtca.org+OR+RTCA)+(DO-365+OR+DO-366+OR+SC-228+OR+SC-147+OR+UAS+OR+UAM)+when:30d&hl=en&gl=US&ceid=US:en',
    region: 'us',
  },
  {
    name: '3GPP',
    url: 'https://news.google.com/rss/search?q=(site:3gpp.org+OR+3GPP)+(UAV+OR+UAS+OR+UTM+OR+%22Release+17%22+OR+%22Release+18%22)+when:30d&hl=en&gl=US&ceid=US:en',
    region: 'world',
  },
];

// ─────────────────────────────────────────────
// Minimal RSS 2.0 parser (regex-based, zero deps)
// ─────────────────────────────────────────────

function extractItems(xml) {
  const out = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return '';
  let s = m[1].trim();
  const cdata = s.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) s = cdata[1];
  return s;
}

function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function stripHtml(s) {
  if (!s) return '';
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function safeDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Decode Google News wrapper URLs. The real URL is base64url-encoded
// inside /articles/<payload>; pull the first http(s) match from the
// decoded bytes.
function decodeGoogleNewsUrl(gUrl) {
  try {
    if (!gUrl || !/news\.google\.com\/(rss\/)?articles\//.test(gUrl)) return null;
    const m = gUrl.match(/\/articles\/([^?/#]+)/);
    if (!m) return null;
    let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const decoded = Buffer.from(b64, 'base64').toString('binary');
    const urlMatch = decoded.match(/https?:\/\/[^\x00-\x1f\x7f-\xff\s"<>]+/);
    if (!urlMatch) return null;
    return urlMatch[0].replace(/[)\].,;:]+$/, '');
  } catch { return null; }
}

function extractSourceUrlFromDescription(html) {
  if (!html) return null;
  const anchor = html.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/i);
  if (!anchor) return null;
  try {
    const u = new URL(anchor[1]);
    if (u.hostname.includes('news.google.com')) return null;
    return anchor[1];
  } catch { return null; }
}

function resolveSourceUrl(rawLink, rawDescriptionHtml) {
  if (!rawLink) return rawLink;
  if (!/news\.google\.com/.test(rawLink)) return rawLink;
  const fromDesc = extractSourceUrlFromDescription(rawDescriptionHtml);
  if (fromDesc) return fromDesc;
  const decoded = decodeGoogleNewsUrl(rawLink);
  if (decoded) return decoded;
  return rawLink;
}

// ─────────────────────────────────────────────
// Feed fetching
// ─────────────────────────────────────────────

async function fetchFeed(feed) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(feed.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SkyNexus/1.0; +https://vercel.com)',
        'Accept': 'application/rss+xml,application/xml,text/xml,*/*;q=0.8',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();

    return extractItems(xml).map(itemXml => {
      const rawTitle = stripHtml(extractTag(itemXml, 'title'));
      const rawLink = decodeEntities(extractTag(itemXml, 'link')).trim();
      const rawDescHtml = extractTag(itemXml, 'description');
      const description = stripHtml(rawDescHtml);
      const pubDate = extractTag(itemXml, 'pubDate');
      const sourceName = stripHtml(extractTag(itemXml, 'source')) || safeDomain(rawLink);
      const resolvedUrl = resolveSourceUrl(rawLink, rawDescHtml);
      const cleanTitle = rawTitle.replace(/\s-\s[^-]+$/, '').trim() || rawTitle;

      return {
        title: cleanTitle,
        description,
        content: description,
        url: resolvedUrl,
        googleNewsUrl: /news\.google\.com/.test(rawLink) ? rawLink : null,
        publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        source: sourceName || safeDomain(resolvedUrl),
        _feedRegion: feed.region,
        _feedName: feed.name,
      };
    });
  } catch (err) {
    console.warn(`[feed:${feed.name}] ${err.message}`);
    return { __error: true, feed: feed.name, message: err.message };
  }
}

function dedupArticles(articles) {
  const seen = new Set();
  return articles.filter(a => {
    const key = (a.title || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────

export default async function handler(req, res) {
  try {
    const results = await Promise.all(FEEDS.map(fetchFeed));
    const errors = results.filter(r => r && r.__error)
      .map(r => ({ feed: r.feed, message: r.message }));
    const raw = results.filter(Array.isArray).flat();
    const deduped = dedupArticles(raw);
    const { published } = filterArticles(deduped, { minScore: 40, maxResults: 30 });

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=300');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      rawCount: raw.length,
      articles: published,
      errors,
    });
  } catch (e) {
    console.error('[api/news]', e);
    res.status(500).json({
      generatedAt: new Date().toISOString(),
      rawCount: 0,
      articles: [],
      errors: [{ feed: 'handler', message: e.message || String(e) }],
    });
  }
}
