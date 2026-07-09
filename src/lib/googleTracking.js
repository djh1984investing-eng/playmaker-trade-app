const GOOGLE_ADS_ID = import.meta.env.VITE_GOOGLE_ADS_ID || "AW-18068394381";
const GOOGLE_ADS_CONVERSION_LABEL = import.meta.env.VITE_GOOGLE_ADS_CONVERSION_LABEL || "2Ku8CNzH4bocEI2j16dD";

export function trackAnalyticsEvent(eventName, params = {}) {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;

  window.gtag("event", eventName, {
    app_name: "playmaker",
    ...params
  });
}

export function trackHomeClick(clickTarget, params = {}) {
  trackAnalyticsEvent("playmaker_home_click", {
    click_target: clickTarget,
    page_area: params.pageArea || "home",
    link_url: params.linkUrl || "",
    button_text: params.buttonText || clickTarget,
    visitor_state: params.visitorState || "logged_out"
  });
}

export function trackBuyAccessClick() {
  trackHomeClick("buy_playmaker_access", {
    pageArea: "access",
    linkUrl: "https://whop.com/checkout/plan_wQepCbh0j806f",
    buttonText: "Buy Playmaker Access"
  });

  if (typeof window === "undefined" || typeof window.gtag !== "function") return;

  window.gtag("event", "conversion", {
    send_to: `${GOOGLE_ADS_ID}/${GOOGLE_ADS_CONVERSION_LABEL}`
  });
}
