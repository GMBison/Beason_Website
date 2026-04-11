const { handleCors, sendJson, ensureAuthorized, readBody, getDeviceDetail } = require("../_lib/beason-monitor");

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
    const body = await readBody(req);
    const device = await getDeviceDetail(body.hwid);
    if (!device) {
      sendJson(res, 404, { ok: false, error: "Device not found." });
      return;
    }
    sendJson(res, 200, { ok: true, device });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || "Could not load device." });
  }
};
