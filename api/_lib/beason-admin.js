const crypto = require("crypto");

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const ISSUER_PRIVATE_KEY_PEM = String(process.env.BEASON_ISSUER_PRIVATE_KEY_PEM || "").replace(/\\n/g, "\n").trim();
const SESSION_DAYS = Math.max(Number(process.env.BEASON_ADMIN_SESSION_DAYS) || 14, 1);
const TABLE = "beason_monitor_learners";
const ADMIN_PREFIX = "admin::";
const LICENSE_PREFIX = "license::";
const APP_PRODUCT_ID = "BEASON_CBT_PRO";
const APP_PRODUCT_CODE = "BCP";

const DEFAULT_USERS = [
  {
    username: "bison",
    passwordHash: "a91341020dd721b012e46deb8cbd40d5a314905c3267ca9fc8e1d41d7492234c",
    role: "owner",
    status: "active",
    displayName: "Bison",
  },
  {
    username: "hwid",
    passwordHash: "cae5ce2c6070338fbe6af38ada38159c798f19e719c2edcd2bc6bd46c5655acc",
    role: "reseller",
    status: "active",
    displayName: "HWID",
  },
];

const DURATION_PRESETS = {
  "1day": { label: "1 day", days: 1 },
  "1month": { label: "1 month", months: 1 },
  "3months": { label: "3 months", months: 3 },
  "6months": { label: "6 months", months: 6 },
  "1year": { label: "1 year", years: 1 },
};

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["active", "paused", "restricted"].includes(normalized) ? normalized : "active";
}

function normalizeHwid(value) {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function signValue(value) {
  return crypto
    .createHmac("sha256", SUPABASE_SERVICE_ROLE_KEY || "beason-admin")
    .update(String(value || ""))
    .digest("hex");
}

function encodeToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signValue(encoded)}`;
}

function decodeToken(token) {
  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature || signValue(encoded) !== signature) {
    const error = new Error("Session expired. Please sign in again.");
    error.statusCode = 401;
    throw error;
  }

  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (!payload.exp || Number(payload.exp) < Date.now()) {
    const error = new Error("Session expired. Please sign in again.");
    error.statusCode = 401;
    throw error;
  }

  return payload;
}

function makeAdminRowUsername(username) {
  return `${ADMIN_PREFIX}${normalizeUsername(username)}`;
}

function makeLicenseRowUsername(keyId) {
  return `${LICENSE_PREFIX}${String(keyId || "").trim().toLowerCase()}`;
}

function parseAdminUsername(rowUsername) {
  return String(rowUsername || "").startsWith(ADMIN_PREFIX) ? String(rowUsername).slice(ADMIN_PREFIX.length) : "";
}

function getFirstAttempt(row) {
  return Array.isArray(row?.recent_attempts) ? row.recent_attempts[0] || null : null;
}

function maskKey(productKey) {
  if (!productKey) return "";
  const [payloadPart = "", signaturePart = ""] = String(productKey).split(".");
  return `${payloadPart.slice(0, 10)}...${signaturePart.slice(-8)}`;
}

function createRelativeLabel(msRemaining) {
  if (msRemaining <= 0) return "expired";
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const month = 30 * day;
  const year = 365 * day;

  const units = [
    { label: "year", size: year },
    { label: "month", size: month },
    { label: "day", size: day },
    { label: "hour", size: hour },
    { label: "minute", size: minute },
  ];

  for (const unit of units) {
    if (msRemaining >= unit.size) {
      const amount = Math.max(1, Math.floor(msRemaining / unit.size));
      return `${amount} ${unit.label}${amount === 1 ? "" : "s"} left`;
    }
  }

  return "less than a minute left";
}

function addDuration(baseDate, preset) {
  const next = new Date(baseDate.getTime());
  if (preset.days) next.setUTCDate(next.getUTCDate() + preset.days);
  if (preset.months) next.setUTCMonth(next.getUTCMonth() + preset.months);
  if (preset.years) next.setUTCFullYear(next.getUTCFullYear() + preset.years);
  return next;
}

function parseCustomExpiry(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    const error = new Error("Custom expiry is invalid.");
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

function resolveExpiry(payload = {}) {
  const preset = DURATION_PRESETS[String(payload.duration || "").trim()];
  const customExpiry = parseCustomExpiry(payload.customExpiresAt);
  const now = new Date();

  let expiresAt = null;
  let durationLabel = "";

  if (customExpiry) {
    expiresAt = customExpiry;
    durationLabel = "Custom expiry";
  } else if (preset) {
    expiresAt = addDuration(now, preset);
    durationLabel = preset.label;
  } else {
    const error = new Error("Choose a duration or custom expiry.");
    error.statusCode = 400;
    throw error;
  }

  if (expiresAt.getTime() <= Date.now()) {
    const error = new Error("Expiry must be in the future.");
    error.statusCode = 400;
    throw error;
  }

  return {
    expiresAt,
    expiresUnix: Math.floor(expiresAt.getTime() / 1000),
    durationLabel,
  };
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function requireIssuerKey() {
  if (!ISSUER_PRIVATE_KEY_PEM) {
    const error = new Error("Issuer private key env is not configured on the server.");
    error.statusCode = 500;
    throw error;
  }
}

function issueProductKey(targetHwid, expiresUnix, kind = "standard") {
  requireIssuerKey();
  const normalizedHwid = normalizeHwid(targetHwid);
  const nowUnix = Math.floor(Date.now() / 1000);
  const payload = {
    v: 2,
    p: APP_PRODUCT_ID,
    pc: APP_PRODUCT_CODE,
    h: crypto.createHash("sha256").update(normalizedHwid, "utf8").digest("base64url"),
    n: nowUnix,
    nb: nowUnix,
    e: expiresUnix,
    k: kind,
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
  };
  const payloadBlob = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = crypto.sign(null, payloadBlob, ISSUER_PRIVATE_KEY_PEM).toString("base64url");
  return {
    payload,
    productKey: `${payloadBlob.toString("base64url")}.${signature}`,
  };
}

async function getRowByUsername(rowUsername) {
  const rows = await supabaseRequest(
    "GET",
    `?select=*&username=eq.${encodeURIComponent(rowUsername)}&limit=1`
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function listRowsByPrefix(prefix) {
  const rows = await supabaseRequest(
    "GET",
    `?select=*&username=like.${encodeURIComponent(`${prefix}%`)}&order=created_at.asc`
  );
  return Array.isArray(rows) ? rows : [];
}

async function upsertAdminUser({ username, passwordHash, role, status, displayName, managedBy }) {
  const rowUsername = makeAdminRowUsername(username);
  const existing = await getRowByUsername(rowUsername);
  const payload = {
    username: rowUsername,
    hwid: null,
    display_name: String(displayName || username).trim() || username,
    first_name: normalizeRole(role),
    last_name: String(managedBy || "").trim() || null,
    status: normalizeStatus(status),
    deactivation_reason: null,
    attempt_count: 0,
    best_score: 0,
    latest_score: 0,
    recent_attempts: [],
    license_validated: true,
    license_blocked: false,
    app_version: String(passwordHash || "").trim(),
    last_seen_at: new Date().toISOString(),
  };

  if (!existing) {
    const rows = await supabaseRequest("POST", "", payload);
    return Array.isArray(rows) ? rows[0] : rows;
  }

  const rows = await supabaseRequest(
    "PATCH",
    `?id=eq.${encodeURIComponent(existing.id)}`,
    payload
  );
  return Array.isArray(rows) ? rows[0] : existing;
}

async function ensureDefaultUsers() {
  for (const user of DEFAULT_USERS) {
    const existing = await getRowByUsername(makeAdminRowUsername(user.username));
    if (existing) continue;
    await upsertAdminUser(user);
  }
}

function mapAdminRow(row) {
  return {
    id: row.id,
    username: parseAdminUsername(row.username),
    displayName: row.display_name || parseAdminUsername(row.username),
    role: normalizeRole(row.first_name || "reseller"),
    status: normalizeStatus(row.status),
    managedBy: row.last_name || null,
    passwordHash: row.app_version || "",
    lastLoginAt: row.last_seen_at || null,
    createdAt: row.created_at || null,
  };
}

function mapLicenseRow(row) {
  const attempt = getFirstAttempt(row) || {};
  const expiresAt = attempt.expiresAt || null;
  const remainingLabel = createRelativeLabel((expiresAt ? new Date(expiresAt).getTime() : 0) - Date.now());
  return {
    id: row.id,
    keyId: attempt.keyId || String(row.username || "").slice(LICENSE_PREFIX.length),
    targetHwid: attempt.hwid || row.display_name || "",
    generatedBy: attempt.generatedBy || row.first_name || "",
    generatedByDisplayName: attempt.generatedByDisplayName || attempt.generatedBy || row.first_name || "",
    durationLabel: attempt.durationLabel || row.last_name || "Custom expiry",
    expiresAt,
    remainingLabel,
    generatedAt: attempt.issuedAt || row.created_at || null,
    productKey: attempt.productKey || "",
    maskedKey: maskKey(attempt.productKey || ""),
    payload: attempt.payload || null,
    note: attempt.note || null,
  };
}

async function getAdminUser(username) {
  const row = await getRowByUsername(makeAdminRowUsername(username));
  return row ? mapAdminRow(row) : null;
}

async function requireAuth(req) {
  const header = String(req.headers.authorization || "").trim();
  if (!header.toLowerCase().startsWith("bearer ")) {
    const error = new Error("Missing session token.");
    error.statusCode = 401;
    throw error;
  }

  const token = header.slice(7).trim();
  const payload = decodeToken(token);
  const user = await getAdminUser(payload.username);
  if (!user) {
    const error = new Error("User not found.");
    error.statusCode = 401;
    throw error;
  }

  return { token, user };
}

function requireOwner(user) {
  if (normalizeRole(user.role) !== "owner") {
    const error = new Error("Owner access required.");
    error.statusCode = 403;
    throw error;
  }
}

function assertCanGenerate(user) {
  if (normalizeRole(user.role) === "reseller" && normalizeStatus(user.status) !== "active") {
    const error = new Error("This reseller is currently not allowed to generate keys.");
    error.statusCode = 403;
    throw error;
  }
}

async function listAdminUsers() {
  return (await listRowsByPrefix(ADMIN_PREFIX)).map(mapAdminRow);
}

async function listLicenseKeys() {
  return (await listRowsByPrefix(LICENSE_PREFIX))
    .map(mapLicenseRow)
    .sort((a, b) => new Date(b.generatedAt || 0).getTime() - new Date(a.generatedAt || 0).getTime());
}

async function buildOverviewFor(user) {
  const users = await listAdminUsers();
  const keys = await listLicenseKeys();
  const isOwner = normalizeRole(user.role) === "owner";

  return {
    ok: true,
    currentUser: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
      managedBy: user.managedBy,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    },
    stats: {
      totalKeys: keys.length,
      resellerCount: users.filter((item) => item.role === "reseller").length,
      pausedResellers: users.filter((item) => item.role === "reseller" && item.status !== "active").length,
    },
    resellers: isOwner
      ? users
          .filter((item) => item.role === "reseller")
          .map((item) => {
            const resellerKeys = keys.filter((key) => normalizeUsername(key.generatedBy) === normalizeUsername(item.username));
            return {
              id: item.id,
              username: item.username,
              displayName: item.displayName,
              role: item.role,
              status: item.status,
              managedBy: item.managedBy,
              lastLoginAt: item.lastLoginAt,
              createdAt: item.createdAt,
              totalKeys: resellerKeys.length,
              recentKeyAt: resellerKeys[0]?.generatedAt || null,
            };
          })
      : [],
    keys: isOwner ? keys : [],
  };
}

async function login(username, password) {
  await ensureDefaultUsers();
  const user = await getAdminUser(username);
  if (!user || user.passwordHash !== sha256(password)) {
    const error = new Error("Invalid username or password.");
    error.statusCode = 401;
    throw error;
  }

  if (user.role !== "owner" && normalizeStatus(user.status) !== "active") {
    const error = new Error(`This account is ${user.status} and cannot sign in right now.`);
    error.statusCode = 403;
    throw error;
  }

  await upsertAdminUser({
    username: user.username,
    passwordHash: user.passwordHash,
    role: user.role,
    status: user.status,
    displayName: user.displayName,
    managedBy: user.managedBy,
  });

  const token = encodeToken({
    username: user.username,
    exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  });

  return {
    ok: true,
    token,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
      managedBy: user.managedBy,
      lastLoginAt: new Date().toISOString(),
      createdAt: user.createdAt,
    },
  };
}

async function deleteSessionByToken() {
  return true;
}

async function createReseller(ownerUser, payload = {}) {
  requireOwner(ownerUser);
  const username = normalizeUsername(payload.username);
  const password = String(payload.password || "").trim();
  const displayName = String(payload.displayName || username).trim();
  if (!username || !password) {
    const error = new Error("Username and password are required.");
    error.statusCode = 400;
    throw error;
  }

  const existing = await getAdminUser(username);
  if (existing) {
    const error = new Error("That username already exists.");
    error.statusCode = 409;
    throw error;
  }

  const row = await upsertAdminUser({
    username,
    passwordHash: sha256(password),
    role: "reseller",
    status: "active",
    displayName: displayName || username,
    managedBy: ownerUser.username,
  });

  const reseller = mapAdminRow(row);
  return {
    ok: true,
    reseller: {
      id: reseller.id,
      username: reseller.username,
      displayName: reseller.displayName,
      role: reseller.role,
      status: reseller.status,
      managedBy: reseller.managedBy,
      lastLoginAt: reseller.lastLoginAt,
      createdAt: reseller.createdAt,
    },
  };
}

async function updateReseller(ownerUser, payload = {}) {
  requireOwner(ownerUser);
  const username = normalizeUsername(payload.username);
  if (!username) {
    const error = new Error("Reseller username is required.");
    error.statusCode = 400;
    throw error;
  }

  const reseller = await getAdminUser(username);
  if (!reseller || reseller.role !== "reseller") {
    const error = new Error("Reseller not found.");
    error.statusCode = 404;
    throw error;
  }

  const row = await upsertAdminUser({
    username: reseller.username,
    passwordHash: payload.password ? sha256(payload.password) : reseller.passwordHash,
    role: "reseller",
    status: payload.status || reseller.status,
    displayName: payload.displayName || reseller.displayName,
    managedBy: reseller.managedBy || ownerUser.username,
  });

  const next = mapAdminRow(row);
  return {
    ok: true,
    reseller: {
      id: next.id,
      username: next.username,
      displayName: next.displayName,
      role: next.role,
      status: next.status,
      managedBy: next.managedBy,
      lastLoginAt: next.lastLoginAt,
      createdAt: next.createdAt,
    },
  };
}

async function generateKey(actorUser, payload = {}) {
  assertCanGenerate(actorUser);

  const targetHwid = normalizeHwid(payload.targetHwid);
  if (!targetHwid) {
    const error = new Error("Target HWID is required.");
    error.statusCode = 400;
    throw error;
  }

  const note = String(payload.note || "").trim();
  const expiry = resolveExpiry(payload);
  const issued = issueProductKey(targetHwid, expiry.expiresUnix, "standard");
  const issuedAt = new Date().toISOString();
  const keyId = issued.payload.id;

  const logEntry = {
    keyId,
    hwid: targetHwid,
    generatedBy: actorUser.username,
    generatedByDisplayName: actorUser.displayName,
    issuedAt,
    expiresAt: expiry.expiresAt.toISOString(),
    durationLabel: expiry.durationLabel,
    note: note || null,
    productKey: issued.productKey,
    payload: issued.payload,
  };

  const rows = await supabaseRequest("POST", "", {
    username: makeLicenseRowUsername(keyId),
    hwid: targetHwid,
    display_name: targetHwid,
    first_name: actorUser.username,
    last_name: expiry.durationLabel,
    status: "active",
    deactivation_reason: null,
    attempt_count: 0,
    best_score: 0,
    latest_score: 0,
    recent_attempts: [logEntry],
    license_validated: true,
    license_blocked: false,
    app_version: "license",
    last_seen_at: issuedAt,
  });

  const row = Array.isArray(rows) ? rows[0] : rows;
  const item = mapLicenseRow(row);
  return {
    ok: true,
    key: {
      keyId: item.keyId,
      targetHwid: item.targetHwid,
      durationLabel: item.durationLabel,
      expiresAt: item.expiresAt,
      remainingLabel: item.remainingLabel,
      maskedKey: item.maskedKey,
      productKey: item.productKey,
      generatedAt: item.generatedAt,
    },
  };
}

module.exports = {
  handleCors,
  sendJson,
  readBody,
  requireAuth,
  buildOverviewFor,
  login,
  deleteSessionByToken,
  createReseller,
  updateReseller,
  generateKey,
};
