import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "POST only" });
  }

  try {
    const signal = req.body || {};

    const { data, error } = await supabase
      .from("playmaker_signals")
      .insert([
        {
          user_id: signal.user_id || "tradingview",
          symbol: signal.symbol || "MNQ",
          timeframe: signal.timeframe || signal.interval || "",
          signal: signal.signal || signal.setup || "TradingView Signal",
          direction: signal.direction || "",
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
