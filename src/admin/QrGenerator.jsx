// QrGenerator.jsx
// Herramienta interna (no la ve el usuario final) para generar el QR que se
// imprime en la caja / patch de cada dispositivo.
//
// Instalar dependencia en tu proyecto:
//   npm install qrcode.react
//
// Uso: /admin/qr-generator (o donde la quieras montar dentro de tu app)

import { useState } from "react";
import { QRCodeCanvas } from "qrcode.react";

const BASE_URL = "https://patch-onboarding.vercel.app/"; // <-- cambia esto por tu dominio real de Vercel

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
      <h2>Generador de QR por dispositivo</h2>

      <label style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>
        ID del dispositivo
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

      <button onClick={downloadPng} style={{ marginTop: 12, padding: "10px 16px" }}>
        Descargar PNG
      </button>
    </div>
  );
}
