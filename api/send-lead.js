import { Resend } from 'resend';

const FROM_ADDRESS = 'Aisha Johnson Realty <forms@aishajohnsonrealty.com>';

const ALLOWED_HOSTS = [
  'aishajohnsonrealty.com',
  'www.aishajohnsonrealty.com',
  'aishajohnsonrealty.vercel.app',
];

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', 'tempmail.com', 'guerrillamail.com', 'guerrillamail.net',
  'guerrillamail.org', 'guerrillamail.biz', 'sharklasers.com', '10minutemail.com',
  '10minutemail.net', 'yopmail.com', 'throwawaymail.com', 'temp-mail.org',
  'fakeinbox.com', 'trashmail.com', 'dispostable.com', 'mintemail.com',
  'maildrop.cc', 'getnada.com', 'mohmal.com', 'spam4.me', 'tempr.email',
  'mailcatch.com', 'tempinbox.com', 'mytemp.email', 'temporarymail.com',
]);

const BOT_UA_PATTERNS = [
  /bot/i, /crawler/i, /spider/i, /curl/i, /wget/i, /python/i,
  /scrapy/i, /httpclient/i, /headlesschrome/i, /phantomjs/i,
  /puppeteer/i, /playwright/i, /selenium/i,
];

const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 3;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isValidEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitStore.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }
  entry.count += 1;
  rateLimitStore.set(ip, entry);
  return entry.count <= RATE_LIMIT_MAX;
}

function looksLikeSpam(value) {
  if (!value) return false;
  const str = String(value);
  if (/https?:\/\//i.test(str)) return true;
  if (/<[^>]+>/.test(str)) return true;
  if (str.length > 30 && str === str.toUpperCase() && /[A-Z]/.test(str)) return true;
  return false;
}

function originAllowed(req) {
  const origin = req.headers.origin || req.headers.referer || '';
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname;
    return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith('.vercel.app'));
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const recipient = process.env.LEAD_RECIPIENT_EMAIL;

  if (!apiKey || !recipient) {
    return res.status(500).json({ error: 'Server is not configured' });
  }

  if (!originAllowed(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const ua = req.headers['user-agent'] || '';
  if (!ua || BOT_UA_PATTERNS.some((re) => re.test(ua))) {
    return res.status(200).json({ ok: true });
  }

  if (!req.headers['accept-language']) {
    return res.status(200).json({ ok: true });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const { first_name, last_name, email, phone, interest, notes, _honey, _ts } = body;

  if (_honey) {
    return res.status(200).json({ ok: true });
  }

  const ts = Number(_ts);
  if (!ts || Number.isNaN(ts)) {
    return res.status(400).json({ error: 'Invalid submission' });
  }
  const elapsed = Date.now() - ts;
  if (elapsed < 2000 || elapsed > 60 * 60 * 1000) {
    return res.status(200).json({ ok: true });
  }

  if (!first_name || !last_name || !isValidEmail(email) || !interest) {
    return res.status(400).json({ error: 'Missing or invalid fields' });
  }

  const emailDomain = email.split('@')[1]?.toLowerCase();
  if (emailDomain && DISPOSABLE_EMAIL_DOMAINS.has(emailDomain)) {
    return res.status(400).json({ error: 'Please use a permanent email address' });
  }

  if (looksLikeSpam(first_name) || looksLikeSpam(last_name) || looksLikeSpam(notes)) {
    return res.status(200).json({ ok: true });
  }

  if (first_name.length > 60 || last_name.length > 60 || (notes && notes.length > 1500)) {
    return res.status(400).json({ error: 'Field too long' });
  }

  const fullName = `${first_name} ${last_name}`.trim();
  const tableRows = [
    ['Name', fullName],
    ['Email', email],
    ['Phone', phone || '—'],
    ['Interested In', interest],
    ['Notes', notes || '—'],
  ]
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:8px 14px;border:1px solid #e0d8d0;background:#f8f3ef;font-weight:600;color:#6b4765;">${escapeHtml(label)}</td>
          <td style="padding:8px 14px;border:1px solid #e0d8d0;color:#333;">${escapeHtml(value)}</td>
        </tr>`
    )
    .join('');

  const html = `
    <div style="font-family:Lato,Arial,sans-serif;color:#333;max-width:560px;">
      <h2 style="font-family:'Cormorant Garamond',Georgia,serif;color:#6b4765;margin:0 0 16px;">New Lead from Landing Page</h2>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">${tableRows}</table>
      <p style="font-size:12px;color:#888;margin-top:20px;">Reply directly to this email to respond to ${escapeHtml(fullName)}.</p>
    </div>
  `;

  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: recipient,
      replyTo: email,
      subject: `New Lead — ${fullName}`,
      html,
    });

    if (error) {
      return res.status(502).json({ error: 'Failed to send email' });
    }

    return res.status(200).json({ ok: true });
  } catch {
    return res.status(502).json({ error: 'Failed to send email' });
  }
}
