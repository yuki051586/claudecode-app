// Shared email HTML builder
// ────────────────────────────────────────────────────────────
// Used by:
//   - scripts/send-digest.mjs  (weekly broadcast)
//   - api/subscribe.js         (welcome email)
//
// Design mirrors email-preview.html — table-based, inline CSS,
// dark theme, compatible with Gmail / iCloud / Outlook.

const DASHBOARD_URL = 'https://claudecode-app.vercel.app/uas-aam.html';
const NEWS_SELECTOR_URL = 'https://github.com/yuki051586/claudecode-app/blob/main/news_selector.js';

// Issue numbering: week 1 = first Monday of 2026-01-05.
const ISSUE_EPOCH_MS = Date.UTC(2026, 0, 5); // Mon 2026-01-05

export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function computeIssueNumber(date = new Date()) {
  const ms = date.getTime();
  const weeks = Math.floor((ms - ISSUE_EPOCH_MS) / (7 * 24 * 3600 * 1000));
  return Math.max(1, weeks + 1);
}

export function formatDate(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Palette — synced with email-preview.html
const C = {
  bg: '#05070d',
  panel: '#0a1120',
  cyan: '#4fd1ff',
  purple: '#b16dff',
  pink: '#ff5a6a',
  green: '#4ade80',
  yellow: '#fbbf24',
  gold: '#ffd36b',
  text: '#e5e7eb',
  mute: '#94a3b8',
  mute2: '#64748b',
};

function tag(label, color) {
  const bgHex = color.bg || color;
  const fgHex = color.fg || color;
  return `<span style="display:inline-block; padding:3px 8px; border-radius:999px; background:${bgHex}; color:${fgHex}; font-size:9px; font-weight:700; letter-spacing:0.08em;">${escapeHtml(label)}</span>`;
}

function categoryTag(cat) {
  const map = {
    '規制・政策': { bg: 'rgba(79,209,255,0.14)', fg: C.cyan, label: '規制' },
    '事故・事件': { bg: 'rgba(255,90,106,0.14)', fg: '#ff8a96', label: '事故・事件' },
    '技術・製品': { bg: 'rgba(74,222,128,0.14)', fg: C.green, label: '技術' },
    '市場・資金': { bg: 'rgba(255,211,107,0.14)', fg: C.gold, label: '市場' },
    '政策・インフラ': { bg: 'rgba(177,109,255,0.14)', fg: C.purple, label: 'インフラ' },
  };
  const s = map[cat];
  if (!s) return '';
  return tag(s.label, s);
}

function rankColor(rank) {
  return [C.cyan, C.purple, C.green, C.yellow, C.pink][(rank - 1) % 5];
}

function renderFeaturedCard(item, accentColor, pillText) {
  const cats = (item.categories || []).slice(0, 2).map(categoryTag).join(' ');
  const safeTitle = escapeHtml(item.title);
  const safeSource = escapeHtml(item.source);
  return `
<tr><td style="padding:8px 0 14px;">
  <a href="${escapeHtml(item.url)}" style="text-decoration:none; color:inherit; display:block;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(135deg,${accentColor.bg14} 0%,${accentColor.bg03} 60%,transparent 100%); border:1px solid ${accentColor.border}; border-radius:14px;">
    <tr><td style="padding:22px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td>
            <span style="display:inline-block; padding:3px 10px; border-radius:999px; background:${accentColor.bg20}; color:${accentColor.fg}; font-size:9px; font-weight:800; letter-spacing:0.15em;">◉ TOP&nbsp;STORY</span>
            ${cats ? ' ' + cats : ''}
          </td>
          <td align="right" style="font-size:10px; color:${C.mute2}; font-weight:700;">SCORE&nbsp;${item.score}</td>
        </tr>
      </table>
      <h2 style="margin:14px 0 10px; font-size:20px; line-height:1.35; color:#ffffff; font-weight:700; letter-spacing:-0.01em;">${safeTitle}</h2>
      <div style="font-size:12px; color:${C.mute}; line-height:1.5;">
        <span style="color:${accentColor.fg};">●</span>&nbsp;${safeSource}&nbsp;&nbsp;·&nbsp;&nbsp;${escapeHtml(pillText)}
      </div>
    </td></tr>
  </table>
  </a>
</td></tr>`;
}

function renderListCard(item, isLast) {
  const cats = (item.categories || []).slice(0, 2).map(categoryTag).join(' ');
  const color = rankColor(item.rank);
  const rankStr = String(item.rank).padStart(2, '0');
  const bottomPad = isLast ? 24 : 10;
  return `
<tr><td style="padding:0 0 ${bottomPad}px;">
  <a href="${escapeHtml(item.url)}" style="text-decoration:none; color:inherit; display:block;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.panel}; border:1px solid rgba(255,255,255,0.08); border-radius:12px;">
    <tr>
      <td valign="top" width="60" align="center" style="padding:16px 0 16px 16px;">
        <div style="font-family:'SF Mono','Consolas',monospace; font-size:22px; font-weight:800; color:${color}; line-height:1; letter-spacing:-0.02em;">${rankStr}</div>
      </td>
      <td style="padding:16px 18px 16px 10px;">
        <div style="font-size:15px; line-height:1.5; color:#ffffff; font-weight:600;">${escapeHtml(item.title)}</div>
        <div style="margin-top:8px;">
          ${cats}
          <span style="margin-left:${cats ? 6 : 0}px; font-size:11px; color:${C.mute2};">${escapeHtml(item.source)} · score ${item.score}</span>
        </div>
      </td>
    </tr>
  </table>
  </a>
</td></tr>`;
}

function renderSection({ chapterNum, chapterColor, emoji, title, subtitle, items }) {
  if (!items || !items.length) return '';
  const accentJp = {
    bg14: 'rgba(255,90,106,0.14)', bg03: 'rgba(255,90,106,0.03)',
    bg20: 'rgba(255,90,106,0.2)', border: 'rgba(255,90,106,0.28)', fg: '#ff8a96',
  };
  const accentWorld = {
    bg14: 'rgba(79,209,255,0.14)', bg03: 'rgba(79,209,255,0.03)',
    bg20: 'rgba(79,209,255,0.2)', border: 'rgba(79,209,255,0.3)', fg: C.cyan,
  };
  const accent = emoji === '🇯🇵' ? accentJp : accentWorld;
  const worldPill = emoji === '🇯🇵' ? '🇯🇵 Japan-reported' : '🌐 Overseas';

  const header = `
<tr><td style="padding:12px 4px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td width="50" valign="middle" style="padding-right:14px;">
        <div style="font-size:11px; letter-spacing:0.2em; color:${chapterColor}; font-weight:800;">${chapterNum}</div>
        <div style="margin-top:2px; height:2px; background:linear-gradient(90deg,${chapterColor},transparent);"></div>
      </td>
      <td valign="middle">
        <div style="font-size:20px; color:#ffffff; font-weight:700; letter-spacing:-0.01em;">${emoji} &nbsp;${escapeHtml(title)}</div>
        <div style="margin-top:3px; font-size:11px; color:${C.mute2}; letter-spacing:0.05em;">${escapeHtml(subtitle)}</div>
      </td>
    </tr>
  </table>
</td></tr>`;

  const [first, ...rest] = items;
  const featuredHtml = renderFeaturedCard(first, accent, worldPill);
  const restHtml = rest
    .map((it, i) => renderListCard(it, i === rest.length - 1))
    .join('');
  return header + featuredHtml + restHtml;
}

function renderImplications({ jp, world }) {
  const hasAny = (jp && jp.length) || (world && world.length);
  if (!hasAny) return '';

  const row = (item, accentColor) => `
<div style="margin-top:14px; padding:14px 16px; background:rgba(255,255,255,0.02); border-left:3px solid ${accentColor}; border-radius:0 10px 10px 0;">
  <div style="font-size:13.5px; line-height:1.7; color:${C.text};">${escapeHtml(item.impl)}</div>
  <div style="margin-top:10px;">
    <span style="display:inline-block; padding:3px 9px; border-radius:999px; background:linear-gradient(135deg,#6ee7b7,#34d399); color:${C.bg}; font-size:9px; font-weight:800; letter-spacing:0.1em;">✓&nbsp;AI&nbsp;VERIFIED</span>
    <span style="margin-left:10px; font-size:10px; color:${C.mute2};">参考:&nbsp;<a href="${escapeHtml(item.url)}" style="color:${C.cyan}; text-decoration:none;">${escapeHtml(item.source)} ↗</a></span>
  </div>
</div>`;

  const bucketHeader = (emoji, label, color, count) => `
<div style="margin-top:${count ? 22 : 0}px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td><span style="display:inline-block; padding:3px 10px; border-radius:999px; background:${color.bg}; color:${color.fg}; font-size:9px; font-weight:800; letter-spacing:0.15em;">${emoji} FROM&nbsp;${label}</span></td>
      <td align="right" style="font-size:9px; color:${C.mute2}; letter-spacing:0.1em; font-weight:600;">${count} ${count === 1 ? 'ITEM' : 'ITEMS'}</td>
    </tr>
  </table>
</div>`;

  let body = '';
  if (jp && jp.length) {
    body += bucketHeader('🇯🇵', 'DOMESTIC', { bg: 'rgba(79,209,255,0.14)', fg: C.cyan }, jp.length);
    body += jp.map(x => row(x, C.cyan)).join('');
  }
  if (world && world.length) {
    body += bucketHeader('🌐', 'OVERSEAS', { bg: 'rgba(177,109,255,0.14)', fg: C.purple }, world.length);
    body += world.map(x => row(x, C.purple)).join('');
  }

  return `
<tr><td style="padding:12px 4px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td width="50" valign="middle" style="padding-right:14px;">
        <div style="font-size:11px; letter-spacing:0.2em; color:${C.pink}; font-weight:800;">03</div>
        <div style="margin-top:2px; height:2px; background:linear-gradient(90deg,${C.pink},transparent);"></div>
      </td>
      <td valign="middle">
        <div style="font-size:20px; color:#ffffff; font-weight:700; letter-spacing:-0.01em;">🧭 &nbsp;日本への示唆</div>
        <div style="margin-top:3px; font-size:11px; color:${C.mute2}; letter-spacing:0.05em;">AI HYPOTHESIS · self-verified</div>
      </td>
    </tr>
  </table>
</td></tr>
<tr><td style="padding:8px 0 24px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(180deg,rgba(255,90,106,0.1) 0%,rgba(255,90,106,0.02) 100%); border:1px solid rgba(255,90,106,0.28); border-radius:16px;">
    <tr><td style="padding:24px 24px 22px;">
      <div style="font-size:11px; color:#ff8a96; letter-spacing:0.1em; font-weight:700; margin-bottom:4px;">HOW THIS AFFECTS JAPAN</div>
      <div style="font-size:12px; color:${C.mute}; line-height:1.5;">Claude Haiku 4.5 が記事から仮説を生成し、同モデルが事実性チェックを通過したもののみ掲載</div>
      ${body}
      <div style="margin-top:22px; padding:12px 14px; background:rgba(0,0,0,0.25); border-radius:10px; font-size:10.5px; color:${C.mute2}; line-height:1.65;">
        <strong style="color:${C.mute};">⚠︎ Disclaimer</strong> &nbsp;
        AI による生成・自己検証は完全ではありません。重要な意思決定では一次ソース (FAA / JCAB 公式発表、各社 IR) を必ずご確認ください。
      </div>
    </td></tr>
  </table>
</td></tr>`;
}

// ──────────────────────────────────────────────────────────
// Digest email
// ──────────────────────────────────────────────────────────

export function buildDigestHtml({ articlesJp, articlesWorld, implications, stats, meta, recipientEmail }) {
  const { issueNumber, dateLabel } = meta;
  const preheader = `Issue #${String(issueNumber).padStart(3, '0')} · 今週の UAS / AAM 主要10件と AI 検証済示唆 ${implications.jp.length + implications.world.length} 件`;

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>SkyNexus Weekly Brief — Issue #${String(issueNumber).padStart(3, '0')}</title>
</head>
<body style="margin:0; padding:0; background:${C.bg}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Hiragino Sans','Yu Gothic',sans-serif; color:${C.text}; -webkit-text-size-adjust:100%; -webkit-font-smoothing:antialiased;">
<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">${escapeHtml(preheader)}</div>
<center style="width:100%; background:${C.bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
  <tr><td align="center" style="padding:32px 12px 48px;">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px; max-width:100%;">

      <!-- MASTHEAD -->
      <tr><td style="padding:0 0 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(135deg,#0a1120 0%,#0f172a 40%,#1a0f2a 100%); border:1px solid rgba(79,209,255,0.25); border-radius:20px;">
          <tr><td style="padding:36px 36px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-size:10px; letter-spacing:0.3em; color:${C.cyan}; font-weight:800;">✦&nbsp;&nbsp;SKYNEXUS&nbsp;&nbsp;INTELLIGENCE</td>
                <td align="right" style="font-size:10px; letter-spacing:0.2em; color:${C.mute2}; font-weight:600;">ISSUE&nbsp;№&nbsp;${String(issueNumber).padStart(3, '0')}&nbsp;&nbsp;·&nbsp;&nbsp;${escapeHtml(dateLabel)}</td>
              </tr>
            </table>
            <div style="margin:20px 0 24px; height:1px; background:linear-gradient(90deg,rgba(79,209,255,0.6) 0%,rgba(177,109,255,0.4) 50%,transparent 100%);"></div>
            <div style="font-size:11px; letter-spacing:0.25em; color:${C.purple}; font-weight:700; margin-bottom:10px;">WEEKLY BRIEF</div>
            <h1 style="margin:0 0 14px; font-size:34px; line-height:1.15; color:#ffffff; font-weight:800; letter-spacing:-0.02em;">
              UAS × AAM<br>
              <span style="background:linear-gradient(135deg,#4fd1ff 0%,#b16dff 50%,#ff5a6a 100%); -webkit-background-clip:text; background-clip:text; color:transparent; -webkit-text-fill-color:transparent;">Intelligence Digest</span>
            </h1>
            <p style="margin:0; font-size:14px; line-height:1.6; color:${C.mute}; max-width:460px;">
              ドローン・空飛ぶクルマ業界の今週の動き。<br>
              国内外 750+ フィードから自動選定、日本への示唆は AI が生成・自己検証して掲載。
            </p>
            <div style="margin-top:22px; font-size:11px; color:${C.mute2}; letter-spacing:0.05em;">
              <span style="display:inline-block; width:24px; height:1px; background:${C.cyan}; vertical-align:middle; margin-right:10px;"></span>
              Curated by SkyNexus · Verified by Claude Haiku 4.5
            </div>
          </td></tr>
        </table>
      </td></tr>

      <!-- STATS -->
      <tr><td style="padding:0 0 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.panel}; border:1px solid rgba(255,255,255,0.06); border-radius:14px;">
          <tr>
            <td width="25%" style="padding:18px 10px; border-right:1px solid rgba(255,255,255,0.06);" align="center">
              <div style="font-size:26px; color:${C.cyan}; font-weight:800; letter-spacing:-0.02em; line-height:1;">${stats.scanned}</div>
              <div style="margin-top:6px; font-size:9px; color:${C.mute2}; letter-spacing:0.15em; font-weight:600;">SCANNED</div>
            </td>
            <td width="25%" style="padding:18px 10px; border-right:1px solid rgba(255,255,255,0.06);" align="center">
              <div style="font-size:26px; color:#34d399; font-weight:800; letter-spacing:-0.02em; line-height:1;">${stats.topics}</div>
              <div style="margin-top:6px; font-size:9px; color:${C.mute2}; letter-spacing:0.15em; font-weight:600;">TOPICS</div>
            </td>
            <td width="25%" style="padding:18px 10px; border-right:1px solid rgba(255,255,255,0.06);" align="center">
              <div style="font-size:26px; color:${C.gold}; font-weight:800; letter-spacing:-0.02em; line-height:1;">${stats.generated}</div>
              <div style="margin-top:6px; font-size:9px; color:${C.mute2}; letter-spacing:0.15em; font-weight:600;">AI&nbsp;GENERATED</div>
            </td>
            <td width="25%" style="padding:18px 10px;" align="center">
              <div style="font-size:26px; color:${C.pink}; font-weight:800; letter-spacing:-0.02em; line-height:1;">${stats.verified}</div>
              <div style="margin-top:6px; font-size:9px; color:${C.mute2}; letter-spacing:0.15em; font-weight:600;">VERIFIED</div>
            </td>
          </tr>
        </table>
      </td></tr>

      ${renderSection({
        chapterNum: '01',
        chapterColor: C.cyan,
        emoji: '🇯🇵',
        title: '国内主要トピック',
        subtitle: `DOMESTIC · ${articlesJp.length} stories`,
        items: articlesJp,
      })}

      ${renderSection({
        chapterNum: '02',
        chapterColor: C.purple,
        emoji: '🌐',
        title: '海外主要トピック',
        subtitle: `OVERSEAS · ${articlesWorld.length} stories`,
        items: articlesWorld,
      })}

      ${renderImplications(implications)}

      <!-- CTA -->
      <tr><td align="center" style="padding:16px 0 8px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td align="center" style="background:linear-gradient(135deg,#4fd1ff 0%,#b16dff 50%,#ff5a6a 100%); border-radius:999px;">
            <a href="${DASHBOARD_URL}" style="display:inline-block; padding:15px 36px; color:${C.bg}; font-weight:800; font-size:13px; text-decoration:none; letter-spacing:0.1em;">EXPLORE&nbsp;FULL&nbsp;DASHBOARD&nbsp;&nbsp;→</a>
          </td></tr>
        </table>
        <div style="margin-top:12px; font-size:11px; color:${C.mute2};">750+ 記事 · 企業マップ · 認証ステータス · 事故統計</div>
      </td></tr>

      <!-- DIVIDER -->
      <tr><td style="padding:32px 0 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="45%" style="border-top:1px solid rgba(255,255,255,0.08);">&nbsp;</td>
            <td width="10%" align="center" style="font-size:12px; color:${C.mute2}; letter-spacing:0.3em;">✦</td>
            <td width="45%" style="border-top:1px solid rgba(255,255,255,0.08);">&nbsp;</td>
          </tr>
        </table>
      </td></tr>

      <!-- FOOTER -->
      <tr><td style="padding:0 4px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td valign="top" width="55%">
              <div style="font-size:13px; color:#ffffff; font-weight:800; letter-spacing:0.05em;">SKYNEXUS</div>
              <div style="margin-top:4px; font-size:11px; color:${C.mute2}; line-height:1.6;">UAS × AAM Intelligence<br>毎週月曜 朝 7:00 配信</div>
            </td>
            <td valign="top" width="45%" align="right">
              <div style="font-size:10px; color:${C.mute2}; letter-spacing:0.1em; font-weight:700;">DATA SOURCES</div>
              <div style="margin-top:6px; font-size:11px; color:${C.mute}; line-height:1.7;">FAA · EASA · JCAB<br>Google News · 日経 · PR TIMES<br>ほか 9 フィード</div>
            </td>
          </tr>
        </table>
        <div style="margin-top:20px; padding-top:16px; border-top:1px solid rgba(255,255,255,0.06); font-size:10.5px; color:${C.mute2}; line-height:1.7;">
          スコアリング: <a href="${NEWS_SELECTOR_URL}" style="color:${C.cyan}; text-decoration:none;">news_selector.js</a> · 生成: Claude Haiku 4.5 · ホスト: Vercel<br>
          ${recipientEmail ? `配信先 <code style="background:rgba(255,255,255,0.06); padding:1px 5px; border-radius:3px; font-size:10px;">${escapeHtml(recipientEmail)}</code> &nbsp;·&nbsp;` : ''}
          <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:${C.mute}; text-decoration:underline;">配信停止</a>
        </div>
        <div style="margin-top:18px; font-size:9.5px; color:#475569; letter-spacing:0.1em;">© 2026&nbsp;&nbsp;SKYNEXUS&nbsp;DASHBOARD&nbsp;&nbsp;·&nbsp;&nbsp;ISSUE&nbsp;№&nbsp;${String(issueNumber).padStart(3, '0')}</div>
      </td></tr>

    </table>
  </td></tr>
</table>
</center>
</body>
</html>`;
}

// ──────────────────────────────────────────────────────────
// Welcome email
// ──────────────────────────────────────────────────────────

export function buildWelcomeHtml({ email }) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark">
<title>SkyNexus Weekly Brief へのご登録ありがとうございます</title>
</head>
<body style="margin:0; padding:0; background:${C.bg}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Hiragino Sans','Yu Gothic',sans-serif; color:${C.text}; -webkit-text-size-adjust:100%;">
<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">ご登録ありがとうございます。次回月曜日 7:00 JST に初回配信をお届けします。</div>
<center style="width:100%; background:${C.bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
  <tr><td align="center" style="padding:40px 12px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px; max-width:100%;">

      <tr><td style="padding:0 0 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(135deg,#0a1120 0%,#0f172a 40%,#1a0f2a 100%); border:1px solid rgba(79,209,255,0.25); border-radius:20px;">
          <tr><td style="padding:36px;">
            <div style="font-size:10px; letter-spacing:0.3em; color:${C.cyan}; font-weight:800;">✦&nbsp;&nbsp;SKYNEXUS&nbsp;&nbsp;INTELLIGENCE</div>
            <div style="margin:18px 0 20px; height:1px; background:linear-gradient(90deg,rgba(79,209,255,0.6) 0%,rgba(177,109,255,0.4) 50%,transparent 100%);"></div>

            <div style="display:inline-block; padding:4px 12px; border-radius:999px; background:linear-gradient(135deg,#6ee7b7,#34d399); color:${C.bg}; font-size:10px; font-weight:800; letter-spacing:0.15em;">✓&nbsp;SUBSCRIBED</div>

            <h1 style="margin:14px 0 10px; font-size:28px; line-height:1.2; color:#ffffff; font-weight:800; letter-spacing:-0.02em;">
              ご登録<br>ありがとうございます
            </h1>
            <p style="margin:0 0 18px; font-size:14px; line-height:1.7; color:${C.mute};">
              <strong style="color:#ffffff;">${escapeHtml(email)}</strong> 宛に<br>
              <strong style="color:${C.cyan};">SkyNexus Weekly Brief</strong> の配信登録が完了しました。
            </p>

            <div style="margin:20px 0; padding:18px 20px; background:rgba(79,209,255,0.06); border-left:3px solid ${C.cyan}; border-radius:0 10px 10px 0;">
              <div style="font-size:10px; color:${C.cyan}; letter-spacing:0.15em; font-weight:800;">NEXT DELIVERY</div>
              <div style="margin-top:6px; font-size:15px; color:#ffffff; font-weight:700;">毎週月曜 朝 7:00 (JST)</div>
              <div style="margin-top:4px; font-size:12px; color:${C.mute}; line-height:1.6;">国内外 750+ フィードから選定した主要トピック 10 件と、AI が生成・自己検証した日本への示唆をお届けします。</div>
            </div>

            <div style="margin:24px 0 10px; font-size:12px; color:${C.mute2}; letter-spacing:0.1em; font-weight:700;">WHAT YOU'LL GET</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px; line-height:1.8; color:${C.text};">
              <tr><td width="24" valign="top" style="color:${C.cyan}; font-weight:800;">🇯🇵</td><td>国内 5 件 / 海外 5 件の主要トピック</td></tr>
              <tr><td width="24" valign="top" style="color:${C.purple}; font-weight:800;">🧭</td><td>日本への示唆 (AI 検証済のみ)</td></tr>
              <tr><td width="24" valign="top" style="color:${C.pink}; font-weight:800;">📊</td><td>週次スコアリング (規制/技術/市場/インフラ)</td></tr>
            </table>

            <div style="margin-top:28px; text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                <tr><td style="background:linear-gradient(135deg,#4fd1ff 0%,#b16dff 50%,#ff5a6a 100%); border-radius:999px;">
                  <a href="${DASHBOARD_URL}" style="display:inline-block; padding:13px 30px; color:${C.bg}; font-weight:800; font-size:12px; text-decoration:none; letter-spacing:0.1em;">今すぐダッシュボードを見る&nbsp;→</a>
                </td></tr>
              </table>
            </div>

          </td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:8px 4px 0; font-size:11px; color:${C.mute2}; line-height:1.7; text-align:center;">
        もしこのメールに覚えがない場合は、このまま破棄してください。<br>
        登録解除は配信メール下部の「配信停止」リンクからいつでも可能です。
      </td></tr>

      <tr><td style="padding:18px 4px; text-align:center; font-size:9.5px; color:#475569; letter-spacing:0.1em;">
        © 2026&nbsp;&nbsp;SKYNEXUS&nbsp;DASHBOARD
      </td></tr>

    </table>
  </td></tr>
</table>
</center>
</body>
</html>`;
}
