#!/usr/bin/env node
// One-shot weekly brief sender
// ────────────────────────────────────────────────────────────
// Sends top-N articles from data/live-news.json to a single address
// via Resend. Designed for quick tests.
//
// Env vars:
//   RESEND_API_KEY   — required
//   RESEND_FROM      — optional, defaults to "SkyNexus <onboarding@resend.dev>"
//
// Also reads ./.env if present (simple KEY=VALUE lines).
//
// CLI flags:
//   --to=<email>         override recipient (default: yuki_n0515@yahoo.co.jp)
//   --dry-run            render and save preview.html, do not send
//   --preview=<path>     write HTML to path (implied by --dry-run)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LIVE_PATH = path.join(ROOT, 'data', 'live-news.json');
const IMPL_PATH = path.join(ROOT, 'data', 'impl-cache.json');

const DEFAULT_TO = 'yuki_n0515@yahoo.co.jp';
const SUBJECT = '【SkyNexus Weekly Brief】今週のUAS/AAMハイライト';
const SITE_URL = 'https://claudecode-app-tawny.vercel.app/';
const PER_BUCKET = 5;
const RESEND_BASE = 'https://api.resend.com';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const toArg = args.find(a => a.startsWith('--to='));
const previewArg = args.find(a => a.startsWith('--preview='));
const TO = toArg ? toArg.split('=')[1] : DEFAULT_TO;
const PREVIEW_PATH = previewArg
  ? previewArg.split('=')[1]
  : (DRY_RUN ? path.join(ROOT, 'email-weekly-preview.html') : null);

// ─── Minimal .env loader ─────────────────────────────────────
async function loadDotEnv() {
  try {
    const text = await fs.readFile(path.join(ROOT, '.env'), 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch { /* no .env — fine */ }
}

// ─── HTML helpers ────────────────────────────────────────────

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CATEGORY_STYLE = {
  '規制・政策':     { bg: 'rgba(79,209,255,0.16)',  fg: '#4fd1ff', label: '規制' },
  '事故・事件':     { bg: 'rgba(255,90,106,0.16)',  fg: '#ff8a96', label: '事故・事件' },
  '技術・製品':     { bg: 'rgba(74,222,128,0.16)',  fg: '#4ade80', label: '技術' },
  '市場・資金':     { bg: 'rgba(255,211,107,0.16)', fg: '#ffd36b', label: '市場' },
  '政策・インフラ': { bg: 'rgba(177,109,255,0.16)', fg: '#b16dff', label: 'インフラ' },
};

function categoryTag(cat) {
  const s = CATEGORY_STYLE[cat];
  if (!s) return '';
  return `<span style="display:inline-block; padding:3px 9px; margin-right:4px; margin-bottom:4px; border-radius:999px; background:${s.bg}; color:${s.fg}; font-size:10px; font-weight:700; letter-spacing:0.05em;">${escapeHtml(s.label)}</span>`;
}

function isJp(a) { return a._feedRegion === 'jp'; }

function rankBarColor(rank) {
  return ['#4fd1ff', '#b16dff', '#4ade80', '#fbbf24', '#ff5a6a'][(rank - 1) % 5];
}

function articleCard(a, rank, implText) {
  const score = a._scoring?.score ?? 0;
  const cats = (a._scoring?.categories || []).slice(0, 3).map(categoryTag).join('');
  const rankColor = rankBarColor(rank);
  const flag = isJp(a) ? '🇯🇵' : '🌐';
  const implBlock = implText ? `
      <div style="margin-top:14px; padding:12px 14px; background:rgba(79,209,255,0.05); border-left:3px solid ${rankColor}; border-radius:6px;">
        <div style="font-size:9px; letter-spacing:0.2em; color:${rankColor}; font-weight:800; margin-bottom:6px;">✦&nbsp;&nbsp;示唆</div>
        <div style="font-size:12px; line-height:1.7; color:#cbd5e1;">${escapeHtml(implText)}</div>
      </div>` : '';
  return `
<tr><td style="padding:0 0 12px;">
  <a href="${escapeHtml(a.url || '#')}" style="text-decoration:none; color:inherit; display:block;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a1120; border:1px solid rgba(255,255,255,0.08); border-left:4px solid ${rankColor}; border-radius:10px;">
    <tr><td style="padding:16px 18px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="font-family:'SF Mono','Consolas',monospace; font-size:11px; color:${rankColor}; font-weight:800; letter-spacing:0.15em;">№ ${String(rank).padStart(2,'0')}</td>
          <td align="right" style="font-size:10px; color:#64748b; font-weight:700; letter-spacing:0.1em;">${flag}&nbsp; SCORE ${score}</td>
        </tr>
      </table>
      <div style="margin-top:10px; font-size:16px; line-height:1.5; color:#ffffff; font-weight:700;">${escapeHtml(a.title || '')}</div>
      ${cats ? `<div style="margin-top:10px; line-height:1.8;">${cats}</div>` : ''}
      <div style="margin-top:10px; font-size:11px; color:#94a3b8;">
        <span style="color:${rankColor};">●</span>&nbsp;${escapeHtml(a.source || '')}
      </div>${implBlock}
    </td></tr>
  </table>
  </a>
</td></tr>`;
}

function sectionHeader({ chapterNum, chapterColor, emoji, title, subtitle }) {
  return `
<tr><td style="padding:14px 4px 10px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td width="40" valign="middle" style="padding-right:12px;">
        <div style="font-size:11px; letter-spacing:0.2em; color:${chapterColor}; font-weight:800;">${chapterNum}</div>
        <div style="margin-top:2px; height:2px; background:linear-gradient(90deg,${chapterColor},transparent);"></div>
      </td>
      <td valign="middle">
        <div style="font-size:17px; color:#ffffff; font-weight:700; letter-spacing:-0.01em;">${emoji} &nbsp;${escapeHtml(title)}</div>
        <div style="margin-top:2px; font-size:11px; color:#64748b; letter-spacing:0.05em;">${escapeHtml(subtitle)}</div>
      </td>
    </tr>
  </table>
</td></tr>`;
}

function buildHtml({ jpItems, worldItems, impl }) {
  const now = new Date();
  const dateLabel = `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')}`;
  const implFor = (a) => impl?.[a.url]?.jp || null;
  const jpCards = jpItems.map((a, i) => articleCard(a, i + 1, implFor(a))).join('');
  const worldCards = worldItems.map((a, i) => articleCard(a, i + 1, implFor(a))).join('');
  const totalCount = jpItems.length + worldItems.length;

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>SkyNexus Weekly Brief</title>
</head>
<body style="margin:0; padding:0; background:#05070d; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Hiragino Sans','Yu Gothic',sans-serif; color:#e5e7eb; -webkit-text-size-adjust:100%; -webkit-font-smoothing:antialiased;">
<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
今週の UAS / AAM 国内 ${jpItems.length} + 海外 ${worldItems.length} 件。続きはダッシュボードへ。
</div>
<center style="width:100%; background:#05070d;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#05070d;">
  <tr><td align="center" style="padding:24px 12px 40px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:100%;">

      <!-- Masthead -->
      <tr><td style="padding:0 0 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(135deg,#0a1120 0%,#0f172a 50%,#1a0f2a 100%); border:1px solid rgba(79,209,255,0.25); border-radius:16px;">
          <tr><td style="padding:28px 24px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-size:10px; letter-spacing:0.3em; color:#4fd1ff; font-weight:800;">✦&nbsp;&nbsp;SKYNEXUS&nbsp;&nbsp;INTELLIGENCE</td>
                <td align="right" style="font-size:10px; letter-spacing:0.15em; color:#64748b; font-weight:600;">${escapeHtml(dateLabel)}</td>
              </tr>
            </table>
            <div style="margin:18px 0 20px; height:1px; background:linear-gradient(90deg,rgba(79,209,255,0.6) 0%,rgba(177,109,255,0.4) 50%,transparent 100%);"></div>
            <div style="font-size:11px; letter-spacing:0.22em; color:#b16dff; font-weight:700; margin-bottom:8px;">WEEKLY BRIEF</div>
            <h1 style="margin:0 0 10px; font-size:26px; line-height:1.25; color:#ffffff; font-weight:800; letter-spacing:-0.01em;">
              今週の <span style="background:linear-gradient(135deg,#4fd1ff 0%,#b16dff 50%,#ff5a6a 100%); -webkit-background-clip:text; background-clip:text; color:transparent; -webkit-text-fill-color:transparent;">UAS / AAM</span><br>ハイライト
            </h1>
            <p style="margin:0; font-size:13px; line-height:1.6; color:#94a3b8;">
              国内外 750+ フィードから選定した国内 ${jpItems.length} + 海外 ${worldItems.length} 件をお届けします。
            </p>
          </td></tr>
        </table>
      </td></tr>

      ${sectionHeader({ chapterNum: '01', chapterColor: '#4fd1ff', emoji: '🇯🇵', title: '国内主要トピック', subtitle: `DOMESTIC · ${jpItems.length} stories` })}
      ${jpCards}

      ${sectionHeader({ chapterNum: '02', chapterColor: '#b16dff', emoji: '🌐', title: '海外主要トピック', subtitle: `OVERSEAS · ${worldItems.length} stories` })}
      ${worldCards}

      <!-- CTA -->
      <tr><td align="center" style="padding:24px 0 6px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="background:linear-gradient(135deg,#4fd1ff 0%,#b16dff 50%,#ff5a6a 100%); border-radius:999px;">
            <a href="${SITE_URL}" style="display:inline-block; padding:14px 32px; color:#05070d; font-weight:800; font-size:13px; text-decoration:none; letter-spacing:0.08em;">続きはサイトで&nbsp;&nbsp;→</a>
          </td></tr>
        </table>
        <div style="margin-top:10px; font-size:11px; color:#64748b;">
          750+ 記事 · 企業マップ · 認証ステータス · 事故統計
        </div>
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:28px 4px 0;">
        <div style="border-top:1px solid rgba(255,255,255,0.08); padding-top:16px; font-size:11px; color:#64748b; line-height:1.7; text-align:center;">
          <div style="font-size:12px; color:#ffffff; font-weight:800; letter-spacing:0.1em; margin-bottom:4px;">SKYNEXUS</div>
          UAS × AAM Intelligence · Curated weekly
        </div>
        <div style="margin-top:14px; font-size:10px; color:#475569; letter-spacing:0.08em; text-align:center;">
          © 2026&nbsp;&nbsp;SKYNEXUS&nbsp;DASHBOARD
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>
</center>
</body>
</html>`;
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  await loadDotEnv();

  const raw = JSON.parse(await fs.readFile(LIVE_PATH, 'utf8'));
  const all = Array.isArray(raw.articles) ? raw.articles : [];
  if (!all.length) {
    console.error('[send-weekly-brief] no articles in live-news.json');
    process.exit(1);
  }

  let impl = {};
  try {
    impl = JSON.parse(await fs.readFile(IMPL_PATH, 'utf8'));
  } catch {
    console.warn('[send-weekly-brief] impl-cache.json not found — implications will be skipped');
  }

  const byScore = (a, b) => (b._scoring?.score ?? 0) - (a._scoring?.score ?? 0);
  const jpItems = all.filter(isJp).slice().sort(byScore).slice(0, PER_BUCKET);
  const worldItems = all.filter(a => !isJp(a)).slice().sort(byScore).slice(0, PER_BUCKET);

  const implCount = [...jpItems, ...worldItems].filter(a => impl[a.url]?.jp).length;
  console.log(`[send-weekly-brief] 🇯🇵 JP (${jpItems.length}):`);
  jpItems.forEach((a, i) => console.log(`  ${i+1}. [${a._scoring?.score ?? '-'}]${impl[a.url]?.jp ? ' ✦' : '  '} ${(a.title || '').slice(0, 78)}  (${a.source || ''})`));
  console.log(`[send-weekly-brief] 🌐 World (${worldItems.length}):`);
  worldItems.forEach((a, i) => console.log(`  ${i+1}. [${a._scoring?.score ?? '-'}]${impl[a.url]?.jp ? ' ✦' : '  '} ${(a.title || '').slice(0, 78)}  (${a.source || ''})`));
  console.log(`[send-weekly-brief] implications attached: ${implCount}/${jpItems.length + worldItems.length}`);

  const html = buildHtml({ jpItems, worldItems, impl });
  console.log(`[send-weekly-brief] html length: ${html.length} bytes`);

  if (PREVIEW_PATH) {
    await fs.writeFile(PREVIEW_PATH, html, 'utf8');
    console.log(`[send-weekly-brief] preview written: ${PREVIEW_PATH}`);
  }

  if (DRY_RUN) {
    console.log('[send-weekly-brief] dry-run — no email dispatched');
    return;
  }

  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  const fromAddr = (process.env.RESEND_FROM || '').trim() || 'SkyNexus <onboarding@resend.dev>';

  if (!apiKey) {
    console.error('[send-weekly-brief] RESEND_API_KEY is not set.');
    console.error('    Set it in your shell:    export RESEND_API_KEY=re_xxxxx');
    console.error('    Or drop a .env file at project root with: RESEND_API_KEY=re_xxxxx');
    process.exit(1);
  }

  console.log(`[send-weekly-brief] sending to ${TO}`);
  console.log(`[send-weekly-brief] from: ${fromAddr}`);

  const res = await fetch(`${RESEND_BASE}/emails`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddr,
      to: [TO],
      subject: SUBJECT,
      html,
    }),
  });

  let result = null;
  try { result = await res.json(); } catch { /* non-JSON body */ }

  if (!res.ok) {
    console.error(`[send-weekly-brief] ✗ Resend error ${res.status}:`, result);
    process.exit(1);
  }

  console.log(`[send-weekly-brief] ✔ sent. id=${result?.id || 'unknown'}`);
}

main().catch(err => {
  console.error('[send-weekly-brief] fatal:', err);
  process.exit(1);
});
