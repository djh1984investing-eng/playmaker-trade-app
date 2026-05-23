export default async function handler(req, res) {
  try {
    const token = req.headers["x-whop-user-token"];

    if (!token) {
      return res.status(401).json({
        ok: false,
        reason: "Missing Whop token",
      });
    }

    return res.status(200).json({
      ok: true,
      reason: "Whop token received",
    });
  } catch (error) {
    console.error("Whop access error:", error);

    return res.status(500).json({
      ok: false,
      reason: "Whop access check failed",
    });
  }
}