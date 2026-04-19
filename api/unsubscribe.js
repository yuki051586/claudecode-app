// Vercel Serverless Function: /api/unsubscribe
// ────────────────────────────────────────────────────────────
// POST { email: string }
//   → marks the contact as unsubscribed in Resend Audience
//
// GET ?email=…
//   → same, for direct links from emails (shows a plain text ack)
//
// Uses Resend's PATCH contact endpoint with { unsubscribed: true }.
// Idempotent: unknown email returns success ('not_found') so users
// don't get stuck if they try to unsubscribe twice.

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

function normalizeEmail(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  if (e.length > MAX_EMAIL_LEN || !EMAIL_RE.test(e)) return null;
  return e;
}

async function unsubscribeInResend(email, { apiKey, audienceId }) {
  // Resend accepts email as the contact identifier in the URL.
  const url = `${RESEND_BASE}/audiences/${audienceId}/contacts/${encodeURIComponent(email)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ unsubscribed: true }),
  });

  if (res.ok) return { status: 'unsubscribed' };

  const text = await res.text();
  // 404 = contact doesn't exist. Treat as idempotent success.
  if (res.status === 404 || /not.?found/i.test(text)) {
    return { status: 'not_found' };
  }
  return { status: 'error', httpStatus: res.status, body: text };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const rawEmail = req.method === 'POST'
    ? readJsonBody(req)?.email
    : req.query?.email;

  const email = normalizeEmail(rawEmail);
  if (!email) {
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(plainHtml(
        'メールアドレスが指定されていません',
        '配信停止するアドレスを指定してください。'
      ));
    }
    return res.status(400).json({ error: 'メールアドレスの形式が正しくありません' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!apiKey || !audienceId) {
    console.error('[unsubscribe] missing RESEND_API_KEY or RESEND_AUDIENCE_ID');
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(500).send(plainHtml('サーバー設定エラー', 'しばらく経ってから再度お試しください。'));
    }
    return res.status(500).json({ error: 'サーバー設定エラー' });
  }

  let result;
  try {
    result = await unsubscribeInResend(email, { apiKey, audienceId });
  } catch (err) {
    console.error('[unsubscribe] network error', err);
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(502).send(plainHtml('通信エラー', 'しばらく経ってから再度お試しください。'));
    }
    return res.status(502).json({ error: 'サーバーに接続できませんでした' });
  }

  if (result.status === 'error') {
    console.error('[unsubscribe] resend error', result.httpStatus, result.body);
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(502).send(plainHtml('配信停止に失敗しました', 'しばらく経ってから再度お試しください。'));
    }
    return res.status(502).json({ error: '配信停止に失敗しました' });
  }

  // Success (or idempotent not_found)
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(plainHtml(
      '✓ 配信を停止しました',
      `<code style="background:rgba(255,255,255,0.06);padding:2px 6px;border-radius:4px;">${escapeHtml(email)}</code> 宛の配信は停止されました。<br>再登録はいつでも <a href="https://claudecode-app.vercel.app/uas-aam.html#subscribe" style="color:#4fd1ff;">ダッシュボード</a> から可能です。`
    ));
  }
  return res.status(200).json({ ok: true, status: result.status });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function plainHtml(title, body) {
  return `<!doctype html>
<html lang="ja"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — SkyNexus</title>
</head>
<body style="margin:0;padding:40px 20px;background:#05070d;font-family:-apple-system,'Segoe UI','Hiragino Sans',sans-serif;color:#e5e7eb;min-height:100vh;box-sizing:border-box;">
<div style="max-width:480px;margin:40px auto;background:linear-gradient(135deg,#0a1120,#0f172a);border:1px solid rgba(79,209,255,0.25);border-radius:16px;padding:32px;">
  <div style="font-size:10px;letter-spacing:0.3em;color:#4fd1ff;font-weight:800;margin-bottom:18px;">✦&nbsp;SKYNEXUS</div>
  <h1 style="margin:0 0 12px;font-size:22px;color:#fff;font-weight:700;">${escapeHtml(title)}</h1>
  <p style="margin:0;font-size:14px;line-height:1.7;color:#94a3b8;">${body}</p>
</div>
</body></html>`;
}
