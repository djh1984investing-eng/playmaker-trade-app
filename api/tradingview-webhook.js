import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  // Respond immediately to TradingView
  res.status(200).json({ ok: true });

  try {
    const signal = req.body || {};

    await supabase.from("playmaker_signals").insert([
      {
        user_id: signal.user_id || "tradingview",
        symbol: signal.symbol || "MNQ",
        timeframe: signal.timeframe || "",
        signal: signal.signal || "",
        direction: signal.direction || "",
      }
    ]);

  } catch (err) {
    console.log(err);
  }
}