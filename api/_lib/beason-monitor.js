const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const MONITOR_ADMIN_SECRET = String(process.env.BEASON_MONITOR_SECRET || "").trim();
const TABLE = "beason_monitor_learners";
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

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

function isDeviceHeartbeatUsername(username = "") {
  return String(username || "").trim().toLowerCase().startsWith("device::");
}

function toTimestamp(value) {
  const ts = new Date(value || 0).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function isOnlineFromTimestamp(ts) {
  return !!ts && (Date.now() - ts) <= ONLINE_WINDOW_MS;
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
  const query = `?select=*&or=(${filters.join(",")})&order=last_seen_at.desc.nullslast&limit=1`;
  const rows = await supabaseRequest("GET", query);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function findLearnersByHwid(hwid = "") {
  const normalizedHwid = normalizeHwid(hwid);
  if (!normalizedHwid) return [];
  const rows = await supabaseRequest(
    "GET",
    `?select=*&hwid=eq.${encodeURIComponent(normalizedHwid)}&order=last_seen_at.desc.nullslast`
  );
  return Array.isArray(rows) ? rows : [];
}

async function getDeviceStatus({ username = "", hwid = "" } = {}) {
  const normalizedHwid = normalizeHwid(hwid);
  if (normalizedHwid) {
    const learners = await findLearnersByHwid(normalizedHwid);
    const blockedRow = learners.find((row) => String(row.status || "active").toLowerCase() === "deactivated");
    if (blockedRow) {
      return {
        deactivated: true,
        reason: blockedRow.deactivation_reason || "",
        learner: blockedRow,
      };
    }
    return {
      deactivated: false,
      reason: "",
      learner: learners[0] || null,
    };
  }

  const learner = await findLearner({ username, hwid });
  return {
    deactivated: String(learner?.status || "active").toLowerCase() === "deactivated",
    reason: learner?.deactivation_reason || "",
    learner,
  };
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

  const attemptCount = Math.max(
    Number(learner.attempt_count) || 0,
    currentAttempts.some((item) => item?.id === cleanAttempt.id)
      ? Number(learner.attempt_count) || nextAttempts.length
      : (Number(learner.attempt_count) || 0) + 1
  );
  const bestScore = nextAttempts.reduce(
    (best, item) => Math.max(best, Number(item.scoreOver400) || 0),
    Number(learner.best_score) || 0
  );
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

function buildDeviceSummary(hwid, rows = []) {
  const safeHwid = normalizeHwid(hwid) || "Unknown device";
  const sorted = rows.slice().sort((a, b) => toTimestamp(b.last_seen_at) - toTimestamp(a.last_seen_at));
  const latestSeenAt = sorted.reduce((max, row) => Math.max(max, toTimestamp(row.last_seen_at)), 0);
  const nonHeartbeatRows = sorted.filter((row) => !isDeviceHeartbeatUsername(row.username));
  const blockedRow = sorted.find((row) => String(row.status || "active").toLowerCase() === "deactivated");
  const attempts = nonHeartbeatRows
    .flatMap((row) => Array.isArray(row.recent_attempts) ? row.recent_attempts : [])
    .sort((a, b) => (Number(b.submittedAt) || 0) - (Number(a.submittedAt) || 0));
  const usernames = [...new Set(nonHeartbeatRows.map((row) => row.username).filter(Boolean))];
  const users = nonHeartbeatRows.map((row) => ({
    key: row.id,
    username: row.username || "",
    displayName: row.display_name || buildDisplayName(row),
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    status: row.status || "active",
    attemptCount: Number(row.attempt_count) || 0,
    bestScore: Number(row.best_score) || 0,
    latestScore: Number(row.latest_score) || 0,
    lastSeenAt: toTimestamp(row.last_seen_at),
    attempts: Array.isArray(row.recent_attempts) ? row.recent_attempts : [],
  }));

  return {
    key: safeHwid,
    hwid: safeHwid,
    online: isOnlineFromTimestamp(latestSeenAt),
    deactivated: !!blockedRow,
    deactivationReason: blockedRow?.deactivation_reason || "",
    lastSeenAt: latestSeenAt,
    userCount: users.length,
    usernames,
    stats: {
      attemptCount: users.reduce((sum, row) => sum + (Number(row.attemptCount) || 0), 0),
      bestScore: users.reduce((best, row) => Math.max(best, Number(row.bestScore) || 0), 0),
      latestScore: users.reduce((best, row) => Math.max(best, Number(row.latestScore) || 0), 0),
    },
    users,
    attempts: attempts.slice(0, 40),
  };
}

async function getOverview() {
  const rows = await supabaseRequest(
    "GET",
    "?select=id,username,hwid,display_name,first_name,last_name,status,deactivation_reason,attempt_count,best_score,latest_score,recent_attempts,last_seen_at,license_validated,license_blocked,app_version&order=last_seen_at.desc.nullslast"
  );

  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const hwid = normalizeHwid(row.hwid) || `unknown:${row.id}`;
    if (!grouped.has(hwid)) grouped.set(hwid, []);
    grouped.get(hwid).push(row);
  }

  const devices = Array.from(grouped.entries())
    .map(([hwid, groupRows]) => buildDeviceSummary(hwid, groupRows))
    .sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));

  return {
    ok: true,
    totals: {
      devices: devices.length,
      attempts: devices.reduce((sum, device) => sum + (device.stats?.attemptCount || 0), 0),
      deactivated: devices.filter((device) => device.deactivated).length,
      online: devices.filter((device) => device.online).length,
      offline: devices.filter((device) => !device.online).length,
    },
    devices,
  };
}

async function getDeviceDetail(hwid = "") {
  const normalizedHwid = normalizeHwid(hwid);
  if (!normalizedHwid) {
    throw new Error("HWID is required.");
  }
  const rows = await findLearnersByHwid(normalizedHwid);
  if (!rows.length) {
    return null;
  }
  return buildDeviceSummary(normalizedHwid, rows);
}

async function setLearnerStatus({ username = "", hwid = "", reason = "", status = "active" } = {}) {
  const normalizedHwid = normalizeHwid(hwid);
  const normalizedUsername = normalizeUsername(username);
  const payload = {
    status,
    deactivation_reason: status === "deactivated" ? String(reason || "Misuse detected").trim() : null,
    last_seen_at: new Date().toISOString(),
  };

  if (normalizedHwid) {
    const rows = await supabaseRequest(
      "PATCH",
      `?hwid=eq.${encodeURIComponent(normalizedHwid)}`,
      payload
    );
    return Array.isArray(rows) ? rows : [];
  }

  if (!normalizedUsername) return null;
  const rows = await supabaseRequest(
    "PATCH",
    `?username=eq.${encodeURIComponent(normalizedUsername)}`,
    payload
  );
  return Array.isArray(rows) ? rows : [];
}

module.exports = {
  TABLE,
  ONLINE_WINDOW_MS,
  handleCors,
  sendJson,
  ensureAuthorized,
  readBody,
  findLearner,
  findLearnersByHwid,
  getDeviceStatus,
  upsertLearner,
  mergeAttemptIntoLearner,
  getOverview,
  getDeviceDetail,
  setLearnerStatus,
};
