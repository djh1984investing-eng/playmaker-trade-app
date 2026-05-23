import { useEffect, useState } from "react";

export default function WhopGate({ children }) {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    async function checkAccess() {
      try {
        const token =
          window?.Whop?.userToken ||
          new URLSearchParams(window.location.search).get("access_token");

        const response = await fetch("/api/check-whop-access", {
          headers: {
            "x-whop-user-token": token || "",
          },
        });

        const data = await response.json();
        setAllowed(data.ok === true);
      } catch (error) {
        console.error("WhopGate error:", error);
        setAllowed(false);
      } finally {
        setLoading(false);
      }
    }

    checkAccess();
  }, []);

  if (loading) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "#000",
        color: "#FFD700",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "24px",
        fontWeight: "bold",
      }}>
        Checking Playmaker Access...
      </div>
    );
  }

  if (!allowed) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "#000",
        color: "#FFD700",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "20px",
        padding: "20px",
        textAlign: "center",
      }}>
        <h1>Playmaker Access Required</h1>
        <p>You must own an active Playmaker membership through Whop to use this app.</p>

        <a
          href="https://whop.com/mr-djharrison/playmaker-trade-setup-rating"
          target="_blank"
          rel="noreferrer"
          style={{
            background: "#FFD700",
            color: "#000",
            padding: "14px 24px",
            borderRadius: "12px",
            textDecoration: "none",
            fontWeight: "bold",
          }}
        >
          Get Access
        </a>
      </div>
    );
  }

  return children;
}