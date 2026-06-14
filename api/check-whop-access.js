import Whop from "@whop/sdk";

const whop = new Whop({
  apiKey: process.env.WHOP_API_KEY,
});

export default async function handler(req, res) {
  try {
    const verified = await whop.verifyUserToken(req.headers, {
      dontThrow: true,
    });

    const debug = {
      hasApiKey: Boolean(process.env.WHOP_API_KEY),
      resourceId: process.env.WHOP_RESOURCE_ID || null,
      verified,
      headersSeen: {
        hasWhopToken: Boolean(req.headers["x-whop-user-token"]),
        hasAuthorization: Boolean(req.headers.authorization),
      },
    };

    if (!verified?.userId) {
      return res.status(401).json({
        ok: false,
        reason: "Missing or invalid Whop app token",
        debug,
      });
    }

    const access = await whop.users.checkAccess(
      process.env.WHOP_RESOURCE_ID,
      { id: verified.userId }
    );

    const ok = Boolean(
      access?.hasAccess ||
      access?.accessLevel ||
      access?.valid ||
      access?.authorized
    );

    return res.status(200).json({
      ok,
      reason: ok ? "Whop access verified" : "No active Whop access",
      userId: verified.userId,
      resourceId: process.env.WHOP_RESOURCE_ID,
      access,
      debug,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      reason: "Whop access check failed",
      detail: error?.message || String(error),
      hasApiKey: Boolean(process.env.WHOP_API_KEY),
      resourceId: process.env.WHOP_RESOURCE_ID || null,
    });
  }
}