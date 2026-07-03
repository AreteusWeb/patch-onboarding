// DeviceSetupPage.jsx
// Page the user lands on after scanning the device's QR code.
// Suggested route in your app: /setup?id=CP-A3F2
//
// Flow:
// 0. If no ?id= in the URL -> show a landing screen prompting the user to
//    scan their QR code. They can also type their device ID manually as a
//    fallback (the ID is printed on the device itself).
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
  NO_ID: "no_id",           // landed here without scanning a QR
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

  // Manual device ID input, only used on the NO_ID screen
  const [manualId, setManualId] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");

    if (!id) {
      // No QR was scanned — show the landing/entry screen
      setStep(STEPS.NO_ID);
      return;
    }

    setDeviceId(id);

    if (isIOS() || !isWebBluetoothAvailable()) {
      setStep(STEPS.IOS_FALLBACK);
    }
  }, []);

  // Called when the user submits their device ID manually from the NO_ID screen
  function handleManualId(e) {
    e.preventDefault();
    const trimmed = manualId.trim().toUpperCase();
    if (!trimmed) return;
    setDeviceId(trimmed);

    // Update the URL so a reload doesn't lose the ID
    const url = new URL(window.location.href);
    url.searchParams.set("id", trimmed);
    window.history.replaceState({}, "", url.toString());

    if (isIOS() || !isWebBluetoothAvailable()) {
      setStep(STEPS.IOS_FALLBACK);
    } else {
      setStep(STEPS.START);
    }
  }

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
          ? "No device was selected. Tap \u201cTry again\u201d and choose your Patch from the list."
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

  const isBusyStep =
    step === STEPS.CONNECTING || step === STEPS.SCANNING_WIFI || step === STEPS.SENDING;

  return (
    <div className="asp-page" style={styles.page}>
      {/* Local keyframes + responsive tweaks — no external deps */}
      <style>{`
        @keyframes areteus-spin { to { transform: rotate(360deg); } }

        /* This page ignores the app-wide #root width/border/dark-mode
           tokens from index.css (meant for a different, content-column
           layout) so the light background fills the whole viewport,
           with no dark bars showing on either side. */
        html, body {
          background: #f8fafc;
          margin: 0;
        }
        #root {
          width: 100% !important;
          max-width: none !important;
          border-inline: none !important;
          margin: 0 !important;
        }

        .asp-page {
          min-height: 100vh; /* fallback for older browsers */
          min-height: 100svh; /* stays put even when the mobile browser bar shows/hides */
          align-items: flex-start;
        }
        @media (min-width: 900px) {
          .asp-page {
            align-items: center;
          }
        }
      `}</style>

      <div style={styles.card}>
        <img
          src="https://i.imgur.com/x2IeR9Y.png"
          alt="ARETEUS"
          style={styles.logo}
          referrerPolicy="no-referrer"
        />

        <h1 style={styles.title}>Set up your device</h1>
        {deviceId && <p style={styles.deviceId}>ID: {deviceId}</p>}

        {/* ── No QR scanned: ask them to scan or enter the ID manually ── */}
        {step === STEPS.NO_ID && (
          <div>
            <p style={styles.bodyText}>
              Scan the QR code that came with your Patch to get started.
            </p>
            <p style={styles.helperText}>
              Don't have the QR code? You can find your Device ID printed on
              the device itself and enter it below.
            </p>
            <div style={styles.notice}>
              This setup needs Bluetooth, so please continue on your phone,
              not on a computer.
            </div>
            <form onSubmit={handleManualId}>
              <label style={styles.label}>Device ID</label>
              <input
                style={styles.input}
                type="text"
                placeholder="e.g. CP-A3F2"
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                required
              />
              <button style={styles.button} type="submit">
                Continue
              </button>
            </form>
          </div>
        )}

        {/* ── iPhone / no Web Bluetooth: SoftAP fallback ── */}
        {step === STEPS.IOS_FALLBACK && (
          <div>
            <p style={styles.bodyText}>
              Your phone doesn't support Bluetooth setup from the browser.
              Connect it over WiFi instead:
            </p>
            <div style={styles.stepList}>
              <div style={styles.stepItem}>
                <span style={styles.stepNumber}>1</span>
                <p style={styles.stepText}>Go to Settings &gt; WiFi on your iPhone.</p>
              </div>
              <div style={styles.stepItem}>
                <span style={styles.stepNumber}>2</span>
                <p style={styles.stepText}>
                  Connect to the network <strong>ThePatch_Setup_{deviceId}</strong>.
                </p>
              </div>
              <div style={styles.stepItem}>
                <span style={styles.stepNumber}>3</span>
                <p style={styles.stepText}>
                  A setup page will open automatically. Follow the instructions there to finish connecting your Patch to WiFi.
                </p>
              </div>
            </div>
          </div>
        )}

        {step === STEPS.START && (
          <div>
            <p style={styles.bodyText}>
              Let's connect your device to your home WiFi. This takes less than a minute.
            </p>
            <button style={styles.button} onClick={handleConnect}>
              Connect to The Patch
            </button>
          </div>
        )}

        {isBusyStep && (
          <div style={styles.busyRow}>
            <span style={styles.spinner} />
            <p style={styles.busyText}>
              {step === STEPS.CONNECTING && "Looking for your device..."}
              {step === STEPS.SCANNING_WIFI && "Reading nearby WiFi networks..."}
              {step === STEPS.SENDING && "Sending credentials..."}
            </p>
          </div>
        )}

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

        {step === STEPS.SUCCESS && (
          <p style={styles.success}>All set! Your Patch is now connected to WiFi.</p>
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
    display: "flex",
    justifyContent: "center",
    background: "#f8fafc", // slate-50
    padding: "80px 16px",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    colorScheme: "light",
  },
  card: {
    background: "#ffffff",
    borderRadius: 12,
    border: "1px solid #e2e8f0", // slate-200
    padding: 32,
    maxWidth: 420,
    width: "100%",
    color: "#0f172a", // slate-900
    lineHeight: 1.55,
    letterSpacing: "0.1px",
  },
  logo: {
    height: 26,
    width: "auto",
    objectFit: "contain",
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    lineHeight: 1.3,
    margin: 0,
    marginBottom: 6,
    color: "#0f172a",
  },
  deviceId: { color: "#94a3b8", fontSize: 13, marginBottom: 20 },
  bodyText: { color: "#334155", fontSize: 14, marginBottom: 8 },
  helperText: { color: "#94a3b8", fontSize: 13, marginBottom: 20 },
  notice: {
    fontSize: 13,
    color: "#334155",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: "10px 12px",
    marginBottom: 20,
  },
  label: {
    display: "block",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#94a3b8",
    marginTop: 16,
    marginBottom: 6,
  },
  input: {
    width: "100%",
    padding: "11px 14px",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
    fontSize: 14,
    color: "#0f172a",
    boxSizing: "border-box",
    outline: "none",
  },
  button: {
    marginTop: 20,
    width: "100%",
    padding: "13px 16px",
    borderRadius: 999,
    border: "none",
    background: "#0f172a", // slate-900
    color: "#fff",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
  },
  list: { paddingLeft: 20, lineHeight: 1.6, color: "#334155", fontSize: 14 },
  stepList: { display: "flex", flexDirection: "column", gap: 14, marginTop: 4 },
  stepItem: { display: "flex", alignItems: "flex-start", gap: 12 },
  stepNumber: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 22,
    height: 22,
    borderRadius: "50%",
    background: "#0f172a",
    color: "#fff",
    fontSize: 11,
    fontWeight: 600,
    flexShrink: 0,
  },
  stepText: { color: "#334155", fontSize: 14, margin: 0, paddingTop: 2 },
  busyRow: { display: "flex", alignItems: "center", gap: 10 },
  spinner: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    border: "2px solid #e2e8f0",
    borderTopColor: "#0f172a",
    animation: "areteus-spin 0.7s linear infinite",
    flexShrink: 0,
  },
  busyText: { color: "#334155", fontSize: 14, margin: 0 },
  success: { color: "#0f172a", fontWeight: 500, fontSize: 14, margin: 0 },
  error: { color: "#ef4444", fontSize: 14, margin: 0 },
};
