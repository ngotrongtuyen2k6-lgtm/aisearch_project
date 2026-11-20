const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { after, test } = require('node:test');

const databasePath = path.join(os.tmpdir(), `verity-load-test-${process.pid}.json`);
process.env.DATABASE_PATH = databasePath;

const db = require('../src/db');
const {
  publicRateLimit,
  loginFailureRateLimit,
  getPublicVerifyLimit,
  setPublicVerifyLimit,
  VERIFY_LIMIT,
  LOGIN_WINDOW_MS,
  LOGIN_FAILURE_LIMIT
} = require('../src/middlewares/rateLimit.middleware');
const {
  analyzeContent,
  MAX_CONCURRENT_ANALYSES
} = require('../src/services/aiVerify.service');
const { updatePrompts, getAllPrompts } = require('../src/services/prompt.service');

after(() => {
  if (fs.existsSync(databasePath)) fs.unlinkSync(databasePath);
});

test('public verification rate limit returns a friendly 429 after five requests', () => {
  const previousLimit = getPublicVerifyLimit();
  setPublicVerifyLimit(VERIFY_LIMIT);
  let nextCount = 0;
  let finalResponse;

  for (let attempt = 1; attempt <= VERIFY_LIMIT + 1; attempt += 1) {
    const response = {
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      status(statusCode) { this.statusCode = statusCode; return this; },
      json(body) { this.body = body; return this; }
    };
    publicRateLimit({ ip: '203.0.113.31', socket: { remoteAddress: '203.0.113.31' } }, response, () => {
      nextCount += 1;
    });
    finalResponse = response;
  }

  setPublicVerifyLimit(previousLimit);
  assert.equal(nextCount, VERIFY_LIMIT);
  assert.equal(finalResponse.statusCode, 429);
  assert.match(finalResponse.body.error, /5 lượt kiểm tra/);
});

test('Admin login blocks an IP after five failures for fifteen minutes', () => {
  const ip = '198.51.100.57';
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex');
  for (let attempt = 0; attempt < LOGIN_FAILURE_LIMIT; attempt += 1) {
    db.recordLoginFailure(ipHash, Date.now(), LOGIN_WINDOW_MS);
  }

  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(statusCode) { this.statusCode = statusCode; return this; },
    json(body) { this.body = body; return this; }
  };
  let nextCalled = false;
  loginFailureRateLimit({ ip, socket: { remoteAddress: ip } }, response, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 429);
  assert.match(response.body.error, /5 lần đăng nhập không thành công/);
  assert.ok(Number(response.headers['Retry-After']) <= 15 * 60);
});

test('concurrent JSON updates preserve records and complete prompt sets', async () => {
  const operations = [];
  for (let index = 0; index < 24; index += 1) {
    operations.push(new Promise(resolve => setImmediate(() => {
      db.recordAnalysis(`analysis-${index}`, 'image', null, 'medium', 'analyzed', new Date().toISOString());
      resolve();
    })));
  }
  for (let index = 0; index < 5; index += 1) {
    operations.push(new Promise(resolve => setImmediate(() => {
      const value = `Prompt version ${index} with enough content for validation.`;
      updatePrompts({ image: value, audio: value, document: value });
      resolve();
    })));
  }
  await Promise.all(operations);

  assert.equal(db.getStats().total, 24);
  const prompts = getAllPrompts();
  assert.equal(prompts.image, prompts.audio);
  assert.equal(prompts.audio, prompts.document);
});

test('AI analysis limits active work and bounds the waiting queue', async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.GEMINI_API_KEY;
  let active = 0;
  let peak = 0;
  process.env.GEMINI_API_KEY = 'test-key';

  global.fetch = async (_url, options) => {
    active += 1;
    peak = Math.max(peak, active);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        active -= 1;
        resolve({
          ok: true,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    aiGeneratedProbability: 50,
                    editedProbability: 25,
                    confidence: 'medium',
                    observedEvidence: ['Test evidence'],
                    hypotheses: ['Test hypothesis'],
                    confidenceReason: 'Test confidence reason'
                  })
                }]
              }
            }]
          })
        });
      }, 20);
      options.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        active -= 1;
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  };

  try {
    const results = await Promise.allSettled(Array.from({ length: 10 }, () =>
      analyzeContent({ type: 'document', text: 'Example text to analyze.' })));
    assert.equal(peak, MAX_CONCURRENT_ANALYSES);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 9);
    const rejected = results.filter(result => result.status === 'rejected');
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.status, 503);
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalApiKey;
  }
});

test('public API validates upload limits and records a successful result', async t => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              aiGeneratedProbability: 20,
              editedProbability: 10,
              confidence: 'high',
              observedEvidence: ['Test evidence'],
              hypotheses: ['Test hypothesis'],
              confidenceReason: 'Test confidence reason'
            })
          }]
        }
      }]
    })
  });

  const app = require('../src/app');
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.close();
    if (server.closeAllConnections) server.closeAllConnections();
    await once(server, 'close');
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalApiKey;
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const validUpload = new FormData();
  validUpload.append('type', 'image');
  validUpload.append('file', new Blob([new Uint8Array(1024)], { type: 'image/png' }), 'sample.png');
  const validResponse = await originalFetch(`${baseUrl}/api/verify`, { method: 'POST', body: validUpload });
  const validBody = await validResponse.json();
  assert.equal(validResponse.status, 200);
  assert.equal(validBody.analysis.aiGeneratedProbability, 20);
  assert.equal(db.getStats().total, 25);

  const disputeResponse = await originalFetch(`${baseUrl}/api/results/analysis-0/dispute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment: 'Please reconsider the available context.' })
  });
  assert.equal(disputeResponse.status, 201);

  const mismatchedUpload = new FormData();
  mismatchedUpload.append('type', 'image');
  mismatchedUpload.append('file', new Blob(['not an image'], { type: 'image/png' }), 'sample.jpg');
  const mismatchResponse = await originalFetch(`${baseUrl}/api/verify`, { method: 'POST', body: mismatchedUpload });
  assert.equal(mismatchResponse.status, 415);

  const oversizedUpload = new FormData();
  oversizedUpload.append('type', 'image');
  oversizedUpload.append('file', new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' }), 'large.png');
  const oversizedResponse = await originalFetch(`${baseUrl}/api/verify`, { method: 'POST', body: oversizedUpload });
  const oversizedBody = await oversizedResponse.json();
  assert.equal(oversizedResponse.status, 413);
  assert.match(oversizedBody.error, /5 MB/);
});
