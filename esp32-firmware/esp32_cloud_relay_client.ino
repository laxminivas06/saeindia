/*
 * =====================================================================================
 * SAE INDIA — Autonomous Drone Rescue System
 * ESP32-S3 Cloud Relay Direct WSS Client (Standalone / Zero-Laptop Mode)
 * With Comprehensive Live Diagnostics & True MAVLink UART RX/TX Byte Tracking
 * =====================================================================================
 *
 * REQUIRED FINAL ARCHITECTURE:
 *   Netlify Frontend (WSS) ──> Render Backend (WebSocket) ──> ESP32 (UART) ──> Pixhawk
 *   Pixhawk (UART) ──> ESP32 (WebSocket) ──> Render Backend (WSS) ──> Netlify Frontend
 *
 * HARDWARE TARGET: ESP32-S3 (or standard ESP32 DevKit)
 *
 * EXACT PHYSICAL WIRING (TELEM2 to ESP32):
 *   PIXHAWK TELEM2                     ESP32-S3
 *   -----------------                  -----------------
 *   Pin 1  +5V        ───────────────  NC (Powered externally or via USB)
 *   Pin 2  TX (Out)   ───────────────  GPIO 18 (RX on ESP32-S3)  <-- MUST BE CROSSED!
 *   Pin 3  RX (In)    ───────────────  GPIO 17 (TX on ESP32-S3)  <-- MUST BE CROSSED!
 *   Pin 4  CTS        ───────────────  NC
 *   Pin 5  RTS        ───────────────  NC
 *   Pin 6  GND        ───────────────  GND (Common Ground)       <-- CRITICAL COMMON GROUND!
 *
 * NOTE FOR CLASSIC ESP32 (WROOM-32):
 *   If using a non-S3 ESP32, change pins below to:
 *   #define PIXHAWK_RX_PIN 16 (RX2)
 *   #define PIXHAWK_TX_PIN 17 (TX2)
 *
 * PIXHAWK CONFIGURATION (telem2 parameters in Mission Planner / QGroundControl):
 *   SERIAL2_PROTOCOL = 2    (MAVLink 2.0)
 *   SERIAL2_BAUD     = 57   (57600 baud)
 *
 * ARDUINO IDE SETTINGS FOR ESP32-S3:
 *   1. Tools -> Board -> "ESP32S3 Dev Module"
 *   2. Tools -> USB CDC On Boot -> "Enabled"  <-- CRITICAL to see Serial output!
 *   3. Set Serial Monitor Baud Rate to: 115200
 * =====================================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoWebsockets.h>

// =====================================================================================
// 1. WI-FI CREDENTIALS (Phone Personal Hotspot or Field Wi-Fi)
// =====================================================================================
const char* WIFI_SSID     = "drone123";      // Enter Phone Hotspot or Field Wi-Fi name
const char* WIFI_PASSWORD = "drone@123";   // Enter Wi-Fi password

const char* FALLBACK_SSID = "";
const char* FALLBACK_PASS = "";

// =====================================================================================
// 2. PRODUCTION CLOUD RELAY & LOCAL FALLBACK CONFIGURATION
// =====================================================================================
// Set to true to connect directly to your laptop running 'npm run relay:start' (offline field mode)
// Set to false to connect to Render Cloud Relay over the internet (production mode)
#define USE_LOCAL_RELAY       false

// Production Render Cloud Server
const char* RELAY_HOST        = "saeindia-szj0.onrender.com";
const uint16_t RELAY_PORT     = 443;
const char* RELAY_PATH        = "/ws?client=esp32";
const char* RELAY_WSS_URL     = "wss://saeindia-szj0.onrender.com:443/ws?client=esp32";

// Local Relay (For offline field testing with laptop running 'npm run relay:start')
const char* LOCAL_RELAY_IP    = "10.18.186.59";   // Laptop Wi-Fi IP
const uint16_t LOCAL_RELAY_PORT = 8080;
const char* LOCAL_RELAY_PATH  = "/ws?client=esp32";

// =====================================================================================
// 3. PIXHAWK UART PIN & BAUD CONFIGURATION
// =====================================================================================
// ESP32-S3 default hardware UART1 pins:
#define PIXHAWK_RX_PIN    18     // Connects to Pixhawk TELEM2 Pin 2 (TX)
#define PIXHAWK_TX_PIN    17     // Connects to Pixhawk TELEM2 Pin 3 (RX)
#define PIXHAWK_BAUD      57600  // Pixhawk TELEM2 baud rate (SERIAL2_BAUD = 57)

// Status LED (set to -1 if your board has no onboard LED)
#define STATUS_LED_PIN    2

// =====================================================================================
// GLOBAL OBJECTS & DIAGNOSTIC COUNTERS
// =====================================================================================
using namespace websockets;
WebsocketsClient wsClient;

// Hardware Serial1 for Pixhawk TELEM2
HardwareSerial PixhawkSerial(1);

// Cumulative byte & packet counters (Mandatory diagnostic separation)
volatile unsigned long raw_uart_rx_bytes      = 0;  // Bytes read from Pixhawk UART
volatile unsigned long raw_uart_tx_bytes      = 0;  // Bytes sent to Pixhawk UART
volatile unsigned long mavlink_rx_packets     = 0;  // MAVLink v1/v2 frame headers detected
volatile unsigned long mavlink_heartbeats_rx  = 0;  // MAVLink HEARTBEAT messages (msgId 0)
volatile unsigned long ws_tx_bytes            = 0;  // Actual bytes sent to Render Cloud
volatile unsigned long ws_rx_bytes            = 0;  // Actual bytes received from Render Cloud

// MAVLink State
bool mavlink_heartbeat_detected = false;
unsigned long last_heartbeat_time = 0;
uint8_t mavlink_system_id         = 0;
uint8_t mavlink_component_id      = 0;
uint32_t mavlink_custom_mode      = 0;
bool drone_is_armed               = false;

// Timers
unsigned long lastPingTime             = 0;
const unsigned long PING_INTERVAL_MS   = 30000; // 30-sec keepalive ping

unsigned long lastReconnectAttempt     = 0;
const unsigned long RECONNECT_DELAY_MS = 2500;

unsigned long lastWiFiReconnect        = 0;
const unsigned long WIFI_RETRY_MS      = 5000;

unsigned long lastDiagPrintTime        = 0;
const unsigned long DIAG_PRINT_MS      = 3000;  // 3-sec serial monitor diagnostic summary

unsigned long lastCloudDiagTime        = 0;
const unsigned long CLOUD_DIAG_MS      = 2000;  // 2-sec JSON telemetry to Render

// UART Buffer
#define UART_BUFFER_SIZE 1024
uint8_t uartBuffer[UART_BUFFER_SIZE];

// =====================================================================================
// STATUS LED HELPER
// =====================================================================================
void updateLED(int mode) {
  if (STATUS_LED_PIN < 0) return;
  if (mode == 2) {
    digitalWrite(STATUS_LED_PIN, HIGH); // Solid ON (WSS Connected)
  } else if (mode == 0) {
    digitalWrite(STATUS_LED_PIN, LOW);  // OFF (Disconnected)
  } else {
    digitalWrite(STATUS_LED_PIN, (millis() / 250) % 2); // Blinking (Connecting)
  }
}

// =====================================================================================
// LIGHTWEIGHT MAVLINK PARSER (Detects v1 / v2 frames & HEARTBEATs without bulky libraries)
// =====================================================================================
void inspectMavlinkBuffer(const uint8_t* buf, size_t len) {
  for (size_t i = 0; i < len; i++) {
    // Check MAVLink v2 magic byte (0xFD)
    if (buf[i] == 0xFD && (i + 10) <= len) {
      uint8_t payloadLen = buf[i + 1];
      uint8_t sysId      = buf[i + 5];
      uint8_t compId     = buf[i + 6];
      uint32_t msgId     = (uint32_t)buf[i + 7] | ((uint32_t)buf[i + 8] << 8) | ((uint32_t)buf[i + 9] << 16);

      mavlink_rx_packets++;
      mavlink_system_id    = sysId;
      mavlink_component_id = compId;

      if (msgId == 0) { // HEARTBEAT
        mavlink_heartbeats_rx++;
        mavlink_heartbeat_detected = true;
        last_heartbeat_time = millis();

        if ((i + 10 + 9) <= len) {
          mavlink_custom_mode = (uint32_t)buf[i + 10] | ((uint32_t)buf[i + 11] << 8) |
                                ((uint32_t)buf[i + 12] << 16) | ((uint32_t)buf[i + 13] << 24);
          uint8_t baseMode = buf[i + 16];
          drone_is_armed = (baseMode & 128) != 0;
        }
      }
    }
    // Check MAVLink v1 magic byte (0xFE)
    else if (buf[i] == 0xFE && (i + 6) <= len) {
      uint8_t sysId  = buf[i + 3];
      uint8_t compId = buf[i + 4];
      uint8_t msgId  = buf[i + 5];

      mavlink_rx_packets++;
      mavlink_system_id    = sysId;
      mavlink_component_id = compId;

      if (msgId == 0) { // HEARTBEAT
        mavlink_heartbeats_rx++;
        mavlink_heartbeat_detected = true;
        last_heartbeat_time = millis();
      }
    }
  }

  // Timeout heartbeat if no packet received in last 5000ms
  if (mavlink_heartbeat_detected && (millis() - last_heartbeat_time > 5000)) {
    mavlink_heartbeat_detected = false;
  }
}

// =====================================================================================
// WEBSOCKET CALLBACKS
// =====================================================================================
void onMessageCallback(WebsocketsMessage message) {
  if (message.isBinary()) {
    // Binary MAVLink command frame received from Frontend Ground Station
    const uint8_t* payload = (const uint8_t*)message.c_str();
    size_t length = message.length();

    // Increment WSS RX counter only after actual payload arrival
    ws_rx_bytes += length;

    // Forward immediately to Pixhawk TELEM2 UART
    PixhawkSerial.write(payload, length);
    raw_uart_tx_bytes += length;

    Serial.printf("📥 [WSS RX] Command from Frontend (%u bytes) -> [MAVLINK TX] Forwarded to Pixhawk (Total WS RX: %lu, UART TX: %lu)\n",
                  length, ws_rx_bytes, raw_uart_tx_bytes);
  } else if (message.isText()) {
    String text = message.data();
    ws_rx_bytes += text.length();

    Serial.printf("ℹ️ [WSS RX JSON] %s\n", text.c_str());

    // Respond to ping
    if (text.indexOf("\"ping\"") >= 0) {
      String pong = "{\"type\":\"pong\",\"timestamp\":" + String(millis()) + "}";
      wsClient.send(pong);
      ws_tx_bytes += pong.length();
    }
  }
}

void onEventsCallback(WebsocketsEvent event, String data) {
  if (event == WebsocketsEvent::ConnectionOpened) {
    Serial.println("\n*********************************************************");
    Serial.println("🟢 [WSS RELAY] >>> CONNECTED TO RENDER CLOUD SUCCESSFULLY! <<<");
    Serial.printf("🔗 Host: %s:%d%s\n", RELAY_HOST, RELAY_PORT, RELAY_PATH);
    Serial.println("*********************************************************\n");
    updateLED(2);

    // Announce client identity to Render relay
    String reg = "{\"type\":\"register\",\"client\":\"esp32\",\"device_id\":\"drone-esp32-s3\"}";
    wsClient.send(reg);
    ws_tx_bytes += reg.length();

    String status = "{\"type\":\"ESP32_STATUS\",\"status\":\"CONNECTED\",\"device\":\"ESP32_S3_STANDALONE\"}";
    wsClient.send(status);
    ws_tx_bytes += status.length();
  } else if (event == WebsocketsEvent::ConnectionClosed) {
    Serial.println("\n🔴 [WSS RELAY] Connection closed. Automatic reconnect will engage...");
    updateLED(0);
  } else if (event == WebsocketsEvent::GotPing) {
    Serial.println("💓 [WSS] Ping received from server");
  } else if (event == WebsocketsEvent::GotPong) {
    Serial.println("💓 [WSS] Pong acknowledged from server");
  }
}

// =====================================================================================
// WI-FI CONNECTION HELPER
// =====================================================================================
void connectToWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.println("---------------------------------------------------------");
  Serial.printf("📡 [WIFI] Connecting to SSID: '%s' ...\n", WIFI_SSID);
  Serial.println("---------------------------------------------------------");

  WiFi.disconnect(true);
  delay(100);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startWait = millis();
  int dotCount = 0;
  while (WiFi.status() != WL_CONNECTED && millis() - startWait < 8000) {
    delay(400);
    Serial.print(".");
    dotCount++;
    if (dotCount % 30 == 0) Serial.println();
    updateLED(1);
  }

  // Fallback Wi-Fi
  if (WiFi.status() != WL_CONNECTED && strlen(FALLBACK_SSID) > 0) {
    Serial.printf("\n📡 [WIFI] Trying fallback SSID: '%s' ...\n", FALLBACK_SSID);
    WiFi.disconnect(true);
    delay(100);
    WiFi.begin(FALLBACK_SSID, FALLBACK_PASS);
    startWait = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startWait < 8000) {
      delay(400);
      Serial.print(".");
      updateLED(1);
    }
  }

  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("🟢 [WIFI] CONNECTED SUCCESSFULLY!");
    Serial.printf("📍 IP Address:    %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("📶 Signal (RSSI):  %d dBm\n", WiFi.RSSI());
    Serial.printf("🚪 Gateway:        %s\n", WiFi.gatewayIP().toString().c_str());
    Serial.printf("🔍 DNS Server:    %s\n", WiFi.dnsIP().toString().c_str());
    Serial.println("⏳ Synchronizing network time...");
    configTime(0, 0, "pool.ntp.org", "time.google.com");
    Serial.println("---------------------------------------------------------");
  } else {
    Serial.println("❌ [WIFI FAILED] Could not connect to Wi-Fi.");
    Serial.println("   👉 1. Make sure your Phone Personal Hotspot is turned ON.");
    Serial.println("   👉 2. On iPhone/Android enable 'Maximize Compatibility' (2.4 GHz).");
    Serial.printf("   👉 3. Verify SSID '%s' and password in lines 45-46.\n", WIFI_SSID);
    Serial.println("---------------------------------------------------------");
  }
}

// =====================================================================================
// CLOUD RELAY WSS CONNECTION HELPER
// =====================================================================================
void connectToCloudRelay() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (wsClient.available()) return;

  if (millis() - lastReconnectAttempt < RECONNECT_DELAY_MS) return;
  lastReconnectAttempt = millis();

#if USE_LOCAL_RELAY
  Serial.println("💻 [WS] Connecting to Local Laptop Relay Server...");
  Serial.printf("🔗 URL: ws://%s:%d%s\n", LOCAL_RELAY_IP, LOCAL_RELAY_PORT, LOCAL_RELAY_PATH);

  bool ok = wsClient.connect(LOCAL_RELAY_IP, LOCAL_RELAY_PORT, LOCAL_RELAY_PATH);
  if (!ok) {
    Serial.printf("⚠️  [WS] Could not connect to Laptop Relay at %s:%d. Ensure 'npm run relay:start' is running on laptop!\n",
                  LOCAL_RELAY_IP, LOCAL_RELAY_PORT);
  }
#else
  // 1. DNS Verification
  IPAddress relayIP;
  if (!WiFi.hostByName(RELAY_HOST, relayIP)) {
    Serial.printf("❌ [DNS FAILED] Could not resolve host '%s'. Check Internet connection!\n", RELAY_HOST);
    return;
  }
  Serial.printf("🌐 [DNS OK] %s -> %s\n", RELAY_HOST, relayIP.toString().c_str());

  Serial.println("☁️  [WSS] Connecting to Render Cloud Relay...");
  Serial.printf("🔗 URL: %s\n", RELAY_WSS_URL);

  // Set insecure TLS so certificate expiration / NTP clock drift does not abort connection
  wsClient.setInsecure();

  // Add explicit HTTP headers required by Cloudflare/Render edge
  wsClient.addHeader("Host", RELAY_HOST);
  wsClient.addHeader("Origin", "https://saeindia-szj0.onrender.com");

  bool ok = wsClient.connect(RELAY_WSS_URL);
  if (!ok) {
    // Fallback direct parameters
    ok = wsClient.connectSecure(RELAY_HOST, RELAY_PORT, RELAY_PATH);
  }

  if (!ok) {
    Serial.println("⚠️  [WSS] Connection attempt failed.");
    Serial.println("ℹ️  NOTE: Outbound IPv4 to the internet is unreachable on this Wi-Fi network.");
    Serial.println("👉 ACTION: Turn on Mobile Data on your phone hotspot, OR set '#define USE_LOCAL_RELAY true'.");
  }
#endif
}

// =====================================================================================
// PERIODIC CLOUD JSON DIAGNOSTICS
// =====================================================================================
void sendCloudDiagnostics() {
  if (!wsClient.available()) return;
  if (millis() - lastCloudDiagTime < CLOUD_DIAG_MS) return;
  lastCloudDiagTime = millis();

  String diagCase = "OK";
  if (raw_uart_rx_bytes == 0) {
    diagCase = "CASE_A_NO_UART_RX";
  } else if (mavlink_rx_packets == 0) {
    diagCase = "CASE_B_NO_MAVLINK";
  }

  long lastHbMs = (last_heartbeat_time > 0) ? (long)(millis() - last_heartbeat_time) : -1;

  String json = "{";
  json += "\"type\":\"ESP32_DIAGNOSTICS\",";
  json += "\"wifi_connected\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false") + ",";
  json += "\"wifi_ssid\":\"" + String(WiFi.SSID()) + "\",";
  json += "\"wifi_rssi\":" + String(WiFi.RSSI()) + ",";
  json += "\"wifi_ip\":\"" + WiFi.localIP().toString() + "\",";
  json += "\"wss_connected\":" + String(wsClient.available() ? "true" : "false") + ",";
  json += "\"raw_uart_rx_bytes\":" + String(raw_uart_rx_bytes) + ",";
  json += "\"raw_uart_tx_bytes\":" + String(raw_uart_tx_bytes) + ",";
  json += "\"mavlink_rx_packets\":" + String(mavlink_rx_packets) + ",";
  json += "\"mavlink_heartbeats\":" + String(mavlink_heartbeats_rx) + ",";
  json += "\"mavlink_heartbeat\":" + String(mavlink_heartbeat_detected ? "true" : "false") + ",";
  json += "\"system_id\":" + String(mavlink_system_id) + ",";
  json += "\"component_id\":" + String(mavlink_component_id) + ",";
  json += "\"armed\":" + String(drone_is_armed ? "true" : "false") + ",";
  json += "\"last_heartbeat_ms_ago\":" + String(lastHbMs) + ",";
  json += "\"ws_tx_bytes\":" + String(ws_tx_bytes) + ",";
  json += "\"ws_rx_bytes\":" + String(ws_rx_bytes) + ",";
  json += "\"baud_rate\":" + String(PIXHAWK_BAUD) + ",";
  json += "\"diagnostic_case\":\"" + diagCase + "\"";
  json += "}";

  wsClient.send(json);
  ws_tx_bytes += json.length();
}

// =====================================================================================
// PERIODIC LIVE SERIAL MONITOR SUMMARY
// =====================================================================================
void printLiveDiagnostics() {
  if (millis() - lastDiagPrintTime < DIAG_PRINT_MS) return;
  lastDiagPrintTime = millis();

  Serial.println("\n╔═══════════════════════════════════════════════════════════════════════════════════╗");
  Serial.println("║                SAE INDIA DRONE BRIDGE — LIVE DIAGNOSTIC MONITOR                   ║");
  Serial.println("╠═══════════════════════════════════════════════════════════════════════════════════╣");

  // State 1: Wi-Fi
  String ssidStr = (WiFi.status() == WL_CONNECTED) ? String(WiFi.SSID()) : "NONE";
  Serial.printf("║ 📡 Wi-Fi:           %-20s  (SSID: %-10s | IP: %-15s) ║\n",
                WiFi.status() == WL_CONNECTED ? "CONNECTED ✓" : "DISCONNECTED ✗",
                ssidStr.c_str(),
                WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str() : "0.0.0.0");

  // State 2: WSS Cloud Relay
  Serial.printf("║ ☁️  Cloud Relay WSS: %-20s  (Host: %-28s) ║\n",
                wsClient.available() ? "CONNECTED ✓" : "CONNECTING... ✗",
                RELAY_HOST);

  // State 3: Pixhawk UART Link
  const char* uartStatus = (raw_uart_rx_bytes > 0) ? "ACTIVE DATA RECEIVED ✓" : "NO RX BYTES (0) ✗";
  Serial.printf("║ 🔌 Pixhawk UART:    %-20s  (GPIO %d RX, %d TX @ %d baud)     ║\n",
                uartStatus, PIXHAWK_RX_PIN, PIXHAWK_TX_PIN, PIXHAWK_BAUD);

  // State 4: MAVLink Parser & Heartbeat
  const char* hbStatus = mavlink_heartbeat_detected ? "HEARTBEAT DETECTED ✓" : "NO HEARTBEAT ✗";
  long hbAge = (last_heartbeat_time > 0) ? (long)(millis() - last_heartbeat_time) : -1;
  Serial.printf("║ 💓 MAVLink Status:  %-20s  (SysID: %d | CompID: %d | Last: %ld ms)   ║\n",
                hbStatus, mavlink_system_id, mavlink_component_id, hbAge);

  Serial.println("╟───────────────────────────────────────────────────────────────────────────────────╢");
  Serial.printf("║ 📊 TELEMETRY COUNTERS:                                                            ║\n");
  Serial.printf("║    • Pixhawk UART RX:   %-10lu bytes   │  • Pixhawk UART TX:   %-10lu bytes    ║\n",
                raw_uart_rx_bytes, raw_uart_tx_bytes);
  Serial.printf("║    • MAVLink Packets:   %-10lu frames  │  • MAVLink Heartbeat: %-10lu pkts     ║\n",
                mavlink_rx_packets, mavlink_heartbeats_rx);
  Serial.printf("║    • Cloud WSS TX:      %-10lu bytes   │  • Cloud WSS RX:      %-10lu bytes    ║\n",
                ws_tx_bytes, ws_rx_bytes);
  Serial.println("╟───────────────────────────────────────────────────────────────────────────────────╢");

  // Root Cause Diagnosis Evaluation
  if (raw_uart_rx_bytes == 0) {
    Serial.println("║ ⚠️  DIAGNOSIS: [CASE A] RAW UART RX = 0                                            ║");
    Serial.println("║    Pixhawk is NOT transmitting bytes to ESP32 RX Pin.                             ║");
    Serial.println("║    Check:                                                                         ║");
    Serial.println("║    1. Pixhawk TELEM2 Pin 2 (TX) must connect to ESP32 GPIO 18 (RX).               ║");
    Serial.println("║    2. Pixhawk Pin 6 (GND) must connect to ESP32 GND (Common Ground).             ║");
    Serial.println("║    3. In Mission Planner, ensure SERIAL2_BAUD = 57 and SERIAL2_PROTOCOL = 2.     ║");
  } else if (mavlink_rx_packets == 0) {
    Serial.println("║ ⚠️  DIAGNOSIS: [CASE B] RAW UART RX > 0, BUT MAVLINK PACKETS = 0                   ║");
    Serial.println("║    ESP32 is receiving raw bytes, but parser cannot frame MAVLink.                ║");
    Serial.println("║    Check: Baud rate mismatch! If Pixhawk is 115200, change PIXHAWK_BAUD to 115200║");
  } else if (!wsClient.available()) {
    Serial.println("║ ⚠️  DIAGNOSIS: [CASE C] PIXHAWK UART OK, BUT CLOUD WSS RELAY IS DISCONNECTED      ║");
    Serial.println("║    Check Wi-Fi internet access or Render backend status.                          ║");
  } else {
    Serial.println("║ ✅ DIAGNOSIS: [CASE D] ALL SYSTEMS HEALTHY & STREAMING REAL-TIME TELEMETRY!        ║");
  }
  Serial.println("╚═══════════════════════════════════════════════════════════════════════════════════╝");
}

// =====================================================================================
// SETUP
// =====================================================================================
void setup() {
  Serial.begin(115200);

  // Allow USB CDC on ESP32-S3 time to attach
  unsigned long startWait = millis();
  while (!Serial && millis() - startWait < 3000) {
    delay(50);
  }
  delay(500);

  Serial.println();
  Serial.println("=====================================================================");
  Serial.println("🚀 SAE INDIA AUTONOMOUS DRONE — ESP32-S3 WSS RELAY CLIENT");
  Serial.println("=====================================================================");
  Serial.printf("📋 Target:              ESP32-S3 Dev Module\n");
  Serial.printf("🔌 Pixhawk TELEM2 RX:   GPIO %d (Connects to Pixhawk TX Pin 2)\n", PIXHAWK_RX_PIN);
  Serial.printf("🔌 Pixhawk TELEM2 TX:   GPIO %d (Connects to Pixhawk RX Pin 3)\n", PIXHAWK_TX_PIN);
  Serial.printf("⚡ Pixhawk Baud Rate:   %d baud (8N1)\n", PIXHAWK_BAUD);
  Serial.printf("☁️  Cloud WSS Relay:     %s\n", RELAY_WSS_URL);
  Serial.println("=====================================================================\n");

  if (STATUS_LED_PIN >= 0) {
    pinMode(STATUS_LED_PIN, OUTPUT);
    digitalWrite(STATUS_LED_PIN, LOW);
  }

  // Initialize Pixhawk Hardware Serial1
  // Explicitly configured for 8 Data Bits, No Parity, 1 Stop Bit (SERIAL_8N1)
  PixhawkSerial.begin(PIXHAWK_BAUD, SERIAL_8N1, PIXHAWK_RX_PIN, PIXHAWK_TX_PIN);
  Serial.printf("✅ [UART] Hardware Serial1 initialized on RX=GPIO%d, TX=GPIO%d at %d baud.\n",
                PIXHAWK_RX_PIN, PIXHAWK_TX_PIN, PIXHAWK_BAUD);

  // Setup WebSocket callbacks
  wsClient.setInsecure();
  wsClient.onMessage(onMessageCallback);
  wsClient.onEvent(onEventsCallback);

  // Connect to Wi-Fi / Hotspot
  connectToWiFi();
}

// =====================================================================================
// MAIN LOOP
// =====================================================================================
void loop() {
  // 1. Maintain Wi-Fi Connection
  if (WiFi.status() != WL_CONNECTED) {
    updateLED(1);
    if (millis() - lastWiFiReconnect > WIFI_RETRY_MS) {
      lastWiFiReconnect = millis();
      connectToWiFi();
    }
    delay(100);
    return;
  }

  // 2. Maintain WebSocket Connection to Render Cloud Relay
  if (!wsClient.available()) {
    updateLED(1);
    connectToCloudRelay();
  } else {
    updateLED(2);
  }

  // 3. Poll WebSocket for incoming commands from Phone Ground Station
  wsClient.poll();

  // 4. Send Periodic Keepalive Ping (Every 30 seconds)
  if (wsClient.available() && (millis() - lastPingTime > PING_INTERVAL_MS)) {
    lastPingTime = millis();
    wsClient.ping();
  }

  // 5. STEP 1 & 2: Read raw UART bytes from Pixhawk TELEM2
  size_t bytesAvailable = PixhawkSerial.available();
  if (bytesAvailable > 0) {
    size_t toRead = (bytesAvailable > UART_BUFFER_SIZE) ? UART_BUFFER_SIZE : bytesAvailable;
    size_t bytesRead = PixhawkSerial.readBytes(uartBuffer, toRead);

    if (bytesRead > 0) {
      // 5.1 Increment raw UART RX byte counter (Mandatory Step 1)
      raw_uart_rx_bytes += bytesRead;

      // 5.2 Parse MAVLink framing and heartbeats (Mandatory Step 2)
      inspectMavlinkBuffer(uartBuffer, bytesRead);

      // 5.3 STEP 3: Forward exact binary MAVLink bytes to Cloud Relay (No text mangling)
      if (wsClient.available()) {
        wsClient.sendBinary((const char*)uartBuffer, bytesRead);
        ws_tx_bytes += bytesRead;
      }
    }
  }

  // 6. Send periodic JSON diagnostics to Render & Netlify Frontend
  sendCloudDiagnostics();

  // 7. Print Live Serial Monitor summary every 3 seconds
  printLiveDiagnostics();
}
