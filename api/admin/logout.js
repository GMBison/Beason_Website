const { handleCors, sendJson, requireAuth, deleteSessionByToken } = require("../_lib/beason-admin");

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const auth = await requireAuth(req);
    await deleteSessionByToken(auth.token);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { ok: false, error: error.message || "Logout failed." });
  }
};
