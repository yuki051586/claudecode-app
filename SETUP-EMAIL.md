# Email Distribution Setup

メール配信機能 (購読フォーム + 自動応答 + 月曜配信) のセットアップ手順。
コードはすでにコミット済み。**外部サービスのアカウント作成と環境変数の設定だけ** あなたが必要。

---

## アーキテクチャ

```
┌─────────────────────────┐
│ ユーザーが uas-aam.html  │
│ で購読登録               │
└─────────────┬───────────┘
              ▼
       /api/subscribe     ← Vercel serverless
              │
        ┌─────┴─────┐
        ▼           ▼
   Resend      Resend
  Audience  → emails (welcome)
  に追加
              ▼
      ユーザー受信箱に
      確認メール

┌─────────────────────────┐
│ 毎週 月曜 7:00 JST       │
│ GitHub Actions cron      │
└─────────────┬───────────┘
              ▼
   scripts/send-digest.mjs
              │
              ▼
   Resend Broadcast API
   → Audience 全員に配信
```

- 購読リスト: **Resend の Audience** にホスト (PII を repo に置かない)
- 配信停止: Resend が自動で `{{{RESEND_UNSUBSCRIBE_URL}}}` を展開
- メールテンプレート: `scripts/email-template.mjs` に集約

---

## 1. Resend アカウントを作る

1. https://resend.com にサインアップ (無料枠: 3,000 通/月、100 通/日)
2. ダッシュボード左の **API Keys** → **Create API Key**
   - Permission: `Full access` でよい
   - キー (`re_...`) をコピー → あとで使う

---

## 2. 送信元ドメインの設定

### 選択肢 A: お試し (独自ドメインなしで送る)

- そのまま `onboarding@resend.dev` から送れる
- ただし Gmail などで「迷惑メール」判定されやすい
- 自分宛のテストには十分

### 選択肢 B: 本番 (推奨 — 独自ドメイン)

`vercel.app` のサブドメインは Resend で使えない。自分のドメインが必要。

1. Resend ダッシュボードで **Domains** → **Add Domain**
2. 例: `mail.skynexus.example.com` を入れる
3. 表示される DNS レコード (MX, TXT × 数件 — SPF / DKIM / DMARC) を
   ドメインの DNS に追加
4. Resend 側が **Verified** になるまで数分〜1時間
5. 検証されたら `brief@mail.skynexus.example.com` 等を `RESEND_FROM` で使える

---

## 3. Audience を作る

1. Resend ダッシュボードの **Audiences** → **Create Audience**
2. 名前は `SkyNexus Weekly Brief` などで適当
3. 作成後、URL またはダッシュボードに表示される **Audience ID**
   (UUID 形式: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) をコピー

---

## 4. 環境変数を設定

### 4-A. Vercel (購読 API 用)

Vercel ダッシュボード → 該当プロジェクト → **Settings** → **Environment Variables**

| Name | Value | 環境 |
|---|---|---|
| `RESEND_API_KEY` | `re_xxxxxxxxxxxx` | Production, Preview |
| `RESEND_AUDIENCE_ID` | `xxxxxxxx-xxxx-...` | Production, Preview |
| `RESEND_FROM` | `SkyNexus <brief@mail.your-domain.com>` (or `SkyNexus <onboarding@resend.dev>`) | Production, Preview |

設定後、Vercel が自動で再デプロイ。

### 4-B. GitHub Actions (週次配信用)

GitHub リポジトリ `yuki051586/claudecode-app` → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

同じ 3 つを登録:

- `RESEND_API_KEY`
- `RESEND_AUDIENCE_ID`
- `RESEND_FROM`

---

## 5. 動作確認

### 購読フォームのテスト

1. https://claudecode-app.vercel.app/uas-aam.html を開く
2. ページ下部の **「毎週月曜、日本と世界の UAS / AAM を10分で。」** 横の入力欄に自分のメールアドレスを入れて **登録する**
3. 数秒で「登録完了。確認メールをお送りしました。」のトースト
4. 受信箱に **【SkyNexus Weekly Brief】 ご登録ありがとうございます** が届く

エラー時:
- ブラウザの DevTools → **Network** で `/api/subscribe` のレスポンスを確認
- Vercel ダッシュボード → **Logs** で `[subscribe]` の出力をチェック

### 週次配信のテスト

cron を待たずに即時テスト:

1. GitHub リポジトリ → **Actions** → **Weekly digest** → **Run workflow**
2. `dry_run` を `true` にして実行 → ログにレンダリング結果が出るが配信はしない
3. 問題なければ `dry_run` を `false` (空でもOK) で実行 → Audience 全員に配信

ローカルで HTML プレビューだけ見たい場合:

```sh
node scripts/send-digest.mjs --dry-run --preview=email-digest-preview.html
# → email-digest-preview.html がブラウザで確認できる
```

---

## 6. 配信スケジュール

| いつ | 何が動く |
|---|---|
| 毎時 0 分 (既存) | `update-data.yml` — RSS取得 + AI示唆生成 |
| 毎週日曜 22:00 UTC = 月曜 7:00 JST | `send-digest.yml` — Audience 全員にメール配信 |

時刻を変えたいときは `.github/workflows/send-digest.yml` の `cron` を編集。
GitHub Actions の cron は UTC なので注意。

---

## 7. 配信停止 (unsubscribe)

3 つの方法で配信停止できる — いずれも即時反映:

### a. ダッシュボード上の「配信停止」タブ
CTA バンドのフォーム上部にある **登録 / 配信停止** タブで「配信停止」に切り替え → メール入力 → 送信。
`/api/unsubscribe` が Resend contact に `unsubscribed: true` をセット。

### b. メール内の「配信停止」リンク
Resend Broadcast 経由で送信したメールには、フッターの配信停止リンクが自動で本物の URL に置換される (`{{{RESEND_UNSUBSCRIBE_URL}}}`)。
1 クリックで Resend 側で `unsubscribed: true` になる。

### c. 直リンク (GET)
メール外からでも次の URL で解除可能:

```
https://claudecode-app.vercel.app/api/unsubscribe?email=foo@example.com
```

HTML ページが返って即時完了。再登録はダッシュボードからいつでも可能。

どの経路でも自分でリストを手動管理する必要はない — Resend Audience 上で
`unsubscribed: true` フラグがついた contact は週次 Broadcast から自動で除外される。

---

## トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| 購読しても確認メールが来ない | 迷惑メールフォルダ。`onboarding@resend.dev` は特に Gmail で迷惑判定されやすい。独自ドメイン設定を推奨 |
| `/api/subscribe` が 500 | Vercel の env vars が未設定。`RESEND_API_KEY` と `RESEND_AUDIENCE_ID` を確認 |
| 週次 cron が動かない | GitHub Actions の Secret が未設定、または Resend Audience に 0 件のとき Broadcast 作成は成功するが送信先がない。1人以上登録が必要 |
| 「既に登録済みです」が常に出る | Audience に同じメールがある。Resend ダッシュボードの **Audience** で削除すれば再登録可能 |
| プレビューと実メールが微妙に違う | Gmail はインライン CSS の一部 (CSS 変数, `linear-gradient` 内のテキスト透過) を落とすことがある。基本は問題ないはず |

---

## ファイル構成

| パス | 役割 |
|---|---|
| `api/subscribe.js` | 購読エンドポイント (Vercel serverless) |
| `api/unsubscribe.js` | 配信停止エンドポイント (POST + GET 両対応) |
| `scripts/email-template.mjs` | メール HTML 生成 (digest + welcome) |
| `scripts/send-digest.mjs` | 週次配信スクリプト |
| `.github/workflows/send-digest.yml` | 月曜 7:00 JST cron |
| `email-preview.html` | デザイン確認用の静的プレビュー (固定データ) |
| `email-digest-preview.html` | `--preview` で出力される実データ版プレビュー (gitignore 対象でOK) |
