const { handleCors, sendJson, readBody, requireAuth, updateReseller } = require("../_lib/beason-admin");

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const auth = await requireAuth(req);
    const body = await readBody(req);
    const result = await updateReseller(auth.user, body);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, error.statusCode || 500, { ok: false, error: error.message || "Could not update reseller." });
  }
};
