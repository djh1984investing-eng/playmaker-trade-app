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
    const signal = req.body;

    const { error } = await supabase.from("trade_journal").insert([
      {
        user_id: "tradingview-webhook",
        symbol: signal.symbol || "NQ",
        direction: signal.direction || "Unknown",
        entry_price: Number(signal.price) || null,
        grade: signal.grade || "Auto",
        score: Number(signal.score) || null,
        zone_score: Number(signal.zone_score) || null,
        precision_score: Number(signal.precision_score) || null,
        result: "Unfilled",
        notes: signal.notes || "Auto signal from TradingView",
        confluences: signal.confluences || signal,
        recommendations: signal.recommendations || null,
        screenshots: []
      }
    ]);

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.status(200).json({
      ok: true,
      message: "TradingView signal saved",
      signal
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}