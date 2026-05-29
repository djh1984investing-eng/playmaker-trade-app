import React, { useMemo, useState, useEffect } from "react";
import WhopGate from "./components/WhopGate";
import { supabase } from "./lib/supabaseClient";
const GREEN = "#00d27a";
const GOLD = "#ffcc19";

const startingOptions = [
  "prevWeekLevel",
  "playMakerSignal",
  "prevSessionSTDV",
  "priorSessionSTDV",
  "oneHSTDV",
  "fourHSTDV",
  "retrace15m",
  "retrace1H",
  "retrace4H"
];

const baseWeights = {
  prevWeekLevel: 9,
  lowVolumeNode: 10,
  playMakerSignal: 7.5,
  prevSessionSTDV: 8,
  priorSessionSTDV: 5.5,
  oneHSTDV: 6,
  fourHSTDV: 7,
  retrace15m: 5,
  retrace1H: 6,
  retrace4H: 7,
  orderBlock: 5,
  rejectionBlock: 5,
  fvg: 5,
  prevHighLow: 4,
  ltfVolNode: 7,
  liquidity: 8
};

const stdvChoices = ["0", "0.5", "0.705", "1", "1.5", "2", "2.25", "2.5", "3", "3.5", "4", "4.5", "5", "5.5", "6", "-0.5", "-0.705", "-1", "-1.5", "-2", "-2.25", "-2.5", "-3", "-3.5", "-4", "-4.5", "-5", "-5.5", "-6"];
const retraceChoices = ["None", "0.50", "0.618", "0.705", "0.786"];
const tfChoices = ["5m", "15m", "1H", "4H"];

const n = (v, f = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : f;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isYes = (v) => v === "Yes";
const fmt = (v) => Number(v).toFixed(2);
const parsePrice = (value) => {
  const cleaned = String(value ?? "").replace(/,/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};
const fmtPrice = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "--";
};

const formatEastern = (value) => {
  if (!value) return "--";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short"
  });
};

const arrayFromMaybe = (value) => {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  if (typeof value === "string") {
    const txt = value.trim();
    if (!txt) return [];
    try {
      const parsed = JSON.parse(txt);
      if (Array.isArray(parsed)) return parsed;
    } catch (_err) {}
    return txt.split(",").map((part) => part.trim()).filter(Boolean);
  }
  return [value];
};

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");

const parseYesNo = (value) => {
  const text = String(value ?? "").trim().toLowerCase();
  if (["yes", "true", "1", "y", "on", "bullish", "long", "buy"].includes(text)) return "Yes";
  if (["no", "false", "0", "n", "off", "bearish", "short", "sell"].includes(text)) return "No";
  return null;
};

const normalizeRetrace = (value) => {
  const parsed = parsePrice(value);
  if (parsed === null) return "None";
  const abs = Math.abs(parsed);
  const choices = [0.5, 0.618, 0.705, 0.786];
  const closest = choices.reduce((best, cur) => Math.abs(cur - abs) < Math.abs(best - abs) ? cur : best, choices[0]);
  return closest === 0.5 ? "0.50" : String(closest);
};

const normalizeSTDV = (value) => {
  const parsed = parsePrice(value);
  if (parsed === null) return "0";
  return String(parsed);
};

const normalizeStatus = (value) => String(value ?? "").trim().toLowerCase();

const isOpenOrder = (item) => {
  const result = normalizeStatus(item?.result);
  const orderStatus = normalizeStatus(item?.orderStatus);

  if (["win", "loss", "be", "filled", "reported", "closed", "cancelled", "canceled"].includes(result)) {
    return false;
  }

  if (["filled", "reported", "closed", "cancelled", "canceled"].includes(orderStatus)) {
    return false;
  }

  return result === "unfilled" || result === "edge" || orderStatus === "unfilled" || item?.pendingOrder === true;
};

const sameTradeAnchor = (a, b) => {
  if (!a || !b) return false;

  const aId = String(a.id ?? "");
  const bId = String(b.id ?? "");
  if (aId && bId && aId === bId) return true;

  const aSignal = String(a.signal_id ?? a.ai_signal_id ?? "");
  const bSignal = String(b.signal_id ?? b.ai_signal_id ?? "");
  if (aSignal && bSignal && aSignal === bSignal) return true;

  const aEntry = String(a.entry ?? a.entry_price ?? "").replace(/,/g, "");
  const bEntry = String(b.entry ?? b.entry_price ?? "").replace(/,/g, "");
  const sameEntry = aEntry && bEntry && Number(aEntry) === Number(bEntry);

  const sameDirection = String(a.direction ?? "").toLowerCase() === String(b.direction ?? "").toLowerCase();

  return sameEntry && sameDirection && (isOpenOrder(a) || isOpenOrder(b));
};


function distanceMult(pointsAway) {
  const d = Math.abs(n(pointsAway));
  if (d <= 1) return 1;
  if (d <= 3) return 0.92;
  if (d <= 5) return 0.78;
  if (d <= 7) return 0.55;
  if (d <= 10) return 0.28;
  return 0.12;
}

function stdvMult(v) {
  const num = Math.abs(Number(v));
  if (num >= 4) return 1.45;
  if (num >= 3) return 1.3;
  if (num >= 2) return 1.1;
  if (num >= 1) return 0.9;
  if (num >= 0.705) return 0.75;
  if (num >= 0.5) return 0.6;
  return 0;
}

function retraceMult(v, trend) {
  let m = 0;
  if (v === "0.786") m = 1.25;
  if (v === "0.705") m = 1.15;
  if (v === "0.618") m = 1;
  if (v === "0.50") m = 0.8;
  return trend === "Against Trend" ? m * 1.1 : m;
}

function tfMult(v) {
  if (v === "4H") return 1.25;
  if (v === "1H") return 1;
  if (v === "15m") return 0.75;
  if (v === "5m") return 0.55;
  return 1;
}

function lvnWidthMult(width) {
  const w = n(width);
  if (w >= 100) return 1.35;
  if (w >= 70) return 1.2;
  if (w >= 40) return 1.05;
  if (w >= 20) return 0.85;
  if (w > 0) return 0.7;
  return 0;
}

function grade(score) {
  if (score >= 92) return ["A+", "Elite Setup"];
  if (score >= 84) return ["A", "High Probability"];
  if (score >= 74) return ["B+", "Strong Setup"];
  if (score >= 65) return ["B", "Tradable Setup"];
  if (score >= 55) return ["C", "Needs Confirmation"];
  return ["D", "Wait / Low Quality"];
}

function dirSide(direction) {
  return direction === "Long" ? -1 : 1;
}


const getDefaultForm = () => ({
    tradeEntryPrice: "21450",
    direction: "Long",
    bias1H: "Bullish",
    bias4H: "Bullish",
    trend: "With Trend",

    prevWeekLevelOn: "Yes",
    prevWeekLevelAway: "0",

    lowVolumeNodeOn: "Yes",
    lowVolumeNodeWidth: "100",
    lowVolumeNodeAway: "5",

    playMakerSignalOn: "Yes",
    playMakerSignalAway: "0",

    prevSessionSTDVOn: "No",
    prevSessionSTDVAway: "3",
    prevSessionSTDVValue: "3",

    priorSessionSTDVOn: "No",
    priorSessionSTDVAway: "4",
    priorSessionSTDVValue: "3",

    oneHSTDVOn: "No",
    oneHSTDVAway: "2",
    oneHSTDVValue: "2",

    fourHSTDVOn: "No",
    fourHSTDVAway: "2",
    fourHSTDVValue: "3",

    retrace15mOn: "No",
    retrace15mAway: "2",
    retrace15mValue: "0.705",

    retrace1HOn: "No",
    retrace1HAway: "3",
    retrace1HValue: "0.618",

    retrace4HOn: "No",
    retrace4HAway: "3",
    retrace4HValue: "0.705",

    orderBlockOn: "No",
    orderBlockAway: "4",
    orderBlockTF: "1H",
    orderBlockState: "Fresh",

    rejectionBlockOn: "No",
    rejectionBlockAway: "4",
    rejectionBlockTF: "1H",
    rejectionBlockState: "Fresh",

    fvgOn: "No",
    fvgAway: "4",
    fvgTF: "1H",
    fvgState: "Fresh",

    prevHighLowOn: "No",
    prevHighLowAway: "3",
    prevHighLowTaps: "1",

    ltfVolNodeOn: "No",
    ltfVolNodeAway: "2",

    liquidityOn: "No",

    result: "Unfilled",
    maxMove: "",
    maxDrawdown: "",
    profitLoss: "",
    notes: "",
    tradeImages: []
  });

export default function PlaymakerSetupGrader() {
  const [tab, setTab] = useState("checklist");
  const [journal, setJournal] = useState([]);

  const [user, setUser] = useState(null);
const [authEmail, setAuthEmail] = useState("");
const [authPassword, setAuthPassword] = useState("");
const [authMessage, setAuthMessage] = useState("");
const signUp = async () => {
  const { error } = await supabase.auth.signUp({
    email: authEmail,
    password: authPassword
  });

  setAuthMessage(
    error ? error.message : "Check your email to confirm account."
  );
};

const signIn = async () => {
  const { error } = await supabase.auth.signInWithPassword({
    email: authEmail,
    password: authPassword
  });

  setAuthMessage(
    error ? error.message : "Logged in."
  );
};

const signOut = async () => {
  await supabase.auth.signOut();
};

useEffect(() => {
  supabase.auth.getSession().then(({ data }) => {
    setUser(data.session?.user || null);
  });

  const {
    data: { subscription }
  } = supabase.auth.onAuthStateChange(
    (_event, session) => {
      setUser(session?.user || null);
    }
  );

  return () => subscription?.unsubscribe();
}, []);
  const [aiSignals, setAiSignals] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiFetchMessage, setAiFetchMessage] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [startingLevel, setStartingLevel] = useState("playMakerSignal");
  const [aiSettings, setAiSettings] = useState({
    volumeCraterTop: "",
    volumeCraterBottom: "",
    weeklyLevelPrice: "",
    weeklyLevelName: "",
    craterBoxName: "",
    autoUseIndicator: "Yes"
  });
  const [aiLevels, setAiLevels] = useState([]);
  const [editingWeeklyLevelId, setEditingWeeklyLevelId] = useState(null);
  const [editingCraterBoxId, setEditingCraterBoxId] = useState(null);
  const [aiLevelMessage, setAiLevelMessage] = useState("");
  const [form, setForm] = useState(getDefaultForm());

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const setStart = (key) => {
    setStartingLevel((cur) => (cur === key ? "" : key));
    const awayKey = `${key}Away`;
    if (awayKey in form) set(awayKey, "0");
  };

  const away = (key) => (startingLevel === key ? 0 : n(form[`${key}Away`]));
  const canStart = (key) => startingOptions.includes(key);
  const startDisabled = (key) => startingLevel && startingLevel !== key;

  const weeklyLevels = aiLevels.filter((level) => level.level_type === "weekly");
  const craterBoxes = aiLevels.filter((level) => level.level_type === "crater");

  const currentCraterTop = parsePrice(aiSettings.volumeCraterTop);
  const currentCraterBottom = parsePrice(aiSettings.volumeCraterBottom);
  const aiCraterSize = currentCraterTop !== null && currentCraterBottom !== null
    ? Math.abs(currentCraterTop - currentCraterBottom)
    : 0;
  const aiCraterMid = currentCraterTop !== null && currentCraterBottom !== null
    ? (currentCraterTop + currentCraterBottom) / 2
    : 0;
  const aiCraterAway = aiCraterMid && form.tradeEntryPrice
    ? Math.abs(aiCraterMid - n(form.tradeEntryPrice))
    : 0;
  const currentWeeklyPrice = parsePrice(aiSettings.weeklyLevelPrice);
  const aiWeeklyAway = currentWeeklyPrice !== null && form.tradeEntryPrice
    ? Math.abs(currentWeeklyPrice - n(form.tradeEntryPrice))
    : 0;

  const automationOn = aiSettings.autoUseIndicator === "Yes";
  const hasTradeEntry = parsePrice(form.tradeEntryPrice) !== null;

  const aiChecklist = [
    {
      item: "Saved weekly levels",
      value: weeklyLevels.length,
      needed: "Manual weekly pillar zones",
      ready: weeklyLevels.length > 0,
      status: weeklyLevels.length > 0 ? "Ready" : "Needed"
    },
    {
      item: "Saved crater boxes",
      value: craterBoxes.length,
      needed: "Manual crater box pillar zones",
      ready: craterBoxes.length > 0,
      status: craterBoxes.length > 0 ? "Ready" : "Needed"
    },
    {
      item: "Draft crater input",
      value: aiCraterSize ? `${fmt(aiCraterSize)} pts wide / Mid ${fmtPrice(aiCraterMid)}` : "Optional — saved crater boxes already loaded",
      needed: craterBoxes.length > 0 ? "Not required. Only type here when adding or editing a crater box." : "Add at least one crater box pillar zone.",
      ready: craterBoxes.length > 0 || aiCraterSize > 0,
      status: craterBoxes.length > 0 ? "Optional" : (aiCraterSize > 0 ? "Ready" : "Needed")
    },
    {
      item: "Draft weekly input",
      value: currentWeeklyPrice !== null ? fmtPrice(currentWeeklyPrice) : "Optional — saved weekly levels already loaded",
      needed: weeklyLevels.length > 0 ? "Not required. Only type here when adding or editing a weekly level." : "Add at least one weekly level pillar zone.",
      ready: weeklyLevels.length > 0 || currentWeeklyPrice !== null,
      status: weeklyLevels.length > 0 ? "Optional" : (currentWeeklyPrice !== null ? "Ready" : "Needed")
    },
    {
      item: "Entry source",
      value: automationOn ? "Auto from TradingView alert" : (hasTradeEntry ? fmtPrice(parsePrice(form.tradeEntryPrice)) : "Manual entry needed"),
      needed: automationOn ? "No manual entry needed. TradingView supplies the trade price when an alert fires." : "Manual mode needs an entry price typed before scoring.",
      ready: automationOn || hasTradeEntry,
      status: automationOn ? "Auto" : (hasTradeEntry ? "Ready" : "Needed")
    },
    {
      item: "Indicator automation",
      value: aiSettings.autoUseIndicator,
      needed: "Lets webhook signals combine with saved AI pillar zones",
      ready: true,
      status: aiSettings.autoUseIndicator === "Yes" ? "Ready" : "Manual"
    }
  ];

  const fetchAiLevels = async () => {
    if (!user) return;

    const { data, error } = await supabase
      .from("ai_levels")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("AI levels fetch error:", error);
      setAiLevelMessage("AI levels failed to load. Check Supabase ai_levels table.");
    } else {
      setAiLevels(data || []);
    }
  };

  const fetchAiSignals = async () => {
    setAiLoading(true);
    setAiFetchMessage("");
    const { data, error } = await supabase
      .from("playmaker_signals")
      .select("*")
      .eq("user_id", "djh1984investing-eng")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("AI signal fetch error:", error);
      setAiFetchMessage("AI fetch failed. Check Supabase table/settings.");
    } else {
      setAiSignals(data || []);
      setAiFetchMessage((data || []).length ? `Fetched ${(data || []).length} AI signals.` : "No AI signals found yet.");
    }
    setAiLoading(false);
  };

  useEffect(() => {
    const fetchSavedJournal = async () => {
      if (!user) return;
      const { data, error } = await supabase
        .from("trade_journal")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
        if (!error && data) {
        setJournal(data.map((row) => ({
          id: row.id || Date.now(),
          date: row.created_at ? new Date(row.created_at).toLocaleDateString() : new Date().toLocaleDateString(),
          direction: row.direction || "",
          entry: row.entry_price || "",
          grade: row.grade || "",
          score: row.score || 0,
          result: row.result || "Unfilled",
          orderStatus: row.result === "Unfilled" ? "Unfilled" : "Reported",
          pendingOrder: row.result === "Unfilled",
          maxMove: row.max_move || "",
          maxDrawdown: row.max_drawdown || "",
          profitLoss: row.profit_loss || "",
          notes: row.notes || "",
          tradeImages: row.screenshots || [],
          top: Array.isArray(row.confluences) ? row.confluences.map((r) => r.name).join(", ") : "",
          signal_id: row.signal_id || row.ai_signal_id || "",
          sourceType: row.notes?.includes("AI Signal:") ? "AI Signal" : "Manual Order",
          evidence: Array.isArray(row.confluences) ? row.confluences : [],
          formSnapshot: row.confluences ? { evidence: row.confluences } : null
        })));
      }
    };

        
    fetchSavedJournal();
    fetchAiSignals();
    fetchAiLevels();
  }, [user]);

  const resetAiLevelInputs = () => {
    setAiSettings((s) => ({
      ...s,
      weeklyLevelName: "",
      weeklyLevelPrice: "",
      craterBoxName: "",
      volumeCraterTop: "",
      volumeCraterBottom: ""
    }));
    setEditingWeeklyLevelId(null);
    setEditingCraterBoxId(null);
  };

  const saveWeeklyLevel = async () => {
  
  if (!user) {
      alert("Please log in before saving AI levels.");
      return;
    }

    const price = parsePrice(aiSettings.weeklyLevelPrice);
    if (price === null || price <= 0) {
      alert("Enter a valid weekly level price.");
      return;
    }

    const payload = {
      user_id: user.id,
      level_type: "weekly",
      name: aiSettings.weeklyLevelName || "Weekly Level",
      price,
      top_price: null,
      bottom_price: null
    };

    if (editingWeeklyLevelId) {
      const { error } = await supabase
        .from("ai_levels")
        .update(payload)
        .eq("id", editingWeeklyLevelId)
        .eq("user_id", user.id);

      if (error) {
        console.error("Weekly level update error:", error);
        alert("Weekly level did not update.");
        return;
      }

      setAiLevels((levels) => levels.map((level) => level.id === editingWeeklyLevelId ? { ...level, ...payload } : level));
      setAiLevelMessage("Weekly level updated.");
    } else {
      const { data, error } = await supabase
        .from("ai_levels")
        .insert([payload])
        .select("*")
        .single();

      if (error) {
        console.error("Weekly level save error:", error);
        alert("Weekly level did not save.");
        return;
      }

      setAiLevels((levels) => [data, ...levels]);
      setAiLevelMessage("Weekly level saved.");
    }

    setAiSettings((s) => ({ ...s, weeklyLevelName: "", weeklyLevelPrice: "" }));
    setEditingWeeklyLevelId(null);
  };

  const saveCraterBox = async () => {
    if (!user) {
      alert("Please log in before saving crater boxes.");
      return;
    }

    const top = parsePrice(aiSettings.volumeCraterTop);
    const bottom = parsePrice(aiSettings.volumeCraterBottom);

    if (top === null || bottom === null || top <= 0 || bottom <= 0) {
      alert("Enter valid crater top and bottom prices.");
      return;
    }

    if (top === bottom) {
      alert("Crater top and bottom cannot be the same price.");
      return;
    }

    const high = Math.max(top, bottom);
    const low = Math.min(top, bottom);
    const payload = {
      user_id: user.id,
      level_type: "crater",
      name: aiSettings.craterBoxName || "Crater Box",
      price: null,
      top_price: high,
      bottom_price: low
    };

    if (editingCraterBoxId) {
      const { error } = await supabase
        .from("ai_levels")
        .update(payload)
        .eq("id", editingCraterBoxId)
        .eq("user_id", user.id);

      if (error) {
        console.error("Crater box update error:", error);
        alert("Crater box did not update.");
        return;
      }

      setAiLevels((levels) => levels.map((level) => level.id === editingCraterBoxId ? { ...level, ...payload } : level));
      setAiLevelMessage("Crater box updated.");
    } else {
      const { data, error } = await supabase
        .from("ai_levels")
        .insert([payload])
        .select("*")
        .single();

      if (error) {
        console.error("Crater box save error:", error);
        alert("Crater box did not save.");
        return;
      }

      setAiLevels((levels) => [data, ...levels]);
      setAiLevelMessage("Crater box saved.");
    }

    setAiSettings((s) => ({ ...s, craterBoxName: "", volumeCraterTop: "", volumeCraterBottom: "" }));
    setEditingCraterBoxId(null);
  };

  const editWeeklyLevel = (level) => {
    setEditingWeeklyLevelId(level.id);
    setEditingCraterBoxId(null);
    setAiSettings((s) => ({
      ...s,
      weeklyLevelName: level.name || "Weekly Level",
      weeklyLevelPrice: level.price ? String(level.price) : ""
    }));
    setAiLevelMessage("Editing weekly level.");
  };

  const editCraterBox = (box) => {
    setEditingCraterBoxId(box.id);
    setEditingWeeklyLevelId(null);
    setAiSettings((s) => ({
      ...s,
      craterBoxName: box.name || "Crater Box",
      volumeCraterTop: box.top_price ? String(box.top_price) : "",
      volumeCraterBottom: box.bottom_price ? String(box.bottom_price) : ""
    }));
    setAiLevelMessage("Editing crater box.");
  };

  const deleteAiLevel = async (level) => {
    if (!user) return;

    const { error } = await supabase
      .from("ai_levels")
      .delete()
      .eq("id", level.id)
      .eq("user_id", user.id);

    if (error) {
      console.error("AI level delete error:", error);
      alert("Delete failed.");
      return;
    }

    setAiLevels((levels) => levels.filter((item) => item.id !== level.id));
    if (editingWeeklyLevelId === level.id || editingCraterBoxId === level.id) {
      resetAiLevelInputs();
    }
    setAiLevelMessage("AI level deleted.");
  };

  const submitAiSettings = async () => {
    await Promise.all([
      aiSettings.weeklyLevelPrice ? saveWeeklyLevel() : Promise.resolve(),
      (aiSettings.volumeCraterTop || aiSettings.volumeCraterBottom) ? saveCraterBox() : Promise.resolve()
    ]);
  };

  const isRecentSignal = (createdAt) => {
    if (!createdAt) return false;
    const diffDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
    return diffDays <= 7;
  };

  const signalHasJournal = (signal) => {
    const signalId = String(signal.id || "");
    const signalName = String(signal.signal || "").toLowerCase();
    return journal.some((j) => {
      const journalSignalId = String(j.signal_id || j.ai_signal_id || "");
      const journalNotes = String(j.notes || "").toLowerCase();
      const journalTop = String(j.top || "").toLowerCase();
      return (signalId && journalSignalId === signalId) || (signalName && (journalNotes.includes(signalName) || journalTop.includes(signalName)));
    });
  };

  const unfilledAiSignals = aiSignals.filter((signal) => !signalHasJournal(signal));


  const getSignalPayload = (signal) => ({
    ...(signal?.raw && typeof signal.raw === "object" ? signal.raw : {}),
    ...signal
  });

  const normalizeDirection = (value, fallbackSignal = "") => {
    const direct = String(value || "").trim().toLowerCase();
    if (["both", "neutral", "level", "levels"].includes(direct)) return "Both";

    const text = String(value || fallbackSignal || "").toLowerCase();
    if (text.includes("short") || text.includes("sell") || text.includes("bearish") || text.includes("top")) return "Short";
    if (text.includes("long") || text.includes("buy") || text.includes("bullish") || text.includes("bottom")) return "Long";
    return "Long";
  };

  const deviationStrength = (name) => {
    const match = String(name || "").match(/(-?\d+(?:_\d+)?|-?\d+(?:\.\d+)?)/);
    if (!match) return 0;
    const value = Math.abs(Number(match[1].replace("_", ".")));

    // Manual-style weighting:
    // ±3 is where the level becomes a serious candidate.
    // ±4 and beyond are premium reaction zones.
    // ±5 to ±6 are elite, but they still need another level nearby before being promoted.
    if (value >= 6) return 58;
    if (value >= 5.5) return 54;
    if (value >= 5) return 50;
    if (value >= 4.5) return 45;
    if (value >= 4) return 40;
    if (value >= 3.5) return 35;
    if (value >= 3) return 30;
    if (value >= 2.5) return 18;
    if (value >= 2) return 14;
    if (value >= 1.5) return 10;
    if (value >= 1) return 7;
    if (value >= 0.705) return 5;
    if (value >= 0.5) return 3;
    return 0;
  };

  const deviationValueFromLabel = (label) => {
    const match = String(label || "").match(/(-?\d+(?:_\d+)?|-?\d+(?:\.\d+)?)/);
    if (!match) return 0;
    return Number(match[1].replace("_", "."));
  };

  const isMajorDeviationLabel = (label) => Math.abs(deviationValueFromLabel(label)) >= 3;

  const aiGrade = (score) => {
    if (score >= 92) return "A+";
    if (score >= 84) return "A";
    if (score >= 74) return "B+";
    if (score >= 65) return "B";
    if (score >= 55) return "C";
    return "D";
  };

  const sessionRankLimit = 5;

  const scoreDistance = (distance, tight, medium, wide) => {
    if (!Number.isFinite(distance)) return 0;
    if (distance <= tight) return 1;
    if (distance <= medium) return 0.72;
    if (distance <= wide) return 0.42;
    return 0;
  };

  const nearestWeeklyToPrice = (price) => {
    const entry = parsePrice(price);
    if (entry === null || weeklyLevels.length === 0) return null;
    return weeklyLevels
      .map((level) => ({
        ...level,
        anchorType: "Previous Week Level",
        anchorPrice: Number(level.price),
        distance: Math.abs(Number(level.price) - entry)
      }))
      .filter((level) => Number.isFinite(level.anchorPrice) && Number.isFinite(level.distance))
      .sort((a, b) => a.distance - b.distance)[0] || null;
  };

  const nearestCraterToPrice = (price) => {
    const entry = parsePrice(price);
    if (entry === null || craterBoxes.length === 0) return null;
    return craterBoxes
      .map((box) => {
        const top = Number(box.top_price);
        const bottom = Number(box.bottom_price);
        if (!Number.isFinite(top) || !Number.isFinite(bottom) || top <= 0 || bottom <= 0 || top === bottom) return null;
        const high = Math.max(top, bottom);
        const low = Math.min(top, bottom);
        const mid = (high + low) / 2;
        const width = Math.abs(high - low);
        const inside = entry <= high && entry >= low;
        return {
          ...box,
          anchorType: "Volume Crater / LVN",
          anchorPrice: inside ? entry : mid,
          high,
          low,
          mid,
          width,
          inside,
          distance: inside ? 0 : Math.min(Math.abs(entry - high), Math.abs(entry - low), Math.abs(entry - mid))
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance)[0] || null;
  };

  // Cluster tolerance: levels within 20 points are treated as one tradable zone.
  // Precision scoring then decides whether that zone is tight enough for 7/10/15 pt stops.
  const levelMergeTolerance = 20;

  const getLevelKey = (price) => {
    const parsed = parsePrice(price);
    if (parsed === null) return "na";
    return String(Math.round(parsed / 5) * 5);
  };


  const uniqueSortedPrices = (items) => {
    const seen = new Set();
    return items
      .map((item) => parsePrice(item.price))
      .filter((price) => price !== null && price > 0)
      .sort((a, b) => a - b)
      .filter((price) => {
        const key = String(Math.round(price * 4) / 4);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };

  const clusterPrecisionFromWidth = (width) => {
    const w = Math.abs(n(width));
    if (w <= 5) return 100;
    if (w <= 10) return 90;
    if (w <= 15) return 80;
    if (w <= 20) return 70;
    if (w <= 30) return 55;
    return 40;
  };

  const clusterStatusFromWidth = (width) => {
    const w = Math.abs(n(width));
    if (w <= 5) return "PINPOINT LIMIT CLUSTER";
    if (w <= 10) return "TIGHT LIMIT CLUSTER";
    if (w <= 20) return "TRADABLE LIMIT CLUSTER";
    if (w <= 30) return "WIDE WATCHLIST CLUSTER";
    return "TOO WIDE / SPLIT ZONE";
  };

  const buildStopPlansForCluster = (direction, low, high, center) => {
    const width = Math.max(0, high - low);
    const halfWidth = width / 2;
    const buffer = 2;
    const dir = String(direction || "").toLowerCase();
    const isShort = dir.includes("short");
    return [7, 10, 15].map((stop) => {
      const needed = halfWidth + buffer;
      const valid = stop >= needed;
      // Wider stops can use the cluster center. Tight stops get an adjusted limit
      // closer to the outside edge so the stop still clears the full cluster.
      const edgeAdjustedLimit = isShort ? high - Math.max(0, stop - buffer) : low + Math.max(0, stop - buffer);
      const limit = valid ? center : edgeAdjustedLimit;
      const stopArea = isShort ? limit + stop : limit - stop;
      return {
        stop,
        limit,
        stopArea,
        valid,
        neededStop: needed,
        confidence: valid ? (stop <= 7 ? "Pinpoint" : stop <= 10 ? "Tight" : "Best Fit") : "Too Tight",
        note: valid
          ? `Center limit from ${fmt(width)} pt cluster.`
          : `Center is too tight for this stop. Adjusted limit toward edge; cluster needs about ${fmt(needed)} pts for center entry.`
      };
    });
  };

  const deviationAbsFromLabel = (label) => {
    const match = String(label || "").match(/[-+]?\d+(?:\.\d+)?/);
    return match ? Math.abs(Number(match[0])) : 0;
  };

  const deviationEvidenceScore = (label) => {
    const value = deviationAbsFromLabel(label);
    if (value >= 6) return 52;
    if (value >= 5.5) return 48;
    if (value >= 5) return 44;
    if (value >= 4.5) return 40;
    if (value >= 4) return 36;
    if (value >= 3.5) return 31;
    if (value >= 3) return 26;
    if (value >= 2.5) return 16;
    if (value >= 2) return 12;
    if (value >= 1.5) return 9;
    if (value >= 1) return 6;
    if (value >= 0.705) return 4;
    if (value >= 0.5) return 3;
    return 0;
  };

  const timeframeFromPayload = (payload, fallback = "") => {
    const raw = String(firstDefined(payload.timeframe, payload.interval, payload.tf, fallback) || "").toUpperCase();
    if (raw === "D" || raw.includes("DAILY") || raw.includes("1D")) return "D";
    if (raw.includes("240") || raw.includes("4H")) return "4H";
    if (raw.includes("60") || raw.includes("1H")) return "1H";
    if (raw.includes("15")) return "15m";
    if (raw.includes("5")) return "5m";
    return "";
  };

  const structureEvidenceScore = (payload, fallback, type) => {
    const tf = timeframeFromPayload(payload, fallback);
    const isRB = String(type || "").toUpperCase().includes("REJECTION");
    if (tf === "4H") return isRB ? 18 : 20;
    if (tf === "1H") return isRB ? 13 : 15;
    if (tf === "15m") return isRB ? 5 : 6;
    if (tf === "5m") return 0;
    return isRB ? 8 : 9;
  };

  const craterQualityScore = (crater) => {
    if (!crater) return 0;
    const width = n(crater.width);
    const widthScore = width >= 120 ? 28 : width >= 80 ? 24 : width >= 50 ? 18 : width >= 25 ? 12 : 7;
    const locationScore = crater.inside ? 18 : 16 * scoreDistance(crater.distance, 3, 7, 15);
    return widthScore + locationScore;
  };

  const buildLevelEvidenceCandidates = (signal) => {
    const payload = getSignalPayload(signal);
    const signalName = String(payload.signal || payload.setup || signal.signal || "AI Signal");
    const type = signalName.toUpperCase();
    const session = String(payload.session || payload.session_name || payload.timeframe || signal.timeframe || "GLOBAL");
    const triggerPrice = parsePrice(firstDefined(payload.trigger_price, payload.price, payload.entry, payload.entry_price, signal.price));
    const created = signal.created_at || payload.created_at;
    const base = { sourceSignal: signal, payload, sourceId: signal.id || payload.id || created || signalName, created_at: created, session, triggerPrice, signalName };

    const make = (price, label, direction, sourceType, evidenceScore = 0, evidenceClass = "support") => {
      const parsed = parsePrice(price);
      if (parsed === null || parsed <= 0) return null;
      return { ...base, price: parsed, label, direction: normalizeDirection(direction, signalName), sourceType, evidenceScore, evidenceClass, levelKey: getLevelKey(parsed) };
    };

    const candidates = [];
    const push = (candidate) => { if (candidate) candidates.push(candidate); };

    if (type.includes("SESSION_DEVIATION")) {
      const levels = [
        ["-6", payload.neg_6], ["-5.5", payload.neg_5_5], ["-5", payload.neg_5], ["-4.5", payload.neg_4_5], ["-4", payload.neg_4], ["-3.5", payload.neg_3_5], ["-3", payload.neg_3], ["-2.5", payload.neg_2_5], ["-2", payload.neg_2], ["-1.5", payload.neg_1_5], ["-1", payload.neg_1], ["-0.786", payload.neg_0786], ["-0.705", payload.neg_0705], ["-0.618", payload.neg_0618], ["-0.5", payload.neg_05],
        ["+0.5", payload.pos_05], ["+0.618", payload.pos_0618], ["+0.705", payload.pos_0705], ["+0.786", payload.pos_0786], ["+1", payload.pos_1], ["+1.5", payload.pos_1_5], ["+2", payload.pos_2], ["+2.5", payload.pos_2_5], ["+3", payload.pos_3], ["+3.5", payload.pos_3_5], ["+4", payload.pos_4], ["+4.5", payload.pos_4_5], ["+5", payload.pos_5], ["+5.5", payload.pos_5_5], ["+6", payload.pos_6]
      ];
      const tf = timeframeFromPayload(payload, signalName) || String(payload.timeframe || signal.timeframe || "5m");
      const tfWeight = tf === "D" ? 1.7 : tf === "4H" ? 1.8 : tf === "1H" ? 1.45 : tf === "15m" ? 1.15 : 1;
      levels.forEach(([name, value]) => {
        const dir = String(name).startsWith("-") ? "Long" : "Short";
        const abs = deviationAbsFromLabel(name);
        const family = tf === "D" ? "Daily STDV" : tf === "4H" ? "4H STDV" : tf === "1H" ? "1H STDV" : tf === "15m" ? "15m STDV" : "5m Session STDV";
        push(make(value, `${family} ${session} ${name}`, dir, abs >= 3 ? "Major Session Deviation" : "Session Deviation", deviationEvidenceScore(name) * tfWeight, abs >= 3 || tf === "D" || tf === "4H" || tf === "1H" ? "anchor" : "support"));
      });
    }

    if (type.includes("CONFLUENCE")) {
      const price = firstDefined(payload.confluence_price, payload.htf_confluence_price, payload.price, payload.trigger_price);
      const count = n(firstDefined(payload.confluence_count, payload.matches, payload.count, payload.htfConfluenceCount), 1);
      push(make(price, `PlayMaker confluence ${payload.sources || payload.confluence_sources || payload.matches || ""}`.trim(), payload.direction, "PlayMaker Confluence", 26 + Math.min(24, count * 6), "major"));
    }

    if (type.includes("ORDER_BLOCK") || type.includes("ORDER BLOCK")) {
      const high = parsePrice(firstDefined(payload.high, payload.ob_high, payload.top, payload.block_top));
      const low = parsePrice(firstDefined(payload.low, payload.ob_low, payload.bottom, payload.block_bottom));
      const ce = parsePrice(firstDefined(payload.ce, payload.ob_ce, high !== null && low !== null ? (high + low) / 2 : null));
      const score = structureEvidenceScore(payload, signalName, "ORDER_BLOCK");
      if (score > 0) push(make(ce, `${timeframeFromPayload(payload, signalName) || "HTF"} order block CE`, firstDefined(payload.direction, signalName), "Order Block", score, score >= 13 ? "major" : "minor"));
    }

    if (type.includes("REJECTION_BLOCK") || type.includes("REJECTION BLOCK")) {
      const high = parsePrice(firstDefined(payload.high, payload.rb_high, payload.top, payload.block_top));
      const low = parsePrice(firstDefined(payload.low, payload.rb_low, payload.bottom, payload.block_bottom));
      const ce = parsePrice(firstDefined(payload.ce, payload.rb_ce, high !== null && low !== null ? (high + low) / 2 : null));
      const score = structureEvidenceScore(payload, signalName, "REJECTION_BLOCK");
      if (score > 0) push(make(ce, `${timeframeFromPayload(payload, signalName) || "HTF"} rejection block CE`, firstDefined(payload.direction, signalName), "Rejection Block", score, score >= 13 ? "major" : "minor"));
    }

    if (type.includes("EXTENSION") || String(payload.type || "").toUpperCase().includes("EXTENSION")) {
      const tf = timeframeFromPayload(payload, signalName) || "HTF";
      const tfWeight = tf === "D" ? 1.65 : tf === "4H" ? 1.9 : tf === "1H" ? 1.55 : 1;
      const family = tf === "D" ? "Daily STDV" : tf === "4H" ? "4H STDV" : tf === "1H" ? "1H STDV" : `${tf} STDV`;
      const levelPairs = [
        ["-6", firstDefined(payload.neg_6, payload.ext_neg_6)],
        ["-5.5", firstDefined(payload.neg_5_5, payload.ext_neg_5_5)],
        ["-5", firstDefined(payload.neg_5, payload.ext_neg_5)],
        ["-4.5", firstDefined(payload.neg_4_5, payload.ext_neg_4_5)],
        ["-4", firstDefined(payload.neg_4, payload.ext_neg_4)],
        ["-3.5", firstDefined(payload.neg_3_5, payload.ext_neg_3_5)],
        ["-3", firstDefined(payload.neg_3, payload.ext_neg_3)],
        ["-2.5", firstDefined(payload.neg_2_5, payload.ext_neg_2_5)],
        ["-2", firstDefined(payload.neg_2, payload.ext_neg_2)],
        ["-1.5", firstDefined(payload.neg_1_5, payload.ext_neg_1_5)],
        ["-1", firstDefined(payload.neg_1, payload.ext_neg_1, payload.swing_low)],
        ["CE", payload.ce],
        ["+1", firstDefined(payload.pos_1, payload.ext_pos_1, payload.swing_high)],
        ["+1.5", firstDefined(payload.pos_1_5, payload.ext_pos_1_5)],
        ["+2", firstDefined(payload.pos_2, payload.ext_pos_2)],
        ["+2.5", firstDefined(payload.pos_2_5, payload.ext_pos_2_5)],
        ["+3", firstDefined(payload.pos_3, payload.ext_pos_3)],
        ["+3.5", firstDefined(payload.pos_3_5, payload.ext_pos_3_5)],
        ["+4", firstDefined(payload.pos_4, payload.ext_pos_4)],
        ["+4.5", firstDefined(payload.pos_4_5, payload.ext_pos_4_5)],
        ["+5", firstDefined(payload.pos_5, payload.ext_pos_5)],
        ["+5.5", firstDefined(payload.pos_5_5, payload.ext_pos_5_5)],
        ["+6", firstDefined(payload.pos_6, payload.ext_pos_6)]
      ];
      levelPairs.forEach(([name, value]) => {
        const isCE = name === "CE";
        const levelScore = isCE ? 12 * tfWeight : deviationEvidenceScore(name) * tfWeight;
        const evidenceClass = tf === "D" || tf === "4H" || tf === "1H" || deviationAbsFromLabel(name) >= 3 ? "anchor" : "support";
        // Neutral sweep extensions are level sources, not long/short bias.
        // Daily levels are good but treated as broader zones; cluster precision still decides exact entry.
        push(make(value, `${family} ${name}`, "Both", family, levelScore, evidenceClass));
      });
    }

    if (type.includes("VOLUME_PROFILE_LEVELS") || type.includes("VOLUME PROFILE")) {
      const tf = timeframeFromPayload(payload, signalName) || String(payload.timeframe || signal.timeframe || "");
      const tfPrefix = tf ? `${tf} ` : "";
      const is15 = tf === "15m";
      const is5 = tf === "5m";

      // Volume profile is used for precision/confirmation, not as a standalone trade anchor.
      // POC can react directly. LVN/crater can sweep below/above then reverse depending on the other levels stacked there.
      const poc = firstDefined(payload.poc, payload.point_of_control, payload.vp_poc, payload.volume_poc);
      const vah = firstDefined(payload.vah, payload.value_area_high, payload.va_high);
      const val = firstDefined(payload.val, payload.value_area_low, payload.va_low);
      const lvnValues = [
        ...arrayFromMaybe(payload.lvn_levels),
        ...arrayFromMaybe(payload.lvns),
        ...arrayFromMaybe(payload.low_volume_nodes),
        ...arrayFromMaybe(payload.low_volume_node),
        ...arrayFromMaybe(payload.crater_levels),
        ...arrayFromMaybe(payload.craters)
      ];
      const hvnValues = [
        ...arrayFromMaybe(payload.hvn_levels),
        ...arrayFromMaybe(payload.hvns),
        ...arrayFromMaybe(payload.high_volume_nodes),
        ...arrayFromMaybe(payload.high_volume_node)
      ];

      const pocScore = is15 ? 24 : is5 ? 18 : 14;
      const lvnScore = is15 ? 26 : is5 ? 20 : 15;
      const vaScore = is15 ? 16 : is5 ? 12 : 9;
      const hvnScore = is15 ? 11 : is5 ? 8 : 6;

      push(make(poc, `${tfPrefix}Volume POC precision`, "Both", "Volume Profile POC", pocScore, "precision"));
      push(make(vah, `${tfPrefix}Volume VAH precision`, "Both", "Volume Profile VAH", vaScore, "precision"));
      push(make(val, `${tfPrefix}Volume VAL precision`, "Both", "Volume Profile VAL", vaScore, "precision"));
      lvnValues.forEach((value, idx) => push(make(value, `${tfPrefix}LVN / crater precision ${idx + 1}`, "Both", "Volume Profile LVN", lvnScore, "precision")));
      hvnValues.forEach((value, idx) => push(make(value, `${tfPrefix}HVN confirmation ${idx + 1}`, "Both", "Volume Profile HVN", hvnScore, "precision")));
    }

    if (type.includes("RETRACE") || type.includes("RETRACEMENT")) {
      const tf = timeframeFromPayload(payload, signalName);
      const tfScore = tf === "D" ? 30 : tf === "4H" ? 24 : tf === "1H" ? 20 : tf === "15m" ? 12 : 8;
      [
        ["CE / 0.50", firstDefined(payload.ce, payload.fib_050, payload.ote_050)],
        ["0.618", firstDefined(payload.ote_0618, payload.fib_0618)],
        ["0.705", firstDefined(payload.ote_0705, payload.fib_0705)],
        ["0.786", firstDefined(payload.ote_0786, payload.fib_0786)]
      ].forEach(([name, value]) => {
        const fibBonus = name.includes("0.786") ? 5 : name.includes("0.705") ? 4 : name.includes("0.618") ? 3 : 1;
        push(make(value, `${tf || "HTF"} OTE Retracement ${name}`, payload.direction, "OTE Retracement", tfScore + fibBonus, tf === "D" || tf === "4H" || tf === "1H" ? "major" : "support"));
      });
    }

    return candidates;
  };

  const rankedAiLimitZones = useMemo(() => {
    const rawEvidence = unfilledAiSignals.flatMap(buildLevelEvidenceCandidates);
    const seedLevels = [
      ...weeklyLevels.map((level) => ({ price: Number(level.price), direction: "Both", label: `Weekly ${level.name || "level"}`, sourceType: "Weekly Level", evidenceScore: 24, evidenceClass: "pillar", session: "WEEKLY", sourceId: `weekly-${level.id}`, created_at: level.created_at, payload: level, signalName: "Weekly Level", triggerPrice: null, levelKey: getLevelKey(level.price) })).filter((item) => Number.isFinite(item.price) && item.price > 0),
      ...craterBoxes.flatMap((box) => {
        const top = Number(box.top_price), bottom = Number(box.bottom_price);
        if (!Number.isFinite(top) || !Number.isFinite(bottom) || top <= 0 || bottom <= 0 || top === bottom) return [];
        const high = Math.max(top, bottom), low = Math.min(top, bottom), mid = (high + low) / 2, width = Math.abs(high - low);
        const score = width >= 120 ? 34 : width >= 80 ? 30 : width >= 50 ? 24 : width >= 25 ? 17 : 11;
        return [{ price: mid, direction: "Both", label: `${box.name || "Crater"} mid ${fmt(width)} pts wide`, sourceType: "Volume Crater / LVN", evidenceScore: score, evidenceClass: "pillar", session: "CRATER", sourceId: `crater-${box.id}`, created_at: box.created_at, payload: box, signalName: "Crater Box", triggerPrice: null, high, low, mid, width, levelKey: getLevelKey(mid) }];
      })
    ];

    const zones = [];
    [...seedLevels, ...rawEvidence].forEach((ev) => {
      const price = parsePrice(ev.price);
      if (price === null || price <= 0) return;
      const direction = ev.direction === "Both" ? "Both" : ev.direction;
      let zone = zones.find((item) => Math.abs(item.price - price) <= levelMergeTolerance && (item.direction === direction || item.direction === "Both" || direction === "Both"));
      if (!zone) {
        zone = { price, direction, evidence: [], sessions: new Set(), sourceIds: new Set(), created_at: ev.created_at, triggerPrice: ev.triggerPrice, payload: ev.payload, sourceId: ev.sourceId };
        zones.push(zone);
      }
      zone.evidence.push({ ...ev, price });
      if (ev.session) zone.sessions.add(ev.session);
      if (ev.sourceId) zone.sourceIds.add(String(ev.sourceId));
      const clusteredPrices = uniqueSortedPrices(zone.evidence);
      zone.clusterLow = clusteredPrices.length ? clusteredPrices[0] : price;
      zone.clusterHigh = clusteredPrices.length ? clusteredPrices[clusteredPrices.length - 1] : price;
      zone.clusterWidth = Math.max(0, zone.clusterHigh - zone.clusterLow);
      zone.price = (zone.clusterHigh + zone.clusterLow) / 2;
      zone.clusterPrices = clusteredPrices;
      if (zone.direction === "Both" && direction !== "Both") zone.direction = direction;
    });

    const scored = zones.map((zone) => {
      const weekly = nearestWeeklyToPrice(zone.price);
      const crater = nearestCraterToPrice(zone.price);
      const sourceTypes = new Set(zone.evidence.map((item) => item.sourceType));
      const majorDeviation = zone.evidence.find((item) => item.sourceType === "Major Session Deviation");
      const minorDeviation = zone.evidence.find((item) => item.sourceType === "Session Deviation");
      const htfStdv = zone.evidence.find((item) => item.sourceType === "1H STDV" || item.sourceType === "4H STDV" || item.sourceType === "Daily STDV");
      const hasDailyStdv = zone.evidence.some((item) => item.sourceType === "Daily STDV");
      const has4HStdv = zone.evidence.some((item) => item.sourceType === "4H STDV");
      const has1HStdv = zone.evidence.some((item) => item.sourceType === "1H STDV");
      const hasVpPrecision = zone.evidence.some((item) => String(item.sourceType).startsWith("Volume Profile"));
      const has5mVpPrecision = zone.evidence.some((item) => String(item.sourceType).startsWith("Volume Profile") && String(item.label).includes("5m"));
      const has15mVpPrecision = zone.evidence.some((item) => String(item.sourceType).startsWith("Volume Profile") && String(item.label).includes("15m"));
      const hasPocPrecision = zone.evidence.some((item) => String(item.sourceType).includes("POC"));
      const hasLvnPrecision = zone.evidence.some((item) => String(item.sourceType).includes("LVN"));
      const vpPrecisionBonus =
        has5mVpPrecision && has15mVpPrecision ? 14 :
        has15mVpPrecision ? 9 :
        has5mVpPrecision ? 6 :
        hasVpPrecision ? 3 :
        0;
      const hasPlaymaker = sourceTypes.has("PlayMaker Confluence");
      const hasOTE = sourceTypes.has("OTE Retracement");
      const hasWeekly = Boolean(weekly) || sourceTypes.has("Weekly Level");
      const hasCrater = Boolean(crater) || sourceTypes.has("Volume Crater / LVN") || sourceTypes.has("Volume Profile LVN");
      const hasHTFStructure = zone.evidence.some((item) => ["Order Block", "Rejection Block"].includes(item.sourceType) && item.evidenceScore >= 13);
      const evidenceScore = zone.evidence.reduce((sum, item) => sum + n(item.evidenceScore), 0);
      const pillarScore = (hasWeekly ? 22 * scoreDistance(weekly?.distance ?? 0, 3, 7, 15) : 0) + (hasCrater ? craterQualityScore(crater) : 0);
      const sourceCount = zone.evidence.length;
      const stackCount = [Boolean(majorDeviation), Boolean(htfStdv), has1HStdv, has4HStdv, hasDailyStdv, hasPlaymaker, hasOTE, hasWeekly, hasCrater, hasHTFStructure, Boolean(minorDeviation), hasVpPrecision].filter(Boolean).length;
      const athModeBonus = (Boolean(majorDeviation) || has1HStdv || has4HStdv || hasDailyStdv) && (has1HStdv || has4HStdv || hasDailyStdv || sourceCount >= 3) ? 14 : 0;
      const noAnchorPenalty = (!majorDeviation && !htfStdv && !hasWeekly && !hasCrater && !hasPlaymaker) ? 20 : 0;
      const rawZoneScore = evidenceScore + pillarScore + Math.min(24, sourceCount * 3) + Math.min(18, sourceTypes.size * 3) + stackCount * 6 + athModeBonus + vpPrecisionBonus - noAnchorPenalty;
      const precisionOnly = zone.evidence.length > 0 && zone.evidence.every((item) => String(item.sourceType).startsWith("Volume Profile"));
      const score = Math.round(clamp(rawZoneScore, 0, 100));
      const [zoneGrade] = grade(score);
      const triggerDistances = zone.evidence.map((item) => item.triggerPrice !== null ? Math.abs(item.triggerPrice - zone.price) : null).filter((value) => value !== null);
      const nearestTriggerDistance = triggerDistances.length ? Math.min(...triggerDistances) : null;
      const clusterPrices = uniqueSortedPrices(zone.evidence);
      const clusterLow = clusterPrices.length ? clusterPrices[0] : zone.price;
      const clusterHigh = clusterPrices.length ? clusterPrices[clusterPrices.length - 1] : zone.price;
      const clusterWidth = Math.max(0, clusterHigh - clusterLow);
      const clusterCenter = (clusterHigh + clusterLow) / 2;
      const tight5Count = clusterPrices.filter((price) => Math.abs(price - clusterCenter) <= 2.5).length;
      const tight10Count = clusterPrices.filter((price) => Math.abs(price - clusterCenter) <= 5).length;
      const tight20Count = clusterPrices.filter((price) => Math.abs(price - clusterCenter) <= 10).length;
      const precisionScore = clamp(clusterPrecisionFromWidth(clusterWidth) + (has5mVpPrecision && has15mVpPrecision ? 8 : hasVpPrecision ? 4 : 0), 0, 100);
      const status = clusterStatusFromWidth(clusterWidth);
      const stopPlans = buildStopPlansForCluster(zone.direction, clusterLow, clusterHigh, clusterCenter);
      const reasons = [
        majorDeviation ? majorDeviation.label : null,
        hasDailyStdv ? "Daily STDV zone aligned" : null,
        has1HStdv ? "1H STDV aligned" : null,
        has4HStdv ? "4H STDV aligned" : null,
        hasPlaymaker ? "PlayMaker confluence" : null,
        hasOTE ? "OTE retracement" : null,
        hasVpPrecision ? `${has5mVpPrecision && has15mVpPrecision ? "5m + 15m" : has15mVpPrecision ? "15m" : has5mVpPrecision ? "5m" : "HTF"} volume-profile precision${hasPocPrecision ? " / POC" : ""}${hasLvnPrecision ? " / LVN-crater" : ""}` : null,
        hasWeekly && weekly ? `Weekly ${weekly.name || "level"} ${fmt(weekly.distance)} pts` : (sourceTypes.has("Weekly Level") ? "Weekly level" : null),
        hasCrater && crater ? `${crater.inside ? "Inside" : "Near"} crater ${crater.name || "box"} ${fmt(crater.distance)} pts / ${fmt(crater.width)} wide` : (sourceTypes.has("Volume Crater / LVN") ? "Crater/LVN" : null),
        hasHTFStructure ? "1H/4H OB/RB structure" : null,
        minorDeviation && !majorDeviation ? "Prior/minor deviation support" : null,
        hasDailyStdv ? "Daily level is treated as a reaction zone; precision still comes from nearby 1H/4H/5m/15m sources." : null,
        `Cluster ${fmt(clusterLow)}–${fmt(clusterHigh)} / width ${fmt(clusterWidth)} pts`,
        `${tight5Count} within 5 • ${tight10Count} within 10 • ${tight20Count} within 20`,
        nearestTriggerDistance !== null ? `Current price ${fmt(nearestTriggerDistance)} pts away (status only)` : "Limit can be far from current price"
      ].filter(Boolean);
      const sortedEvidence = [...zone.evidence].sort((a, b) => n(b.evidenceScore) - n(a.evidenceScore));
      const createdTimes = sortedEvidence.map((item) => item.created_at).filter(Boolean).map((value) => new Date(value).getTime()).filter(Number.isFinite);
      const createdAt = createdTimes.length ? new Date(Math.min(...createdTimes)).toISOString() : zone.created_at;
      const updatedAt = createdTimes.length ? new Date(Math.max(...createdTimes)).toISOString() : zone.created_at;
      return { ...zone, precisionOnly, id: `level-${Math.round(clusterCenter)}-${zone.direction}`, label: `${zone.direction === "Both" ? "Long/Short" : zone.direction} cluster ${fmtPrice(clusterCenter)}`, sourceType: "Persistent Level Stack", price: clusterCenter, clusterCenter, clusterLow, clusterHigh, clusterWidth, clusterPrices, tight5Count, tight10Count, tight20Count, stopPlans, score, zoneScore: score, precisionScore, grade: zoneGrade, status, triggerDistance: nearestTriggerDistance, weekly, crater, reasons, evidence: sortedEvidence, sourceCount, created_at: createdAt, updated_at: updatedAt, sourceId: Array.from(zone.sourceIds).join("|") || zone.sourceId, session: Array.from(zone.sessions).join(",") || "GLOBAL", signalName: `Stacked cluster ${fmtPrice(clusterCenter)}`, payload: { price: clusterCenter, cluster_center: clusterCenter, cluster_low: clusterLow, cluster_high: clusterHigh, cluster_width: clusterWidth, stop_plans: stopPlans, direction: zone.direction, zone_score: score, precision_score: precisionScore, evidence: sortedEvidence.map((item) => ({ label: item.label, price: item.price, sourceType: item.sourceType, score: item.evidenceScore, created_at: item.created_at })) } };
    }).filter((zone) => zone.score >= 55 && !zone.precisionOnly).sort((a, b) => b.score - a.score || b.precisionScore - a.precisionScore);

    const selected = [];
    const directionCounts = { Long: 0, Short: 0, Both: 0 };
    for (const zone of scored) {
      const duplicate = selected.some((item) => Math.abs(item.price - zone.price) <= levelMergeTolerance && (item.direction === zone.direction || item.direction === "Both" || zone.direction === "Both"));
      const dir = zone.direction === "Both" ? "Both" : zone.direction;
      const underCap = dir === "Long" ? directionCounts.Long < 5 : dir === "Short" ? directionCounts.Short < 5 : directionCounts.Both < 5;
      if (!duplicate && underCap) {
        selected.push(zone);
        directionCounts[dir] += 1;
      }
      if (selected.length >= 10) break;
    }
    return selected;
  }, [unfilledAiSignals, weeklyLevels, craterBoxes]);

  const report = useMemo(() => {
    const rows = [];
    const add = (key, name, base, active, pointsAway, mult = 1, note = "") => {
      const score = active ? base * mult * distanceMult(pointsAway) : 0;
      rows.push({ key, name, base, pointsAway, score, active, note });
      return score;
    };

    add("prevWeekLevel", "Previous Week Level", baseWeights.prevWeekLevel, isYes(form.prevWeekLevelOn), away("prevWeekLevel"), 1, "Previous week high/low interaction.");

    add("lowVolumeNode", "Low Volume Node", baseWeights.lowVolumeNode, isYes(form.lowVolumeNodeOn), n(form.lowVolumeNodeAway), lvnWidthMult(form.lowVolumeNodeWidth), "Bigger LVN / volume crater = more weight.");

    add("playMakerSignal", "PlayMaker Signal", baseWeights.playMakerSignal, isYes(form.playMakerSignalOn), away("playMakerSignal"), isYes(form.playMakerSignalOn) ? 1 : 0, "Can be the starting level.");

    add("prevSessionSTDV", "Prev Session STDV", baseWeights.prevSessionSTDV, isYes(form.prevSessionSTDVOn), away("prevSessionSTDV"), stdvMult(form.prevSessionSTDVValue), "+3 or -3 and beyond carries more impact.");
    add("priorSessionSTDV", "Prior Session STDV", baseWeights.priorSessionSTDV, isYes(form.priorSessionSTDVOn), away("priorSessionSTDV"), stdvMult(form.priorSessionSTDVValue), "Session before previous session; lower weight.");
    add("oneHSTDV", "1H STDV", baseWeights.oneHSTDV, isYes(form.oneHSTDVOn), away("oneHSTDV"), stdvMult(form.oneHSTDVValue), "1H STDV matters but less than session deviations.");
    add("fourHSTDV", "4H STDV", baseWeights.fourHSTDV, isYes(form.fourHSTDVOn), away("fourHSTDV"), stdvMult(form.fourHSTDVValue), "4H STDV has stronger reaction value than 1H.");

    add("retrace15m", "15m Retracement", baseWeights.retrace15m, isYes(form.retrace15mOn), away("retrace15m"), retraceMult(form.retrace15mValue, form.trend), "Deeper retracement means more against trend.");
    add("retrace1H", "1H Retracement", baseWeights.retrace1H, isYes(form.retrace1HOn), away("retrace1H"), retraceMult(form.retrace1HValue, form.trend), "OTE/CE style retracement.");
    add("retrace4H", "4H Retracement", baseWeights.retrace4H, isYes(form.retrace4HOn), away("retrace4H"), retraceMult(form.retrace4HValue, form.trend), "Higher timeframe retracement.");

    const obFresh = form.orderBlockState === "Fresh" ? 1 : 0.75;
    add("orderBlock", "Order Block", baseWeights.orderBlock, isYes(form.orderBlockOn), n(form.orderBlockAway), tfMult(form.orderBlockTF) * obFresh, "Highest timeframe OB selected; fresh or prev tapped.");
    const rbFresh = form.rejectionBlockState === "Fresh" ? 1 : 0.75;
    add("rejectionBlock", "Rejection Block", baseWeights.rejectionBlock, isYes(form.rejectionBlockOn), n(form.rejectionBlockAway), tfMult(form.rejectionBlockTF) * rbFresh, "Higher timeframe means more.");
    const fvgFresh = form.fvgState === "Fresh" ? 1 : 0.75;
    add("fvg", "FVG", baseWeights.fvg, isYes(form.fvgOn), n(form.fvgAway), tfMult(form.fvgTF) * fvgFresh, "Higher timeframe FVG means more.");

    const taps = clamp(n(form.prevHighLowTaps, 1), 1, 10);
    add("prevHighLow", "Previous High / Low", baseWeights.prevHighLow, isYes(form.prevHighLowOn), n(form.prevHighLowAway), Math.max(0.25, 1.15 - taps * 0.12), "More taps = less value.");
    add("ltfVolNode", "LTF Volume Node", baseWeights.ltfVolNode, isYes(form.ltfVolNodeOn), n(form.ltfVolNodeAway), 1, "Used for entry precision.");
    add("liquidity", "Liquidity", baseWeights.liquidity, isYes(form.liquidityOn), 0, 1, "Yes/no liquidity context.");

    const active = rows.filter((r) => r.active && r.score > 0);
    const within3 = rows.filter((r) => r.active && Math.abs(r.pointsAway) <= 3).length;
    const within5 = rows.filter((r) => r.active && Math.abs(r.pointsAway) <= 5).length;
    const within7 = rows.filter((r) => r.active && Math.abs(r.pointsAway) <= 7).length;
    const farCount = rows.filter((r) => r.active && Math.abs(r.pointsAway) >= 8).length;
    const topWeighted = [...active].sort((a, b) => b.base - a.base || b.score - a.score).slice(0, 3);
    const topWithin3 = topWeighted.filter((r) => Math.abs(r.pointsAway) <= 3).length;
    const topWithin5 = topWeighted.filter((r) => Math.abs(r.pointsAway) <= 5).length;
    const topFar = topWeighted.filter((r) => Math.abs(r.pointsAway) >= 8).length;

    const compression =
      within5 >= 5 ? 14 :
      within5 >= 4 ? 11 :
      within5 >= 3 ? 8 :
      within7 >= 4 ? 5 :
      within7 >= 3 ? 3 :
      active.length >= 2 ? 1 :
      0;

    const coreStackAligned =
      isYes(form.prevWeekLevelOn) && isYes(form.lowVolumeNodeOn) && isYes(form.playMakerSignalOn) &&
      Math.abs(away("prevWeekLevel")) <= 5 &&
      Math.abs(n(form.lowVolumeNodeAway)) <= 5 &&
      Math.abs(away("playMakerSignal")) <= 5;

    const coreStackTight =
      isYes(form.prevWeekLevelOn) && isYes(form.lowVolumeNodeOn) && isYes(form.playMakerSignalOn) &&
      Math.abs(away("prevWeekLevel")) <= 3 &&
      Math.abs(n(form.lowVolumeNodeAway)) <= 3 &&
      Math.abs(away("playMakerSignal")) <= 3;

    const coreBonus =
      coreStackTight ? 28 :
      coreStackAligned ? 22 :
      isYes(form.prevWeekLevelOn) && isYes(form.lowVolumeNodeOn) ? 12 :
      isYes(form.lowVolumeNodeOn) && isYes(form.playMakerSignalOn) ? 10 :
      0;

    const raw = rows.reduce((sum, r) => sum + r.score, 0) + compression + coreBonus;
    const zoneScore = Math.round(clamp((raw / 82) * 100, 0, 100));

    let precisionScore = zoneScore;
    if (topWithin3 === 3) precisionScore += 10;
    else if (topWithin5 === 3) precisionScore += 5;
    else if (topWithin5 >= 2) precisionScore += 1;
    else precisionScore -= 10;

    if (topWithin3 === 3 && active.length >= 3) precisionScore = Math.max(precisionScore, 92);
    else if (topWithin5 === 3 && active.length >= 3) precisionScore = Math.max(precisionScore, 84);

    if (topWithin3 < 3) precisionScore = Math.min(precisionScore, 91);
    if (topFar >= 2) precisionScore = Math.min(precisionScore, 74);
    if (farCount >= 4) precisionScore = Math.min(precisionScore, 74);
    else if (farCount >= 3 && topWithin5 < 3) precisionScore = Math.min(precisionScore, 82);
    if (active.length >= 6 && topWithin5 < 2) precisionScore = Math.min(precisionScore, 76);

    const score = Math.round(clamp(precisionScore, 0, 100));

    return {
      rows,
      active,
      within3,
      within5,
      within7,
      farCount,
      topWeighted,
      topWithin3,
      topWithin5,
      topFar,
      compression,
      coreBonus,
      raw,
      zoneScore,
      precisionScore: score,
      score,
      confluences: active.length
    };
  }, [form, startingLevel]);

  const recommendations = useMemo(() => {
    if (selectedTrade?.stopPlans?.length) {
      return selectedTrade.stopPlans.map((plan) => ({
        stop: plan.stop,
        limit: plan.limit,
        stopArea: plan.stopArea,
        match: selectedTrade.signalName || "AI cluster center",
        confidence: plan.confidence || (plan.valid ? "Valid" : "Too Tight"),
        note: plan.note || (plan.valid ? "Cluster width supports this stop." : "This stop is too tight for the cluster width."),
        valid: plan.valid
      }));
    }

    const entry = n(form.tradeEntryPrice);
    const side = dirSide(form.direction);

    const priorityByStop = {
      7: ["ltfVolNode", "playMakerSignal", "fvg", "orderBlock", "rejectionBlock", "lowVolumeNode"],
      10: ["lowVolumeNode", "playMakerSignal", "prevWeekLevel", "prevSessionSTDV", "fourHSTDV", "ltfVolNode"],
      15: ["prevWeekLevel", "prevSessionSTDV", "fourHSTDV", "lowVolumeNode", "priorSessionSTDV", "liquidity"]
    };

    const active = report.rows
      .filter((r) => r.active && r.score > 0 && r.key !== "liquidity")
      .map((r) => ({ ...r, pullback: Math.abs(n(r.pointsAway)), signedPullback: n(r.pointsAway) }));

    return [7, 10, 15].map((stop) => {
      const min = stop * 0.10;
      const max = stop * 0.85;

      const ranked = active
        .filter((r) => r.pullback >= min && r.pullback <= max)
        .sort((a, b) => {
          const aRank = priorityByStop[stop].indexOf(a.key);
          const bRank = priorityByStop[stop].indexOf(b.key);
          const ar = aRank === -1 ? 99 : aRank;
          const br = bRank === -1 ? 99 : bRank;
          return ar - br || b.score - a.score;
        });

      const strongest = [...active].sort((a, b) => b.score - a.score)[0];
      const match = ranked[0] || strongest;
      const signedPullback = match ? match.signedPullback : side * (stop * 0.35);
      const limit = entry + signedPullback;
      const stopArea = form.direction === "Long" ? limit - stop : limit + stop;

      return {
        stop,
        limit,
        stopArea,
        match: match ? match.name : "Default pullback",
        confidence: match ? (match.score >= 8 ? "Strong" : "Moderate") : "Light",
        note:
          stop === 7 ? "Tighter entry. Best near LTF Vol Node / PlayMaker." :
          stop === 10 ? "Balanced entry. Best near LVN / PlayMaker stack." :
          "Wider protection. Best near HTF level / STDV."
      };
    });
  }, [report.rows, form.tradeEntryPrice, form.direction, selectedTrade]);

  const behavior = useMemo(() => {
    const closed = journal.filter((j) => !isOpenOrder(j));
    const wins = closed.filter((j) => j.result === "Win").length;
    const losses = closed.filter((j) => j.result === "Loss").length;
    const be = closed.filter((j) => j.result === "BE").length;
    const notesText = journal.map((j) => j.notes || "").join(" ").toLowerCase();
    let score = 5;
    if (closed.length >= 3 && wins > losses) score += 2;
    if (losses > wins) score -= 2;
    if (notesText.includes("chased") || notesText.includes("late")) score -= 1;
    if (notesText.includes("patient") || notesText.includes("followed")) score += 1;
    score = clamp(score, 0, 10);
    return { score, wins, losses, be, total: closed.length };
  }, [journal]);

  const tips = useMemo(() => {
    const t = [];
    if (report.coreBonus > 0) t.push("Core setup is active: Previous Week Level + LVN + PlayMaker stack is your strongest base.");
    if (n(form.lowVolumeNodeWidth) >= 70 && isYes(form.lowVolumeNodeOn)) t.push("LVN is wide: reaction weight is high, but use LTF volume node or tighter confluence for limit precision.");
    if (startingLevel) t.push("Starting level selected. All other starting-level toggles are locked to prevent mixed anchors.");
    if (isYes(form.ltfVolNodeOn)) t.push("LTF volume node is active: use it to pinpoint the entry suggestion.");
    if (form.orderBlockState === "Fresh" && form.orderBlockTF === "5m") t.push("Fresh low timeframe OB should stay lower weight because the turn can happen before the block fully builds.");
    if (journal.some((j) => isOpenOrder(j))) t.push("You have unfilled orders showing on the front screen. Review them before market close or market open.");
    return t;
  }, [form, startingLevel, report.coreBonus, journal]);

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files || []);

    files.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setForm((prev) => ({
          ...prev,
          tradeImages: [...(prev.tradeImages || []), reader.result]
        }));
      };
      reader.readAsDataURL(file);
    });
  };

const exportJournalCSV = () => {
  const headers = [
    "Date",
    "Direction",
    "Entry",
    "Grade",
    "Score",
    "Result",
    "Max Move",
    "Max Drawdown",
    "Profit/Loss",
    "Notes"
  ];

  const rows = journal.map((j) => [
    j.date || "",
    j.direction || "",
    j.entry || "",
    j.grade || "",
    j.score || "",
    j.result || "",
    j.maxMove || "",
    j.maxDrawdown || "",
    j.profitLoss || "",
   JSON.stringify(j.notes || "")
  ]);

  const csv = [
  headers.join(","),
  ...rows.map((r) => r.join(","))
].join("\n");
  const blob = new Blob([csv], {
    type: "text/csv"
  });

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `playmaker-journal-${Date.now()}.csv`;
  link.click();
};

  const exportSetup = () => {
    const payload = {
      exportedAt: new Date().toLocaleString(),
      grade: grade(report.score)[0],
      precisionScore: report.score,
      zoneScore: report.zoneScore,
      score: report.score,
      tradeInfo: {
        entryPrice: form.tradeEntryPrice,
        direction: form.direction,
        bias1H: form.bias1H,
        bias4H: form.bias4H,
        trend: form.trend
      },
      recommendations,
      confluences: report.rows.filter((r) => r.active),
      tips,
      result: {
        result: form.result,
        maxMove: form.maxMove,
        maxDrawdown: form.maxDrawdown,
        profitLoss: form.profitLoss,
        notes: form.notes
      }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `playmaker-setup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printSetup = () => window.print();

  const makeJournalItem = (resultOverride = form.result, extra = {}) => {
    const normalizedResult = resultOverride === "Edge" || resultOverride === "Unfilled" ? "Unfilled" : resultOverride;
    const sourceType = extra.sourceType || selectedTrade?.sourceType || "Manual Order";
    const signalName = extra.signalName || selectedTrade?.signalName || selectedTrade?.signal || "";
    const baseNotes = form.notes || "";
    const notes =
      sourceType === "AI Signal" && signalName && !baseNotes.includes(`AI Signal: ${signalName}`)
        ? `AI Signal: ${signalName}${baseNotes ? ` — ${baseNotes}` : ""}`
        : baseNotes;

    const isAiAnchor = sourceType === "AI Signal";
    const aiEvidence = selectedTrade?.evidence || selectedTrade?.rawSignal?.evidence || form.evidence || [];
    const aiPayload = selectedTrade?.rawSignal || form.aiPayload || null;
    const aiTop = selectedTrade?.top || selectedTrade?.signalName || signalName || "AI Level";

    return {
      id: extra.id || selectedTrade?.id || editingId || Date.now(),
      date: formatEastern(new Date()),
      direction: form.direction,
      entry: form.tradeEntryPrice,
      grade: isAiAnchor && selectedTrade?.grade ? selectedTrade.grade : grade(report.score)[0],
      score: isAiAnchor && selectedTrade?.score ? selectedTrade.score : report.score,
      result: normalizedResult,
      orderStatus: normalizedResult === "Unfilled" ? "Unfilled" : "Reported",
      pendingOrder: normalizedResult === "Unfilled",
      maxMove: form.maxMove,
      maxDrawdown: form.maxDrawdown,
      profitLoss: form.profitLoss,
      notes,
      tradeImages: form.tradeImages,
      top: isAiAnchor ? aiTop : report.active.slice(0, 4).map((r) => r.name).join(", "),
      sourceType,
      signal_id: extra.signal_id || selectedTrade?.signal_id || aiPayload?.id || "",
      signalName,
      evidence: aiEvidence,
      rawSignal: aiPayload,
      formSnapshot: { ...form, evidence: aiEvidence, aiPayload }
    };
  };

  const tradePayload = (item) => ({
    user_id: user.id,
    symbol: "NQ",
    direction: item.direction,
    entry_price: Number(item.entry) || null,
    grade: item.grade,
    score: item.score,
    zone_score: report.zoneScore || report.score,
    precision_score: report.precisionScore || report.score,
    result: item.result,
    max_move: Number(item.maxMove) || null,
    max_drawdown: Number(item.maxDrawdown) || null,
    profit_loss: Number(item.profitLoss) || null,
    notes: item.notes,
    confluences: item.evidence?.length ? item.evidence : report.active,
    recommendations,
    screenshots: item.tradeImages || []
  });

  const clearTradeForm = () => {
    const next = getDefaultForm();
    next.tradeEntryPrice = "";
    next.prevWeekLevelOn = "No";
    next.lowVolumeNodeOn = "No";
    next.playMakerSignalOn = "No";
    next.prevSessionSTDVOn = "No";
    next.priorSessionSTDVOn = "No";
    next.oneHSTDVOn = "No";
    next.fourHSTDVOn = "No";
    next.retrace15mOn = "No";
    next.retrace1HOn = "No";
    next.retrace4HOn = "No";
    next.orderBlockOn = "No";
    next.rejectionBlockOn = "No";
    next.fvgOn = "No";
    next.prevHighLowOn = "No";
    next.ltfVolNodeOn = "No";
    next.liquidityOn = "No";
    next.result = "Unfilled";
    next.maxMove = "";
    next.maxDrawdown = "";
    next.profitLoss = "";
    next.notes = "";
    next.tradeImages = [];

    setForm(next);
    setStartingLevel("");
    setSelectedTrade(null);
    setEditingId(null);
  };

  const saveTradeToDatabase = async (item, updateExisting = false) => {
    if (!user) {
      alert("Please log in before saving a trade.");
      return item;
    }

    let savedItem = item;

    if (updateExisting && item.id && selectedTrade?.sourceType !== "AI Signal") {
      const { error } = await supabase
        .from("trade_journal")
        .update(tradePayload(item))
        .eq("id", item.id)
        .eq("user_id", user.id);

      if (error) {
        console.error("Supabase update error:", error);
        alert("Trade updated locally, but database update failed.");
      }
    } else {
      const { data, error } = await supabase
        .from("trade_journal")
        .insert([tradePayload(item)])
        .select("id, created_at")
        .single();

      if (error) {
        console.error("Supabase save error:", error);
        alert("Trade saved locally, but database save failed.");
      } else if (data?.id) {
        savedItem = {
          ...item,
          id: data.id,
          date: data.created_at ? new Date(data.created_at).toLocaleDateString() : item.date
        };
      }
    }

    return savedItem;
  };

  const saveTradeMemory = async (item) => {
    if (!user || isOpenOrder(item)) return;

    const { error } = await supabase.from("ai_trade_memory").insert([
      {
        user_id: user.id,
        source_type: item.sourceType || "Manual Order",
        signal_id: item.signal_id || null,
        symbol: "NQ",
        direction: item.direction,
        entry_price: Number(item.entry) || null,
        grade: item.grade,
        score: Number(item.score) || null,
        result: item.result,
        max_move: Number(item.maxMove) || null,
        max_drawdown: Number(item.maxDrawdown) || null,
        profit_loss: Number(item.profitLoss) || null,
        confluences: item.evidence?.length ? item.evidence : report.active,
        recommendations,
        notes: item.notes || null
      }
    ]);

    if (error) {
      console.error("AI trade memory save error:", error);
    }
  };

  const submitOrder = async () => {
    const item = makeJournalItem("Unfilled", {
      sourceType: selectedTrade?.sourceType || "Manual Order",
      signal_id: selectedTrade?.signal_id || selectedTrade?.rawSignal?.id || "",
      signalName: selectedTrade?.signalName || selectedTrade?.rawSignal?.signal || ""
    });
    const savedItem = await saveTradeToDatabase(item, false);

    setJournal((j) => {
      const withoutDuplicates = j.filter((x) => !sameTradeAnchor(x, savedItem));
      return [savedItem, ...withoutDuplicates];
    });

    clearTradeForm();
    setTab("trade");
    console.log("Order submitted to active anchors");
  };

  const saveTrade = async () => {
    const item = makeJournalItem(form.result);
    const isReportingExisting = Boolean(selectedTrade && selectedTrade.sourceType !== "AI Signal");
    const savedItem = await saveTradeToDatabase(item, isReportingExisting);

    await saveTradeMemory(savedItem);

    setJournal((j) => {
      const withoutOldOpenCopies = j.filter((x) => !sameTradeAnchor(x, savedItem));

      // Closed/filled/reported orders stay in the Journal table, but they no longer qualify
      // for Active Trade Anchors because isOpenOrder() returns false for them.
      return [savedItem, ...withoutOldOpenCopies];
    });

    clearTradeForm();
    setTab("journal");
    console.log("Trade result saved and active anchor cleared");
  };

  const editTrade = (item) => {
    setSelectedTrade(item);
    setEditingId(item.id);

    if (item.formSnapshot) {
      setForm({
        ...getDefaultForm(),
        ...item.formSnapshot,
        result: item.result || "Unfilled",
        maxMove: item.maxMove || "",
        maxDrawdown: item.maxDrawdown || "",
        profitLoss: item.profitLoss || "",
        notes: item.notes || "",
        tradeImages: item.tradeImages || []
      });
    } else {
      setForm((f) => ({
        ...f,
        direction: item.direction || "Long",
        tradeEntryPrice: item.entry || "",
        result: item.result || "Unfilled",
        maxMove: item.maxMove || "",
        maxDrawdown: item.maxDrawdown || "",
        profitLoss: item.profitLoss || "",
        notes: item.notes || "",
        tradeImages: item.tradeImages || []
      }));
    }

    setTab("checklist");
  };

  const closestWeeklyLevelToEntry = (entryPrice) => {
    const entry = parsePrice(entryPrice);
    if (entry === null || weeklyLevels.length === 0) return null;

    return weeklyLevels
      .map((level) => ({ ...level, distance: Math.abs(Number(level.price) - entry) }))
      .filter((level) => Number.isFinite(level.distance))
      .sort((a, b) => a.distance - b.distance)[0] || null;
  };

  const closestCraterBoxToEntry = (entryPrice) => {
    const entry = parsePrice(entryPrice);
    if (entry === null || craterBoxes.length === 0) return null;

    return craterBoxes
      .map((box) => {
        const top = Number(box.top_price);
        const bottom = Number(box.bottom_price);
        if (!Number.isFinite(top) || !Number.isFinite(bottom) || top <= 0 || bottom <= 0 || top === bottom) return null;
        const high = Math.max(top, bottom);
        const low = Math.min(top, bottom);
        const mid = (high + low) / 2;
        const width = Math.abs(high - low);
        return { ...box, high, low, mid, width, distance: Math.abs(mid - entry) };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance)[0] || null;
  };

  const buildFormFromAiSignal = (signal, fallbackForm) => {
    const payload = getSignalPayload(signal);
    const signalText = String(firstDefined(payload.signal, payload.side, payload.action, signal.signal, "AI Signal"));
    const lowerSignal = signalText.toLowerCase();
    const inferredDirection = normalizeDirection(firstDefined(payload.direction, payload.side, signal.direction), signalText);
    const entryValue = firstDefined(payload.entry, payload.entry_price, payload.price, payload.trigger_price, payload.close, payload.alert_price, signal.entry, fallbackForm.tradeEntryPrice, "");
    const nearestWeekly = closestWeeklyLevelToEntry(entryValue);
    const nearestCrater = closestCraterBoxToEntry(entryValue);

    const playMakerSignalOn = parseYesNo(firstDefined(payload.playmaker_signal, payload.playMakerSignal, payload.pm_signal, payload.signal_active));
    const liquidityOn = parseYesNo(firstDefined(payload.liquidity, payload.liquidity_on));
    const lvnPrice = parsePrice(firstDefined(payload.lvn, payload.low_volume_node, payload.lowVolumeNode, payload.volume_node));
    const ltfNodePrice = parsePrice(firstDefined(payload.ltf_vol_node, payload.ltf_volume_node, payload.ltfVolNode));
    const entryNumber = parsePrice(entryValue);

    const next = {
      ...fallbackForm,
      direction: inferredDirection,
      tradeEntryPrice: String(entryValue || ""),
      result: "Unfilled",
      maxMove: "",
      maxDrawdown: "",
      profitLoss: "",
      notes: `AI Signal: ${signalText}`,
      tradeImages: []
    };

    if (nearestWeekly) {
      next.prevWeekLevelOn = "Yes";
      next.prevWeekLevelAway = String(fmt(nearestWeekly.distance));
    }

    if (nearestCrater) {
      next.lowVolumeNodeOn = "Yes";
      next.lowVolumeNodeWidth = String(fmt(nearestCrater.width));
      next.lowVolumeNodeAway = String(fmt(nearestCrater.distance));
    } else if (entryNumber !== null && lvnPrice !== null) {
      next.lowVolumeNodeOn = "Yes";
      next.lowVolumeNodeAway = String(fmt(Math.abs(lvnPrice - entryNumber)));
    }

    if (playMakerSignalOn) next.playMakerSignalOn = playMakerSignalOn;
    if (liquidityOn) next.liquidityOn = liquidityOn;

    const prevSessionSTDV = firstDefined(payload.stdv_session, payload.session_stdv, payload.prev_session_stdv, payload.prevSessionSTDV);
    if (prevSessionSTDV !== undefined) {
      next.prevSessionSTDVOn = "Yes";
      next.prevSessionSTDVValue = normalizeSTDV(prevSessionSTDV);
      next.prevSessionSTDVAway = String(firstDefined(payload.prev_session_stdv_away, payload.stdv_session_away, "0"));
    }

    const oneHSTDV = firstDefined(payload.stdv_1h, payload.oneHSTDV, payload.one_h_stdv, payload.h1_fib_0705, payload.h1_fib_0618);
    if (oneHSTDV !== undefined) {
      next.oneHSTDVOn = "Yes";
      next.oneHSTDVValue = normalizeSTDV(oneHSTDV);
      next.oneHSTDVAway = String(firstDefined(payload.stdv_1h_away, payload.one_h_stdv_away, "0"));
    }

    const fourHSTDV = firstDefined(payload.stdv_4h, payload.fourHSTDV, payload.four_h_stdv, payload.h4_fib_0705, payload.h4_fib_0618);
    if (fourHSTDV !== undefined) {
      next.fourHSTDVOn = "Yes";
      next.fourHSTDVValue = normalizeSTDV(fourHSTDV);
      next.fourHSTDVAway = String(firstDefined(payload.stdv_4h_away, payload.four_h_stdv_away, "0"));
    }

    const fib15 = firstDefined(payload.fib_15m, payload.retrace_15m, payload.retrace15m, payload.fib_0705, payload.fib_0618);
    if (fib15 !== undefined) {
      next.retrace15mOn = "Yes";
      next.retrace15mValue = normalizeRetrace(fib15);
      next.retrace15mAway = String(firstDefined(payload.fib_15m_away, payload.retrace_15m_away, "0"));
    }

    const fib1h = firstDefined(payload.fib_1h, payload.retrace_1h, payload.retrace1H, payload.h1_fib_0705, payload.h1_fib_0618);
    if (fib1h !== undefined) {
      next.retrace1HOn = "Yes";
      next.retrace1HValue = normalizeRetrace(fib1h);
      next.retrace1HAway = String(firstDefined(payload.fib_1h_away, payload.retrace_1h_away, "0"));
    }

    const fib4h = firstDefined(payload.fib_4h, payload.retrace_4h, payload.retrace4H, payload.h4_fib_0705, payload.h4_fib_0618);
    if (fib4h !== undefined) {
      next.retrace4HOn = "Yes";
      next.retrace4HValue = normalizeRetrace(fib4h);
      next.retrace4HAway = String(firstDefined(payload.fib_4h_away, payload.retrace_4h_away, "0"));
    }

    if (entryNumber !== null && ltfNodePrice !== null) {
      next.ltfVolNodeOn = "Yes";
      next.ltfVolNodeAway = String(fmt(Math.abs(ltfNodePrice - entryNumber)));
    }

    return { next, signalText, inferredDirection, entryValue };
  };

  const selectAiSignal = (signal) => {
    const payload = getSignalPayload(signal);
    const { next, signalText, inferredDirection, entryValue } = buildFormFromAiSignal(signal, form);

    const item = {
      id: `ai-${signal.id || signal.created_at || Date.now()}`,
      date: formatEastern(signal.created_at || payload.created_at || new Date()),
      updatedAt: formatEastern(payload.updated_at || signal.updated_at || signal.created_at || payload.created_at || new Date()),
      direction: inferredDirection,
      entry: entryValue || "",
      clusterLow: payload.cluster_low,
      clusterHigh: payload.cluster_high,
      clusterWidth: payload.cluster_width,
      stopPlans: payload.stop_plans,
      grade: payload.ai_grade || "AI",
      score: payload.ai_score || payload.zone_score || 0,
      precisionScore: payload.precision_score || 0,
      zoneScore: payload.zone_score || payload.ai_score || 0,
      sourceCount: payload.source_count || payload.evidence?.length || 0,
      evidence: payload.evidence || [],
      result: "Unfilled",
      orderStatus: "Unfilled",
      pendingOrder: true,
      maxMove: "",
      maxDrawdown: "",
      profitLoss: "",
      notes: `AI Signal: ${signalText}`,
      tradeImages: [],
      top: signalText,
      sourceType: "AI Signal",
      signal_id: signal.id || "",
      signalName: signalText,
      formSnapshot: { ...next, evidence: payload.evidence || [], aiPayload: payload }
    };

    setSelectedTrade(item);
    setEditingId(null);
    setForm(next);
    if (next.playMakerSignalOn === "Yes") setStartingLevel("playMakerSignal");
    else setStartingLevel("");
    setTab("checklist");
  };

  const selectActiveAnchor = (anchor) => {
    if (anchor.sourceType === "AI Signal") {
      selectAiSignal(anchor.rawSignal || anchor);
    } else {
      editTrade(anchor);
    }
  };

  const [manualLetter, manualText] = grade(report.score);
  const selectedAiScore = selectedTrade?.sourceType === "AI Signal" ? n(selectedTrade.score || selectedTrade.rawSignal?.ai_score || selectedTrade.rawSignal?.zone_score, 0) : 0;
  const selectedAiPrecision = selectedTrade?.sourceType === "AI Signal" ? n(selectedTrade.precisionScore || selectedTrade.rawSignal?.precision_score, 0) : 0;
  const letter = selectedTrade?.sourceType === "AI Signal" && selectedAiScore ? (selectedTrade.grade || selectedTrade.rawSignal?.ai_grade || grade(selectedAiScore)[0]) : manualLetter;
  const text = selectedTrade?.sourceType === "AI Signal" && selectedAiScore ? "AI Level / Limit Anchor" : manualText;
  const displayScore = selectedTrade?.sourceType === "AI Signal" && selectedAiScore ? selectedAiScore : report.score;
  const displayPrecision = selectedTrade?.sourceType === "AI Signal" && selectedAiPrecision ? selectedAiPrecision : report.score;
  const unfilledOrders = journal.filter((j) => isOpenOrder(j));

  const activeAnchors = [
    ...unfilledOrders.map((order) => ({
      ...order,
      sourceType: order.sourceType || "Manual Order"
    })),
    ...rankedAiLimitZones
      .filter((zone) => !unfilledOrders.some((order) => {
        const orderEntry = parsePrice(order.entry || order.entry_price);
        const sameDirection = String(order.direction || "").toLowerCase() === String(zone.direction || "").toLowerCase() || zone.direction === "Both";
        const entryMatches = orderEntry !== null && Math.abs(orderEntry - zone.price) <= Math.max(2, Math.min(levelMergeTolerance, zone.clusterWidth || levelMergeTolerance));
        const orderSignalId = String(order.signal_id || order.ai_signal_id || "");
        const signalMatches = orderSignalId && String(zone.sourceId || "").includes(orderSignalId);
        return sameDirection && (entryMatches || signalMatches);
      }))
      .map((zone) => ({
      id: `zone-${zone.sourceId}-${zone.session}-${zone.direction}-${zone.price}`,
      date: formatEastern(zone.created_at),
      updatedAt: formatEastern(zone.updated_at || zone.created_at),
      direction: zone.direction,
      entry: zone.price,
      clusterLow: zone.clusterLow,
      clusterHigh: zone.clusterHigh,
      clusterWidth: zone.clusterWidth,
      stopPlans: zone.stopPlans,
      grade: zone.grade,
      score: zone.score,
      precisionScore: zone.precisionScore,
      zoneScore: zone.zoneScore || zone.score,
      sourceCount: zone.sourceCount || zone.evidence?.length || 0,
      evidence: zone.evidence || [],
      result: "Unfilled",
      orderStatus: zone.status,
      pendingOrder: true,
      maxMove: "",
      maxDrawdown: "",
      profitLoss: "",
      notes: `${zone.status}: ${zone.label} — ${zone.reasons.join(" • ")}`,
      tradeImages: [],
      top: `Center ${fmtPrice(zone.price)} • Width ${fmt(zone.clusterWidth)} pts • ${zone.reasons.join(" • ")}`,
      sourceType: "AI Signal",
      signal_id: zone.sourceId || "",
      signalName: zone.label,
      rawSignal: {
        ...zone.payload,
        id: zone.sourceId,
        signal: zone.label,
        direction: zone.direction,
        price: zone.price,
        entry: zone.price,
        cluster_center: zone.clusterCenter,
        cluster_low: zone.clusterLow,
        cluster_high: zone.clusterHigh,
        cluster_width: zone.clusterWidth,
        stop_plans: zone.stopPlans,
        trigger_price: zone.triggerPrice,
        ai_grade: zone.grade,
        ai_score: zone.score,
        zone_score: zone.zoneScore || zone.score,
        precision_score: zone.precisionScore || 0,
        ai_status: zone.status,
        confluence_reasons: zone.reasons,
        evidence: zone.evidence || [],
        source_count: zone.sourceCount || zone.evidence?.length || 0,
        created_eastern: formatEastern(zone.created_at),
        updated_eastern: formatEastern(zone.updated_at || zone.created_at)
      }
    }))
  ];

  const aiAnchorsOnly = activeAnchors.filter((anchor) => anchor.sourceType === "AI Signal");
  const tradeAnchorLevels = aiAnchorsOnly.filter((anchor) => ["A+", "A"].includes(anchor.grade));
  const intermediateWatchlist = aiAnchorsOnly.filter((anchor) => ["B+", "B"].includes(anchor.grade));
  const watchLevels = aiAnchorsOnly.filter((anchor) => anchor.grade === "C");

  const learningStats = useMemo(() => {
    const closed = journal.filter((item) => !isOpenOrder(item));
    const bySource = {};
    closed.forEach((item) => {
      const sources = Array.isArray(item.formSnapshot?.evidence) ? item.formSnapshot.evidence : [];
      const sourceNames = sources.length ? sources.map((src) => src.sourceType || src.label || "Unknown") : String(item.top || "Manual").split(",").map((x) => x.trim()).filter(Boolean);
      sourceNames.forEach((name) => {
        if (!bySource[name]) bySource[name] = { name, trades: 0, wins: 0, losses: 0, be: 0, maxMove: 0, maxDrawdown: 0 };
        bySource[name].trades += 1;
        if (item.result === "Win") bySource[name].wins += 1;
        if (item.result === "Loss") bySource[name].losses += 1;
        if (item.result === "BE") bySource[name].be += 1;
        bySource[name].maxMove += n(item.maxMove);
        bySource[name].maxDrawdown += n(item.maxDrawdown);
      });
    });
    return Object.values(bySource).map((row) => ({
      ...row,
      winRate: row.trades ? Math.round((row.wins / row.trades) * 100) : 0,
      avgMaxMove: row.trades ? row.maxMove / row.trades : 0,
      avgDrawdown: row.trades ? row.maxDrawdown / row.trades : 0
    })).sort((a, b) => b.trades - a.trades || b.winRate - a.winRate);
  }, [journal]);


  if (!user) {
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <div className="w-full max-w-md p-6 rounded-xl border border-yellow-500 bg-[#080808]">

        <h1 className="text-3xl font-bold text-[#ffcc19] mb-4">
          PlayMaker Login
        </h1>

        <input
          type="email"
          placeholder="Email"
          value={authEmail}
          onChange={(e)=>setAuthEmail(e.target.value)}
          className="w-full p-3 mb-3 rounded bg-zinc-900"
        />

        <input
          type="password"
          placeholder="Password"
          value={authPassword}
          onChange={(e)=>setAuthPassword(e.target.value)}
          className="w-full p-3 mb-4 rounded bg-zinc-900"
        />

        <div className="flex gap-3">

          <button
            onClick={signIn}
            className="flex-1 bg-[#ffcc19] text-black font-bold p-3 rounded"
          >
            Login
          </button>

          <button
            onClick={signUp}
            className="flex-1 border border-[#ffcc19] p-3 rounded"
          >
            Register
          </button>

        </div>

        <p className="mt-4 text-sm text-zinc-400">
          {authMessage}
        </p>

      </div>
    </div>
  );
}


  return (
    <WhopGate>
    <div className="min-h-screen bg-[#080808] text-white">
      <div className="mx-auto max-w-[1500px] p-4 md:p-6">
        <div className="grid gap-5 lg:grid-cols-[1fr_230px]">
          <div>
            <div className="mb-5 text-[#ffcc19] font-black tracking-[0.24em] text-sm">♕ THE PLAYMAKER</div>
            <h1 className="text-5xl md:text-6xl font-black leading-none">Setup Grader</h1>
            <p className="mt-3 text-xl text-zinc-300">Starting-level scoring, distance compression, weighted confluences, behavior review, and trade journal.</p>
          </div>
          <div className="rounded-3xl border border-[#2c2300] bg-black p-4 shadow-xl shadow-black/50">
            <div className="flex items-start gap-5">
              <div className="text-5xl font-black text-[#00e68a]">{letter}</div>
              <div className="mt-2 rounded-full bg-[#00d27a] px-5 py-2 text-sm font-black text-black">{displayScore}/100</div>
            </div>
            <div className="mt-1 text-lg text-zinc-200">{text}</div>
            <div className="mt-4 h-2 rounded-full bg-zinc-900"><div className="h-full rounded-full bg-[#00d27a]" style={{width: `${displayScore}%`}} /></div>
            <div className="mt-4 rounded-xl border border-zinc-800 bg-[#090909] p-3 text-xs text-zinc-300">
              <div className="font-black text-[#ffcc19]">Logged in</div>
              <div className="mt-1 break-all">{user?.email || "No email"}</div>
              <button onClick={signOut} className="mt-3 rounded-lg border border-[#ffcc19] px-3 py-2 font-black text-[#ffcc19] hover:bg-[#171200]">Sign Out</button>
            </div>
          </div>
        </div>

        <div className="mt-7 grid gap-5 md:grid-cols-5">
          <Dash label="Confluences" value={report.confluences} />
          <Dash label="Within 5 Points" value={report.within5} />
          <Dash label="Zone Score" value={`${report.zoneScore}/100`} />
          <Dash label="Precision Score" value={`${displayPrecision}/100`} />
          <Dash label="Behavior Score" value={`${behavior.score}/10`} />
        </div>

        <div className="mt-5 rounded-3xl border border-[#2c2300] bg-black p-5 shadow-lg shadow-black/30">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-sm font-black tracking-[0.2em] text-[#ffcc19]">ACTIVE TRADE ANCHOR</div>
              <div className="mt-2 text-2xl font-black text-white">{form.direction}: {Number(form.tradeEntryPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div className="mt-1 text-sm text-zinc-400">Starting Level: {startingLevel || "None selected"} • Top 3 within 5 pts: {report.topWithin5}/3 • Far levels: {report.farCount}</div>
            </div>
            <div className="grid gap-2 text-sm text-zinc-300 md:grid-cols-3">
              {recommendations.map((r) => (
                <div key={r.stop} className="rounded-xl border border-zinc-800 bg-[#090909] p-3">
                  <div className="font-black text-[#ffcc19]">{r.stop}pt Stop</div>
                  <div>Limit: {Number(r.limit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div>Stop: {Number(r.stopArea).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {activeAnchors.length > 0 && (
          <div className="mt-6 rounded-3xl border border-[#ffcc19] bg-black p-5 shadow-xl shadow-yellow-950/20">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-black uppercase tracking-[0.22em] text-[#ffcc19]">👑 Crown Level Board</div>
                <p className="mt-1 text-sm text-zinc-400">Persistent AI levels, clustered sources, precision entries, and private result-learning for your account only.</p>
              </div>
              <button onClick={() => setTab("journal")} className="rounded-xl bg-[#ffcc19] px-4 py-2 font-black text-black">Review / Report</button>
            </div>

            <LevelSection title="👑 Trade Anchors" subtitle="A+ / A levels: strongest limit-order candidates." items={tradeAnchorLevels} selectedTrade={selectedTrade} onSelect={selectActiveAnchor} />
            <LevelSection title="Intermediate Watchlist" subtitle="B+ / B levels: good clusters still building or needing discretion." items={intermediateWatchlist} selectedTrade={selectedTrade} onSelect={selectActiveAnchor} />
            <LevelSection title="Watch Levels" subtitle="C levels: repeat prices and early confluence worth monitoring." items={watchLevels} selectedTrade={selectedTrade} onSelect={selectActiveAnchor} />

            {unfilledOrders.length > 0 && (
              <LevelSection title="Manual Orders" subtitle="Your active manual orders." items={unfilledOrders.map((order) => ({ ...order, sourceType: order.sourceType || "Manual Order" }))} selectedTrade={selectedTrade} onSelect={selectActiveAnchor} />
            )}
          </div>
        )}

        <div className="mt-8 rounded-3xl border border-[#2c2300] bg-black p-2">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <Tab id="trade" tab={tab} setTab={setTab}>Trade Info</Tab>
            <Tab id="checklist" tab={tab} setTab={setTab}>Setup Checklist</Tab>
            <Tab id="settings" tab={tab} setTab={setTab}>AI Settings</Tab>
            <Tab id="behavior" tab={tab} setTab={setTab}>Behavior</Tab>
            <Tab id="breakdown" tab={tab} setTab={setTab}>Score Breakdown</Tab>
            <Tab id="journal" tab={tab} setTab={setTab}>Journal</Tab>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <button onClick={exportSetup} className="rounded-xl bg-[#ffcc19] px-5 py-3 font-black text-black shadow-lg shadow-yellow-950/30">Export Setup File</button>
          <button onClick={printSetup} className="rounded-xl border border-[#ffcc19] bg-black px-5 py-3 font-black text-[#ffcc19] hover:bg-[#171200]">Print / Save PDF</button>
        </div>

        {tab === "trade" && (
          <div className="mt-6 grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <Title>Trade Info</Title>
              <div className="grid gap-5 md:grid-cols-3 mt-5">
                <Field label="Trade Entry Price" value={form.tradeEntryPrice} onChange={(v) => set("tradeEntryPrice", v)} />
                <Select label="Long / Short" value={form.direction} options={["Long", "Short"]} onChange={(v) => set("direction", v)} />
                <Select label="Trend" value={form.trend} options={["With Trend", "Against Trend", "Neutral"]} onChange={(v) => set("trend", v)} />
                <Select label="1H Bias" value={form.bias1H} options={["Bullish", "Bearish", "Indecisive"]} onChange={(v) => set("bias1H", v)} />
                <Select label="4H Bias" value={form.bias4H} options={["Bullish", "Bearish", "Indecisive"]} onChange={(v) => set("bias4H", v)} />
              </div>
              <button onClick={submitOrder} className="mt-5 rounded-xl bg-[#00d27a] px-5 py-3 font-black text-black">
                Submit Order
              </button>
            </Card>
            <Card>
              <Title>Adjusted Recommendations</Title>
              <div className="mt-4 space-y-3">{recommendations.map((r) => <Rec key={r.stop} r={r} />)}</div>
            </Card>
          </div>
        )}

        {tab === "checklist" && (
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <Conf title="Previous Week Level" base="9" active={form.prevWeekLevelOn} onActive={(v) => set("prevWeekLevelOn", v)}>
              <StartControl k="prevWeekLevel" startingLevel={startingLevel} setStart={setStart} disabled={startDisabled("prevWeekLevel")} />
              <Away k="prevWeekLevel" form={form} set={set} startingLevel={startingLevel} />
            </Conf>

            <Conf title="Low Volume Node" base="10" active={form.lowVolumeNodeOn} onActive={(v) => set("lowVolumeNodeOn", v)} sub="Bigger LVN / volume crater = more weight">
              <Field label="How Wide?" value={form.lowVolumeNodeWidth} onChange={(v) => set("lowVolumeNodeWidth", v)} />
              <Field label="Points Away From Starting Level" value={form.lowVolumeNodeAway} onChange={(v) => set("lowVolumeNodeAway", v)} />
            </Conf>

            <Conf title="PlayMaker Signal" base="7.5" active={form.playMakerSignalOn} onActive={(v) => set("playMakerSignalOn", v)}>
              <StartControl k="playMakerSignal" startingLevel={startingLevel} setStart={setStart} disabled={startDisabled("playMakerSignal")} />
              <Away k="playMakerSignal" form={form} set={set} startingLevel={startingLevel} />
            </Conf>

            <Conf title="Prev Session STDV" base="8" active={form.prevSessionSTDVOn} onActive={(v) => set("prevSessionSTDVOn", v)} sub="3, 3.5, 4 and beyond carry stronger reaction weighting">
              <StartControl k="prevSessionSTDV" startingLevel={startingLevel} setStart={setStart} disabled={startDisabled("prevSessionSTDV")} />
              <Select label="STDV" value={form.prevSessionSTDVValue} options={stdvChoices} onChange={(v) => set("prevSessionSTDVValue", v)} />
              <Away k="prevSessionSTDV" form={form} set={set} startingLevel={startingLevel} />
            </Conf>

            <Conf title="Prior Session STDV" base="5.5" active={form.priorSessionSTDVOn} onActive={(v) => set("priorSessionSTDVOn", v)} sub="Prior session STDV carries less weight than current previous session STDV">
              <StartControl k="priorSessionSTDV" startingLevel={startingLevel} setStart={setStart} disabled={startDisabled("priorSessionSTDV")} />
              <Select label="STDV" value={form.priorSessionSTDVValue} options={stdvChoices} onChange={(v) => set("priorSessionSTDVValue", v)} />
              <Away k="priorSessionSTDV" form={form} set={set} startingLevel={startingLevel} />
            </Conf>

            <Conf title="1H STDV" base="6" active={form.oneHSTDVOn} onActive={(v) => set("oneHSTDVOn", v)}>
              <StartControl k="oneHSTDV" startingLevel={startingLevel} setStart={setStart} disabled={startDisabled("oneHSTDV")} />
              <Select label="STDV" value={form.oneHSTDVValue} options={stdvChoices} onChange={(v) => set("oneHSTDVValue", v)} />
              <Away k="oneHSTDV" form={form} set={set} startingLevel={startingLevel} />
            </Conf>

            <Conf title="4H STDV" base="7" active={form.fourHSTDVOn} onActive={(v) => set("fourHSTDVOn", v)}>
              <StartControl k="fourHSTDV" startingLevel={startingLevel} setStart={setStart} disabled={startDisabled("fourHSTDV")} />
              <Select label="STDV" value={form.fourHSTDVValue} options={stdvChoices} onChange={(v) => set("fourHSTDVValue", v)} />
              <Away k="fourHSTDV" form={form} set={set} startingLevel={startingLevel} />
            </Conf>

            <Conf title="15m Retracement" base="5" active={form.retrace15mOn} onActive={(v) => set("retrace15mOn", v)}>
              <StartControl k="retrace15m" startingLevel={startingLevel} setStart={setStart} disabled={startDisabled("retrace15m")} />
              <Select label="Retracement" value={form.retrace15mValue} options={retraceChoices} onChange={(v) => set("retrace15mValue", v)} />
              <Away k="retrace15m" form={form} set={set} startingLevel={startingLevel} />
            </Conf>

            <Conf title="1H Retracement" base="6" active={form.retrace1HOn} onActive={(v) => set("retrace1HOn", v)}>
              <StartControl k="retrace1H" startingLevel={startingLevel} setStart={setStart} disabled={startDisabled("retrace1H")} />
              <Select label="Retracement" value={form.retrace1HValue} options={retraceChoices} onChange={(v) => set("retrace1HValue", v)} />
              <Away k="retrace1H" form={form} set={set} startingLevel={startingLevel} />
            </Conf>

            <Conf title="4H Retracement" base="7" active={form.retrace4HOn} onActive={(v) => set("retrace4HOn", v)}>
              <StartControl k="retrace4H" startingLevel={startingLevel} setStart={setStart} disabled={startDisabled("retrace4H")} />
              <Select label="Retracement" value={form.retrace4HValue} options={retraceChoices} onChange={(v) => set("retrace4HValue", v)} />
              <Away k="retrace4H" form={form} set={set} startingLevel={startingLevel} />
            </Conf>

            <Conf title="Order Block" base="5" active={form.orderBlockOn} onActive={(v) => set("orderBlockOn", v)}>
              <Select label="Highest Timeframe" value={form.orderBlockTF} options={tfChoices} onChange={(v) => set("orderBlockTF", v)} />
              <Select label="Fresh or Prev Tapped" value={form.orderBlockState} options={["Fresh", "Prev Tapped"]} onChange={(v) => set("orderBlockState", v)} />
              <Field label="Points Away From Starting Level" value={form.orderBlockAway} onChange={(v) => set("orderBlockAway", v)} />
            </Conf>

            <Conf title="Rejection Block" base="5" active={form.rejectionBlockOn} onActive={(v) => set("rejectionBlockOn", v)}>
              <Select label="Highest Timeframe" value={form.rejectionBlockTF} options={tfChoices} onChange={(v) => set("rejectionBlockTF", v)} />
              <Select label="Fresh or Prev Tapped" value={form.rejectionBlockState} options={["Fresh", "Prev Tapped"]} onChange={(v) => set("rejectionBlockState", v)} />
              <Field label="Points Away From Starting Level" value={form.rejectionBlockAway} onChange={(v) => set("rejectionBlockAway", v)} />
            </Conf>

            <Conf title="FVG" base="5" active={form.fvgOn} onActive={(v) => set("fvgOn", v)}>
              <Select label="Highest Timeframe" value={form.fvgTF} options={tfChoices} onChange={(v) => set("fvgTF", v)} />
              <Select label="Fresh or Prev Tapped" value={form.fvgState} options={["Fresh", "Prev Tapped"]} onChange={(v) => set("fvgState", v)} />
              <Field label="Points Away From Starting Level" value={form.fvgAway} onChange={(v) => set("fvgAway", v)} />
            </Conf>

            <Conf title="Prev High or Low" base="4" active={form.prevHighLowOn} onActive={(v) => set("prevHighLowOn", v)} sub="More taps means less value">
              <Field label="Points Away From Starting Level" value={form.prevHighLowAway} onChange={(v) => set("prevHighLowAway", v)} />
              <Field label="Times Tapped on 15m" value={form.prevHighLowTaps} onChange={(v) => set("prevHighLowTaps", v)} />
            </Conf>

            <Conf title="LTF Vol Node" base="7" active={form.ltfVolNodeOn} onActive={(v) => set("ltfVolNodeOn", v)}>
              <Field label="Points Away From Starting Level" value={form.ltfVolNodeAway} onChange={(v) => set("ltfVolNodeAway", v)} />
            </Conf>

            <Conf title="Liquidity" base="8" active={form.liquidityOn} onActive={(v) => set("liquidityOn", v)} sub="Yes / No only" />
          </div>
        )}

        {tab === "settings" && (
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <Card>
              <Title>AI Pillar Zones</Title>
              <p className="mt-2 text-zinc-400">Save multiple weekly levels and crater boxes. These are the foundation zones the AI uses with TradingView alerts.</p>

              {aiLevelMessage && <div className="mt-4 rounded-xl border border-[#2c2300] bg-[#090909] p-3 text-sm text-[#ffcc19]">{aiLevelMessage}</div>}

              <div className="mt-5 rounded-2xl border border-zinc-800 bg-[#090909] p-4">
                <h3 className="text-lg font-black text-[#ffcc19]">Weekly Level</h3>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <Field label="Weekly Level Name" value={aiSettings.weeklyLevelName} onChange={(v) => setAiSettings((s) => ({ ...s, weeklyLevelName: v }))} />
                  <Field label="Weekly Level Price" value={aiSettings.weeklyLevelPrice} onChange={(v) => setAiSettings((s) => ({ ...s, weeklyLevelPrice: v }))} />
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button onClick={saveWeeklyLevel} className="rounded-xl bg-[#ffcc19] px-5 py-3 font-black text-black">
                    {editingWeeklyLevelId ? "Update Weekly Level" : "Save Weekly Level"}
                  </button>
                  {editingWeeklyLevelId && <button onClick={resetAiLevelInputs} className="rounded-xl border border-zinc-700 px-5 py-3 font-black text-zinc-200">Cancel Edit</button>}
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-zinc-800 bg-[#090909] p-4">
                <h3 className="text-lg font-black text-[#ffcc19]">Crater Box</h3>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <Field label="Crater Box Name" value={aiSettings.craterBoxName} onChange={(v) => setAiSettings((s) => ({ ...s, craterBoxName: v }))} />
                  <Field label="Crater Top Price" value={aiSettings.volumeCraterTop} onChange={(v) => setAiSettings((s) => ({ ...s, volumeCraterTop: v }))} />
                  <Field label="Crater Bottom Price" value={aiSettings.volumeCraterBottom} onChange={(v) => setAiSettings((s) => ({ ...s, volumeCraterBottom: v }))} />
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <Small label="Crater Width" value={aiCraterSize ? `${fmt(aiCraterSize)} pts` : "--"} />
                  <Small label="Crater Mid" value={aiCraterMid ? fmtPrice(aiCraterMid) : "--"} />
                  <Small label="Crater Mid Away" value={aiCraterAway ? `${fmt(aiCraterAway)} pts` : "--"} />
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button onClick={saveCraterBox} className="rounded-xl bg-[#ffcc19] px-5 py-3 font-black text-black">
                    {editingCraterBoxId ? "Update Crater Box" : "Save Crater Box"}
                  </button>
                  {editingCraterBoxId && <button onClick={resetAiLevelInputs} className="rounded-xl border border-zinc-700 px-5 py-3 font-black text-zinc-200">Cancel Edit</button>}
                </div>
              </div>

              <div className="mt-5">
                <Select label="Use Indicator Auto Signals" value={aiSettings.autoUseIndicator} options={["Yes", "No"]} onChange={(v) => setAiSettings((s) => ({ ...s, autoUseIndicator: v }))} />
              </div>
            </Card>

            <Card>
              <Title>Saved AI Pillars</Title>
              <div className="mt-5">
                <h3 className="font-black text-[#ffcc19]">Weekly Levels</h3>
                <div className="mt-3 space-y-3">
                  {weeklyLevels.length === 0 && <div className="text-sm text-zinc-500">No weekly levels saved.</div>}
                  {weeklyLevels.map((level) => (
                    <div key={level.id} className="rounded-xl border border-zinc-800 bg-[#090909] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-black text-white">{level.name || "Weekly Level"}</div>
                          <div className="mt-1 text-sm text-zinc-400">Price: {fmtPrice(level.price)}</div>
                          <div className="mt-1 text-xs text-zinc-500">Away from entry: {form.tradeEntryPrice && level.price ? `${fmt(Math.abs(Number(level.price) - n(form.tradeEntryPrice)))} pts` : "--"}</div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => editWeeklyLevel(level)} className="rounded-lg border border-[#ffcc19] px-3 py-2 text-xs font-black text-[#ffcc19]">Edit</button>
                          <button onClick={() => deleteAiLevel(level)} className="rounded-lg border border-red-500 px-3 py-2 text-xs font-black text-red-400">Delete</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-7">
                <h3 className="font-black text-[#ffcc19]">Crater Boxes</h3>
                <div className="mt-3 space-y-3">
                  {craterBoxes.length === 0 && <div className="text-sm text-zinc-500">No crater boxes saved.</div>}
                  {craterBoxes.map((box) => {
                    const top = Number(box.top_price);
                    const bottom = Number(box.bottom_price);
                    const valid = Number.isFinite(top) && Number.isFinite(bottom) && top > 0 && bottom > 0 && top !== bottom;
                    const high = valid ? Math.max(top, bottom) : 0;
                    const low = valid ? Math.min(top, bottom) : 0;
                    const mid = valid ? (high + low) / 2 : 0;
                    const width = valid ? Math.abs(high - low) : 0;
                    const away = valid && form.tradeEntryPrice ? Math.abs(mid - n(form.tradeEntryPrice)) : 0;

                    return (
                      <div key={box.id} className={`rounded-xl border bg-[#090909] p-4 ${valid ? "border-zinc-800" : "border-red-500"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-black text-white">{box.name || "Crater Box"}</div>
                            {valid ? (
                              <>
                                <div className="mt-1 text-sm text-zinc-400">Top: {fmtPrice(high)} • Bottom: {fmtPrice(low)}</div>
                                <div className="mt-1 text-sm text-zinc-400">Mid: {fmtPrice(mid)} • Width: {fmt(width)} pts</div>
                                <div className="mt-1 text-xs text-zinc-500">Mid away from entry: {away ? `${fmt(away)} pts` : "--"}</div>
                              </>
                            ) : (
                              <div className="mt-1 text-sm text-red-400">Invalid crater values. Edit or delete this box.</div>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => editCraterBox(box)} className="rounded-lg border border-[#ffcc19] px-3 py-2 text-xs font-black text-[#ffcc19]">Edit</button>
                            <button onClick={() => deleteAiLevel(box)} className="rounded-lg border border-red-500 px-3 py-2 text-xs font-black text-red-400">Delete</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>

            <Card className="lg:col-span-2">
              <Title>AI Setup Checklist Chart</Title>
              <div className="mt-5 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-zinc-400">
                    <tr><th className="p-3">Needed</th><th>Current Value</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {aiChecklist.map((row) => (
                      <tr key={row.item} className="border-t border-zinc-800">
                        <td className="p-3"><b>{row.item}</b><div className="text-xs text-zinc-500">{row.needed}</div></td>
                        <td>{row.value === 0 ? 0 : (row.value || "--")}</td>
                        <td className={row.ready ? "font-black text-[#00d27a]" : "font-black text-[#ffcc19]"}>{row.status || (row.ready ? "Ready" : "Needed")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="lg:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Title>AI Signal Memory</Title>
                <button onClick={fetchAiSignals} className="rounded-xl bg-[#ffcc19] px-4 py-2 font-black text-black">{aiLoading ? "Fetching..." : "Fetch AI Entries"}</button>
              </div>
              {aiFetchMessage && <div className="mt-3 text-sm text-zinc-400">{aiFetchMessage}</div>}
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {aiSignals.length === 0 && <div className="text-zinc-500">No AI signals found yet.</div>}
                {aiSignals.map((signal) => (
                  <div key={signal.id || `${signal.signal}-${signal.created_at}`} className="rounded-xl border border-zinc-800 bg-[#090909] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <b className="text-[#ffcc19]">{signal.signal || "AI_SIGNAL"}</b>
                      <span className={`rounded-full px-3 py-1 text-xs font-black ${isRecentSignal(signal.created_at) ? "bg-[#00d27a] text-black" : "bg-zinc-800 text-zinc-400"}`}>{isRecentSignal(signal.created_at) ? "Recent" : "Historical"}</span>
                    </div>
                    <div className="mt-2 text-sm text-zinc-400">{signal.ticker || "NQ"} • {signal.price || "--"} • {signal.interval || "--"}</div>
                    <div className="mt-1 text-xs text-zinc-500">{signal.created_at ? new Date(signal.created_at).toLocaleString() : "No time"}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {tab === "behavior" && <Behavior behavior={behavior} journal={journal} learningStats={learningStats} />}
        {tab === "breakdown" && <Breakdown report={report} recommendations={recommendations} tips={tips} />}
        {tab === "journal" && (
          <Journal
            journal={journal}
            saveTrade={saveTrade}
            editTrade={editTrade}
            exportJournalCSV={exportJournalCSV}
            form={form}
            set={set}
            editingId={editingId}
            handleImageUpload={handleImageUpload}
          />
        )}
      </div>
    </div>
    </WhopGate>
  );
}

function sourceGroupName(sourceType = "") {
  const text = String(sourceType);
  if (text.includes("STDV") || text.includes("Deviation")) return "STDV";
  if (text.includes("Volume Profile")) return "Volume Profile";
  if (text.includes("Crater") || text.includes("LVN")) return "Craters / LVN";
  if (text.includes("Weekly")) return "Weekly";
  if (text.includes("PlayMaker")) return "PlayMaker";
  if (text.includes("OTE") || text.includes("Retrace")) return "OTE";
  if (text.includes("Order") || text.includes("Rejection")) return "Structure";
  return "Other";
}

function EvidenceList({ evidence = [] }) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    return <div className="mt-3 text-xs text-zinc-500">No source breakdown saved.</div>;
  }

  const groups = evidence.reduce((acc, item) => {
    const key = sourceGroupName(item.sourceType);
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, {});

  return (
    <div className="mt-3 rounded-xl border border-zinc-800 bg-black/60 p-3">
      <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-[#ffcc19]">All Sources</div>
      <div className="space-y-2">
        {Object.entries(groups).map(([group, items]) => (
          <div key={group}>
            <div className="text-[11px] font-black uppercase text-zinc-400">{group}</div>
            <div className="mt-1 space-y-1">
              {items.map((item, idx) => (
                <div key={`${group}-${idx}`} className="flex items-start justify-between gap-2 text-xs text-zinc-300">
                  <span>✓ {item.label || item.sourceType} @ {fmtPrice(item.price)}</span>
                  <span className="shrink-0 font-black text-[#00d27a]">+{Number(item.evidenceScore ?? item.score ?? 0).toFixed(0)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LevelCard({ anchor, selectedTrade, onSelect }) {
  const isAi = anchor.sourceType === "AI Signal";
  const evidence = anchor.evidence || anchor.rawSignal?.evidence || [];
  const selected = selectedTrade?.id === anchor.id;
  return (
    <button
      onClick={() => onSelect(anchor)}
      className={`rounded-2xl border bg-[#090909] p-4 text-left transition hover:border-[#ffcc19] ${selected ? "border-[#ffcc19]" : "border-[#2c2300]"}`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex rounded-full bg-[#ffcc19] px-3 py-1 text-xs font-black text-black">
          {isAi ? (anchor.grade === "A+" ? "👑 CROWN ANCHOR" : "AI LEVEL") : "MANUAL ORDER"}
        </span>
        {isAi && <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs font-black text-zinc-300">Sources {anchor.sourceCount || evidence.length || 0}</span>}
      </div>

      <div className="text-xl font-black text-[#00d27a]">
        {anchor.direction}: {anchor.entry ? fmtPrice(anchor.entry) : "--"}
      </div>

      <div className="mt-1 text-sm text-zinc-400">
        Grade {anchor.grade} • Zone {anchor.zoneScore || anchor.score}/100{anchor.precisionScore ? ` • Precision ${anchor.precisionScore}/100` : ""}
      </div>

      {anchor.clusterWidth !== undefined && (
        <div className="mt-1 text-xs text-[#ffcc19]">
          Center {fmtPrice(anchor.entry)} • Cluster {fmtPrice(anchor.clusterLow)}–{fmtPrice(anchor.clusterHigh)} • Width {fmt(anchor.clusterWidth)} pts
        </div>
      )}

      {anchor.stopPlans && (
        <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] text-zinc-300">
          {anchor.stopPlans.map((plan) => (
            <div key={plan.stop} className={`rounded border px-2 py-1 ${plan.valid ? "border-[#00d27a]" : "border-zinc-700 text-zinc-500"}`}>
              {plan.stop}pt<br />{plan.valid ? "OK" : "Too tight"}
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 text-xs text-zinc-500">
        Created: {anchor.date || "--"}{anchor.updatedAt ? ` • Updated: ${anchor.updatedAt}` : ""}
      </div>

      {anchor.top && <div className="mt-2 text-xs text-zinc-500">{anchor.top}</div>}
      {isAi && <EvidenceList evidence={evidence} />}
    </button>
  );
}

function LevelSection({ title, subtitle, items = [], selectedTrade, onSelect }) {
  if (!items.length) return null;
  return (
    <div className="mt-5">
      <div className="mb-3">
        <div className="text-lg font-black text-white">{title}</div>
        {subtitle && <div className="text-sm text-zinc-500">{subtitle}</div>}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {items.map((anchor) => (
          <LevelCard key={anchor.id} anchor={anchor} selectedTrade={selectedTrade} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function Dash({ label, value }) {
  return <div className="rounded-2xl border border-[#2c2300] bg-black p-6 shadow-lg shadow-black/30"><div className="text-lg text-zinc-200">{label}</div><div className="mt-2 text-4xl font-black text-[#ffcc19]">{value}</div></div>;
}

function Tab({ id, tab, setTab, children }) {
  return <button onClick={() => setTab(id)} className={`rounded-xl px-4 py-3 font-bold ${tab === id ? "bg-white text-black" : "text-zinc-500 hover:text-white"}`}>{children}</button>;
}

function Card({ children, className = "" }) {
  return <div className={`rounded-3xl border border-[#2c2300] bg-black p-6 shadow-xl shadow-black/30 ${className}`}>{children}</div>;
}

function Title({ children }) {
  return <h2 className="text-2xl font-black">{children}</h2>;
}

function Field({ label, value, onChange, disabled }) {
  return <label className="block"><span className="mb-2 block text-sm text-zinc-300">{label}</span><input disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-zinc-700 bg-[#0b0b0b] px-4 py-3 text-white outline-none focus:border-[#ffcc19] disabled:opacity-40" /></label>;
}

function Select({ label, value, options, onChange }) {
  return <label className="block"><span className="mb-2 block text-sm text-zinc-300">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-zinc-700 bg-[#0b0b0b] px-4 py-3 text-white outline-none focus:border-[#ffcc19]">{options.map((o) => <option key={o}>{o}</option>)}</select></label>;
}

function StartControl({ k, startingLevel, setStart, disabled }) {
  const active = startingLevel === k;
  return <button disabled={disabled} onClick={() => setStart(k)} className={`rounded-xl border px-4 py-3 text-left font-bold ${active ? "border-[#ffcc19] bg-[#ffcc19] text-black" : "border-zinc-700 bg-[#0b0b0b] text-zinc-300 disabled:opacity-30"}`}>{active ? "Starting Level ✓" : "Set As Starting Level"}</button>;
}

function Away({ k, form, set, startingLevel }) {
  const key = `${k}Away`;
  return <Field label="Points Away From Starting Level" value={startingLevel === k ? "0" : form[key]} disabled={startingLevel === k} onChange={(v) => set(key, v)} />;
}

function ToggleMini({ value, onChange }) {
  return <div className="grid grid-cols-2 gap-1 rounded-xl border border-zinc-700 bg-[#0b0b0b] p-1"><button onClick={() => onChange("Yes")} className={`rounded-lg py-2 font-black ${value === "Yes" ? "bg-[#ffcc19] text-black" : "text-zinc-400"}`}>Yes</button><button onClick={() => onChange("No")} className={`rounded-lg py-2 font-black ${value === "No" ? "bg-[#ffcc19] text-black" : "text-zinc-400"}`}>No</button></div>;
}

function Conf({ title, base, active, onActive, sub, children }) {
  return <Card><div className="mb-4 flex items-start justify-between gap-4"><div className="flex items-start gap-3"><div className={`mt-1 flex h-8 w-8 items-center justify-center rounded-lg border ${active === "Yes" ? "border-[#ffcc19] bg-[#ffcc19] text-black" : "border-zinc-700 text-transparent"}`}>✓</div><div><h3 className="text-2xl font-black">{title}</h3>{sub && <p className="mt-1 text-zinc-300">{sub}</p>}</div></div><div className="rounded-full border border-[#ffcc19] px-4 py-2 text-sm font-bold text-[#ffcc19]">Base {base}</div></div><ToggleMini value={active} onChange={onActive} /><div className="mt-5 grid gap-4 md:grid-cols-2">{children}</div></Card>;
}

function Rec({ r }) {
  const isInvalid = r.valid === false;
  return <div className={`rounded-2xl border bg-[#090909] p-4 ${isInvalid ? "border-zinc-700 opacity-70" : "border-zinc-800"}`}><div className="flex items-center justify-between"><div className="text-lg font-black text-[#ffcc19]">{r.stop}pt Stop</div><div className={`rounded-full px-3 py-1 text-xs font-black ${isInvalid ? "bg-zinc-700 text-zinc-300" : "bg-[#00d27a] text-black"}`}>{r.confidence}</div></div><div className="mt-3 grid grid-cols-2 gap-3"><Small label="Limit" value={fmt(r.limit)} /><Small label="Stop" value={fmt(r.stopArea)} /></div><p className="mt-3 text-sm text-zinc-400">Based on: {r.match}</p>{r.note && <p className="mt-1 text-xs text-zinc-500">{r.note}</p>}</div>;
}

function Small({ label, value }) {
  return <div className="rounded-xl border border-zinc-800 bg-black p-3"><div className="text-xs text-zinc-500">{label}</div><div className="font-black">{value}</div></div>;
}

function Breakdown({ report, recommendations, tips }) {
  return <div className="mt-6 grid gap-5 lg:grid-cols-2"><Card><Title>Adjusted Recommendations</Title><div className="mt-4 space-y-3">{recommendations.map((r) => <Rec key={r.stop} r={r} />)}</div></Card><Card><Title>Tips</Title><div className="mt-4 space-y-3">{tips.map((t, i) => <div key={i} className="rounded-xl border border-[#2c2300] bg-[#0b0b0b] p-4 text-zinc-200">{t}</div>)}</div></Card><Card className="lg:col-span-2"><Title>Score Breakdown</Title><div className="mt-4 grid gap-3 md:grid-cols-4"><Small label="Zone Score" value={`${report.zoneScore}/100`} /><Small label="Precision Grade Score" value={`${report.score}/100`} /><Small label="Top 3 Within 5" value={`${report.topWithin5}/3`} /><Small label="Far Levels 8+" value={report.farCount} /></div><div className="mt-4 rounded-xl border border-[#2c2300] bg-[#0b0b0b] p-4 text-sm text-zinc-300">Raw points still count the reaction zone. The grade is capped by entry precision: top-weighted confluences need to align within 3–5 points for A/A+.</div><div className="mt-4 grid gap-3 md:grid-cols-2">{report.rows.map((r) => <div key={r.key} className="rounded-xl border border-zinc-800 bg-[#090909] p-4"><div className="flex justify-between"><b>{r.name}</b><b className="text-[#ffcc19]">{r.score.toFixed(1)}</b></div><div className="mt-1 text-sm text-zinc-500">Base {r.base} • Away {r.pointsAway} • {r.note}</div></div>)}</div></Card></div>;
}

function Journal({ journal, saveTrade, editTrade, exportJournalCSV, form, set, editingId, handleImageUpload }) {
  return <div className="mt-6 grid gap-5 lg:grid-cols-[420px_1fr]"><Card><Title>{editingId ? "Edit Report" : "Report Result"}</Title><div className="mt-5 grid gap-4"><Select label="Result" value={form.result} options={["Win", "Loss", "BE", "Unfilled"]} onChange={(v) => set("result", v)} /><Field label="Max Move" value={form.maxMove} onChange={(v) => set("maxMove", v)} /><Field label="Max Drawdown" value={form.maxDrawdown} onChange={(v) => set("maxDrawdown", v)} /><Field label="Profit / Loss $" value={form.profitLoss} onChange={(v) => set("profitLoss", v)} /><label><span className="mb-2 block text-sm text-zinc-300">Notes</span><textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} className="h-28 w-full rounded-lg border border-zinc-700 bg-[#0b0b0b] p-4 text-white outline-none focus:border-[#ffcc19]" /></label><label><span className="mb-2 block text-sm text-zinc-300">Trade Pictures / Screenshots</span><input type="file" multiple accept="image/*" onChange={handleImageUpload} className="w-full rounded-lg border border-zinc-700 bg-[#0b0b0b] px-4 py-3 text-white" /></label>{form.tradeImages?.length > 0 && <div className="grid grid-cols-2 gap-3">{form.tradeImages.map((img, i) => <img key={i} src={img} alt="trade" className="h-32 w-full rounded-xl object-cover border border-zinc-800" />)}</div>}<button onClick={saveTrade} className="rounded-xl bg-[#ffcc19] py-3 font-black text-black">{editingId || form.result !== "Unfilled" ? "Save Result" : "Save To Journal"}</button></div></Card><Card><Title>Journal</Title><button onClick={exportJournalCSV} className="mt-4 rounded-xl bg-[#ffcc19] px-5 py-3 font-black text-black">Export Journal CSV</button><div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-zinc-400"><tr><th className="p-3">Date</th><th>Dir</th><th>Grade</th><th>Result</th><th>Top Confluence</th><th>P/L</th><th></th></tr></thead><tbody>{journal.map((j) => <React.Fragment key={j.id}><tr className="border-t border-zinc-800"><td className="p-3">{j.date}</td><td>{j.direction}</td><td>{j.grade} {j.score}</td><td>{j.result}</td><td>{j.top}</td><td>{j.profitLoss}</td><td><button onClick={() => editTrade(j)} className="text-[#ffcc19] font-bold">Edit</button></td></tr><tr><td colSpan="7" className="px-3 pb-5">{j.notes && <div className="mb-3 text-zinc-400">{j.notes}</div>}{j.tradeImages?.length > 0 && <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{j.tradeImages.map((img, idx) => <img key={idx} src={img} alt="journal" className="h-32 w-full rounded-xl object-cover border border-zinc-800" />)}</div>}</td></tr></React.Fragment>)}</tbody></table>{journal.length === 0 && <div className="p-6 text-zinc-500">No saved trades yet.</div>}</div></Card></div>;
}

function Behavior({ behavior, journal, learningStats = [] }) {
  return <div className="mt-6 grid gap-5 lg:grid-cols-2"><Card><Title>Behavior Rating</Title><div className="mt-6 text-7xl font-black text-[#00d27a]">{behavior.score}/10</div><p className="mt-3 text-zinc-300">Based on saved results and notes. Notes mentioning chasing/late reduce behavior score. Notes mentioning patience/followed plan improve it.</p><div className="mt-5 grid grid-cols-4 gap-3"><Small label="Trades" value={behavior.total} /><Small label="Wins" value={behavior.wins} /><Small label="Losses" value={behavior.losses} /><Small label="BE" value={behavior.be} /></div></Card><Card><Title>Private AI Result Learning</Title><p className="mt-2 text-sm text-zinc-400">Only your logged-in account sees this. It calculates which source families and repeat-level combinations are working from your saved results.</p><div className="mt-4 space-y-3">{learningStats.slice(0,8).map((row) => <div key={row.name} className="rounded-xl border border-zinc-800 bg-[#090909] p-4"><div className="flex items-center justify-between gap-3"><b className="text-[#ffcc19]">{row.name}</b><span className="font-black text-[#00d27a]">{row.winRate}%</span></div><div className="mt-1 text-xs text-zinc-500">Trades {row.trades} • Wins {row.wins} • Losses {row.losses} • BE {row.be} • Avg move {fmt(row.avgMaxMove)} • Avg DD {fmt(row.avgDrawdown)}</div></div>)}{learningStats.length === 0 && <div className="text-zinc-500">Save completed trade results to populate AI learning stats.</div>}</div></Card><Card className="lg:col-span-2"><Title>Behavior Notes</Title><div className="mt-4 space-y-3">{journal.slice(0,5).map((j) => <div key={j.id} className="rounded-xl border border-zinc-800 bg-[#090909] p-4"><b>{j.result}</b><p className="mt-1 text-zinc-400">{j.notes || "No notes"}</p></div>)}{journal.length === 0 && <div className="text-zinc-500">Save journal results to populate behavior reports.</div>}</div></Card></div>;
}
