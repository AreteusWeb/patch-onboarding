// QrGenerator.jsx
// Internal tool (not seen by end users) to generate the QR code that gets
// printed on the box / patch of each device.
//
// Install dependency in your project:
//   npm install qrcode.react
//
// Usage: /admin/qr-generator (or wherever you mount it inside your app)

import { useState } from "react";
import { QRCodeCanvas } from "qrcode.react";

const BASE_URL = "https://patch-onboarding.vercel.app/"; // <-- change to your real domain

export default function QrGenerator() {
  const [deviceId, setDeviceId] = useState("CP-A3F2");

  const setupUrl = `${BASE_URL}?id=${encodeURIComponent(deviceId)}`;

  function downloadPng() {
    const canvas = document.getElementById("device-qr-canvas");
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `qr-${deviceId}.png`;
    a.click();
  }

  return (
    <div style={{ padding: 32, fontFamily: "system-ui, sans-serif", maxWidth: 360 }}>
      <h2>Device QR Generator</h2>

      <label style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>
        Device ID
      </label>
      <input
        style={{ width: "100%", padding: 8, marginBottom: 16 }}
        value={deviceId}
        onChange={(e) => setDeviceId(e.target.value)}
      />

      <div style={{ background: "#fff", padding: 16, display: "inline-block" }}>
        <QRCodeCanvas id="device-qr-canvas" value={setupUrl} size={220} includeMargin />
      </div>

      <p style={{ fontSize: 12, color: "#666", marginTop: 12, wordBreak: "break-all" }}>
        {setupUrl}
      </p>

      <button
        onClick={downloadPng}
        style={{
          marginTop: 12,
          padding: "10px 16px",
          background: "#1863FD",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Download PNG
      </button>
    </div>
  );
}
