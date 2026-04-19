// Vercel Serverless Function: /api/subscribe
// ────────────────────────────────────────────────────────────
// POST { email: string }
//
// 1. Validates email format
// 2. Adds contact to Resend Audience
// 3. Sends welcome email via Resend
// 4. Returns JSON { ok, status } — status: 'subscribed' | 'already' | 'welcome_failed'
//
// Env vars required:
//   RESEND_API_KEY        — Resend API key (re_...)
//   RESEND_AUDIENCE_ID    — audience UUID from Resend dashboard
//   RESEND_FROM           — "SkyNexus <brief@yourdomain.com>" or test sender
//                           (falls back to "SkyNexus <onboarding@resend.dev>")

import { buildWelcomeHtml } from '../scripts/email-template.mjs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254;
const RESEND_BASE = 'https://api.resend.com';

function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return null;
}

export default async function handler(req, res) {
  // CORS for same-origin fetch (harmless for /api on same vercel app)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = readJsonBody(req);
  const rawEmail = body?.email;

  if (!rawEmail || typeof rawEmail !== 'string') {
    return res.status(400).json({ error: 'メールアドレスを入力してください' });
  }

  const email = rawEmail.trim().toLowerCase();
  if (email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'メールアドレスの形式が正しくありません' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  const fromAddr = process.env.RESEND_FROM || 'SkyNexus <onboarding@resend.dev>';

  if (!apiKey || !audienceId) {
    console.error('[subscribe] missing RESEND_API_KEY or RESEND_AUDIENCE_ID');
    return res.status(500).json({ error: 'サーバー設定エラー' });
  }

  // ── 1. Add to audience ──────────────────────────────────
  let status = 'subscribed';
  try {
    const addRes = await fetch(`${RESEND_BASE}/audiences/${audienceId}/contacts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, unsubscribed: false }),
    });

    if (!addRes.ok) {
      const text = await addRes.text();
      // Resend returns 409/422 for duplicate — treat as idempotent success
      const isDup = addRes.status === 409 ||
        /already exists|duplicate/i.test(text);
      if (!isDup) {
        console.error('[subscribe] add contact failed', addRes.status, text);
        return res.status(502).json({ error: '登録に失敗しました。しばらく経ってから再度お試しください。' });
      }
      status = 'already';
    }
  } catch (err) {
    console.error('[subscribe] add contact error', err);
    return res.status(502).json({ error: 'サーバーに接続できませんでした' });
  }

  // ── 2. Send welcome email ───────────────────────────────
  // Always send on first subscribe. For duplicates, still send a light
  // "we still have you" confirmation so the user knows the button worked.
  try {
    const html = buildWelcomeHtml({ email });
    const subject = status === 'already'
      ? '【SkyNexus】 既にご登録済みです'
      : '【SkyNexus Weekly Brief】 ご登録ありがとうございます';

    const sendRes = await fetch(`${RESEND_BASE}/emails`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddr,
        to: [email],
        subject,
        html,
      }),
    });

    if (!sendRes.ok) {
      const text = await sendRes.text();
      console.warn('[subscribe] welcome send failed', sendRes.status, text);
      return res.status(200).json({ ok: true, status: 'welcome_failed' });
    }
  } catch (err) {
    console.warn('[subscribe] welcome send error', err);
    return res.status(200).json({ ok: true, status: 'welcome_failed' });
  }

  return res.status(200).json({ ok: true, status });
}
