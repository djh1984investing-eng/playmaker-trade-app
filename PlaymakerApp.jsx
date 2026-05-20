import React from "react";

export default function PlaymakerApp() {
  return (
    <div style={{background:"#09090b", color:"white", minHeight:"100vh", padding:"40px"}}>
      <h1 style={{fontSize:"42px", fontWeight:"bold"}}>
        Play Maker Trade Grader
      </h1>

      <p style={{marginTop:"12px", color:"#a1a1aa"}}>
        Base production starter build for Whop integration.
      </p>

      <div style={{
        marginTop:"30px",
        border:"1px solid #27272a",
        borderRadius:"18px",
        padding:"20px",
        background:"#18181b"
      }}>
        <h2 style={{fontSize:"24px"}}>Next Production Steps</h2>

        <ul style={{marginTop:"16px", lineHeight:"2"}}>
          <li>• Preserve approved dashboard layout</li>
          <li>• Add Whop authentication</li>
          <li>• Add subscription locking</li>
          <li>• Add cloud journal saves</li>
          <li>• Add export/report system</li>
          <li>• Add learning analytics</li>
        </ul>
      </div>
    </div>
  );
}
