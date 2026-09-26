/*
 * =====================================================================================
 * SAE INDIA — Autonomous Drone Rescue System
 * ESP32-S3 Cloud Relay Direct WSS Client (Standalone / Zero-Laptop Mode)
 * =====================================================================================
 *
 * HARDWARE: ESP32-S3
 * 
 * EXACT WIRING:
 *   PIXHAWK TELEM2                     ESP32-S3
 *   -----------------                  -----------------
 *   Pin 1  +5V        ───────────────  NC (Powered externally or via USB)
 *   Pin 2  TX         ───────────────  GPIO 18 (RX on ESP32-S3)
 *   Pin 3  RX         ───────────────  GPIO 17 (TX on ESP32-S3)
 *   Pin 4  CTS        ───────────────  NC
 *   Pin 5  RTS        ───────────────  NC
 *   Pin 6  GND        ───────────────  GND (Common Ground)
 *
 * MISSION PLANNER PARAMETERS (TELEM2):
 *   SERIAL2_PROTOCOL = 2   (MAVLink 2)
 *   SERIAL2_BAUD     = 57  (57600 baud)
 *
 * ARCHITECTURE (NO LAPTOP NEEDED IN FIELD):
 *   [Pixhawk TELEM2]
 *          ↕ UART (GPIO 18 RX / GPIO 17 TX @ 57600 baud)
 *     [ESP32-S3]
 *          ↕ Direct WSS Client (via Phone Hotspot or Wi-Fi)
 *   [Render Cloud Relay: wss://sae-india-relay.onrender.com/connector]
 *          ↕ Secure WSS
 *   [Your Phone: https://saeindia-umber.vercel.app]
 *
 * REQUIRED ARDUINO LIBRARY:
 *   In Arduino IDE -> Sketch -> Include Library -> Manage Libraries...
 *   Search for and install: "ArduinoWebsockets" by Gil Maimon (v0.5.3 or higher)
 *
 * ARDUINO IDE BOARD SETTINGS:
 *   Tools -> Board -> ESP32 Arduino -> "ESP32S3 Dev Module"
 *   Tools -> USB CDC On Boot -> "Enabled"
 * =====================================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoWebsockets.h>

// =====================================================================================
// 1. WI-FI CONFIGURATION (Phone Hotspot or Field Wi-Fi)
// =====================================================================================
// Enter your Phone's Personal Hotspot or field Wi-Fi credentials here:
const char* WIFI_SSID     = "DRONE_WIFI_2.4G";      // <-- YOUR PHONE HOTSPOT OR WI-FI NAME
const char* WIFI_PASSWORD = "your_wifi_password";   // <-- YOUR PASSWORD

// Optional Fallback Wi-Fi (e.g. Home Wi-Fi when testing indoors)
const char* FALLBACK_SSID = "HOME_WIFI";
const char* FALLBACK_PASS = "home_password";

// =====================================================================================
// 2. CLOUD RELAY WSS CONFIGURATION
// =====================================================================================
const char* RELAY_HOST    = "sae-india-relay.onrender.com";
const uint16_t RELAY_PORT = 443;
const char* RELAY_PATH    = "/connector?token=saeindia_secret_token_2026";
const char* RELAY_WSS_URL = "wss://sae-india-relay.onrender.com/connector?token=saeindia_secret_token_2026";

// =====================================================================================
// 3. PIXHAWK TELEM2 UART CONFIGURATION (YOUR EXACT WIRING)
// =====================================================================================
// Pixhawk TELEM2 Pin 2 (TX) -> ESP32-S3 GPIO 18 (RX)
// Pixhawk TELEM2 Pin 3 (RX) -> ESP32-S3 GPIO 17 (TX)
#define PIXHAWK_RX_PIN    18     // ESP32-S3 GPIO 18 (RX)
#define PIXHAWK_TX_PIN    17     // ESP32-S3 GPIO 17 (TX)
#define PIXHAWK_BAUD      57600  // Standard Pixhawk TELEM2 baud rate (SERIAL2_BAUD = 57)

// Status LED (GPIO 2 or GPIO 21 on ESP32-S3, set to -1 if your board doesn't have one)
#define STATUS_LED_PIN    2

// =====================================================================================
// GLOBAL OBJECTS & STATE
// =====================================================================================
using namespace websockets;
WebsocketsClient wsClient;

// Hardware UART1 on ESP32-S3 for Pixhawk TELEM2
HardwareSerial PixhawkSerial(1);

unsigned long lastPingTime = 0;
const unsigned long PING_INTERVAL_MS = 15000; // Ping every 15s to keep cloud connection alive

unsigned long lastReconnectAttempt = 0;
const unsigned long RECONNECT_INTERVAL_MS = 3000;

// UART Buffer
#define UART_BUFFER_SIZE 1024
uint8_t uartBuffer[UART_BUFFER_SIZE];

// =====================================================================================
// STATUS LED HELPER
// =====================================================================================
void updateLED(int mode) {
  if (STATUS_LED_PIN < 0) return;
  // 0 = OFF (Disconnected)
  // 1 = Blinking (Connecting)
  // 2 = Solid ON (Connected & Streaming)
  if (mode == 2) {
    digitalWrite(STATUS_LED_PIN, HIGH);
  } else if (mode == 0) {
    digitalWrite(STATUS_LED_PIN, LOW);
  } else {
    digitalWrite(STATUS_LED_PIN, (millis() / 250) % 2);
  }
}

// =====================================================================================
// WEBSOCKET EVENT CALLBACKS
// =====================================================================================
void onMessageCallback(WebsocketsMessage message) {
  if (message.isBinary()) {
    // Binary MAVLink frame received from Phone / Web App -> Write to Pixhawk TELEM2
    const uint8_t* payload = (const uint8_t*)message.c_str();
    size_t length = message.length();
    PixhawkSerial.write(payload, length);
  } else if (message.isText()) {
    Serial.print("[RELAY MSG] ");
    Serial.println(message.data());
  }
}

void onEventsCallback(WebsocketsEvent event, String data) {
  if (event == WebsocketsEvent::ConnectionOpened) {
    Serial.println("\n[WSS] >>> CONNECTED TO CLOUD RELAY (RENDER) SUCCESSFULLY! <<<");
    updateLED(2);

    // Announce to relay that ESP32-S3 is directly connected
    wsClient.send("{\"type\":\"ESP32_STATUS\",\"status\":\"CONNECTED\",\"device\":\"ESP32_S3_STANDALONE\"}");
  } else if (event == WebsocketsEvent::ConnectionClosed) {
    Serial.println("\n[WSS] Connection Closed to Cloud Relay. Retrying...");
    updateLED(0);
  } else if (event == WebsocketsEvent::GotPing) {
    // wsClient automatically responds with Pong
  } else if (event == WebsocketsEvent::GotPong) {
    // Connection alive
  }
}

// =====================================================================================
// WI-FI CONNECTION HELPER
// =====================================================================================
void connectToWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.printf("\n[WIFI] Connecting to %s ...", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 10000) {
    delay(300);
    Serial.print(".");
    updateLED(1);
  }

  // If primary Wi-Fi timed out, try fallback
  if (WiFi.status() != WL_CONNECTED && strlen(FALLBACK_SSID) > 0) {
    Serial.printf("\n[WIFI] Primary failed. Trying fallback %s ...", FALLBACK_SSID);
    WiFi.begin(FALLBACK_SSID, FALLBACK_PASS);
    startAttempt = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 10000) {
      delay(300);
      Serial.print(".");
      updateLED(1);
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] CONNECTED TO NETWORK!");
    Serial.print("[WIFI] IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WIFI] Not connected. Will retry in main loop.");
  }
}

// =====================================================================================
// CLOUD RELAY CONNECTION HELPER
// =====================================================================================
void connectToCloudRelay() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (wsClient.available()) return;

  if (millis() - lastReconnectAttempt < RECONNECT_INTERVAL_MS) return;
  lastReconnectAttempt = millis();

  Serial.println("[WSS] Dialing Render Cloud Relay via SSL...");
  Serial.printf("[WSS] %s\n", RELAY_WSS_URL);
  
  // Connect via secure WSS to Render
  bool connected = wsClient.connect(RELAY_WSS_URL);
  if (!connected) {
    Serial.println("[WSS] Connection attempt failed. Will retry automatically.");
  }
}

// =====================================================================================
// SETUP
// =====================================================================================
void setup() {
  // Debug USB Serial Monitor
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=======================================================");
  Serial.println("🚀 SAE INDIA — ESP32-S3 DIRECT CLOUD RELAY CLIENT");
  Serial.println("=======================================================");

  if (STATUS_LED_PIN >= 0) {
    pinMode(STATUS_LED_PIN, OUTPUT);
    digitalWrite(STATUS_LED_PIN, LOW);
  }

  // Initialize Pixhawk Hardware UART1 with YOUR EXACT PINOUT:
  // RX = GPIO 18 (receives from Pixhawk TX Pin 2)
  // TX = GPIO 17 (transmits to Pixhawk RX Pin 3)
  PixhawkSerial.begin(PIXHAWK_BAUD, SERIAL_8N1, PIXHAWK_RX_PIN, PIXHAWK_TX_PIN);
  Serial.printf("[UART] Pixhawk TELEM2 initialized: RX=GPIO%d, TX=GPIO%d @ %d baud\n", 
                PIXHAWK_RX_PIN, PIXHAWK_TX_PIN, PIXHAWK_BAUD);

  // Configure WebSocket Client callbacks
  wsClient.onMessage(onMessageCallback);
  wsClient.onEvent(onEventsCallback);

  // Connect to Wi-Fi / Phone Hotspot
  connectToWiFi();
}

// =====================================================================================
// MAIN LOOP
// =====================================================================================
void loop() {
  // 1. Maintain Wi-Fi Connection
  if (WiFi.status() != WL_CONNECTED) {
    updateLED(1);
    connectToWiFi();
    delay(500);
    return;
  }

  // 2. Maintain WebSocket Connection to Cloud Relay
  if (!wsClient.available()) {
    updateLED(1);
    connectToCloudRelay();
  } else {
    updateLED(2); // Solid ON when connected and ready
  }

  // 3. Poll WebSocket Client for incoming commands from Phone
  wsClient.poll();

  // 4. Send Periodic Ping to keep cloud relay connection alive
  if (wsClient.available() && millis() - lastPingTime > PING_INTERVAL_MS) {
    lastPingTime = millis();
    wsClient.ping();
  }

  // 5. Read binary MAVLink telemetry from Pixhawk TELEM2 -> Forward to Cloud Relay
  size_t bytesAvailable = PixhawkSerial.available();
  if (bytesAvailable > 0 && wsClient.available()) {
    size_t bytesToRead = (bytesAvailable > UART_BUFFER_SIZE) ? UART_BUFFER_SIZE : bytesAvailable;
    size_t bytesRead = PixhawkSerial.readBytes(uartBuffer, bytesToRead);

    if (bytesRead > 0) {
      // Send binary frame to cloud relay (which forwards instantly to your phone)
      wsClient.sendBinary((const char*)uartBuffer, bytesRead);
    }
  }
}
