// scripts/update-news.mjs
// ─────────────────────────────────────────────────────────────
// Hourly RSS updater run by GitHub Actions.
// Fetches the same feeds as /api/news, scores them with
// news_selector.js, and writes the result to data/live-news.json.
// The Action then commits the file so Vercel auto-redeploys
// with the new payload.
//
// Run locally: node scripts/update-news.mjs
// Run in CI:   see .github/workflows/update-data.yml

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterArticles } from '../news_selector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUT_PATH = resolve(__dirname, '..', 'data', 'live-news.json');
const IMPL_CACHE_PATH = resolve(__dirname, '..', 'data', 'impl-cache.json');

// ── LLM-powered "日本への示唆" generation (Claude Haiku 4.5) ─────────
// Top N articles get a bespoke one-liner; the rest fall back to the
// template in uas-aam.html. URLs are cached so we don't re-bill Claude
// for stories we've already analyzed. 15 comfortably covers the Brief
// (top 5 by pick order) even after region/category filtering.
const IMPL_TARGET_COUNT = 15;
const IMPL_CACHE_MAX = 500;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.CLAUDE_IMPL_MODEL || 'claude-haiku-4-5-20251001';

const FEEDS = [
  { name: 'FAA',
    url: 'https://news.google.com/rss/search?q=FAA+(UAS+OR+drone+OR+eVTOL+OR+%22advanced+air+mobility%22)+when:14d&hl=en-US&gl=US&ceid=US:en',
    region: 'us' },
  { name: 'EASA',
    url: 'https://news.google.com/rss/search?q=EASA+(UAS+OR+drone+OR+eVTOL+OR+%22air+mobility%22+OR+U-space)+when:14d&hl=en&gl=US&ceid=US:en',
    region: 'eu' },
  { name: 'Google News (Global)',
    url: 'https://news.google.com/rss/search?q=(%22eVTOL%22+OR+%22air+taxi%22+OR+%22advanced+air+mobility%22+OR+UAS+OR+UAM+OR+BVLOS+OR+vertiport)+when:7d&hl=en&gl=US&ceid=US:en',
    region: 'global' },
  { name: 'Google News (JP)',
    url: 'https://news.google.com/rss/search?q=(ドローン+OR+%22空飛ぶクルマ%22+OR+eVTOL+OR+UAS+OR+無人航空機)+when:14d&hl=ja&gl=JP&ceid=JP:ja',
    region: 'jp' },
  { name: 'Google News (JP 政策/実証)',
    url: 'https://news.google.com/rss/search?q=(ドローン+OR+無人航空機+OR+%22空飛ぶクルマ%22+OR+eVTOL)+(国交省+OR+航空局+OR+JCAB+OR+レベル4+OR+特定飛行+OR+実証+OR+資金調達+OR+提携)+when:30d&hl=ja&gl=JP&ceid=JP:ja',
    region: 'jp' },
  { name: 'Google News (JP 経済メディア)',
    url: 'https://news.google.com/rss/search?q=(site:nikkei.com+OR+site:xtech.nikkei.com+OR+site:itmedia.co.jp+OR+site:impress.co.jp+OR+site:toyokeizai.net)+(ドローン+OR+eVTOL+OR+%22空飛ぶクルマ%22+OR+無人航空機)+when:30d&hl=ja&gl=JP&ceid=JP:ja',
    region: 'jp' },
  { name: 'Google News (JP ドローン専門)',
    url: 'https://news.google.com/rss/search?q=(site:drone.jp+OR+site:dronejournal.jp+OR+site:dronetimes.com+OR+%22ドローンジャーナル%22+OR+%22Drone.jp%22)+(ドローン+OR+eVTOL+OR+BVLOS+OR+レベル4+OR+無人航空機+OR+UAS)+when:60d&hl=ja&gl=JP&ceid=JP:ja',
    region: 'jp' },
  { name: 'Google News (JP 事業者/実装)',
    url: 'https://news.google.com/rss/search?q=(ドローン+OR+eVTOL+OR+%22空飛ぶクルマ%22)+(SkyDrive+OR+JAL+OR+ANA+OR+トヨタ+OR+スズキ+OR+丸紅+OR+KDDI+OR+楽天+OR+物流+OR+配送+OR+点検+OR+測量)+when:30d&hl=ja&gl=JP&ceid=JP:ja',
    region: 'jp' },
  { name: 'ASTM',
    url: 'https://news.google.com/rss/search?q=(site:astm.org+OR+ASTM)+(F3411+OR+F38+OR+UAS+OR+drone+OR+BVLOS)+when:30d&hl=en&gl=US&ceid=US:en',
    region: 'world' },
  { name: 'ISO TC20/SC16',
    url: 'https://news.google.com/rss/search?q=(site:iso.org+OR+%22ISO+21895%22+OR+%22ISO+23629%22)+(UAS+OR+UAV+OR+drone+OR+unmanned)+when:30d&hl=en&gl=US&ceid=US:en',
    region: 'world' },
  { name: 'EUROCAE',
    url: 'https://news.google.com/rss/search?q=(site:eurocae.net+OR+EUROCAE)+(ED-269+OR+ED-270+OR+WG-73+OR+WG-105+OR+drone+OR+UAS)+when:30d&hl=en&gl=US&ceid=US:en',
    region: 'eu' },
  { name: 'RTCA',
    url: 'https://news.google.com/rss/search?q=(site:rtca.org+OR+RTCA)+(DO-365+OR+DO-366+OR+SC-228+OR+SC-147+OR+UAS+OR+UAM)+when:30d&hl=en&gl=US&ceid=US:en',
    region: 'us' },
  { name: '3GPP',
    url: 'https://news.google.com/rss/search?q=(site:3gpp.org+OR+3GPP)+(UAV+OR+UAS+OR+UTM+OR+%22Release+17%22+OR+%22Release+18%22)+when:30d&hl=en&gl=US&ceid=US:en',
    region: 'world' },
];

// ─── Minimal RSS 2.0 parser (regex-based, zero deps) ───
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

async function fetchFeed(feed) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(feed.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SkyNexus-Updater/1.0; +https://github.com)',
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

async function loadImplCache() {
  try {
    const raw = await readFile(IMPL_CACHE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch { return {}; }
}

async function saveImplCache(cache) {
  const entries = Object.entries(cache);
  entries.sort((a, b) => (b[1]?.ts || 0) - (a[1]?.ts || 0));
  const pruned = Object.fromEntries(entries.slice(0, IMPL_CACHE_MAX));
  await mkdir(dirname(IMPL_CACHE_PATH), { recursive: true });
  await writeFile(IMPL_CACHE_PATH, JSON.stringify(pruned, null, 2) + '\n', 'utf8');
}

async function generateImplicationJp(article) {
  if (!ANTHROPIC_API_KEY) return null;
  const prompt =
`あなたは日本の UAS / AAM(ドローン・空飛ぶクルマ)業界アナリストです。
以下のニュースを読み、日本の事業者・規制当局・利用者にとっての示唆を1〜2文で日本語で書いてください。

制約:
- 事実の繰り返しではなく、日本側への含意を書く
- 「〜可能性がある」「〜と見られる」など推論調で可
- 100字以内、1段落、装飾記号や見出しは付けない

タイトル: ${article.title}
出典: ${article._feedName || article.source || ''}
概要: ${(article.description || '').slice(0, 400)}

示唆:`;

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 220,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[impl] HTTP ${res.status}: ${body.slice(0, 180)}`);
      return null;
    }
    const data = await res.json();
    const text = data?.content?.[0]?.text?.trim();
    if (!text) return null;
    return text.replace(/^示唆[:：]?\s*/, '').replace(/\s+/g, ' ').slice(0, 180);
  } catch (err) {
    clearTimeout(to);
    console.warn(`[impl] ${err.message}`);
    return null;
  }
}

async function enrichWithImplications(articles) {
  if (!ANTHROPIC_API_KEY) {
    console.log('[impl] ANTHROPIC_API_KEY not set — skipping LLM enrichment');
    return { hits: 0, misses: 0, fails: 0 };
  }
  const cache = await loadImplCache();
  let hits = 0, misses = 0, fails = 0;
  for (const a of articles.slice(0, IMPL_TARGET_COUNT)) {
    const key = a.url || a.title;
    if (!key) { fails++; continue; }
    if (cache[key]?.jp) {
      a.implication = cache[key].jp;
      hits++;
      continue;
    }
    const generated = await generateImplicationJp(a);
    if (generated) {
      a.implication = generated;
      // Also persist enough metadata that the frontend can show this
      // article in the archive even after it falls out of the live feed —
      // that's the whole point of paying for the LLM call.
      cache[key] = {
        jp: generated,
        ts: Date.now(),
        title: a.title,
        source: a.source,
        url: a.url,
        region: a._feedRegion || null,
        feedName: a._feedName || null,
        publishedAt: a.publishedAt,
      };
      misses++;
    } else {
      fails++;
    }
  }
  await saveImplCache(cache);
  console.log(`[impl] model=${CLAUDE_MODEL} cache-hit=${hits} api-call=${misses} fail=${fails}`);
  return { hits, misses, fails };
}

async function main() {
  const startedAt = Date.now();
  console.log(`[update-news] fetching ${FEEDS.length} feeds...`);

  const results = await Promise.all(FEEDS.map(fetchFeed));
  const errors = results.filter(r => r && r.__error)
    .map(r => ({ feed: r.feed, message: r.message }));
  const raw = results.filter(Array.isArray).flat();
  const deduped = dedupArticles(raw);
  const { published } = filterArticles(deduped, { minScore: 40, maxResults: 30 });

  await enrichWithImplications(published);

  const payload = {
    generatedAt: new Date().toISOString(),
    rawCount: raw.length,
    articles: published,
    errors,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[update-news] wrote ${published.length}/${raw.length} to ${OUT_PATH} in ${elapsed}s`);
  if (errors.length) console.log(`[update-news] ${errors.length} feed errors:`, errors);
}

main().catch(err => {
  console.error('[update-news] fatal:', err);
  process.exit(1);
});
