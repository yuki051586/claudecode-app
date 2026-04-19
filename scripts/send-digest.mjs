#!/usr/bin/env node
// Weekly digest sender
// ────────────────────────────────────────────────────────────
// Reads data/live-news.json + data/impl-cache.json
// Picks top 5 JP + top 5 World + top implications
// Creates a Resend Broadcast and sends it to RESEND_AUDIENCE_ID
//
// Env vars required:
//   RESEND_API_KEY        — Resend API key
//   RESEND_AUDIENCE_ID    — audience UUID
//   RESEND_FROM           — "SkyNexus <brief@yourdomain.com>"
//                           (falls back to onboarding@resend.dev)
//
// CLI flags:
//   --dry-run   print HTML + summary, don't create broadcast
//   --preview=FILE  write the digest HTML to FILE for visual check

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDigestHtml,
  computeIssueNumber,
  formatDate,
} from './email-template.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LIVE_PATH = path.join(ROOT, 'data', 'live-news.json');
const IMPL_CACHE_PATH = path.join(ROOT, 'data', 'impl-cache.json');
const RESEND_BASE = 'https://api.resend.com';

const PER_BUCKET = 5;
const IMPL_PER_BUCKET = 2;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const PREVIEW_FLAG = args.find(a => a.startsWith('--preview='));
const PREVIEW_PATH = PREVIEW_FLAG ? PREVIEW_FLAG.split('=')[1] : null;

// ─── Load data ──────────────────────────────────────────────

async function loadJson(p, fallback) {
  try {
    const text = await fs.readFile(p, 'utf8');
    return JSON.parse(text);
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

function isJpArticle(a) {
  return a._feedRegion === 'jp';
}

function toEmailItem(article, rank) {
  return {
    rank,
    title: article.title || '',
    source: article.source || '',
    url: article.url || '#',
    score: article._scoring?.score ?? 0,
    categories: article._scoring?.categories || [],
  };
}

function pickImplication(article, implCache) {
  // Prefer fresh cache entry; fall back to inline `implication` on article.
  const byUrl = implCache[article.url];
  if (byUrl && byUrl.jp && (byUrl.verified !== false)) {
    return { impl: byUrl.jp, verified: byUrl.verified === true };
  }
  if (article.implication && typeof article.implication === 'string') {
    return { impl: article.implication, verified: false };
  }
  return null;
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  const live = await loadJson(LIVE_PATH);
  const implCache = await loadJson(IMPL_CACHE_PATH, {});

  const articles = Array.isArray(live.articles) ? live.articles : [];
  if (!articles.length) {
    console.error('[send-digest] no articles in live-news.json — aborting');
    process.exit(1);
  }

  const jpSorted = articles.filter(isJpArticle)
    .sort((a, b) => (b._scoring?.score ?? 0) - (a._scoring?.score ?? 0));
  const worldSorted = articles.filter(a => !isJpArticle(a))
    .sort((a, b) => (b._scoring?.score ?? 0) - (a._scoring?.score ?? 0));

  const jpTop = jpSorted.slice(0, PER_BUCKET);
  const worldTop = worldSorted.slice(0, PER_BUCKET);

  const articlesJp = jpTop.map((a, i) => toEmailItem(a, i + 1));
  const articlesWorld = worldTop.map((a, i) => toEmailItem(a, i + 1));

  // Implications: pick top candidates with non-null, (ideally) verified text
  const jpImpls = [];
  for (const a of jpSorted) {
    if (jpImpls.length >= IMPL_PER_BUCKET) break;
    const i = pickImplication(a, implCache);
    if (!i) continue;
    jpImpls.push({ ...i, source: a.source, url: a.url });
  }
  const worldImpls = [];
  for (const a of worldSorted) {
    if (worldImpls.length >= IMPL_PER_BUCKET) break;
    const i = pickImplication(a, implCache);
    if (!i) continue;
    worldImpls.push({ ...i, source: a.source, url: a.url });
  }

  const now = new Date();
  const issueNumber = computeIssueNumber(now);
  const dateLabel = formatDate(now);

  const totalImpls = Object.keys(implCache).length;
  const verifiedCount = Object.values(implCache)
    .filter(e => e && e.verified === true).length;

  const stats = {
    scanned: live.rawCount || articles.length,
    topics: articlesJp.length + articlesWorld.length,
    generated: totalImpls,
    verified: verifiedCount || (jpImpls.length + worldImpls.length),
  };

  const html = buildDigestHtml({
    articlesJp,
    articlesWorld,
    implications: { jp: jpImpls, world: worldImpls },
    stats,
    meta: { issueNumber, dateLabel },
    recipientEmail: null,
  });

  const subject = `🛰 SkyNexus Weekly Brief № ${String(issueNumber).padStart(3, '0')} — ${dateLabel}`;

  console.log(`[send-digest] issue=${issueNumber} date=${dateLabel}`);
  console.log(`[send-digest] JP=${articlesJp.length} World=${articlesWorld.length}`);
  console.log(`[send-digest] impls: JP=${jpImpls.length} World=${worldImpls.length}`);
  console.log(`[send-digest] html length: ${html.length} bytes`);

  if (PREVIEW_PATH) {
    await fs.writeFile(PREVIEW_PATH, html, 'utf8');
    console.log(`[send-digest] wrote preview: ${PREVIEW_PATH}`);
  }

  if (DRY_RUN) {
    console.log('[send-digest] dry-run complete (no broadcast created)');
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  const fromAddr = process.env.RESEND_FROM || 'SkyNexus <onboarding@resend.dev>';

  if (!apiKey || !audienceId) {
    console.error('[send-digest] missing RESEND_API_KEY or RESEND_AUDIENCE_ID');
    process.exit(1);
  }

  // ── Create broadcast ──────────────────────────────────────
  const createRes = await fetch(`${RESEND_BASE}/broadcasts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audience_id: audienceId,
      from: fromAddr,
      subject,
      html,
      name: `Weekly Brief ${dateLabel} (№${issueNumber})`,
    }),
  });

  if (!createRes.ok) {
    const text = await createRes.text();
    console.error('[send-digest] create broadcast failed', createRes.status, text);
    process.exit(1);
  }

  const created = await createRes.json();
  const broadcastId = created?.id || created?.data?.id;
  if (!broadcastId) {
    console.error('[send-digest] no broadcast id in response', JSON.stringify(created));
    process.exit(1);
  }
  console.log(`[send-digest] broadcast created: ${broadcastId}`);

  // ── Send it ───────────────────────────────────────────────
  const sendRes = await fetch(`${RESEND_BASE}/broadcasts/${broadcastId}/send`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!sendRes.ok) {
    const text = await sendRes.text();
    console.error('[send-digest] send broadcast failed', sendRes.status, text);
    process.exit(1);
  }

  console.log('[send-digest] ✔ broadcast dispatched');
}

main().catch(err => {
  console.error('[send-digest] fatal:', err);
  process.exit(1);
});
