# UAS/AAM ニュース選定ロジック — Claude Code 組み込みガイド

---

## ファイル構成

```
project/
├── news_selector.js       ← 選定ロジック本体（このパッケージ）
├── news_fetcher.js        ← 各ソースからの取得処理（別途実装）
└── uas-aam.html           ← フロントエンド表示
```

---

## Claude Code へ渡すプロンプト

以下をそのままClaude Codeに貼り付けてください。

---

### プロンプト

```
`news_selector.js` をプロジェクトに追加して、UAS/AAMニュース選定パイプラインを実装してください。

要件:

1. **ニュース取得** (`news_fetcher.js` を新規作成)
   - 以下のソースからRSSまたはAPIでニュースを取得
     - FAA: https://www.faa.gov/rss/
     - EASA: https://www.easa.europa.eu/en/feeds/news
     - Google News RSS (UAS, eVTOL, drone, air taxi のクエリ)
   - 取得した記事を { title, description, url, publishedAt, source } の形式に正規化

2. **選定ロジックの適用** (`news_selector.js` の `filterArticles` を使用)
   ```js
   import { filterArticles } from './news_selector.js';
   const { published } = filterArticles(rawArticles, { minScore: 60, maxResults: 30 });
   ```

3. **uas-aam.html への反映**
   - `published` の記事をスコア降順で表示
   - `_scoring.categories` をタグとして表示
   - `_scoring.score` に応じて優先度バッジを表示 (critical/high/medium)
   - スコア100以上は赤バッジ "BREAKING"、80以上は橙バッジ "重要"

4. **定期実行**
   - 15分ごとに取得・選定・更新を繰り返す
   - 重複はURLの正規化で排除

スコア閾値・カテゴリ定義は `news_selector.js` に集中管理されているため、
そちらを編集すればサイト全体の挙動が変わる設計です。
```

---

## スコアリングのカスタマイズ

`news_selector.js` 内の以下の値を変更してチューニングできます。

| 変数 | 説明 | デフォルト |
|------|------|-----------|
| `KEYWORDS.required` | 必須キーワード（1つも含まれなければ破棄） | uas, drone, evtol... |
| `categories.regulation.score` | 規制ニュースの基本加算点 | 40 |
| `categories.incident.score` | 事故ニュースの基本加算点 | 35 |
| `SOURCE_TRUST` | ドメインごとの信頼度乗数 | 0.8〜1.5 |
| `minScore` (filterArticles引数) | 掲載の最低スコア閾値 | 60 |

---

## 動作確認用スニペット

```js
import { scoreArticle, debugScore } from './news_selector.js';

const sample = {
  title: 'FAA finalizes BVLOS rulemaking for commercial drone operations',
  description: 'The FAA has published the final rule for beyond visual line of sight UAS operations...',
  url: 'https://www.faa.gov/news/...',
  publishedAt: new Date().toISOString(),
};

debugScore(sample);
// 期待出力: Score ~120, categories: ['規制・政策'], pass: true
```
