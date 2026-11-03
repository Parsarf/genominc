// Offline checks: no real email or network requests are made.
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('enquiry validation, delivery, retry keys and limits', async () => {
  const saved = { ...process.env };
  const originalFetch = global.fetch;
  const sent = [];
  Object.assign(process.env, { RESEND_API_KEY: 'test', INQUIRY_TO: 'test@example.com', INQUIRY_FROM: 'site@example.com' });
  const handler = require('../api/inquiry.js');
  let fail = false;
  global.fetch = async (_url, options) => {
    sent.push(options);
    if (fail) throw new Error('network');
    return { ok: true };
  };
  const valid = { name: 'Test Person', email: 'buyer@example.com', message: 'Please quote ten boxes of test kits.', category: 'diagnostics' };
  const call = async (body = valid, headers = {}, method = 'POST') => {
    const result = { headers: {} };
    const res = {
      status(code) { result.status = code; return this; },
      setHeader(key, value) { result.headers[key] = value; return this; },
      json(body) { result.body = body; },
    };
    await handler({ method, headers: { host: 'genominc.test', ...headers }, body }, res);
    return result;
  };
  try {
    assert.equal((await call(valid, {}, 'GET')).status, 405);
    assert.equal((await call(valid, { origin: 'https://elsewhere.test' })).status, 403);
    assert.equal((await call({ ...valid, email: 'invalid' })).status, 400);
    assert.equal((await call({ ...valid, website: 'spam' })).status, 200);
    assert.equal(sent.length, 0);
    assert.equal((await call()).status, 200);
    assert.equal((await call()).status, 200);
    assert.equal(sent[0].headers['Idempotency-Key'], sent[1].headers['Idempotency-Key']);
    assert.equal(JSON.parse(sent[0].body).reply_to, valid.email);
    await call({ ...valid, message: 'A different enquiry for twenty boxes.' });
    assert.notEqual(sent[1].headers['Idempotency-Key'], sent[2].headers['Idempotency-Key']);
    fail = true;
    assert.equal((await call()).status, 502);
    fail = false;
    assert.equal((await call()).status, 200);
    assert.equal(sent[3].headers['Idempotency-Key'], sent[4].headers['Idempotency-Key']);
    const limited = await call();
    assert.equal(limited.status, 429);
    assert.equal(limited.headers['Retry-After'], '900');
    assert.equal(sent.length, 5);
    assert.equal((await call({ ...valid, email: 'another@example.com' })).status, 200);
    delete process.env.RESEND_API_KEY;
    assert.equal((await call()).status, 503);
  } finally {
    global.fetch = originalFetch;
    for (const key of ['RESEND_API_KEY', 'INQUIRY_TO', 'INQUIRY_FROM']) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  }
});
