import { useEffect, useState } from "react";

export default function WhopGate({ children }) {
  const [status, setStatus] = useState("checking");
  const [reason, setReason] = useState("");

  useEffect(() => {
    const checkAccess = async () => {
      try {
        const res = await fetch("/api/check-whop-access", {
          method: "GET",
          credentials: "include",
        });

        const data = await res.json();

        if (data.ok) {
          setStatus("allowed");
        } else {
          setStatus("denied");
          setReason(data.reason || "No active Whop access.");
        }
      } catch (err) {
        setStatus("denied");
        setReason(err?.message || "Whop access check failed.");
      }
    };

    checkAccess();
  }, []);

  if (status === "checking") {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="rounded-xl border border-[#ffcc19] bg-[#080808] p-6 text-center">
          <div className="text-2xl font-black text-[#ffcc19]">
            Checking Whop Access...
          </div>
        </div>
      </div>
    );
  }

  if (status === "denied") {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-red-500 bg-[#080808] p-6 text-center">
          <div className="text-2xl font-black text-red-400">
            No Playmaker Access
          </div>
          <p className="mt-3 text-zinc-300">{reason}</p>
          <p className="mt-3 text-sm text-zinc-500">
            Open Playmaker from inside your Whop dashboard.
          </p>
        </div>
      </div>
    );
  }

  return children;
}