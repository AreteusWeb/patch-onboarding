// bleProtocol.js
// Protocolo BLE compartido entre la web (DeviceSetupPage) y el firmware del ESP32.
// Estos mismos UUIDs deben coincidir EXACTO con los del .ino (ble_provisioning_test.ino)

export const BLE_SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";

export const CHAR_WIFI_LIST_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8"; // notify/read: lista de redes WiFi cercanas (JSON)
export const CHAR_CREDENTIALS_UUID = "0a3f1001-0001-4a76-b1b2-d34db33f0001"; // write: credenciales cifradas
export const CHAR_STATUS_UUID = "0a3f1001-0002-4a76-b1b2-d34db33f0002"; // notify: estado de conexión

// ⚠️ DEMO KEY — esto es solo para que el flujo funcione mientras no hay
// intercambio de llaves real. Antes de producción, cada dispositivo debe
// tener su propia llave (ej. generada en fábrica y guardada también en el
// backend), no una llave fija en el código. Ver nota en PROTOCOLO_Y_PRUEBAS.md
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

// Cifra { ssid, password } y devuelve un objeto Uint8Array listo para
// escribirse en la característica BLE: [16 bytes IV][ciphertext...]
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

// Decodifica el valor crudo (DataView) que llega de una característica BLE
// (ej. la lista de WiFi o el status) que el firmware manda como JSON plano sin cifrar.
export function decodeJsonValue(dataView) {
  const text = new TextDecoder().decode(dataView.buffer);
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("No se pudo parsear JSON de BLE:", text, e);
    return null;
  }
}

export function isWebBluetoothAvailable() {
  return typeof navigator !== "undefined" && !!navigator.bluetooth;
}

export function isIOS() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPadOS 13+ se reporta como Mac, por eso también revisamos maxTouchPoints
  const isAppleTouch = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || isAppleTouch;
}
