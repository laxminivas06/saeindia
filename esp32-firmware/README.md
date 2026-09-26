# ESP32 Direct Cloud Relay Client (Standalone Drone Setup)

This firmware allows your drone's ESP32 to connect **directly to your cloud relay over WSS** using your **Phone Hotspot** or any Wi-Fi.

### Why use this?
- **Zero Laptop Required**: You don't need a computer in the field.
- **Zero Local Connector**: You never have to run `npm run connector:start` again.
- **Worldwide Access**: You can open `https://saeindia-umber.vercel.app` on your phone browser anywhere, and the drone connects automatically as soon as it's powered on!

---

## 1. Hardware Wiring

Connect your ESP32 board to the Pixhawk **TELEM1** or **TELEM2** port:

| ESP32 Pin | Pixhawk TELEM Pin | Description |
| :--- | :--- | :--- |
| **GPIO 16 (RX2)** | **TX** | Receives MAVLink telemetry from Pixhawk |
| **GPIO 17 (TX2)** | **RX** | Sends commands from phone to Pixhawk |
| **GND** | **GND** | Common ground reference |
| **VIN (5V)** | **5V / VCC** | 5V power from Pixhawk or external BEC |

---

## 2. Arduino IDE Setup (1-Time Setup)

1. Open **Arduino IDE**.
2. Go to **Tools ➔ Board ➔ ESP32 Arduino ➔ ESP32 Dev Module** (or your specific ESP32 model).
3. Install the WebSocket library:
   - Go to **Sketch ➔ Include Library ➔ Manage Libraries...**
   - In the search bar, type: **`ArduinoWebsockets`**
   - Install **`ArduinoWebsockets` by Gil Maimon** (Version 0.5.3 or higher).

---

## 3. Configure Wi-Fi & Upload

Open [`esp32_cloud_relay_client.ino`](file:///c:/Users/brish/OneDrive/Desktop/saeindia/esp32-firmware/esp32_cloud_relay_client.ino) and update lines 42–43 with your Wi-Fi or Phone Hotspot:

```cpp
const char* WIFI_SSID     = "YOUR_PHONE_HOTSPOT_NAME";
const char* WIFI_PASSWORD = "YOUR_HOTSPOT_PASSWORD";
```

### Render WSS Settings (Already pre-configured):
- **Relay URL**: `wss://sae-india-relay.onrender.com/connector?token=saeindia_secret_token_2026`
- **UART Baud**: `57600` (matches standard Pixhawk TELEM port)

Click **Upload** in Arduino IDE.

---

## 4. Status Indicator LED (GPIO 2)

- **Blinking fast**: Connecting to Wi-Fi or Cloud Relay.
- **Solid Blue ON**: Fully connected to Cloud Relay and streaming MAVLink with Pixhawk.

---

## 5. Pixhawk Configuration (Mission Planner)

Ensure your Pixhawk TELEM port matches the baud rate:
- `SERIAL1_PROTOCOL` = `2` (MAVLink2)
- `SERIAL1_BAUD` = `57` (57600 baud)
*(Or `SERIAL2_PROTOCOL` / `SERIAL2_BAUD` if using TELEM2).*
