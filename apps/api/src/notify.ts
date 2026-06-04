import { request } from 'undici';

/**
 * Alert delivery (Phase 4): email via Resend, SMS via Twilio, both over their
 * REST APIs (no SDKs). When the relevant credentials are unset, the message is
 * logged to the console instead of sent — so the loop works end to end in dev
 * and "goes live" the moment keys are added to .env. Failures never throw into
 * the request path (best-effort delivery).
 */
export interface NotifyTarget {
  email: string | null;
  phone: string | null;
  notifyEmail: boolean;
  notifySms: boolean;
}

export interface DeliveryResult {
  channel: 'email' | 'sms';
  sent: boolean;
  detail: string;
}

export async function sendAlertNotifications(
  target: NotifyTarget,
  msg: { title: string; body: string | null },
): Promise<DeliveryResult[]> {
  const out: DeliveryResult[] = [];
  const text = msg.body ? `${msg.title} — ${msg.body}` : msg.title;
  if (target.notifyEmail && target.email) {
    out.push(await sendEmail(target.email, msg.title, text));
  }
  if (target.notifySms && target.phone) {
    out.push(await sendSms(target.phone, text));
  }
  return out;
}

async function sendEmail(to: string, subject: string, text: string): Promise<DeliveryResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[alert:email → ${to}] ${subject}: ${text}`);
    return { channel: 'email', sent: false, detail: 'logged (RESEND_API_KEY unset)' };
  }
  const from = process.env.ALERT_FROM_EMAIL || 'Furlong <alerts@furlong.local>';
  try {
    const res = await request('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text }),
    });
    const ok = res.statusCode >= 200 && res.statusCode < 300;
    if (!ok) console.warn('Resend send failed', res.statusCode, await res.body.text());
    return { channel: 'email', sent: ok, detail: `resend ${res.statusCode}` };
  } catch (e) {
    console.warn('Resend error', e);
    return { channel: 'email', sent: false, detail: 'resend error' };
  }
}

async function sendSms(to: string, body: string): Promise<DeliveryResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    console.log(`[alert:sms → ${to}] ${body}`);
    return { channel: 'sms', sent: false, detail: 'logged (Twilio creds unset)' };
  }
  try {
    const params = new URLSearchParams({ To: to, From: from, Body: body });
    const res = await request(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      },
    );
    const ok = res.statusCode >= 200 && res.statusCode < 300;
    if (!ok) console.warn('Twilio send failed', res.statusCode, await res.body.text());
    return { channel: 'sms', sent: ok, detail: `twilio ${res.statusCode}` };
  } catch (e) {
    console.warn('Twilio error', e);
    return { channel: 'sms', sent: false, detail: 'twilio error' };
  }
}
