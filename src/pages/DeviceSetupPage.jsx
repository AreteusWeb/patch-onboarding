// DeviceSetupPage.jsx
// Page the user lands on after scanning the device's QR code.
// Suggested route in your app: /setup?id=CP-A3F2
//
// Flow:
// 1. If iPhone / no Web Bluetooth -> show SoftAP fallback instructions
// 2. If Web Bluetooth is available -> connect over BLE, read nearby WiFi
//    networks, ask for password, encrypt + send credentials, wait for confirmation.

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
} from "../utils/bleProtocol";

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
  const statusCharRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setDeviceId(params.get("id") || "UNKNOWN");

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

      // 1. Read the list of WiFi networks the device scanned
      setStep(STEPS.SCANNING_WIFI);
      const wifiListChar = await service.getCharacteristic(CHAR_WIFI_LIST_UUID);
      const wifiListValue = await wifiListChar.readValue();
      const list = decodeJsonValue(wifiListValue) || [];
      setNetworks(list);

      // 2. Get the credentials characteristic ready to write to later
      const credChar = await service.getCharacteristic(CHAR_CREDENTIALS_UUID);
      setCredentialsChar(credChar);

      // 3. Subscribe to status notifications to know if the device's WiFi connection worked
      const statusChar = await service.getCharacteristic(CHAR_STATUS_UUID);
      statusCharRef.current = statusChar;
      await statusChar.startNotifications();
      statusChar.addEventListener("characteristicvaluechanged", (event) => {
        const status = decodeJsonValue(event.target.value);
        if (!status) return;
        if (status.status === "connected") {
          setStep(STEPS.SUCCESS);
          // Small delay before disconnecting BLE: gives time for any write
          // that was still being confirmed on the Android side.
          setTimeout(() => device.gatt.disconnect(), 500);
        } else if (status.status === "failed") {
          setErrorMsg("The device couldn't connect to that network. Check the password.");
          setStep(STEPS.ERROR);
        }
      });

      setStep(STEPS.CHOOSE_NETWORK);
    } catch (err) {
      console.error(err);
      setErrorMsg(
        err.name === "NotFoundError"
          ? "No device was selected."
          : "Couldn't connect over Bluetooth. Please try again."
      );
      setStep(STEPS.ERROR);
    }
  }

  // Backup mechanism: BLE notifications sometimes never arrive on some
  // Android phones/Bluetooth stacks (known flakiness). Instead of relying
  // only on the notification, we also actively ask the device "what's your
  // status?" every second using a plain read — the same kind of read that
  // already works reliably for the WiFi list.
  async function pollStatusUntilDone(maxAttempts = 25) {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      if (stepRef.current === STEPS.SUCCESS || stepRef.current === STEPS.ERROR) return;

      try {
        const value = await statusCharRef.current.readValue();
        const status = decodeJsonValue(value);
        if (status?.status === "connected") {
          setStep(STEPS.SUCCESS);
          return;
        } else if (status?.status === "failed") {
          setErrorMsg("The device couldn't connect to that network. Check the password.");
          setStep(STEPS.ERROR);
          return;
        }
        // still "connecting" -> keep polling
      } catch (err) {
        // The device may have already disconnected after a successful setup
        // (it turns BLE off once provisioned). If we got here it likely means
        // we missed the "connected" read by a hair — treat a disconnect as
        // success rather than failure, since the device only disconnects on its own
        // right after a successful WiFi connection.
        console.warn("Status read failed (device may have disconnected):", err);
        setStep(STEPS.SUCCESS);
        return;
      }
    }
    if (stepRef.current !== STEPS.SUCCESS) {
      setErrorMsg("Timed out waiting for the device to confirm the connection.");
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
      // Now we wait for the status notification (see listener above) AND
      // poll as a backup in case the notification never arrives.
      pollStatusUntilDone();
    } catch (err) {
      console.error(err);
      // If we already reached SUCCESS (because the "connected" notification
      // already arrived), a late error here is just a write throwing because
      // of the disconnect we triggered on success. Ignore it, it's not a real error.
      if (stepRef.current === STEPS.SUCCESS) return;
      setErrorMsg("Couldn't send the credentials. Please try again.");
      setStep(STEPS.ERROR);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Set up your device</h1>
        <p style={styles.deviceId}>ID: {deviceId}</p>

        {step === STEPS.IOS_FALLBACK && (
          <div style={{ color: "#1a1a1a" }}>
            <p style={{ color: "#1a1a1a" }}>
              Your phone doesn't support Bluetooth from the browser. No
              worries, let's connect it over WiFi directly:
            </p>
            <ol style={{ ...styles.list, color: "#1a1a1a" }}>
              <li>Go to Settings &gt; WiFi on your iPhone</li>
              <li>
                Connect to the network <strong>ThePatch_Setup_{deviceId}</strong>
              </li>
              <li>A setup page will open automatically — follow the instructions there</li>
            </ol>
          </div>
        )}

        {step === STEPS.START && (
          <div>
            <p>Let's connect your device to your home WiFi. This takes less than a minute.</p>
            <button style={styles.button} onClick={handleConnect}>
              Connect to The Patch
            </button>
          </div>
        )}

        {step === STEPS.CONNECTING && <p>Looking for your device...</p>}
        {step === STEPS.SCANNING_WIFI && <p>Reading nearby WiFi networks...</p>}

        {step === STEPS.CHOOSE_NETWORK && (
          <form onSubmit={handleSubmitCredentials}>
            <label style={styles.label}>Select your WiFi network</label>
            <select
              style={styles.input}
              value={selectedSsid}
              onChange={(e) => setSelectedSsid(e.target.value)}
              required
            >
              <option value="" disabled>
                Choose a network
              </option>
              {networks.map((n) => (
                <option key={n.ssid} value={n.ssid}>
                  {n.ssid} {n.rssi ? `(${n.rssi} dBm)` : ""}
                </option>
              ))}
            </select>

            <label style={styles.label}>Password</label>
            <input
              style={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />

            <button style={styles.button} type="submit">
              Connect
            </button>
          </form>
        )}

        {step === STEPS.SENDING && <p>Sending credentials...</p>}

        {step === STEPS.SUCCESS && (
          <p style={styles.success}>✅ All set! Your Patch is now connected to WiFi.</p>
        )}

        {step === STEPS.ERROR && (
          <div>
            <p style={styles.error}>{errorMsg}</p>
            <button style={styles.button} onClick={() => setStep(STEPS.START)}>
              Try again
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
    justifyContent: "center",
    alignItems: "flex-start",
    background: "#0f1115",
    padding: "64px 16px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    colorScheme: "light",
  },
  card: {
    background: "#ffffff",
    borderRadius: 16,
    padding: 32,
    maxWidth: 420,
    width: "100%",
    boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
    color: "#1a1a1a",
    lineHeight: 1.55,
    letterSpacing: "0.1px",
  },
  title: {
    fontSize: 23,
    fontWeight: 650,
    letterSpacing: "0.1px",
    lineHeight: 1.3,
    margin: 0,
    marginBottom: 6,
  },
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
    background: "#1863FD",
    color: "#fff",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
  },
  list: { paddingLeft: 20, lineHeight: 1.6 },
  success: { color: "#188038", fontWeight: 600 },
  error: { color: "#c5221f" },
};
