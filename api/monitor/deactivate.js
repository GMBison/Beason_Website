const { handleCors, sendJson, ensureAuthorized, readBody, setLearnerStatus } = require("../_lib/beason-monitor");

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
    const learner = await setLearnerStatus({
      username: body.username,
      hwid: body.hwid,
      reason: body.reason,
      status: "deactivated",
    });
    if (!learner) {
      sendJson(res, 404, { ok: false, error: "Learner not found." });
      return;
    }
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || "Deactivate failed." });
  }
};
