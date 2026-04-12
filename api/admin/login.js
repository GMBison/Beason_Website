const { handleCors, sendJson, readBody, login } = require("../_lib/beason-admin");

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const body = await readBody(req);
    const result = await login(body.username, body.password);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, error.statusCode || 500, { ok: false, error: error.message || "Login failed." });
  }
};
