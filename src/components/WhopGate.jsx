import { useEffect, useState } from "react";

export default function WhopGate({ children }) {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    try {
      const whopUser = localStorage.getItem("whop-user");

      if (whopUser) {
        setAllowed(true);
      } else {
        setAllowed(false);
      }
    } catch (e) {
      console.error(e);
      setAllowed(false);
    }

    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#000",
          color: "#FFD700",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "24px"
        }}
      >
        Loading...
      </div>
    );
  }

  if (!allowed) {
    return (
      <div
        style={{
          minHeight:"100vh",
          background:"#000",
          color:"#FFD700",
          display:"flex",
          alignItems:"center",
          justifyContent:"center",
          flexDirection:"column"
        }}
      >
        <h1>PlayMaker Access Required</h1>

        <a
          href="https://whop.com"
          style={{
            marginTop:"20px",
            padding:"12px 25px",
            background:"#FFD700",
            color:"#000",
            borderRadius:"10px",
            textDecoration:"none",
            fontWeight:"bold"
          }}
        >
          Join PlayMaker
        </a>
      </div>
    );
  }

  return children;
}