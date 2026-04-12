const crypto = require("crypto");

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const SESSION_DAYS = Math.max(Number(process.env.BEASON_ADMIN_SESSION_DAYS) || 14, 1);
const TABLE = "beason_monitor_learners";
const ADMIN_PREFIX = "admin::";
const LICENSE_PREFIX = "license::";

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

function makeLicenseRowUsername(key) {
  return `${LICENSE_PREFIX}${String(key || "").trim().toUpperCase()}`;
}

function parseAdminUsername(rowUsername) {
  return String(rowUsername || "").startsWith(ADMIN_PREFIX) ? String(rowUsername).slice(ADMIN_PREFIX.length) : "";
}

function parseLicenseKey(rowUsername) {
  return String(rowUsername || "").startsWith(LICENSE_PREFIX) ? String(rowUsername).slice(LICENSE_PREFIX.length) : "";
}

function createLicenseKey() {
  const chunks = [];
  for (let index = 0; index < 5; index += 1) {
    chunks.push(crypto.randomBytes(3).toString("hex").toUpperCase());
  }
  return `BEASON-${chunks.join("-")}`;
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
  return {
    id: row.id,
    licenseKey: parseLicenseKey(row.username),
    targetHwid: row.display_name || "",
    generatedBy: row.first_name || "",
    note: row.last_name || "",
    status: row.status || "active",
    generatedAt: row.created_at || null,
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
  const visibleKeys = normalizeRole(user.role) === "owner"
    ? keys
    : keys.filter((item) => normalizeUsername(item.generatedBy) === normalizeUsername(user.username));

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
      visibleKeys: visibleKeys.length,
      resellerCount: users.filter((item) => item.role === "reseller").length,
      pausedResellers: users.filter((item) => item.role === "reseller" && item.status !== "active").length,
    },
    resellers: users
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
      }),
    keys: visibleKeys,
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
  const targetHwid = String(payload.targetHwid || "").trim();
  const note = String(payload.note || "").trim();
  if (!targetHwid) {
    const error = new Error("Target HWID is required.");
    error.statusCode = 400;
    throw error;
  }

  let key = createLicenseKey();
  while (await getRowByUsername(makeLicenseRowUsername(key))) {
    key = createLicenseKey();
  }

  const rows = await supabaseRequest("POST", "", {
    username: makeLicenseRowUsername(key),
    hwid: null,
    display_name: targetHwid,
    first_name: actorUser.username,
    last_name: note || null,
    status: "active",
    deactivation_reason: null,
    attempt_count: 0,
    best_score: 0,
    latest_score: 0,
    recent_attempts: [],
    license_validated: true,
    license_blocked: false,
    app_version: "license",
    last_seen_at: new Date().toISOString(),
  });

  const row = Array.isArray(rows) ? rows[0] : rows;
  const item = mapLicenseRow(row);
  return {
    ok: true,
    key: item,
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
