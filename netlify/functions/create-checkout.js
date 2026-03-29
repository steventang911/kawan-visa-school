// Netlify Function: stripe-webhook
// Listens for Stripe payment events → flips is_pro = true in Supabase
// Env vars needed: STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY

const https = require('https');
const crypto = require('crypto');

// Verify Stripe webhook signature
function verifySignature(payload, signature, secret) {
  const parts = signature.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    acc[k] = v;
    return acc;
  }, {});

  const signedPayload = `${parts.t}.${payload}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(`v1=${expected}`),
    Buffer.from(parts.v1 || '')
  );
}

// Update is_pro in Supabase
function supabaseUpdate(userId, isPro) {
  return new Promise((resolve, reject) => {
    const supabaseUrl = new URL(process.env.SUPABASE_URL);
    const body = JSON.stringify({ is_pro_school: isPro });

    const req = https.request(
      {
        hostname: supabaseUrl.hostname,
        path: `/rest/v1/profiles?id=eq.${userId}`,
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          'Content-Length': Buffer.byteLength(body),
          'Prefer': 'return=minimal',
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

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  const payload = event.body;

  // Verify webhook authenticity
  let valid = false;
  try {
    valid = verifySignature(payload, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('Signature verification error:', e);
  }

  if (!valid) {
    return { statusCode: 400, body: 'Invalid signature' };
  }

  const stripeEvent = JSON.parse(payload);
  console.log('Stripe event:', stripeEvent.type);

  try {
    // Payment succeeded → activate Pro
    if (stripeEvent.type === 'checkout.session.completed') {
      const session = stripeEvent.data.object;
      const userId = session.metadata?.userId || session.client_reference_id;
      if (userId) {
        const result = await supabaseUpdate(userId, true);
        console.log(`✅ is_pro=true for user ${userId}, Supabase status: ${result.status}`);
      } else {
        console.error('❌ No userId in session metadata');
      }
    }

    // Subscription cancelled / payment failed → deactivate Pro
    if (
      stripeEvent.type === 'customer.subscription.deleted' ||
      stripeEvent.type === 'invoice.payment_failed'
    ) {
      const obj = stripeEvent.data.object;
      // Need userId from metadata — stored during checkout
      const userId = obj.metadata?.userId;
      if (userId) {
        await supabaseUpdate(userId, false);
        console.log(`⚠️ is_pro=false for user ${userId}`);
      }
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };

  } catch (err) {
    console.error('Webhook handler error:', err);
    return { statusCode: 500, body: 'Webhook handler failed' };
  }
};
