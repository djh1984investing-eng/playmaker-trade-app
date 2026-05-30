import Whop from "@whop/sdk";

const whop = new Whop({
  apiKey: process.env.WHOP_API_KEY,
});

export default async function handler(req, res) {
  try {
    const token = req.headers["x-whop-user-token"];

    if (!token) {
      return res.status(401).json({
        ok: false,
        reason: "Missing Whop token",
      });
    }

    const verified = await whop.verifyUserToken(req.headers, {
      dontThrow: true,
    });

    if (!verified?.userId) {
      return res.status(401).json({
        ok: false,
        reason: "Invalid Whop token",
      });
    }

    const access = await whop.users.checkAccess(
      process.env.WHOP_RESOURCE_ID,
      { id: verified.userId }
    );

    return res.status(200).json({
      ok: Boolean(access?.hasAccess || access?.accessLevel),
      reason:
        access?.hasAccess || access?.accessLevel
          ? "Whop access verified"
          : "No active Whop access",
      userId: verified.userId,
    });
  } catch (error) {
    console.error("Whop access error:", error);

    return res.status(500).json({
      ok: false,
      reason: "Whop access check failed",
      detail: error?.message || String(error),
    });
  }
}