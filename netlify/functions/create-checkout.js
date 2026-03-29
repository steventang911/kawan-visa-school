// Netlify Function: create-checkout
// Creates a Stripe Checkout session for Kawan Visa School Pro (RM14.90/month)
// Env vars needed: STRIPE_SECRET_KEY, STRIPE_PRICE_ID_SCHOOL

const https = require('https');

function stripeRequest(path, payload) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(payload).toString();
    const req = https.request(
      {
        hostname: 'api.stripe.com',
        path,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

  try {
    const { email, userId } = JSON.parse(event.body);
    if (!email || !userId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing email or userId' }) };

    const BASE_URL = 'https://kawan-visa-school.netlify.app';

    // Create Stripe Checkout session
    const session = await stripeRequest('/v1/checkout/sessions', {
      'mode': 'subscription',
      'line_items[0][price]': process.env.STRIPE_PRICE_ID_SCHOOL, // RM14.90/month price ID
      'line_items[0][quantity]': '1',
      'customer_email': email,
      'client_reference_id': userId,            // used in webhook to identify user
      'success_url': `${BASE_URL}/?payment=success`,
      'cancel_url': `${BASE_URL}/?payment=cancelled`,
      'metadata[userId]': userId,
      'metadata[app]': 'kawan-visa-school',
    });

    if (session.status !== 200) {
      console.error('Stripe error:', session.body);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Stripe session creation failed' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ url: session.body.url }) };

  } catch (err) {
    console.error('create-checkout error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
