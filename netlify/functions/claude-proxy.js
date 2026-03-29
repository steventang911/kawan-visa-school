// Netlify Function: claude-proxy
// Proxies requests from Kawan Visa School to Anthropic API
// Keeps API key server-side, never exposed to browser

const https = require('https');

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // CORS headers — allow kawan-visa-school.netlify.app
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const payload = JSON.parse(event.body);

    // Validate required fields
    if (!payload.messages || !payload.model) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing messages or model' }) };
    }

    // Call Anthropic API using Node https (no npm needed)
    const anthropicPayload = JSON.stringify({
      model: payload.model || 'claude-haiku-4-5-20251001',
      max_tokens: payload.max_tokens || 600,
      system: payload.system || '',
      messages: payload.messages,
    });

    const result = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(anthropicPayload),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        }
      );
      req.on('error', reject);
      req.write(anthropicPayload);
      req.end();
    });

    if (result.status !== 200) {
      console.error('Anthropic API error:', result.body);
      return { statusCode: result.status, headers, body: result.body };
    }

    return { statusCode: 200, headers, body: result.body };

  } catch (err) {
    console.error('claude-proxy error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
