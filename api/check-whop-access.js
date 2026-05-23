import Whop from "@whop/sdk";

const client = new Whop({
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

    return res.status(200).json({
      ok: true
    });

  } catch (err) {
    console.error(err);

    return res.status(401).json({
      ok:false
    });
  }
}