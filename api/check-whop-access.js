export default async function handler(req, res) {
  res.status(200).json({
    ok: true,
    message: "Whop API route is connected",
    appId: process.env.VITE_WHOP_APP_ID ? "found" : "missing",
    apiKey: process.env.WHOP_API_KEY ? "found" : "missing"
  });
}