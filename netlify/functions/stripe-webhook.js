// Netlify Function: stripe-webhook (Kawan Visa SCHOOL)
// Listens for Stripe events → flips is_pro_school in Supabase
// Env vars: STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY

const https  = require('https');
const crypto = require('crypto');

// ── Signature verification (manual — no Stripe SDK) ──────────────────────────
function verifySignature(rawBody, sigHeader, secret) {
  const parts = {};
  sigHeader.split(',').forEach(part => {
    const [k, v] = part.split('=');
    parts[k] = v;
  });
  const timestamp  = parts['t'];
  const v1sigs     = sigHeader.split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  const signed     = `${timestamp}.${rawBody}`;
  const expected   = crypto.createHmac('sha256', secret).update(signed, 'utf8').digest('hex');
  return v1sigs.includes(expected);
}

// ── Supabase PATCH: flip is_pro_school ───────────────────────────────────────
function supabaseUpdate(userId, isPro) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ is_pro_school: isPro });
    const url  = new URL(`${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`);
    const req  = https.request(
      {
        hostname: url.hostname,
        path:     url.pathname + url.search,
        method:   'PATCH',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body),
          'apikey':         process.env.SUPABASE_SERVICE_KEY,
          'Authorization':  `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          'Prefer':         'return=minimal',
        },
      },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // CRITICAL: Netlify may base64-encode the raw body — decode it properly
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  const sig    = event.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !secret) {
    console.error('Missing signature or secret');
    return { statusCode: 400, body: 'Missing signature or secret' };
  }

  // Verify Stripe signature against RAW body
  let valid = false;
  try {
    valid = verifySignature(rawBody, sig, secret);
  } catch (e) {
    console.error('Signature error:', e.message);
  }

  if (!valid) {
    console.error('Invalid signature — check STRIPE_WEBHOOK_SECRET env var');
    return { statusCode: 400, body: JSON.stringify('Invalid signature') };
  }

  // Parse event
  let stripeEvent;
  try {
    stripeEvent = JSON.parse(rawBody);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  console.log('Stripe event received:', stripeEvent.type);

  try {
    if (stripeEvent.type === 'checkout.session.completed') {
      const session = stripeEvent.data.object;
      const userId  = session.metadata?.userId || session.client_reference_id;
      if (userId) {
        const result = await supabaseUpdate(userId, true);
        console.log(`✅ is_pro_school=true for userId=${userId}, Supabase: ${result.status}`);
      } else {
        console.error('❌ No userId in session metadata or client_reference_id');
      }
    }

    if (stripeEvent.type === 'customer.subscription.deleted' ||
        stripeEvent.type === 'invoice.payment_failed') {
      const obj    = stripeEvent.data.object;
      const userId = obj.metadata?.userId;
      if (userId) {
        await supabaseUpdate(userId, false);
        console.log(`⚠️ is_pro_school=false for userId=${userId}`);
      }
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };

  } catch (err) {
    console.error('Webhook handler error:', err);
    return { statusCode: 500, body: 'Webhook handler failed' };
  }
};
