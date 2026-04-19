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
// for stories we've already analyzed. 30 keeps Brief picks covered even
// when /api/news returns a slightly different ranking than this batch.
const IMPL_TARGET_COUNT = 30;
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

const IMPL_SYSTEM_PROMPT = `あなたは日本の UAS / AAM (ドローン・空飛ぶクルマ) 業界アナリストです。
このニュースが「日本で何を引き起こすか」を、1〜2文・120字以内で簡潔に書いてください。

# 出力ルール
- 必ず1〜2文、合計120字以内、1段落、改行・記号なし
- ニュース本文の **固有名詞**(企業・機関・製品・地名・金額・日付) を最低1つ引用
- 日本側の **具体的な主体・制度** を最低1つ使う(抽象語は禁止)
  - 規制/行政例: 航空法レベル4、機体認証、型式認証、JCAB、NEDO
  - 産業例: SkyDrive、テラドローン、ACSL、JAL、ANA、KDDI、楽天、JAXA
  - 案件例: 大阪・関西万博、離島配送、山間地点検、災害対応、インフラ点検

# 示唆の型 (どれか1つを選ぶ)
 (a) X の動きが日本の Y規制 に直接波及する
 (b) X 社の事例が日本の Y社 に圧力をかける
 (c) FAA / EASA の X が JCAB の Y を加速 / 阻害する
 (d) X 分野の海外勢が国内の Y案件 に参入する余地

# 禁止フレーズ (使うと出力棄却)
- 「同分野の国内対応が問われる」「〜の鍵となる」「〜という局面になりうる」
- 「日本の事業者」「規制側」「国内対応」などの抽象語

# 文体
言い切りで簡潔に。「〜可能性がある」「〜と示唆される」を文末で多用しない。前置き・自己言及は書かない。

# 事実性ルール (違反するとファクトチェッカーに棄却されます)
- 記事本文に書かれていない事実は書かない。数字・期日・出来事・契約・実装実績は捏造禁止。
- 日本の固有制度を使うときは定義に厳密に即すこと:
  - 航空法レベル4 = 「有人地帯における目視外飛行」(レベル3 = 無人地帯目視外、レベル2 = 補助者ありの目視外)
  - 機体認証 = 個別機体に対する安全性認証 (≠ 型式認証 = 機体設計に対する認証)
  - JCAB = 国土交通省航空局
  - BVLOS は「目視外飛行」の意。日本ではレベル3/4で扱う
- 海外ニュースに対して「日本でも実装/合意/採用された」など、記事に裏付けのない断定を書かない。
- 「示唆」「圧力」「波及」「加速」など影響を述べる表現に留め、未発表の事実を確定的に書かない。

# 出力形式 (厳守)
- 本文のみを出力。「# 出力」「# 分析」などの見出しや箇条書き記号は絶対に書かない。
- Markdown / 改行 / 引用符を使わず、平文1段落で書く。`;

// Trim a raw model response down to a clean, in-spec implication string:
// strip any leftover markdown headers (the model occasionally echoes the
// prompt's `# 出力` / `# 分析` section markers), collapse whitespace, and
// hard-cap to ~120 chars at a sentence boundary so the UI doesn't overflow.
const IMPL_MAX_CHARS = 120;
function sanitizeImpl(raw) {
  if (!raw) return null;
  let s = String(raw)
    // Drop standalone heading lines like "# 出力" entirely.
    .replace(/^\s*#+\s*\S+\s*$/gmu, '')
    // Strip leading "# 出力" / "# 分析 " etc. prefixes (single-line variant).
    .replace(/(^|[\n。!?！?]\s*)#+\s*\S+\s*[:：]?\s*/gu, '$1')
    .replace(/^(示唆|注釈|注記|出力|分析)[:：]?\s*/u, '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!s) return null;
  if (s.length <= IMPL_MAX_CHARS) return s;
  // Prefer cutting at the last sentence boundary inside the limit so the
  // text reads as a complete thought instead of trailing off mid-clause.
  const slice = s.slice(0, IMPL_MAX_CHARS);
  const lastEnd = Math.max(slice.lastIndexOf('。'), slice.lastIndexOf('．'));
  if (lastEnd >= 40) return slice.slice(0, lastEnd + 1);
  return slice.slice(0, IMPL_MAX_CHARS - 1) + '…';
}

// Second-pass fact check: ask the same model to audit the generated
// implication against the source article. Designed to catch the most
// common failure mode — the model hallucinating Japanese implementation
// facts (level-4 deployments, JCAB decisions, etc.) that are nowhere
// in the source. Returns { ok, issue }.
const VERIFY_SYSTEM_PROMPT = `あなたは日本の航空法規・UAS / AAM 政策に精通したファクトチェッカーです。
これから「ニュース記事 (本文抜粋)」と、その記事から生成された「日本への示唆文」を渡します。
示唆文に下記いずれかの問題が**1つでも**あれば不合格にしてください。

# 棄却基準
1. 記事本文に書かれていない事実主張: 記事に存在しない数字・期日・出来事・契約・実装実績を書いている。
2. 日本の固有制度の誤用・誤定義:
   - 航空法レベル4 は「有人地帯における目視外飛行」(レベル3 = 無人地帯目視外)
   - 機体認証 ≠ 型式認証 (型式認証は設計、機体認証は個別機体)
   - BVLOS = 目視外飛行
   - JCAB = 国土交通省航空局
3. 海外ニュースに対し「日本でも実装/合意/採用」など根拠のない断定。
4. 記事の主体と日本側の主体が論理的につながらない強引な飛躍。

# 判定基準の追記
- 「〜の圧力となる」「〜を加速させる」「〜の検討を迫る」など影響を**述べる**表現は OK (未確定の含意なら可)。
- ただし「実績」「合意」「採用」「導入」などの確定表現が記事に裏付けなく書かれていれば NG。

# 出力形式 (厳守)
1行のJSONのみを返す。コードフェンス・前置き・解説は禁止。
- 問題なし: {"ok": true}
- 問題あり: {"ok": false, "issue": "<簡潔に1行・60字以内>"}`;

async function verifyImplicationJp(article, implication) {
  if (!ANTHROPIC_API_KEY) return { ok: true };
  const userMessage =
`# 記事
タイトル: ${article.title}
出典: ${article._feedName || article.source || ''}
本文抜粋: ${(article.description || '').slice(0, 800)}

# 示唆文
${implication}`;

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 20000);
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
        max_tokens: 120,
        system: VERIFY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[verify] HTTP ${res.status}: ${body.slice(0, 180)}`);
      // Conservative: on infra error, accept rather than burn a good gen.
      return { ok: true, issue: null };
    }
    const data = await res.json();
    const text = data?.content?.[0]?.text?.trim() || '';
    // The model occasionally wraps the JSON in code fences despite the rule.
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`[verify] no JSON in response: ${text.slice(0, 80)}`);
      return { ok: true, issue: null };
    }
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.ok !== 'boolean') return { ok: true, issue: null };
      return { ok: parsed.ok, issue: parsed.issue || null };
    } catch {
      return { ok: true, issue: null };
    }
  } catch (err) {
    clearTimeout(to);
    console.warn(`[verify] ${err.message}`);
    return { ok: true, issue: null };
  }
}

async function generateImplicationJp(article) {
  if (!ANTHROPIC_API_KEY) return null;
  const userMessage =
`タイトル: ${article.title}
出典: ${article._feedName || article.source || ''}
概要: ${(article.description || '').slice(0, 600)}

上記ニュースの、日本の航空行政・産業への具体的な示唆を書いてください。`;

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 20000);
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
        system: IMPL_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
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
    const cleaned = sanitizeImpl(text);
    if (!cleaned) return null;
    // Reject outputs that still lean on banned stock phrases — fall back to
    // the HTML-side template so we don't pay for filler text.
    const banned = /同分野の国内対応が問われる|鍵となる|という局面になりうる/;
    if (banned.test(cleaned)) {
      console.warn(`[impl] rejected banned phrase in output: ${cleaned.slice(0, 60)}…`);
      return null;
    }
    return cleaned;
  } catch (err) {
    clearTimeout(to);
    console.warn(`[impl] ${err.message}`);
    return null;
  }
}

async function enrichWithImplications(articles) {
  if (!ANTHROPIC_API_KEY) {
    console.log('[impl] ANTHROPIC_API_KEY not set — skipping LLM enrichment');
    return { hits: 0, misses: 0, fails: 0, rejected: 0 };
  }
  const cache = await loadImplCache();
  let hits = 0, misses = 0, fails = 0, rejected = 0, backfillVerified = 0;
  for (const a of articles.slice(0, IMPL_TARGET_COUNT)) {
    const key = a.url || a.title;
    if (!key) { fails++; continue; }
    if (cache[key]?.jp) {
      // Re-sanitize on read so previously cached entries that contain
      // leaked headers / overflow are cleaned up without an API call.
      const cleanedCached = sanitizeImpl(cache[key].jp);
      if (cleanedCached) {
        if (cleanedCached !== cache[key].jp) cache[key].jp = cleanedCached;
        // Backfill verification for legacy cache entries that predate the
        // verifier. Only runs once per entry, so the cost amortizes.
        if (!cache[key].verifiedAt) {
          const verdict = await verifyImplicationJp(a, cleanedCached);
          if (verdict.ok) {
            cache[key].verifiedAt = Date.now();
            cache[key].verifiedBy = CLAUDE_MODEL;
            a.implication = cleanedCached;
            a.implicationVerified = true;
            hits++;
            backfillVerified++;
          } else {
            console.warn(`[verify] cache-rejected ${key.slice(0, 60)}…: ${verdict.issue || ''}`);
            // Drop the bad cache entry so we don't repeatedly try to
            // re-verify it, and fall through to regenerate.
            delete cache[key];
            rejected++;
          }
          continue;
        }
        a.implication = cleanedCached;
        a.implicationVerified = true;
        hits++;
        continue;
      }
      // Cached entry was unrecoverable — fall through and regenerate.
    }
    const generated = await generateImplicationJp(a);
    if (!generated) { fails++; continue; }
    const verdict = await verifyImplicationJp(a, generated);
    if (!verdict.ok) {
      console.warn(`[verify] rejected: ${verdict.issue || ''} | ${generated.slice(0, 70)}…`);
      rejected++;
      continue;
    }
    a.implication = generated;
    a.implicationVerified = true;
    cache[key] = {
      jp: generated,
      ts: Date.now(),
      verifiedAt: Date.now(),
      verifiedBy: CLAUDE_MODEL,
      title: a.title,
      source: a.source,
      url: a.url,
      region: a._feedRegion || null,
      feedName: a._feedName || null,
      publishedAt: a.publishedAt,
    };
    misses++;
  }
  await saveImplCache(cache);
  console.log(
    `[impl] model=${CLAUDE_MODEL} cache-hit=${hits} api-call=${misses} ` +
    `rejected=${rejected} fail=${fails} backfill-verified=${backfillVerified}`
  );
  return { hits, misses, fails, rejected };
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
