/**
 * UAS/AAM News Selection Logic
 * Claude Codeに組み込むニュース選定モジュール
 *
 * 使用方法:
 *   import { scoreArticle, filterArticles } from './news_selector.js';
 *   const results = filterArticles(rawArticles, { minScore: 60 });
 */

// ─────────────────────────────────────────────
// 1. キーワード定義
// ─────────────────────────────────────────────

const KEYWORDS = {
  // 必須キーワード: どれか1つが含まれないと即スキップ
  required: [
    'uas', 'uav', 'aam', 'evtol', 'uam', 'drone', 'unmanned',
    'air taxi', 'air mobility', 'vertiport', 'vtol', 'autonomy',
    'urban air', 'advanced air',
    '無人航空', 'ドローン', '空飛ぶクルマ', '空飛ぶ車', 'エアタクシー', '垂直離着陸',
  ],

  // カテゴリ別キーワードとスコア加算値
  categories: {
    regulation: {
      score: 40,
      label: '規制・政策',
      keywords: [
        'faa', 'easa', 'icao', 'jcab', 'part 107', 'part 135',
        'bvlos', 'type certificate', 'airworthiness', 'certification',
        'waiver', 'regulation', 'rule', 'rulemaking', 'ntia',
        '国土交通省', '国交省', '航空局', '航空法', '型式認証', '規制',
        'レベル4', '特定飛行', '機体認証', '操縦ライセンス',
      ],
    },
    technology: {
      score: 30,
      label: '技術・製品',
      keywords: [
        'prototype', 'launch', 'flight test', 'maiden flight', 'battery',
        'autonomy', 'detect and avoid', 'daa', 'utm', 'u-space',
        'payload', 'sensor', 'lidar', 'hydrogen', 'hybrid propulsion',
        '試験飛行', '実証飛行', '実証実験', '量産', '開発', '認証取得', '初飛行',
      ],
    },
    market: {
      score: 25,
      label: '市場・資金',
      keywords: [
        'funding', 'series', 'ipo', 'spac', 'acquisition', 'merger',
        'partnership', 'contract', 'order', 'revenue', 'valuation',
        'investment', 'venture', 'billion', 'million',
        '資金調達', '契約', '買収', '出資', 'シリーズ', '提携', '業務提携', '上場', '調達',
      ],
    },
    incident: {
      score: 35,
      label: '事故・事件',
      keywords: [
        'crash', 'accident', 'incident', 'violation', 'grounding',
        'recall', 'investigation', 'ntsb', 'safety', 'near miss',
        '墜落', '事故', '事件', '違反', '調査',
      ],
    },
    policy: {
      score: 30,
      label: '政策・インフラ',
      keywords: [
        'vertiport', 'corridor', 'infrastructure', 'airport', 'skyport',
        'nasa', 'aria', 'darpa', 'dod', 'defense', 'military',
        'public safety', 'emergency', 'delivery',
        '空港', 'インフラ', '整備', '運用開始',
      ],
    },
  },
};

// ─────────────────────────────────────────────
// 2. ソース信頼度スコア
// ─────────────────────────────────────────────

const SOURCE_TRUST = {
  // 一次情報ソース
  'faa.gov':          1.5,
  'easa.europa.eu':   1.5,
  'icao.int':         1.5,
  'nasa.gov':         1.4,
  'ntsb.gov':         1.4,
  'mlit.go.jp':       1.5,
  // 専門メディア
  'avweb.com':        1.3,
  'ainonline.com':    1.3,
  'aviationweek.com': 1.3,
  'flightglobal.com': 1.3,
  'unmannedairspace.info': 1.3,
  'dronelife.com':    1.2,
  'uasmagazine.com':  1.2,
  'suasnews.com':     1.2,
  // 日本メディア
  'nikkei.com':       1.2,
  'asahi.com':        1.1,
  'mainichi.jp':      1.1,
  'yomiuri.co.jp':    1.1,
  'nhk.or.jp':        1.2,
  'nhk.jp':           1.2,
  'jiji.com':         1.1,
  'kyodonews.net':    1.1,
  'sankei.com':       1.0,
  'itmedia.co.jp':    1.1,
  'impress.co.jp':    1.0,
  'drone.jp':         1.1,
  // 一般メディア
  'reuters.com':      1.1,
  'bloomberg.com':    1.1,
  'ft.com':           1.1,
  'wsj.com':          1.0,
  'techcrunch.com':   1.0,
  // デフォルト
  default:            0.8,
};

// ─────────────────────────────────────────────
// 3. 新鮮度スコア (時間経過でペナルティ)
// ─────────────────────────────────────────────

function freshnessScore(publishedAt) {
  const ageHours = (Date.now() - new Date(publishedAt).getTime()) / 3_600_000;
  if (ageHours <= 3)   return 20;
  if (ageHours <= 12)  return 15;
  if (ageHours <= 24)  return 10;
  if (ageHours <= 48)  return 5;
  if (ageHours <= 72)  return 2;
  return 0;
}

// ─────────────────────────────────────────────
// 4. テキスト正規化ユーティリティ
// ─────────────────────────────────────────────

function normalize(text = '') {
  return text.toLowerCase().replace(/[^\w\s\u3040-\u9fff]/g, ' ');
}

function containsAny(text, keywords) {
  const t = normalize(text);
  return keywords.some(kw => t.includes(kw.toLowerCase()));
}

function countMatches(text, keywords) {
  const t = normalize(text);
  return keywords.filter(kw => t.includes(kw.toLowerCase())).length;
}

// ─────────────────────────────────────────────
// 5. メインスコアリング関数
// ─────────────────────────────────────────────

/**
 * 1件の記事を評価してスコアとメタデータを返す
 *
 * @param {Object} article
 * @param {string} article.title
 * @param {string} article.description
 * @param {string} article.content
 * @param {string} article.url
 * @param {string} article.publishedAt  - ISO 8601
 * @param {string} [article.source]     - ドメイン名
 * @param {number} [article.engagement] - いいね/シェア数など (任意)
 *
 * @returns {{ score: number, categories: string[], breakdown: Object, pass: boolean }}
 */
export function scoreArticle(article) {
  const fullText = [
    article.title ?? '',
    article.description ?? '',
    article.content ?? '',
  ].join(' ');

  // 1. 必須キーワードチェック (ヒットなし → score=0で即終了)
  if (!containsAny(fullText, KEYWORDS.required)) {
    return { score: 0, categories: [], breakdown: { required: false }, pass: false };
  }

  let score = 0;
  const hitCategories = [];
  const breakdown = { required: true };

  // 2. カテゴリスコア (複数カテゴリに加算、ただしmax1カテゴリは満点)
  for (const [key, def] of Object.entries(KEYWORDS.categories)) {
    const matches = countMatches(fullText, def.keywords);
    if (matches > 0) {
      const catScore = Math.min(def.score, def.score * (0.6 + matches * 0.2));
      score += catScore;
      hitCategories.push(def.label);
      breakdown[key] = { matches, catScore: Math.round(catScore) };
    }
  }

  // 3. ソース信頼度乗数
  const domain = extractDomain(article.url ?? article.source ?? '');
  const trust = SOURCE_TRUST[domain] ?? SOURCE_TRUST.default;
  score *= trust;
  breakdown.sourceTrust = { domain, multiplier: trust };

  // 4. 新鮮度ボーナス
  const fresh = freshnessScore(article.publishedAt);
  score += fresh;
  breakdown.freshness = fresh;

  // 5. エンゲージメントボーナス (任意)
  if (typeof article.engagement === 'number') {
    const engBonus = Math.min(10, Math.log10(article.engagement + 1) * 5);
    score += engBonus;
    breakdown.engagement = Math.round(engBonus);
  }

  // タイトルに必須キーワードが入っている場合のボーナス
  if (containsAny(article.title ?? '', KEYWORDS.required)) {
    score += 10;
    breakdown.titleBonus = 10;
  }

  // 日本語ソースは英語ソースより reach / trust 乗数で不利になりがちなので
  // 国内報道にフラットなボーナスを乗せて競争力を確保する
  if (article._feedRegion === 'jp' || article.region === 'jp') {
    score += 15;
    breakdown.jpRegionBonus = 15;
  }

  score = Math.round(score);

  return {
    score,
    categories: hitCategories,
    breakdown,
    pass: score > 0,  // フィルタ自体は minScore で判定 — pass は単に「必須キーワードを通過した」サイン
  };
}

// ─────────────────────────────────────────────
// 6. バッチフィルタリング
// ─────────────────────────────────────────────

/**
 * 記事配列をスコアリングして掲載対象だけ返す
 *
 * @param {Object[]} articles
 * @param {Object}  [options]
 * @param {number}  [options.minScore=60]        - 最低スコア
 * @param {number}  [options.maxResults=50]      - 最大返却件数
 * @param {boolean} [options.includeBelowThreshold=false] - 閾値未満もアーカイブ用に含める
 *
 * @returns {{ published: Object[], archived: Object[] }}
 */
export function filterArticles(articles, options = {}) {
  const {
    minScore = 60,
    maxResults = 50,
    includeBelowThreshold = false,
  } = options;

  const scored = articles.map(article => ({
    ...article,
    _scoring: scoreArticle(article),
  }));

  const published = scored
    .filter(a => a._scoring.pass && a._scoring.score >= minScore)
    .sort((a, b) => b._scoring.score - a._scoring.score)
    .slice(0, maxResults);

  const archived = includeBelowThreshold
    ? scored.filter(a => !a._scoring.pass)
    : [];

  return { published, archived };
}

// ─────────────────────────────────────────────
// 7. ユーティリティ
// ─────────────────────────────────────────────

function extractDomain(url) {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace('www.', '');
  } catch {
    return '';
  }
}

/**
 * スコアに基づいて表示用の優先度ラベルを返す
 * @param {number} score
 * @returns {'critical' | 'high' | 'medium' | 'low'}
 */
export function priorityLabel(score) {
  if (score >= 100) return 'critical';
  if (score >= 80)  return 'high';
  if (score >= 60)  return 'medium';
  return 'low';
}

/**
 * デバッグ用: スコア内訳を整形して出力
 */
export function debugScore(article) {
  const result = scoreArticle(article);
  console.log(`\n📰 "${article.title}"`);
  console.log(`   Score: ${result.score} → ${result.pass ? '✅ 掲載' : '❌ 非掲載'}`);
  console.log(`   Categories: ${result.categories.join(', ') || 'なし'}`);
  console.log(`   Breakdown:`, JSON.stringify(result.breakdown, null, 2));
  return result;
}
