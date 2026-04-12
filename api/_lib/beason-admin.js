const crypto = require("crypto");

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const SESSION_DAYS = Math.max(Number(process.env.BEASON_ADMIN_SESSION_DAYS) || 14, 1);
const ADMIN_USERS_TABLE = "beason_admin_users";
const ADMIN_SESSIONS_TABLE = "beason_admin_sessions";
const LICENSE_KEYS_TABLE = "beason_license_keys";

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

async function supabaseRequest(table, method, query = "", body) {
  requireSupabaseConfig();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
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

function randomToken(size = 32) {
  return crypto.randomBytes(size).toString("hex");
}

function createLicenseKey() {
  const chunks = [];
  for (let index = 0; index < 5; index += 1) {
    chunks.push(crypto.randomBytes(3).toString("hex").toUpperCase());
  }
  return `BEASON-${chunks.join("-")}`;
}

async function getUserByUsername(username) {
  const normalized = normalizeUsername(username);
  if (!normalized) return null;
  const rows = await supabaseRequest(
    ADMIN_USERS_TABLE,
    "GET",
    `?select=*&username=eq.${encodeURIComponent(normalized)}&limit=1`
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function getUserById(id) {
  if (!id) return null;
  const rows = await supabaseRequest(
    ADMIN_USERS_TABLE,
    "GET",
    `?select=*&id=eq.${encodeURIComponent(id)}&limit=1`
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function ensureDefaultUsers() {
  for (const user of DEFAULT_USERS) {
    const existing = await getUserByUsername(user.username);
    if (existing) continue;
    await supabaseRequest(ADMIN_USERS_TABLE, "POST", "", {
      username: user.username,
      display_name: user.displayName,
      password_hash: user.passwordHash,
      role: user.role,
      status: user.status,
      managed_by: null,
    });
  }
}

async function createSession(user) {
  const token = randomToken(24);
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await supabaseRequest(ADMIN_SESSIONS_TABLE, "POST", "", {
    user_id: user.id,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });
  return { token, expiresAt };
}

async function deleteSessionByToken(token) {
  if (!token) return;
  await supabaseRequest(
    ADMIN_SESSIONS_TABLE,
    "DELETE",
    `?token_hash=eq.${encodeURIComponent(sha256(token))}`
  );
}

function extractBearerToken(req) {
  const header = String(req.headers.authorization || "").trim();
  if (!header.toLowerCase().startsWith("bearer ")) return "";
  return header.slice(7).trim();
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name || user.username,
    role: user.role,
    status: user.status,
    managedBy: user.managed_by || null,
    lastLoginAt: user.last_login_at || null,
    createdAt: user.created_at || null,
  };
}

async function requireAuth(req) {
  const token = extractBearerToken(req);
  if (!token) {
    const error = new Error("Missing session token.");
    error.statusCode = 401;
    throw error;
  }

  const rows = await supabaseRequest(
    ADMIN_SESSIONS_TABLE,
    "GET",
    `?select=*&token_hash=eq.${encodeURIComponent(sha256(token))}&limit=1`
  );
  const session = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!session) {
    const error = new Error("Session expired. Please sign in again.");
    error.statusCode = 401;
    throw error;
  }

  if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) {
    await supabaseRequest(
      ADMIN_SESSIONS_TABLE,
      "DELETE",
      `?id=eq.${encodeURIComponent(session.id)}`
    );
    const error = new Error("Session expired. Please sign in again.");
    error.statusCode = 401;
    throw error;
  }

  const user = await getUserById(session.user_id);
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
  const status = normalizeStatus(user.status);
  if (status !== "active") {
    const error = new Error("This reseller is currently not allowed to generate keys.");
    error.statusCode = 403;
    throw error;
  }
}

async function listUsers() {
  const rows = await supabaseRequest(
    ADMIN_USERS_TABLE,
    "GET",
    "?select=*&order=created_at.asc"
  );
  return Array.isArray(rows) ? rows : [];
}

async function listKeys() {
  const rows = await supabaseRequest(
    LICENSE_KEYS_TABLE,
    "GET",
    "?select=*&order=created_at.desc"
  );
  return Array.isArray(rows) ? rows : [];
}

async function buildOverviewFor(user) {
  const users = await listUsers();
  const keys = await listKeys();
  const visibleKeys = normalizeRole(user.role) === "owner"
    ? keys
    : keys.filter((item) => item.generated_by === user.id);

  return {
    ok: true,
    currentUser: sanitizeUser(user),
    stats: {
      totalKeys: keys.length,
      visibleKeys: visibleKeys.length,
      resellerCount: users.filter((item) => item.role === "reseller").length,
      pausedResellers: users.filter((item) => item.role === "reseller" && item.status !== "active").length,
    },
    resellers: users
      .filter((item) => item.role === "reseller")
      .map((item) => {
        const resellerKeys = keys.filter((key) => key.generated_by === item.id);
        return {
          ...sanitizeUser(item),
          totalKeys: resellerKeys.length,
          recentKeyAt: resellerKeys[0]?.created_at || null,
        };
      }),
    keys: visibleKeys.map((item) => ({
      id: item.id,
      licenseKey: item.license_key,
      targetHwid: item.target_hwid || "",
      note: item.note || "",
      status: item.status || "active",
      generatedBy: item.generated_by_username || "",
      generatedAt: item.created_at || null,
    })),
  };
}

async function login(username, password) {
  await ensureDefaultUsers();
  const user = await getUserByUsername(username);
  if (!user || user.password_hash !== sha256(password)) {
    const error = new Error("Invalid username or password.");
    error.statusCode = 401;
    throw error;
  }

  const status = normalizeStatus(user.status);
  if (status !== "active" && user.role !== "owner") {
    const error = new Error(`This account is ${status} and cannot sign in right now.`);
    error.statusCode = 403;
    throw error;
  }

  await supabaseRequest(
    ADMIN_USERS_TABLE,
    "PATCH",
    `?id=eq.${encodeURIComponent(user.id)}`,
    { last_login_at: new Date().toISOString() }
  );

  const session = await createSession(user);
  return {
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt,
    user: sanitizeUser(user),
  };
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

  const existing = await getUserByUsername(username);
  if (existing) {
    const error = new Error("That username already exists.");
    error.statusCode = 409;
    throw error;
  }

  const rows = await supabaseRequest(ADMIN_USERS_TABLE, "POST", "", {
    username,
    display_name: displayName || username,
    password_hash: sha256(password),
    role: "reseller",
    status: "active",
    managed_by: ownerUser.id,
  });

  return {
    ok: true,
    reseller: sanitizeUser(Array.isArray(rows) ? rows[0] : rows),
  };
}

async function updateReseller(ownerUser, payload = {}) {
  requireOwner(ownerUser);
  const username = normalizeUsername(payload.username);
  const nextStatus = normalizeStatus(payload.status);
  if (!username) {
    const error = new Error("Reseller username is required.");
    error.statusCode = 400;
    throw error;
  }

  const reseller = await getUserByUsername(username);
  if (!reseller || reseller.role !== "reseller") {
    const error = new Error("Reseller not found.");
    error.statusCode = 404;
    throw error;
  }

  const patch = { status: nextStatus };
  if (payload.password) patch.password_hash = sha256(payload.password);
  if (payload.displayName) patch.display_name = String(payload.displayName).trim();

  const rows = await supabaseRequest(
    ADMIN_USERS_TABLE,
    "PATCH",
    `?id=eq.${encodeURIComponent(reseller.id)}`,
    patch
  );

  return {
    ok: true,
    reseller: sanitizeUser(Array.isArray(rows) ? rows[0] : rows),
  };
}

async function generateKey(actorUser, payload = {}) {
  if (normalizeRole(actorUser.role) === "reseller") {
    assertCanGenerate(actorUser);
  }

  const targetHwid = String(payload.targetHwid || "").trim();
  const note = String(payload.note || "").trim();
  if (!targetHwid) {
    const error = new Error("Target HWID is required.");
    error.statusCode = 400;
    throw error;
  }

  const rows = await supabaseRequest(LICENSE_KEYS_TABLE, "POST", "", {
    license_key: createLicenseKey(),
    target_hwid: targetHwid,
    note,
    status: "active",
    generated_by: actorUser.id,
    generated_by_username: actorUser.username,
  });

  const row = Array.isArray(rows) ? rows[0] : rows;
  return {
    ok: true,
    key: {
      id: row.id,
      licenseKey: row.license_key,
      targetHwid: row.target_hwid,
      note: row.note || "",
      status: row.status || "active",
      generatedBy: row.generated_by_username || actorUser.username,
      generatedAt: row.created_at || null,
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
