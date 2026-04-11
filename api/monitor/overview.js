const { handleCors, sendJson, ensureAuthorized, getOverview } = require("../_lib/beason-monitor");

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }
  if (!ensureAuthorized(req)) {
    sendJson(res, 401, { ok: false, error: "Unauthorized." });
    return;
  }

  try {
    const overview = await getOverview();
    sendJson(res, 200, overview);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || "Overview failed." });
  }
};
