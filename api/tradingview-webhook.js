import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const webhookSecret = process.env.PLAYMAKER_WEBHOOK_SECRET;

const supabase = createClient(supabaseUrl, supabaseKey);

const getSubmittedSecret = (req) => {
  const authSecret = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  return String(
    req.headers["x-playmaker-secret"] ||
    authSecret ||
    req.query?.secret ||
    req.body?.secret ||
    ""
  ).trim();
};

const safeText = (value, fallback = "", maxLength = 120) => {
  const text = String(value || fallback).trim();
  return text.slice(0, maxLength);
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "POST only" });
  }

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ ok: false, message: "Supabase server config is missing" });
  }

  if (!webhookSecret) {
    return res.status(500).json({ ok: false, message: "Webhook secret is not configured" });
  }

  if (getSubmittedSecret(req) !== webhookSecret) {
    return res.status(401).json({ ok: false, message: "Unauthorized webhook" });
  }

  try {
    const signal = req.body || {};

    const { data, error } = await supabase
      .from("playmaker_signals")
      .insert([
        {
          user_id: "tradingview",
          symbol: safeText(signal.symbol, "MNQ", 24).toUpperCase(),
          timeframe: safeText(signal.timeframe || signal.interval, "", 24),
          signal: safeText(signal.signal || signal.setup, "TradingView Signal", 180),
          direction: safeText(signal.direction, "", 24).toUpperCase(),
        }
      ])
      .select();

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.status(200).json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
