const {
  handleCors,
  sendJson,
  ensureAuthorized,
  readBody,
  upsertLearner,
  mergeAttemptIntoLearner,
} = require("../_lib/beason-monitor");

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
    const learner = await upsertLearner(body.user || {});
    let updated = learner;
    if (body?.payload?.attempt?.id) {
      updated = await mergeAttemptIntoLearner(learner, body.payload.attempt);
    }

    sendJson(res, 200, {
      ok: true,
      deactivated: String(updated?.status || "active").toLowerCase() === "deactivated",
      reason: updated?.deactivation_reason || "",
    });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || "Report failed." });
  }
};
