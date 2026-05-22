import Whop from "@whop/sdk";

const client = new Whop({
  apiKey: process.env.WHOP_API_KEY,
});

export default async function handler(req, res) {
  try {
    const userToken = req.headers["x-whop-user-token"];

    if (!userToken) {
      return res.status(401).json({
        ok: false,
        reason: "Missing Whop user token",
      });
    }

    const user = await client.verifyUserToken(userToken);

    const access = await client.users.checkAccess(
      process.env.WHOP_RESOURCE_ID,
      { id: user.userId }
    );

    return res.status(200).json({
      ok: access.has_access === true,
      userId: user.userId,
      access,
    });
  } catch (error) {
    console.error("Whop access error:", error);

    return res.status(401).json({
      ok: false,
      reason: "Whop access check failed",
    });
  }
}