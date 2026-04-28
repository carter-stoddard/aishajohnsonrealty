import { Resend } from 'resend';

const FROM_ADDRESS = 'Aisha Johnson Realty <forms@aishajohnsonrealty.com>';

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

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const { first_name, last_name, email, phone, interest, notes } = body;

  if (!first_name || !last_name || !isValidEmail(email) || !interest) {
    return res.status(400).json({ error: 'Missing or invalid fields', received: Object.keys(body) });
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
