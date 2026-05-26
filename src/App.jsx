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

const stdvChoices = ["0", "0.5", "0.705", "1", "1.5", "2", "2.25", "2.5", "3", "3.5", "4", "4.5", "-0.5", "-0.705", "-1", "-1.5", "-2", "-2.25", "-2.5", "-3", "-3.5", "-4", "-4.25", "-4.5"];
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
          formSnapshot: null
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
    const entry = n(form.tradeEntryPrice);
    const side = dirSide(form.direction);

    const priorityByStop = {
      7: ["ltfVolNode", "playMakerSignal", "fvg", "orderBlock", "rejectionBlock", "lowVolumeNode"],
      10: ["lowVolumeNode", "playMakerSignal", "prevWeekLevel", "prevSessionSTDV", "fourHSTDV", "ltfVolNode"],
      12: ["prevWeekLevel", "prevSessionSTDV", "fourHSTDV", "lowVolumeNode", "priorSessionSTDV", "liquidity"]
    };

    const active = report.rows
      .filter((r) => r.active && r.score > 0 && r.key !== "liquidity")
      .map((r) => ({ ...r, pullback: Math.abs(n(r.pointsAway)), signedPullback: n(r.pointsAway) }));

    return [7, 10, 12].map((stop) => {
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
  }, [report.rows, form.tradeEntryPrice, form.direction]);

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

    return {
      id: extra.id || selectedTrade?.id || editingId || Date.now(),
      date: new Date().toLocaleDateString(),
      direction: form.direction,
      entry: form.tradeEntryPrice,
      grade: grade(report.score)[0],
      score: report.score,
      result: normalizedResult,
      orderStatus: normalizedResult === "Unfilled" ? "Unfilled" : "Reported",
      pendingOrder: normalizedResult === "Unfilled",
      maxMove: form.maxMove,
      maxDrawdown: form.maxDrawdown,
      profitLoss: form.profitLoss,
      notes,
      tradeImages: form.tradeImages,
      top: report.active.slice(0, 4).map((r) => r.name).join(", "),
      sourceType,
      signal_id: extra.signal_id || selectedTrade?.signal_id || "",
      signalName,
      formSnapshot: { ...form }
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
    confluences: report.active,
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
        confluences: report.active,
        recommendations,
        notes: item.notes || null
      }
    ]);

    if (error) {
      console.error("AI trade memory save error:", error);
    }
  };

  const submitOrder = async () => {
    const item = makeJournalItem("Unfilled", { sourceType: "Manual Order" });
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
    const signalText = String(firstDefined(signal.signal, signal.side, signal.action, "AI Signal"));
    const lowerSignal = signalText.toLowerCase();
    const inferredDirection = lowerSignal.includes("short") || lowerSignal.includes("sell") ? "Short" : "Long";
    const entryValue = firstDefined(signal.entry, signal.entry_price, signal.price, signal.close, signal.alert_price, fallbackForm.tradeEntryPrice, "");
    const nearestWeekly = closestWeeklyLevelToEntry(entryValue);
    const nearestCrater = closestCraterBoxToEntry(entryValue);

    const playMakerSignalOn = parseYesNo(firstDefined(signal.playmaker_signal, signal.playMakerSignal, signal.pm_signal, signal.signal_active));
    const liquidityOn = parseYesNo(firstDefined(signal.liquidity, signal.liquidity_on));
    const lvnPrice = parsePrice(firstDefined(signal.lvn, signal.low_volume_node, signal.lowVolumeNode, signal.volume_node));
    const ltfNodePrice = parsePrice(firstDefined(signal.ltf_vol_node, signal.ltf_volume_node, signal.ltfVolNode));
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

    const prevSessionSTDV = firstDefined(signal.stdv_session, signal.session_stdv, signal.prev_session_stdv, signal.prevSessionSTDV);
    if (prevSessionSTDV !== undefined) {
      next.prevSessionSTDVOn = "Yes";
      next.prevSessionSTDVValue = normalizeSTDV(prevSessionSTDV);
      next.prevSessionSTDVAway = String(firstDefined(signal.prev_session_stdv_away, signal.stdv_session_away, "0"));
    }

    const oneHSTDV = firstDefined(signal.stdv_1h, signal.oneHSTDV, signal.one_h_stdv);
    if (oneHSTDV !== undefined) {
      next.oneHSTDVOn = "Yes";
      next.oneHSTDVValue = normalizeSTDV(oneHSTDV);
      next.oneHSTDVAway = String(firstDefined(signal.stdv_1h_away, signal.one_h_stdv_away, "0"));
    }

    const fourHSTDV = firstDefined(signal.stdv_4h, signal.fourHSTDV, signal.four_h_stdv);
    if (fourHSTDV !== undefined) {
      next.fourHSTDVOn = "Yes";
      next.fourHSTDVValue = normalizeSTDV(fourHSTDV);
      next.fourHSTDVAway = String(firstDefined(signal.stdv_4h_away, signal.four_h_stdv_away, "0"));
    }

    const fib15 = firstDefined(signal.fib_15m, signal.retrace_15m, signal.retrace15m);
    if (fib15 !== undefined) {
      next.retrace15mOn = "Yes";
      next.retrace15mValue = normalizeRetrace(fib15);
      next.retrace15mAway = String(firstDefined(signal.fib_15m_away, signal.retrace_15m_away, "0"));
    }

    const fib1h = firstDefined(signal.fib_1h, signal.retrace_1h, signal.retrace1H);
    if (fib1h !== undefined) {
      next.retrace1HOn = "Yes";
      next.retrace1HValue = normalizeRetrace(fib1h);
      next.retrace1HAway = String(firstDefined(signal.fib_1h_away, signal.retrace_1h_away, "0"));
    }

    const fib4h = firstDefined(signal.fib_4h, signal.retrace_4h, signal.retrace4H);
    if (fib4h !== undefined) {
      next.retrace4HOn = "Yes";
      next.retrace4HValue = normalizeRetrace(fib4h);
      next.retrace4HAway = String(firstDefined(signal.fib_4h_away, signal.retrace_4h_away, "0"));
    }

    if (entryNumber !== null && ltfNodePrice !== null) {
      next.ltfVolNodeOn = "Yes";
      next.ltfVolNodeAway = String(fmt(Math.abs(ltfNodePrice - entryNumber)));
    }

    return { next, signalText, inferredDirection, entryValue };
  };

  const selectAiSignal = (signal) => {
    const { next, signalText, inferredDirection, entryValue } = buildFormFromAiSignal(signal, form);

    const item = {
      id: `ai-${signal.id || signal.created_at || Date.now()}`,
      date: signal.created_at ? new Date(signal.created_at).toLocaleDateString() : new Date().toLocaleDateString(),
      direction: inferredDirection,
      entry: entryValue || "",
      grade: "AI",
      score: 0,
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
      formSnapshot: null
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

  const [letter, text] = grade(report.score);
  const unfilledOrders = journal.filter((j) => isOpenOrder(j));

  const activeAnchors = [
    ...unfilledOrders.map((order) => ({
      ...order,
      sourceType: order.sourceType || "Manual Order"
    })),
    ...unfilledAiSignals.map((signal) => ({
      id: `ai-${signal.id || signal.created_at || signal.signal}`,
      date: signal.created_at ? new Date(signal.created_at).toLocaleDateString() : new Date().toLocaleDateString(),
      direction: String(signal.signal || "").toLowerCase().includes("short") || String(signal.signal || "").toLowerCase().includes("sell") ? "Short" : "Long",
      entry: firstDefined(signal.entry, signal.entry_price, signal.price, signal.close, signal.alert_price, ""),
      grade: "AI",
      score: "--",
      result: "Unfilled",
      orderStatus: "Unfilled",
      pendingOrder: true,
      maxMove: "",
      maxDrawdown: "",
      profitLoss: "",
      notes: `AI Signal: ${signal.signal || "AI Signal"}`,
      tradeImages: [],
      top: signal.signal || "AI Signal",
      sourceType: "AI Signal",
      signal_id: signal.id || "",
      signalName: signal.signal || "AI Signal",
      rawSignal: signal
    }))
  ];

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
              <div className="mt-2 rounded-full bg-[#00d27a] px-5 py-2 text-sm font-black text-black">{report.score}/100</div>
            </div>
            <div className="mt-1 text-lg text-zinc-200">{text}</div>
            <div className="mt-4 h-2 rounded-full bg-zinc-900"><div className="h-full rounded-full bg-[#00d27a]" style={{width: `${report.score}%`}} /></div>
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
          <Dash label="Precision Score" value={`${report.score}/100`} />
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
                <div className="text-sm font-black uppercase tracking-[0.22em] text-[#ffcc19]">Active Trade Anchors</div>
                <p className="mt-1 text-sm text-zinc-400">Manual orders and AI signals. Click one to load its trade info, checklist, grade, and report form.</p>
              </div>
              <button onClick={() => setTab("journal")} className="rounded-xl bg-[#ffcc19] px-4 py-2 font-black text-black">Review / Report</button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {activeAnchors.map((anchor) => (
                <button
                  key={anchor.id}
                  onClick={() => selectActiveAnchor(anchor)}
                  className={`rounded-2xl border bg-[#090909] p-4 text-left transition hover:border-[#ffcc19] ${selectedTrade?.id === anchor.id ? "border-[#ffcc19]" : "border-[#2c2300]"}`}
                >
                  <div className="mb-2 inline-flex rounded-full bg-[#ffcc19] px-3 py-1 text-xs font-black text-black">
                    {anchor.sourceType === "AI Signal" ? "AI SIGNAL" : "MANUAL ORDER"}
                  </div>
                  <div className="text-xl font-black text-[#00d27a]">
                    {anchor.direction}: {anchor.entry ? Number(anchor.entry).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "--"}
                  </div>
                  <div className="mt-1 text-sm text-zinc-400">Grade {anchor.grade} • {anchor.score}/100</div>
                  <div className="mt-1 text-xs text-zinc-500">{anchor.date} • {anchor.top || "No top confluence saved"}</div>
                </button>
              ))}
            </div>
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

        {tab === "behavior" && <Behavior behavior={behavior} journal={journal} />}
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
  return <div className="rounded-2xl border border-zinc-800 bg-[#090909] p-4"><div className="flex items-center justify-between"><div className="text-lg font-black text-[#ffcc19]">{r.stop}pt Stop</div><div className="rounded-full bg-[#00d27a] px-3 py-1 text-xs font-black text-black">{r.confidence}</div></div><div className="mt-3 grid grid-cols-2 gap-3"><Small label="Limit" value={fmt(r.limit)} /><Small label="Stop" value={fmt(r.stopArea)} /></div><p className="mt-3 text-sm text-zinc-400">Based on: {r.match}</p>{r.note && <p className="mt-1 text-xs text-zinc-500">{r.note}</p>}</div>;
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

function Behavior({ behavior, journal }) {
  return <div className="mt-6 grid gap-5 lg:grid-cols-2"><Card><Title>Behavior Rating</Title><div className="mt-6 text-7xl font-black text-[#00d27a]">{behavior.score}/10</div><p className="mt-3 text-zinc-300">Based on saved results and notes. Notes mentioning chasing/late reduce behavior score. Notes mentioning patience/followed plan improve it.</p><div className="mt-5 grid grid-cols-4 gap-3"><Small label="Trades" value={behavior.total} /><Small label="Wins" value={behavior.wins} /><Small label="Losses" value={behavior.losses} /><Small label="BE" value={behavior.be} /></div></Card><Card><Title>Behavior Notes</Title><div className="mt-4 space-y-3">{journal.slice(0,5).map((j) => <div key={j.id} className="rounded-xl border border-zinc-800 bg-[#090909] p-4"><b>{j.result}</b><p className="mt-1 text-zinc-400">{j.notes || "No notes"}</p></div>)}{journal.length === 0 && <div className="text-zinc-500">Save journal results to populate behavior reports.</div>}</div></Card></div>;
}
