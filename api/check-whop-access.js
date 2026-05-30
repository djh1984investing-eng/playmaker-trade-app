export default async function handler(req, res) {
  return res.status(200).json({
    ok: false,
    reason: "DEBUG HEADERS",
    headers: req.headers,
  });
}