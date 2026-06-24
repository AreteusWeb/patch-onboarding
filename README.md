# WiFi Provisioning — Testing Protocol

This repository implements an end-to-end WiFi provisioning system for IoT devices using Bluetooth Low Energy (BLE) and WiFi Access Point (SoftAP) fallback. It includes React components for device setup, QR code generation, and Arduino/ESP32 firmware to simulate the device side of the protocol.

## Overview

The WiFi provisioning system allows users to connect IoT devices to their home WiFi network through:

1. **BLE Flow**: Primary method for Android and desktop browsers (Chrome/Edge)
2. **SoftAP Fallback**: Backup method via WiFi AP and captive portal (iOS and Android)

A user scans a QR code with their phone or computer, opens the setup page, connects to the device via Bluetooth, selects their WiFi network, and provides credentials. The device connects and reports its IP address back to the provisioning app.

---

## File Structure

| File | Location | Purpose |
|---|---|---|
| `DeviceSetupPage.jsx` | `src/pages/` | Main provisioning page opened when user scans QR. Handles entire BLE flow. |
| `QrGenerator.jsx` | `src/admin/` | Admin page to generate QR codes for test devices. |
| `bleProtocol.js` | `src/utils/` | Shared BLE UUIDs, AES encryption utilities, and protocol constants. |
| `ble_provisioning_test.ino` | ESP32 Arduino IDE | Device firmware that acts as BLE GATT server (for BLE flow testing). |
| `softap_fallback_test.ino` | ESP32 Arduino IDE | Device firmware that creates WiFi AP with captive portal (for iOS/fallback testing). |

---

## Installation

### React Project

Install the required QR code library:

```bash
npm install qrcode.react
```

### Arduino IDE (for ESP32 testing)

1. Go to `Tools > Board > Boards Manager` and install **"esp32"** (by Espressif Systems) if not already installed.
2. Go to `Tools > Manage Libraries` and install **ArduinoJson** (by Benoit Blanchon).
3. BLE and mbedtls libraries come built-in with the ESP32 board package — no additional installation needed.

---

## Testing the BLE Flow (Android / Chrome Desktop)

Follow these steps to test the Bluetooth provisioning flow:

1. **Upload firmware to ESP32:**
   - Open `ble_provisioning_test.ino` in Arduino IDE
   - Select board: `Tools > Board > ESP32 Dev Module`
   - Select the correct COM port
   - Click **Upload**

2. **Monitor ESP32 output:**
   - Open **Serial Monitor** (115200 baud)
   - You'll see debug messages and connection status

3. **Deploy React app to Vercel** (or run locally)
   - Push your code to Vercel as usual
   - Ensure `DeviceSetupPage.jsx`, `bleProtocol.js`, and `QrGenerator.jsx` are in the correct directories

4. **Update BASE_URL in QrGenerator.jsx**
   - Set it to your actual Vercel domain

5. **Access setup page directly** (for testing, no need to scan QR yet):
   ```
   https://your-app.vercel.app/setup?id=CP-A3F2
   ```

6. **Connect to device via Bluetooth:**
   - Click "Connect via Bluetooth"
   - Select `ChestPatch_TEST_A3F2` from the device list

7. **Configure WiFi:**
   - The app displays WiFi networks detected by the ESP32
   - Select your home network
   - Enter WiFi password
   - Click "Connect"

8. **Verify success:**
   - Serial Monitor should show: `Connected! IP: ...`
   - App page should display: `✅ Ready!`


---

## Testing the SoftAP Fallback (iPhone & Android)

Follow these steps to test the WiFi AP provisioning flow (used as fallback on iOS):

1. **Upload different firmware to ESP32:**
   - Open `softap_fallback_test.ino` in Arduino IDE
   - Select board and port (same as above)
   - Click **Upload**
   - This replaces the previous BLE firmware

2. **Connect from iPhone:**
   - Go to `Settings > WiFi`
   - Find and connect to `ChestPatch_Setup_A3F2`
   - A configuration page should open automatically (captive portal)
   - If not, open Safari and navigate to `http://192.168.4.1` or any URL (ESP32 will redirect)

3. **Configure WiFi:**
   - Select your home WiFi network
   - Enter your WiFi password
   - Click "Connect"

4. **Verify success:**
   - Check Serial Monitor on ESP32 for connection confirmation

You can also test this from Android to confirm the fallback works on both platforms, though Android will typically use the BLE flow in production.

---

## BLE Protocol Details (Reference)

### Service UUID
```
4fafc201-1fb5-459e-8fcc-c5c9c331914b
```

### Characteristics

| Name | UUID | Type | Content |
|---|---|---|---|
| WiFi List | `beb5483e-36e1-4688-b7f5-ea07361b26a8` | Read | JSON array of networks: `[{"ssid":"MyNetwork","rssi":-45}, ...]` |
| Credentials | `0a3f1001-0001-4a76-b1b2-d34db33f0001` | Write | `[16 bytes IV][AES-128-CBC ciphertext]` of `{"ssid":"...", "password":"..."}` |
| Status | `0a3f1001-0002-4a76-b1b2-d34db33f0002` | Notify | JSON status: `{"status":"connecting"}`, `{"status":"connected"}`, or `{"status":"failed"}` |

---

## Security Notice ⚠️

### Current Implementation (Demo Only)

This codebase uses a **fixed AES encryption key** (`DEMO_KEY`) for testing purposes. This key is visible in the JavaScript source code and is not suitable for production:

- The AES key is exposed in client-side JavaScript
- No session-specific key negotiation occurs
- **Not HIPAA-compliant or secure for user data**

### Before Production

Before deploying to real users, implement proper key management:

1. **Per-Device Keys:** Each device ships with a unique key (stored in flash, registered in backend with device serial)
2. **Key Negotiation:** Implement ECDH (Elliptic Curve Diffie-Hellman) or similar for session-specific keys during first BLE handshake
3. **Secure Backend:** Store credentials encrypted at rest and never expose the provisioning key

This can be handled as a separate task — it doesn't block testing the current flow and firmware.

---
