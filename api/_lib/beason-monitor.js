const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const MONITOR_ADMIN_SECRET = String(process.env.BEASON_MONITOR_SECRET || "").trim();
const TABLE = "beason_monitor_learners";

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Beason-Secret");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.end(JSON.stringify(payload));
}

function handleCors(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return true;
  }
  return false;
}

function ensureAuthorized(req) {
  const supplied = String(req.headers["x-beason-secret"] || "").trim();
  return !!MONITOR_ADMIN_SECRET && supplied === MONITOR_ADMIN_SECRET;
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeHwid(value) {
  return String(value || "").trim();
}

function buildDisplayName(user = {}) {
  const full = `${String(user.firstName || "").trim()} ${String(user.lastName || "").trim()}`.trim();
  return full || String(user.displayName || "").trim() || String(user.username || "").trim() || "Unknown User";
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function requireSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase environment variables.");
  }
}

async function supabaseRequest(method, query = "", body) {
  requireSupabaseConfig();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}${query}`, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Supabase request failed with ${response.status}.`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function findLearner({ username = "", hwid = "" } = {}) {
  const normalizedUsername = normalizeUsername(username);
  const normalizedHwid = normalizeHwid(hwid);
  if (!normalizedUsername && !normalizedHwid) return null;

  const filters = [];
  if (normalizedUsername) filters.push(`username.eq.${encodeURIComponent(normalizedUsername)}`);
  if (normalizedHwid) filters.push(`hwid.eq.${encodeURIComponent(normalizedHwid)}`);
  const query = `?select=*&or=(${filters.join(",")})&limit=1`;
  const rows = await supabaseRequest("GET", query);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function upsertLearner(user = {}) {
  const existing = await findLearner(user);
  const payload = {
    username: normalizeUsername(user.username),
    hwid: normalizeHwid(user.hwid),
    display_name: buildDisplayName(user),
    first_name: String(user.firstName || "").trim() || null,
    last_name: String(user.lastName || "").trim() || null,
    license_validated: !!user.licenseValidated,
    license_blocked: !!user.licenseBlocked,
    app_version: String(user.appVersion || "").trim() || null,
    last_seen_at: new Date().toISOString(),
  };

  if (!existing) {
    const rows = await supabaseRequest("POST", "", {
      ...payload,
      status: "active",
      deactivation_reason: null,
      attempt_count: 0,
      best_score: 0,
      latest_score: 0,
      recent_attempts: [],
    });
    return Array.isArray(rows) ? rows[0] : rows;
  }

  const rows = await supabaseRequest(
    "PATCH",
    `?id=eq.${encodeURIComponent(existing.id)}`,
    payload
  );
  return Array.isArray(rows) ? rows[0] : existing;
}

function sanitizeAttempt(attempt = {}) {
  return {
    id: String(attempt.id || "").trim(),
    examBody: String(attempt.examBody || "").trim().toLowerCase(),
    modeLabel: String(attempt.modeLabel || "").trim(),
    yearLabel: String(attempt.yearLabel || "").trim(),
    submittedAt: Number(attempt.submittedAt) || Date.now(),
    startedAt: Number(attempt.startedAt) || 0,
    durationSeconds: Number(attempt.durationSeconds) || 0,
    elapsedSeconds: Number(attempt.elapsedSeconds) || 0,
    correct: Number(attempt.correct) || 0,
    attempted: Number(attempt.attempted) || 0,
    total: Number(attempt.total) || 0,
    pct: Number(attempt.pct) || 0,
    scoreOver400: Number(attempt.scoreOver400) || 0,
    userDisplayName: String(attempt.userDisplayName || "").trim(),
  };
}

async function mergeAttemptIntoLearner(learner, attempt = {}) {
  const cleanAttempt = sanitizeAttempt(attempt);
  const currentAttempts = Array.isArray(learner.recent_attempts) ? learner.recent_attempts.slice() : [];
  const nextAttempts = [cleanAttempt, ...currentAttempts.filter((item) => item?.id !== cleanAttempt.id)]
    .sort((a, b) => (Number(b.submittedAt) || 0) - (Number(a.submittedAt) || 0))
    .slice(0, 24);

  const attemptCount = Math.max(Number(learner.attempt_count) || 0, currentAttempts.some((item) => item?.id === cleanAttempt.id)
    ? Number(learner.attempt_count) || nextAttempts.length
    : (Number(learner.attempt_count) || 0) + 1);
  const bestScore = nextAttempts.reduce((best, item) => Math.max(best, Number(item.scoreOver400) || 0), Number(learner.best_score) || 0);
  const latestScore = Number(nextAttempts[0]?.scoreOver400) || 0;

  const rows = await supabaseRequest(
    "PATCH",
    `?id=eq.${encodeURIComponent(learner.id)}`,
    {
      recent_attempts: nextAttempts,
      attempt_count: attemptCount,
      best_score: bestScore,
      latest_score: latestScore,
      last_seen_at: new Date().toISOString(),
    }
  );
  return Array.isArray(rows) ? rows[0] : learner;
}

async function getOverview() {
  const rows = await supabaseRequest(
    "GET",
    "?select=id,username,hwid,display_name,first_name,last_name,status,deactivation_reason,attempt_count,best_score,latest_score,recent_attempts,last_seen_at,license_validated,license_blocked,app_version&order=last_seen_at.desc.nullslast"
  );
  const users = Array.isArray(rows) ? rows : [];
  return {
    ok: true,
    totals: {
      users: users.length,
      attempts: users.reduce((sum, row) => sum + (Number(row.attempt_count) || 0), 0),
      deactivated: users.filter((row) => String(row.status || "active").toLowerCase() === "deactivated").length,
    },
    users: users.map((row) => ({
      key: row.id,
      username: row.username || "",
      hwid: row.hwid || "",
      displayName: row.display_name || buildDisplayName(row),
      status: row.status || "active",
      deactivated: String(row.status || "active").toLowerCase() === "deactivated",
      deactivationReason: row.deactivation_reason || "",
      lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0,
      stats: {
        attemptCount: Number(row.attempt_count) || 0,
        bestScore: Number(row.best_score) || 0,
        latestScore: Number(row.latest_score) || 0,
      },
      attempts: Array.isArray(row.recent_attempts) ? row.recent_attempts : [],
    })),
  };
}

async function setLearnerStatus({ username = "", hwid = "", reason = "", status = "active" } = {}) {
  const learner = await findLearner({ username, hwid });
  if (!learner) return null;
  const rows = await supabaseRequest(
    "PATCH",
    `?id=eq.${encodeURIComponent(learner.id)}`,
    {
      status,
      deactivation_reason: status === "deactivated" ? String(reason || "Misuse detected").trim() : null,
      last_seen_at: new Date().toISOString(),
    }
  );
  return Array.isArray(rows) ? rows[0] : learner;
}

module.exports = {
  TABLE,
  handleCors,
  sendJson,
  ensureAuthorized,
  readBody,
  findLearner,
  upsertLearner,
  mergeAttemptIntoLearner,
  getOverview,
  setLearnerStatus,
};
