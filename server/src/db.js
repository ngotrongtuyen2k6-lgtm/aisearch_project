const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const seedPrompts = require('./config/prompts.json');
const MAX_ANALYSIS_RECORDS = 10000;

const dataPath = process.env.DATABASE_PATH
  ? path.resolve(process.cwd(), process.env.DATABASE_PATH)
  : path.resolve(__dirname, '../data/verity.json');
fs.mkdirSync(path.dirname(dataPath), { recursive: true });

const defaultState = () => ({
  prompts: { ...seedPrompts },
  settings: {
    rateLimitMax: '5',
    rateLimitWindowSeconds: '60'
  },
  analyses: [],
  disputes: [],
  rateBuckets: {},
  loginFailures: {}
});

if (!fs.existsSync(dataPath)) fs.writeFileSync(dataPath, JSON.stringify(defaultState(), null, 2), 'utf8');

function readState() {
  const parsed = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  return {
    ...defaultState(),
    ...parsed,
    prompts: { ...seedPrompts, ...parsed.prompts },
    settings: { ...defaultState().settings, ...parsed.settings },
    analyses: Array.isArray(parsed.analyses) ? parsed.analyses : [],
    disputes: Array.isArray(parsed.disputes) ? parsed.disputes : [],
    rateBuckets: parsed.rateBuckets && typeof parsed.rateBuckets === 'object' ? parsed.rateBuckets : {},
    loginFailures: parsed.loginFailures && typeof parsed.loginFailures === 'object' ? parsed.loginFailures : {}
  };
}

function writeState(state) {
  const temporaryPath = `${dataPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(state), 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, dataPath);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function getSetting(key) {
  const value = readState().settings[key];
  return value == null ? null : String(value);
}

function setSetting(key, value) {
  const state = readState();
  state.settings[key] = String(value);
  writeState(state);
}

function getPrompts() {
  return readState().prompts;
}

function setPrompts(prompts) {
  const state = readState();
  state.prompts = { ...state.prompts, ...prompts };
  writeState(state);
}

function recordAnalysis(id, type, filename, confidence, status, createdAt) {
  const state = readState();
  state.analyses.push({ id, type, filename, confidence, status, createdAt });
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  state.analyses = state.analyses.filter(item => new Date(item.createdAt).getTime() >= cutoff);
  if (state.analyses.length > MAX_ANALYSIS_RECORDS) {
    state.analyses = state.analyses.slice(-MAX_ANALYSIS_RECORDS);
  }
  writeState(state);
}

function addDispute(analysisId, comment, contact, createdAt) {
  const state = readState();
  if (!state.analyses.some(item => item.id === analysisId)) return null;
  const dispute = {
    id: crypto.randomUUID(),
    analysisId,
    comment,
    contact: contact || null,
    createdAt
  };
  state.disputes.push(dispute);
  if (state.disputes.length > 10000) state.disputes = state.disputes.slice(-10000);
  writeState(state);
  return dispute;
}

function cleanupExpiredData() {
  const state = readState();
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  state.analyses = state.analyses.filter(item => new Date(item.createdAt).getTime() >= cutoff);
  if (state.analyses.length > MAX_ANALYSIS_RECORDS) {
    state.analyses = state.analyses.slice(-MAX_ANALYSIS_RECORDS);
  }
  const rateCutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [ipHash, bucket] of Object.entries(state.rateBuckets)) {
    if (bucket.windowStart < rateCutoff) delete state.rateBuckets[ipHash];
  }
  for (const [ipHash, bucket] of Object.entries(state.loginFailures)) {
    if (bucket.windowStart < rateCutoff) delete state.loginFailures[ipHash];
  }
  writeState(state);
}

function consumeRateLimit(ipHash, now, durationMs) {
  const state = readState();
  let bucket = state.rateBuckets[ipHash];
  if (!bucket || bucket.windowStart <= now - durationMs) bucket = { windowStart: now, count: 0 };
  bucket.count += 1;
  state.rateBuckets[ipHash] = bucket;
  for (const [key, value] of Object.entries(state.rateBuckets)) {
    if (value.windowStart < now - 24 * 60 * 60 * 1000) delete state.rateBuckets[key];
  }
  writeState(state);
  return bucket;
}

function getLoginFailures(ipHash, now, durationMs) {
  const bucket = readState().loginFailures[ipHash];
  if (!bucket || bucket.windowStart <= now - durationMs) return { count: 0, windowStart: now };
  return bucket;
}

function recordLoginFailure(ipHash, now, durationMs) {
  const state = readState();
  const staleCutoff = now - 24 * 60 * 60 * 1000;
  for (const [key, value] of Object.entries(state.loginFailures)) {
    if (value.windowStart < staleCutoff) delete state.loginFailures[key];
  }
  let bucket = state.loginFailures[ipHash];
  if (!bucket || bucket.windowStart <= now - durationMs) bucket = { windowStart: now, count: 0 };
  bucket.count += 1;
  state.loginFailures[ipHash] = bucket;
  writeState(state);
  return bucket;
}

function clearLoginFailures(ipHash) {
  const state = readState();
  if (!state.loginFailures[ipHash]) return;
  delete state.loginFailures[ipHash];
  writeState(state);
}

function getStats() {
  const analyses = readState().analyses;
  const byType = {};
  const byConfidence = {};
  for (const item of analyses) {
    byType[item.type] = (byType[item.type] || 0) + 1;
    byConfidence[item.confidence] = (byConfidence[item.confidence] || 0) + 1;
  }
  return {
    total: analyses.length,
    byType,
    byConfidence,
    recent: [...analyses].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50)
  };
}

module.exports = {
  getSetting, setSetting, getPrompts, setPrompts, recordAnalysis,
  addDispute,
  cleanupExpiredData, consumeRateLimit, getLoginFailures,
  recordLoginFailure, clearLoginFailures, getStats
};
