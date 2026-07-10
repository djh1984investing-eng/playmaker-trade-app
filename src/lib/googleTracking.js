const GOOGLE_ADS_ID = import.meta.env.VITE_GOOGLE_ADS_ID || "AW-18068394381";
const GOOGLE_ADS_CONVERSION_LABEL = import.meta.env.VITE_GOOGLE_ADS_CONVERSION_LABEL || "2Ku8CNzH4bocEI2j16dD";

function getGoogleTag() {
  if (typeof window === "undefined") return null;
  if (typeof window.gtag === "function") return window.gtag;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };

  return window.gtag;
}

export function trackAnalyticsEvent(eventName, params = {}) {
  const gtag = getGoogleTag();
  if (!gtag) return;

  gtag("event", eventName, {
    app_name: "playmaker",
    ...params
  });
}

function cleanEventName(value) {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28) || "unknown";
}

export function trackHomeClick(clickTarget, params = {}) {
  const eventParams = {
    click_target: clickTarget,
    page_area: params.pageArea || "home",
    link_url: params.linkUrl || "",
    button_text: params.buttonText || clickTarget,
    visitor_state: params.visitorState || "logged_out"
  };

  trackAnalyticsEvent("playmaker_home_click", eventParams);
  trackAnalyticsEvent(`click_${cleanEventName(clickTarget)}`, eventParams);
}

export function trackBuyAccessClick() {
  trackHomeClick("buy_playmaker_access", {
    pageArea: "access",
    linkUrl: "https://whop.com/checkout/plan_wQepCbh0j806f",
    buttonText: "Buy Playmaker Access"
  });

  const gtag = getGoogleTag();
  if (!gtag) return;

  gtag("event", "conversion", {
    send_to: `${GOOGLE_ADS_ID}/${GOOGLE_ADS_CONVERSION_LABEL}`
  });
}
