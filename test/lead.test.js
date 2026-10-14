// Zero-dependency tests for api/lead.js: mock req/res objects and a mocked global fetch.
// Run with: npm test
const assert = require('assert');
const handler = require('../api/lead.js');

const ENV = { RESEND_API_KEY: 're_test', LEAD_TO_EMAIL: 'owner@example.com, office@example.com', LEAD_FROM_EMAIL: 'Website <leads@landclearingalbuquerque.com>' };

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: undefined, redirectedTo: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.redirect = (c, url) => { res.statusCode = c; res.redirectedTo = url; return res; };
  return res;
}
let calls = [];
function mockFetch(status = 200, reply = { id: 'email_123' }) {
  calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, opts, body: JSON.parse(opts.body) }); return { ok: status < 300, status, json: async () => reply, text: async () => JSON.stringify(reply) }; };
}
const lead = { first_name: 'Jane', last_name: 'Doe', phone: '505-555-0000', email: 'jane@example.com', address: '87109', project_type: 'Land/lot clearing', property_size: '1–5 acres', property_type: 'Vacant lot', timeframe: 'ASAP', weed_notice: 'Yes', message: 'Lots of <tumbleweeds>' };
const post = (body, accept = 'application/json') => ({ method: 'POST', headers: { accept }, body, query: {} });
const run = async (req) => { const res = mockRes(); await handler(req, res); return res; };
const withEnv = (env) => { for (const k of Object.keys(ENV)) delete process.env[k]; Object.assign(process.env, env); };
console.error = () => {}; // keep expected error logs quiet

const tests = {
  'success sends one email with all fields': async () => {
    withEnv(ENV); mockFetch();
    const res = await run(post({ ...lead }));
    assert.deepStrictEqual([res.statusCode, res.body], [200, { ok: true }]);
    assert.strictEqual(calls.length, 1);
    const b = calls[0].body;
    assert.deepStrictEqual(b.to, ['owner@example.com', 'office@example.com']);
    assert.strictEqual(b.reply_to, 'jane@example.com');
    assert.match(b.subject, /Jane Doe \(Land\/lot clearing\) — HAS WEED NOTICE/);
    for (const v of ['87109', '1–5 acres', 'Vacant lot', 'ASAP', 'Weed/litter notice']) assert.ok(b.text.includes(v), v);
    assert.ok(b.html.includes('&lt;tumbleweeds&gt;'), 'html is escaped');
    assert.strictEqual(calls[0].opts.headers.Authorization, 'Bearer re_test');
  },
  'honeypot pretends success, sends nothing': async () => {
    withEnv(ENV); mockFetch();
    const res = await run(post({ ...lead, company: 'spam inc' }));
    assert.deepStrictEqual([res.statusCode, res.body, calls.length], [200, { ok: true }, 0]);
  },
  'missing name or phone → 400': async () => {
    withEnv(ENV); mockFetch();
    for (const k of ['first_name', 'phone']) {
      const res = await run(post({ ...lead, [k]: '  ' }));
      assert.strictEqual(res.statusCode, 400); assert.strictEqual(res.body.ok, false);
    }
    assert.strictEqual(calls.length, 0);
  },
  'missing env vars → 500, no send': async () => {
    for (const k of Object.keys(ENV)) {
      withEnv({ ...ENV, [k]: '' }); mockFetch();
      const res = await run(post({ ...lead }));
      assert.strictEqual(res.statusCode, 500, k); assert.strictEqual(calls.length, 0);
    }
  },
  'Resend error → 502': async () => {
    withEnv(ENV); mockFetch(403, { message: 'domain not verified' });
    const res = await run(post({ ...lead }));
    assert.deepStrictEqual([res.statusCode, res.body.ok], [502, false]);
  },
  'Resend unreachable → 502': async () => {
    withEnv(ENV); global.fetch = async () => { throw new Error('ECONNRESET'); };
    const res = await run(post({ ...lead }));
    assert.strictEqual(res.statusCode, 502);
  },
  'urlencoded (no-JS) post → 303 to /thank-you/': async () => {
    withEnv(ENV); mockFetch();
    const res = await run(post(new URLSearchParams(lead).toString(), 'text/html'));
    assert.deepStrictEqual([res.statusCode, res.redirectedTo, calls.length], [303, '/thank-you/', 1]);
    assert.strictEqual(calls[0].body.reply_to, 'jane@example.com');
  },
  'no-JS honeypot also redirects': async () => {
    withEnv(ENV); mockFetch();
    const res = await run(post({ ...lead, company: 'x' }, 'text/html'));
    assert.deepStrictEqual([res.statusCode, res.redirectedTo, calls.length], [303, '/thank-you/', 0]);
  },
  'GET without check → 405': async () => {
    const res = await run({ method: 'GET', headers: {}, query: {} });
    assert.strictEqual(res.statusCode, 405);
  },
  '?check reports booleans only, never values': async () => {
    withEnv(ENV); mockFetch();
    const res = await run({ method: 'GET', headers: {}, query: { check: '' } });
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual([res.body.RESEND_API_KEY, res.body.LEAD_TO_EMAIL, res.body.LEAD_FROM_EMAIL, res.body.senderDomain], [true, true, true, 'landclearingalbuquerque.com']);
    assert.ok(!JSON.stringify(res.body).includes('re_test') && !JSON.stringify(res.body).includes('owner@'));
    assert.strictEqual(calls.length, 0);
    withEnv({});
    const empty = await run({ method: 'GET', headers: {}, query: { check: '' } });
    assert.deepStrictEqual([empty.body.RESEND_API_KEY, empty.body.LEAD_TO_EMAIL, empty.body.LEAD_FROM_EMAIL, empty.body.senderDomain], [false, false, false, null]);
  },
  '?check&send only sends to a LEAD_TO_EMAIL address': async () => {
    withEnv(ENV); mockFetch();
    const bad = await run({ method: 'GET', headers: {}, query: { check: '', send: 'attacker@evil.com' } });
    assert.strictEqual(bad.body.testEmail.sent, false); assert.strictEqual(calls.length, 0);
    const good = await run({ method: 'GET', headers: {}, query: { check: '', send: 'Office@Example.com' } });
    assert.strictEqual(good.body.testEmail.sent, true);
    assert.deepStrictEqual(calls.map((c) => c.body.to), [['office@example.com']]);
    assert.deepStrictEqual(good.body.testEmail.resendReply, { id: 'email_123' });
  },
};

(async () => {
  let failed = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try { await fn(); console.log(`✔ ${name}`); } catch (e) { failed++; console.log(`✘ ${name}\n   ${e.message}`); }
  }
  console.log(failed ? `${failed} failed` : `all ${Object.keys(tests).length} passed`);
  process.exit(failed ? 1 : 0);
})();
