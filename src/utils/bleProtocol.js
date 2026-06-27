// bleProtocol.js
// BLE protocol shared between the web app (DeviceSetupPage) and the ESP32 firmware.
// These UUIDs must match EXACTLY the ones in the .ino (ble_provisioning_test.ino)

export const BLE_SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";

export const CHAR_WIFI_LIST_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8"; // notify/read: nearby WiFi networks (JSON)
export const CHAR_CREDENTIALS_UUID = "0a3f1001-0001-4a76-b1b2-d34db33f0001"; // write: encrypted credentials
export const CHAR_STATUS_UUID = "0a3f1001-0002-4a76-b1b2-d34db33f0002"; // notify: connection status

// ⚠️ DEMO KEY — this is only so the flow works while there's no real key
// exchange in place. Before production, each device should have its own
// key (e.g. generated at the factory and also stored in the backend),
// not a fixed key in the code. See note in PROTOCOLO_Y_PRUEBAS.md
const DEMO_KEY_HEX = "000102030405060708090a0b0c0d0e0f"; // 16 bytes = AES-128

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function getAesKey() {
  return window.crypto.subtle.importKey(
    "raw",
    hexToBytes(DEMO_KEY_HEX),
    { name: "AES-CBC" },
    false,
    ["encrypt", "decrypt"]
  );
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return window.btoa(binary);
}

// Max size of each BLE write. Android often caps the MTU at ~23 bytes
// (20 usable payload bytes), so we send the credentials in small chunks
// instead of one big writeValue() call.
const BLE_CHUNK_SIZE = 16;

// Wraps the encrypted payload with a 2-byte header (total length), and
// sends it over several sequential writeValue() calls, awaiting each one
// before sending the next (avoids "GATT busy" errors on Android).
async function writeChunkWithRetry(characteristic, chunk, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await characteristic.writeValue(chunk);
      return;
    } catch (err) {
      console.warn(`writeValue failed (attempt ${attempt}/${maxAttempts}):`, err);
      if (attempt === maxAttempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

export async function writeCredentialsChunked(characteristic, encryptedPayload) {
  const totalLen = encryptedPayload.length;
  const framed = new Uint8Array(2 + totalLen);
  framed[0] = (totalLen >> 8) & 0xff; // length high byte
  framed[1] = totalLen & 0xff; // length low byte
  framed.set(encryptedPayload, 2);

  for (let offset = 0; offset < framed.length; offset += BLE_CHUNK_SIZE) {
    const chunk = framed.slice(offset, offset + BLE_CHUNK_SIZE);
    await writeChunkWithRetry(characteristic, chunk);
    // Small pause between writes: Android's BLE stack sometimes marks a
    // write as failed (even though it did arrive) if the next one is sent
    // too quickly. 40ms is enough headroom without the user noticing.
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

// Encrypts { ssid, password } and returns a Uint8Array ready to be
// written to the BLE characteristic: [16 bytes IV][ciphertext...]
export async function encryptCredentials(ssid, password) {
  const key = await getAesKey();
  const iv = window.crypto.getRandomValues(new Uint8Array(16));
  const plaintext = new TextEncoder().encode(JSON.stringify({ ssid, password }));

  const ciphertext = await window.crypto.subtle.encrypt(
    { name: "AES-CBC", iv },
    key,
    plaintext
  );

  const payload = new Uint8Array(iv.length + ciphertext.byteLength);
  payload.set(iv, 0);
  payload.set(new Uint8Array(ciphertext), iv.length);
  return payload;
}

// Decodes the raw value (DataView) coming from a BLE characteristic
// (e.g. the WiFi list or the status) that the firmware sends as plain,
// unencrypted JSON.
export function decodeJsonValue(dataView) {
  const text = new TextDecoder().decode(dataView.buffer);
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Couldn't parse JSON from BLE:", text, e);
    return null;
  }
}

export function isWebBluetoothAvailable() {
  return typeof navigator !== "undefined" && !!navigator.bluetooth;
}

export function isIOS() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPadOS 13+ reports itself as Mac, so we also check maxTouchPoints
  const isAppleTouch = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || isAppleTouch;
}
