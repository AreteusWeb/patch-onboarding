// DeviceSetupPage.jsx
// Página que abre el usuario al escanear el QR del dispositivo.
// Ruta sugerida en tu app: /setup?id=CP-A3F2
//
// Flujo:
// 1. Si es iPhone / no hay Web Bluetooth -> mostrar instrucciones de SoftAP (fallback)
// 2. Si hay Web Bluetooth -> conectar por BLE, leer redes WiFi cercanas, pedir
//    contraseña, cifrar y enviar credenciales, esperar confirmación.

import { useEffect, useRef, useState } from "react";
import {
  BLE_SERVICE_UUID,
  CHAR_WIFI_LIST_UUID,
  CHAR_CREDENTIALS_UUID,
  CHAR_STATUS_UUID,
  encryptCredentials,
  writeCredentialsChunked,
  decodeJsonValue,
  isWebBluetoothAvailable,
  isIOS,
} from "../utils/bleProtocol"; // ajustado: bleProtocol.js vive en src/utils/

const STEPS = {
  START: "start",
  CONNECTING: "connecting",
  SCANNING_WIFI: "scanning_wifi",
  CHOOSE_NETWORK: "choose_network",
  SENDING: "sending",
  SUCCESS: "success",
  ERROR: "error",
  IOS_FALLBACK: "ios_fallback",
};

export default function DeviceSetupPage() {
  const [deviceId, setDeviceId] = useState(null);
  const [step, setStep] = useState(STEPS.START);
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);
  const [networks, setNetworks] = useState([]);
  const [selectedSsid, setSelectedSsid] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [gattServer, setGattServer] = useState(null);
  const [credentialsChar, setCredentialsChar] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setDeviceId(params.get("id") || "DESCONOCIDO");

    if (isIOS() || !isWebBluetoothAvailable()) {
      setStep(STEPS.IOS_FALLBACK);
    }
  }, []);

  async function handleConnect() {
    setErrorMsg("");
    setStep(STEPS.CONNECTING);
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [BLE_SERVICE_UUID] }],
      });

      const server = await device.gatt.connect();
      setGattServer(server);
      const service = await server.getPrimaryService(BLE_SERVICE_UUID);

      // 1. Leer la lista de redes WiFi que el dispositivo escaneó
      setStep(STEPS.SCANNING_WIFI);
      const wifiListChar = await service.getCharacteristic(CHAR_WIFI_LIST_UUID);
      const wifiListValue = await wifiListChar.readValue();
      const list = decodeJsonValue(wifiListValue) || [];
      setNetworks(list);

      // 2. Preparar la característica de credenciales para escribir después
      const credChar = await service.getCharacteristic(CHAR_CREDENTIALS_UUID);
      setCredentialsChar(credChar);

      // 3. Suscribirse al status para saber si la conexión WiFi del device funcionó
      const statusChar = await service.getCharacteristic(CHAR_STATUS_UUID);
      await statusChar.startNotifications();
      statusChar.addEventListener("characteristicvaluechanged", (event) => {
        const status = decodeJsonValue(event.target.value);
        if (!status) return;
        if (status.status === "connected") {
          setStep(STEPS.SUCCESS);
          // Pequeña pausa antes de cortar BLE: le da tiempo a cualquier
          // write que aún estuviera confirmándose del lado de Android.
          setTimeout(() => device.gatt.disconnect(), 500);
        } else if (status.status === "failed") {
          setErrorMsg("El dispositivo no pudo conectarse a esa red. Verifica la contraseña.");
          setStep(STEPS.ERROR);
        }
      });

      setStep(STEPS.CHOOSE_NETWORK);
    } catch (err) {
      console.error(err);
      setErrorMsg(
        err.name === "NotFoundError"
          ? "No se seleccionó ningún dispositivo."
          : "No se pudo conectar por Bluetooth. Intenta de nuevo."
      );
      setStep(STEPS.ERROR);
    }
  }

  async function handleSubmitCredentials(e) {
    e.preventDefault();
    if (!selectedSsid || !password || !credentialsChar) return;

    setStep(STEPS.SENDING);
    setErrorMsg("");
    try {
      const payload = await encryptCredentials(selectedSsid, password);
      await writeCredentialsChunked(credentialsChar, payload);
      // Ahora esperamos la notificación de status (ver listener arriba)
    } catch (err) {
      console.error(err);
      // Si ya habíamos llegado a SUCCESS (porque la notificación de "connected"
      // ya llegó), un error tardío aquí es solo un write que truena por el
      // disconnect que disparamos al tener éxito. Lo ignoramos, no es un error real.
      if (stepRef.current === STEPS.SUCCESS) return;
      setErrorMsg("No se pudieron enviar las credenciales. Intenta de nuevo.");
      setStep(STEPS.ERROR);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Configurar tu dispositivo</h1>
        <p style={styles.deviceId}>ID: {deviceId}</p>

        {step === STEPS.IOS_FALLBACK && (
          <div>
            <p>
              Tu teléfono no soporta Bluetooth desde el navegador. No te
              preocupes, vamos a conectarlo por WiFi directo:
            </p>
            <ol style={styles.list}>
              <li>Ve a Configuración &gt; WiFi en tu iPhone</li>
              <li>
                Conéctate a la red <strong>ChestPatch_Setup_{deviceId}</strong>
              </li>
              <li>Se abrirá una página automáticamente — sigue las instrucciones ahí</li>
            </ol>
          </div>
        )}

        {step === STEPS.START && (
          <div>
            <p>Vamos a conectar tu dispositivo a tu WiFi de casa. Toma menos de un minuto.</p>
            <button style={styles.button} onClick={handleConnect}>
              Conectar por Bluetooth
            </button>
          </div>
        )}

        {step === STEPS.CONNECTING && <p>Buscando tu dispositivo...</p>}
        {step === STEPS.SCANNING_WIFI && <p>Leyendo redes WiFi cercanas...</p>}

        {step === STEPS.CHOOSE_NETWORK && (
          <form onSubmit={handleSubmitCredentials}>
            <label style={styles.label}>Selecciona tu red WiFi</label>
            <select
              style={styles.input}
              value={selectedSsid}
              onChange={(e) => setSelectedSsid(e.target.value)}
              required
            >
              <option value="" disabled>
                Elige una red
              </option>
              {networks.map((n) => (
                <option key={n.ssid} value={n.ssid}>
                  {n.ssid} {n.rssi ? `(${n.rssi} dBm)` : ""}
                </option>
              ))}
            </select>

            <label style={styles.label}>Contraseña</label>
            <input
              style={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            <button style={styles.button} type="submit">
              Conectar
            </button>
          </form>
        )}

        {step === STEPS.SENDING && <p>Enviando credenciales...</p>}

        {step === STEPS.SUCCESS && (
          <p style={styles.success}>✅ ¡Listo! Tu dispositivo ya está conectado a WiFi.</p>
        )}

        {step === STEPS.ERROR && (
          <div>
            <p style={styles.error}>{errorMsg}</p>
            <button style={styles.button} onClick={() => setStep(STEPS.START)}>
              Intentar de nuevo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0f1115",
    padding: 16,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  card: {
    background: "#ffffff",
    borderRadius: 16,
    padding: 32,
    maxWidth: 420,
    width: "100%",
    boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
  },
  title: { fontSize: 22, margin: 0, marginBottom: 4 },
  deviceId: { color: "#888", fontSize: 13, marginBottom: 20 },
  label: { display: "block", fontSize: 13, fontWeight: 600, marginTop: 16, marginBottom: 6 },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #ddd",
    fontSize: 15,
    boxSizing: "border-box",
  },
  button: {
    marginTop: 20,
    width: "100%",
    padding: "12px 16px",
    borderRadius: 8,
    border: "none",
    background: "#1a73e8",
    color: "#fff",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
  },
  list: { paddingLeft: 20, lineHeight: 1.6 },
  success: { color: "#188038", fontWeight: 600 },
  error: { color: "#c5221f" },
};
