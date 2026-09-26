/*
 * =====================================================================================
 * SAE INDIA — Autonomous Drone Rescue System
 * ESP32 Cloud Relay Direct WSS Client (Standalone / Zero-Laptop Mode)
 * =====================================================================================
 *
 * DESCRIPTION:
 * This firmware transforms the ESP32 into an active WSS client that connects directly
 * over the internet to your cloud relay (Render).
 * 
 * Flow:
 *   [Pixhawk TELEM Port]
 *           ↕ UART (GPIO 16/17 @ 57600 baud)
 *       [ESP32]
 *           ↕ WSS Client (SSL Port 443 via Wi-Fi / Phone Hotspot)
 *   [Render Cloud Relay: wss://sae-india-relay.onrender.com/connector]
 *           ↕ Secure WSS
 *   [Your Phone / Web App: https://saeindia-umber.vercel.app]
 *
 * BENEFITS:
 * - NO LAPTOP NEEDED in the field.
 * - NO "connector:start" command needed.
 * - You can use your phone's mobile hotspot or any Wi-Fi.
 * - Worldwide command and telemetry access from your phone browser.
 *
 * REQUIRED ARDUINO LIBRARY:
 *   Open Arduino IDE -> Sketch -> Include Library -> Manage Libraries...
 *   Search for and install: "ArduinoWebsockets" by Gil Maimon (v0.5.3 or higher)
 *
 * WIRING:
 *   ESP32 Pin GPIO 16 (RX2)  <----->  Pixhawk TELEM1/2 TX
 *   ESP32 Pin GPIO 17 (TX2)  <----->  Pixhawk TELEM1/2 RX
 *   ESP32 GND                <----->  Pixhawk GND
 *   ESP32 VIN (5V)           <----->  Pixhawk 5V (or clean external 5V BEC)
 * =====================================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoWebsockets.h>

// =====================================================================================
// 1. WI-FI CONFIGURATION (Phone Hotspot or Field Wi-Fi)
// =====================================================================================
// You can enter your Phone's Personal Hotspot credentials here:
const char* WIFI_SSID     = "DRONE_WIFI_2.4G";      // Change to your phone hotspot or Wi-Fi SSID
const char* WIFI_PASSWORD = "your_wifi_password";   // Change to your Wi-Fi / Hotspot password

// Optional Fallback Wi-Fi (e.g. Home Wi-Fi when testing indoors)
const char* FALLBACK_SSID = "HOME_WIFI";
const char* FALLBACK_PASS = "home_password";

// =====================================================================================
// 2. CLOUD RELAY WSS CONFIGURATION
// =====================================================================================
// Your deployed Render Cloud Relay host and token
const char* RELAY_HOST    = "sae-india-relay.onrender.com";
const uint16_t RELAY_PORT = 443;
const char* RELAY_PATH    = "/connector?token=saeindia_secret_token_2026";

// Complete WSS URL
const char* RELAY_WSS_URL = "wss://sae-india-relay.onrender.com/connector?token=saeindia_secret_token_2026";

// =====================================================================================
// 3. PIXHAWK UART CONFIGURATION
// =====================================================================================
// Connect ESP32 to Pixhawk TELEM1 or TELEM2 port
#define PIXHAWK_RX_PIN  16   // ESP32 RX2 connects to Pixhawk TX
#define PIXHAWK_TX_PIN  17   // ESP32 TX2 connects to Pixhawk RX
#define PIXHAWK_BAUD    57600 // Standard Pixhawk TELEM baud rate (57600 default)

// Status LED (GPIO 2 is the onboard blue LED on most ESP32 Dev Boards)
#define STATUS_LED_PIN  2

// =====================================================================================
// GLOBAL OBJECTS & STATE
// =====================================================================================
using namespace websockets;
WebsocketsClient wsClient;

HardwareSerial PixhawkSerial(2);

unsigned long lastPingTime = 0;
const unsigned long PING_INTERVAL_MS = 15000; // Ping every 15s to keep cloud connection alive

unsigned long lastReconnectAttempt = 0;
const unsigned long RECONNECT_INTERVAL_MS = 3000;

// UART Buffer
#define UART_BUFFER_SIZE 512
uint8_t uartBuffer[UART_BUFFER_SIZE];

// =====================================================================================
// STATUS LED HELPER
// =====================================================================================
void updateLED(int mode) {
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
    // Binary MAVLink frame received from Phone / Web App -> Send to Pixhawk via UART
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
    Serial.println("\n[WSS] >>> CONNECTED TO CLOUD RELAY SUCCESSFULLY! <<<");
    updateLED(2);

    // Send initial status announcement to relay server
    wsClient.send("{\"type\":\"ESP32_STATUS\",\"status\":\"CONNECTED\",\"device\":\"ESP32_STANDALONE\"}");
  } else if (event == WebsocketsEvent::ConnectionClosed) {
    Serial.println("\n[WSS] Connection Closed to Cloud Relay.");
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
    Serial.println("\n[WIFI] CONNECTED!");
    Serial.print("[WIFI] IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WIFI] Could not connect. Will retry in loop.");
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

  Serial.println("[WSS] Connecting to Render Cloud Relay...");
  Serial.printf("[WSS] Target: %s\n", RELAY_WSS_URL);
  
  // Connect via secure WSS
  bool connected = wsClient.connect(RELAY_WSS_URL);
  if (!connected) {
    Serial.println("[WSS] Connection attempt failed. Retrying...");
  }
}

// =====================================================================================
// SETUP
// =====================================================================================
void setup() {
  // Debug USB Serial (for monitoring on computer if plugged in)
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=======================================================");
  Serial.println("🚀 SAE INDIA — ESP32 CLOUD RELAY CLIENT (STANDALONE)");
  Serial.println("=======================================================");

  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);

  // Initialize Pixhawk Hardware Serial (UART2)
  PixhawkSerial.begin(PIXHAWK_BAUD, SERIAL_8N1, PIXHAWK_RX_PIN, PIXHAWK_TX_PIN);
  Serial.printf("[UART] Pixhawk Serial2 initialized: RX=%d, TX=%d @ %d baud\n", 
                PIXHAWK_RX_PIN, PIXHAWK_TX_PIN, PIXHAWK_BAUD);

  // Configure WebSocket Client callbacks
  wsClient.onMessage(onMessageCallback);
  wsClient.onEvent(onEventsCallback);

  // Connect to Wi-Fi / Hotspot
  connectToWiFi();
}

// =====================================================================================
// MAIN LOOP
// =====================================================================================
void loop() {
  // 1. Maintain Wi-Fi
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

  // 3. Poll WebSocket Client for incoming packets from phone
  wsClient.poll();

  // 4. Send Periodic Ping to keep cloud relay connection alive
  if (wsClient.available() && millis() - lastPingTime > PING_INTERVAL_MS) {
    lastPingTime = millis();
    wsClient.ping();
  }

  // 5. Read binary MAVLink data from Pixhawk UART -> Send to Cloud Relay
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
