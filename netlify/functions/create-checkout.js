// Netlify Function: create-checkout
// Creates a Stripe Checkout session and returns the URL to redirect to
// Env vars needed: STRIPE_SECRET_KEY, YOUR_DOMAIN (e.g. https://kawan-visa-school.netlify.app)

const https = require('https');

// Helper: make HTTPS request to Stripe API using pure Node (no npm needed)
function stripeRequest(path, postData) {
  return new Promise((resolve, reject) => {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    const body = postData;

    const req = https.request(
      {
        hostname: 'api.stripe.com',
        path: path,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch(e) {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Helper: URL-encode form data for Stripe API
function encodeForm(params) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let email = null;
  let userId = null;

  // Parse body — email and userId are optional (guest checkout allowed)
  try {
    const body = JSON.parse(event.body || '{}');
    email = body.email || null;
    userId = body.userId || null;
  } catch(e) {
    console.warn('Could not parse body:', e.message);
  }

  const domain = process.env.YOUR_DOMAIN || 'https://kawan-visa-school.netlify.app';

  // Build Stripe checkout session params
  const params = {
    'mode': 'subscription',
    'line_items[0][price]': process.env.STRIPE_PRICE_ID_SCHOOL || process.env.STRIPE_PRICE_ID, // school price ID
    'line_items[0][quantity]': '1',
    'success_url': `${domain}/?payment=success`,
    'cancel_url': `${domain}/?payment=cancelled`,
    'allow_promotion_codes': 'true',
    'billing_address_collection': 'auto',
  };

  // If user is logged in, pre-fill email and pass userId in metadata
  // So webhook can flip is_pro_school = true after payment
  if (email) params['customer_email'] = email;
  if (userId) {
    params['metadata[userId]'] = userId;
    params['subscription_data[metadata][userId]'] = userId;
  }

  console.log('Creating Stripe checkout session', { email, userId });

  try {
    const result = await stripeRequest('/v1/checkout/sessions', encodeForm(params));

    if (result.status !== 200) {
      console.error('Stripe error:', result.body);
      return {
        statusCode: result.status,
        body: JSON.stringify({ error: result.body.error?.message || 'Stripe error' }),
      };
    }

    const session = result.body;
    console.log('Stripe session created:', session.id);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };

  } catch (err) {
    console.error('create-checkout error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
