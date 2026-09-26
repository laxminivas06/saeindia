/*
 * =====================================================================================
 * SAE INDIA — Autonomous Drone Rescue System
 * ESP32-S3 Cloud Relay Direct WSS Client (Standalone / Zero-Laptop Mode)
 * With Comprehensive Live Serial Monitor Diagnostics
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
 * ARDUINO IDE SETTINGS (CRITICAL FOR ESP32-S3 SERIAL MONITOR):
 *   1. Tools -> Board -> "ESP32S3 Dev Module"
 *   2. Tools -> USB CDC On Boot -> "Enabled"  <-- CRITICAL to see Serial output!
 *   3. Tools -> Upload Mode -> "UART0 / Hardware CDC" or "USB-OTG CDC"
 *   4. Set Serial Monitor Baud Rate to: 115200
 *
 * MISSION PLANNER PARAMETERS (TELEM2):
 *   SERIAL2_PROTOCOL = 2   (MAVLink 2)
 *   SERIAL2_BAUD     = 57  (57600 baud)
 * =====================================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoWebsockets.h>

// =====================================================================================
// 1. WI-FI CONFIGURATION (Phone Hotspot or Field Wi-Fi)
// =====================================================================================
// Change to your Phone's Personal Hotspot or home Wi-Fi credentials:
const char* WIFI_SSID     = "DRONE_WIFI_2.4G";      // <-- Enter your hotspot/Wi-Fi name
const char* WIFI_PASSWORD = "your_wifi_password";   // <-- Enter your Wi-Fi password

// Optional Fallback Wi-Fi
const char* FALLBACK_SSID = "";
const char* FALLBACK_PASS = "";

// =====================================================================================
// 2. CLOUD RELAY WSS CONFIGURATION (ACTIVE PRODUCTION RELAY)
// =====================================================================================
const char* RELAY_HOST    = "saeindia-relay.onrender.com";
const uint16_t RELAY_PORT = 443;
const char* RELAY_PATH    = "/connector?token=saeindia_sec_99348a7b1c0e";
const char* RELAY_WSS_URL = "wss://saeindia-relay.onrender.com/connector?token=saeindia_sec_99348a7b1c0e";

// Google Trust Services (GTS Root R4) Root CA used by Render.com
const char RENDER_CA_CERT[] PROGMEM = 
"-----BEGIN CERTIFICATE-----\n"
"MIIDejCCAmKgAwIBAgIQf+UwvzMTQ77dghYQST2KGzANBgkqhkiG9w0BAQsFADBX\n"
"MQswCQYDVQQGEwJCRTEZMBcGA1UEChMQR2xvYmFsU2lnbiBudi1zYTEQMA4GA1UE\n"
"CxMHUm9vdCBDQTEbMBkGA1UEAxMSR2xvYmFsU2lnbiBSb290IENBMB4XDTIzMTEx\n"
"NTAzNDMyMVoXDTI4MDEyODAwMDA0MlowRzELMAkGA1UEBhMCVVMxIjAgBgNVBAoT\n"
"GUdvb2dsZSBUcnVzdCBTZXJ2aWNlcyBMTEMxFDASBgNVBAMTC0dUUyBSb290IFI0\n"
"MHYwEAYHKoZIzj0CAQYFK4EEACIDYgAE83Rzp2iLYK5DuDXFgTB7S0md+8Fhzube\n"
"Rr1r1WEYNa5A3XP3iZEwWus87oV8okB2O6nGuEfYKueSkWpz6bFyOZ8pn6KY019e\n"
"WIZlD6GEZQbR3IvJx3PIjGov5cSr0R2Ko4H/MIH8MA4GA1UdDwEB/wQEAwIBhjAd\n"
"BgNVHSUEFjAUBggrBgEFBQcDAQYIKwYBBQUHAwIwDwYDVR0TAQH/BAUwAwEB/zAd\n"
"BgNVHQ4EFgQUgEzW63T/STaj1dj8tT7FavCUHYwwHwYDVR0jBBgwFoAUYHtmGkUN\n"
"l8qJUC99BM00qP/8/UswNgYIKwYBBQUHAQEEKjAoMCYGCCsGAQUFBzAChhpodHRw\n"
"Oi8vaS5wa2kuZ29vZy9nc3IxLmNydDAtBgNVHR8EJjAkMCKgIKAehhxodHRwOi8v\n"
"Yy5wa2kuZ29vZy9yL2dzcjEuY3JsMBMGA1UdIAQMMAowCAYGZ4EMAQIBMA0GCSqG\n"
"SIb3DQEBCwUAA4IBAQAYQrsPBtYDh5bjP2OBDwmkoWhIDDkic574y04tfzHpn+cJ\n"
"odI2D4SseesQ6bDrarZ7C30ddLibZatoKiws3UL9xnELz4ct92vID24FfVbiI1hY\n"
"+SW6FoVHkNeWIP0GCbaM4C6uVdF5dTUsMVs/ZbzNnIdCp5Gxmx5ejvEau8otR/Cs\n"
"kGN+hr/W5GvT1tMBjgWKZ1i4//emhA1JG1BbPzoLJQvyEotc03lXjTaCzv8mEbep\n"
"8RqZ7a2CPsgRbuvTPBwcOMBBmuFeU88+FSBX6+7iP0il8b4Z0QFqIwwMHfs/L6K1\n"
"vepuoxtGzi4CZ68zJpiq1UvSqTbFJjtbD4seiMHl\n"
"-----END CERTIFICATE-----\n";

// GlobalSign Root CA fallback
const char GLOBALSIGN_ROOT_CA[] PROGMEM =
"-----BEGIN CERTIFICATE-----\n"
"MIIDdTCCAl2gAwIBAgILBAAAAAABFUtaw5QwDQYJKoZIhvcNAQEFBQAwVzELMAkG\n"
"A1UEBhMCQkUxGTAXBgNVBAoTEEdsb2JhbFNpZ24gbnYtc2ExEDAOBgNVBAsTB1Jv\n"
"b3QgQ0ExGzAZBgNVBAMTEkdsb2JhbFNpZ24gUm9vdCBDQTAeFw05ODA5MDExMjAw\n"
"MDBaFw0yODAxMjgxMjAwMDBaMFcxCzAJBgNVBAYTAkJFMRkwFwYDVQQKExBHbG9i\n"
"YWxTaWduIG52LXNhMRAwDgYDVQQLEwdSb290IENBMRswGQYDVQQDExJHbG9iYWxT\n"
"aWduIFJvb3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDaDuaZ\n"
"jc6j40+Kfvvxi4Mla+pIH/EqsLmVEQS98GPR4mdmzxzdzxtIK+6NiY6arymAZavp\n"
"xy0Sy6scTHAHoT0KMM0VjU/43dSMUBUc71DuxC73/OlS8pF94G3VNTCOXkNz8kHp\n"
"1Wrjsok6Vjk4bwY8iGlbKk3Fp1S4bInMm/k8yuX9ifUSPJJ4ltbcdG6TRGHRjcdG\n"
"snUOhugZitVtbNV4FpWi6cgKOOvyJBNPc1STE4U6G7weNLWLBYy5d4ux2x8gkasJ\n"
"U26Qzns3dLlwR5EiUWMWea6xrkEmCMgZK9FGqkjWZCrXgzT/LCrBbBlDSgeF59N8\n"
"9iFo7+ryUp9/k5DPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNVHRMBAf8E\n"
"BTADAQH/MB0GA1UdDgQWBBRge2YaRQ2XyolQL30EzTSo//z9SzANBgkqhkiG9w0B\n"
"AQUFAAOCAQEA1nPnfE920I2/7LqivjTFKDK1fPxsnCwrvQmeU79rXqoRSLblCKOz\n"
"yj1hTdNGCbM+w6DjY1Ub8rrvrTnhQ7k4o+YviiY776BQVvnGCv04zcQLcFGUl5gE\n"
"38NflNUVyRRBnMRddWQVDf9VMOyGj/8N7yy5Y0b2qvzfvGn9LhJIZJrglfCm7ymP\n"
"AbEVtQwdpf5pLGkkeB6zpxxxYu7KyJesF12KwvhHhm4qxFYxldBniYUr+WymXUad\n"
"DKqC5JlR3XC321Y9YeRq4VzW9v493kHMB65jUr9TU/Qr6cf9tveCX4XSQRjbgbME\n"
"HMUfpIBvFSDJ3gyICh3WZlXi/EjJKSZp4A==\n"
"-----END CERTIFICATE-----\n";

// =====================================================================================
// 3. PIXHAWK TELEM2 UART CONFIGURATION (YOUR EXACT WIRING)
// =====================================================================================
#define PIXHAWK_RX_PIN    18     // ESP32-S3 GPIO 18 connects to Pixhawk TELEM2 Pin 2 (TX)
#define PIXHAWK_TX_PIN    17     // ESP32-S3 GPIO 17 connects to Pixhawk TELEM2 Pin 3 (RX)
#define PIXHAWK_BAUD      57600  // Standard Pixhawk TELEM2 baud (SERIAL2_BAUD = 57)

// Status LED (GPIO 2, set to -1 if your S3 board has no onboard LED)
#define STATUS_LED_PIN    2

// =====================================================================================
// GLOBAL OBJECTS & TELEMETRY COUNTERS
// =====================================================================================
using namespace websockets;
WebsocketsClient wsClient;

// Hardware UART1 on ESP32-S3 for Pixhawk TELEM2
HardwareSerial PixhawkSerial(1);

unsigned long lastPingTime = 0;
const unsigned long PING_INTERVAL_MS = 15000;

unsigned long lastReconnectAttempt = 0;
const unsigned long RECONNECT_INTERVAL_MS = 3000;

// Periodic 3-second live diagnostic print timer
unsigned long lastDiagnosticPrint = 0;
const unsigned long DIAGNOSTIC_INTERVAL_MS = 3000;

// Cumulative statistics
unsigned long totalRxBytesFromPixhawk = 0;
unsigned long totalTxBytesToPixhawk   = 0;
unsigned long totalMavlinkPacketsSent = 0;
unsigned long totalCommandsReceived   = 0;

// UART Buffer
#define UART_BUFFER_SIZE 1024
uint8_t uartBuffer[UART_BUFFER_SIZE];

// =====================================================================================
// STATUS LED HELPER
// =====================================================================================
void updateLED(int mode) {
  if (STATUS_LED_PIN < 0) return;
  if (mode == 2) {
    digitalWrite(STATUS_LED_PIN, HIGH); // Solid ON (Connected)
  } else if (mode == 0) {
    digitalWrite(STATUS_LED_PIN, LOW);  // OFF
  } else {
    digitalWrite(STATUS_LED_PIN, (millis() / 250) % 2); // Blinking (Connecting)
  }
}

// =====================================================================================
// WEBSOCKET EVENT CALLBACKS
// =====================================================================================
void onMessageCallback(WebsocketsMessage message) {
  if (message.isBinary()) {
    // Binary MAVLink command frame received from Phone -> Forward to Pixhawk TELEM2
    const uint8_t* payload = (const uint8_t*)message.c_str();
    size_t length = message.length();
    PixhawkSerial.write(payload, length);

    totalTxBytesToPixhawk += length;
    totalCommandsReceived++;

    Serial.printf("📥 [PHONE -> PIXHAWK] Command received (%u bytes) -> Sent to TELEM2 (Total TX: %lu bytes)\n",
                  length, totalTxBytesToPixhawk);
  } else if (message.isText()) {
    Serial.printf("ℹ️ [RELAY MESSAGE] %s\n", message.data().c_str());
  }
}

void onEventsCallback(WebsocketsEvent event, String data) {
  if (event == WebsocketsEvent::ConnectionOpened) {
    Serial.println("\n");
    Serial.println("*********************************************************");
    Serial.println("🟢 [WSS CLOUD RELAY] >>> CONNECTED SUCCESSFULLY! <<<");
    Serial.println("🌐 Drone is now online in the cloud. Phone webapp ready!");
    Serial.println("*********************************************************\n");
    updateLED(2);

    // Announce connection to relay server
    wsClient.send("{\"type\":\"ESP32_STATUS\",\"status\":\"CONNECTED\",\"device\":\"ESP32_S3_STANDALONE\"}");
  } else if (event == WebsocketsEvent::ConnectionClosed) {
    Serial.println("\n🔴 [WSS CLOUD RELAY] Connection closed. Will reconnect automatically...");
    updateLED(0);
  } else if (event == WebsocketsEvent::GotPing) {
    // Ping acknowledged
  } else if (event == WebsocketsEvent::GotPong) {
    // Pong received
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
  
  WiFi.mode(WIFI_STA);
  // Configure Google Public DNS (8.8.8.8) to guarantee .onrender.com resolves on all mobile hotspots
  WiFi.config(INADDR_NONE, INADDR_NONE, INADDR_NONE, IPAddress(8, 8, 8, 8), IPAddress(1, 1, 1, 1));
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startAttempt = millis();
  int dotCount = 0;
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 10000) {
    delay(400);
    Serial.print(".");
    dotCount++;
    if (dotCount % 30 == 0) Serial.println();
    updateLED(1);
  }

  // Fallback Wi-Fi check
  if (WiFi.status() != WL_CONNECTED && strlen(FALLBACK_SSID) > 0) {
    Serial.printf("\n📡 [WIFI] Trying fallback SSID: '%s' ...\n", FALLBACK_SSID);
    WiFi.begin(FALLBACK_SSID, FALLBACK_PASS);
    startAttempt = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 10000) {
      delay(400);
      Serial.print(".");
      updateLED(1);
    }
  }

  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("🟢 [WIFI] CONNECTED SUCCESSFULLY!");
    Serial.printf("📍 [WIFI] IP Address:    %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("📶 [WIFI] Signal (RSSI):  %d dBm\n", WiFi.RSSI());
    Serial.printf("🚪 [WIFI] Gateway:        %s\n", WiFi.gatewayIP().toString().c_str());
    Serial.printf("🔍 [WIFI] DNS Server:    %s\n", WiFi.dnsIP().toString().c_str());
    Serial.println("⏳ [NTP] Synchronizing network time for TLS certificate validation...");
    configTime(0, 0, "pool.ntp.org", "time.google.com");
    Serial.println("---------------------------------------------------------");
  } else {
    Serial.println("❌ [WIFI FAILED] Could not connect to Wi-Fi. Check SSID and password.");
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

  // 1. Verify DNS resolution
  IPAddress relayIP;
  if (!WiFi.hostByName(RELAY_HOST, relayIP)) {
    Serial.printf("❌ [DNS FAILED] Could not resolve '%s' via DNS %s. Check Internet connection!\n",
                  RELAY_HOST, WiFi.dnsIP().toString().c_str());
    return;
  }
  Serial.printf("🌐 [DNS OK] %s -> %s\n", RELAY_HOST, relayIP.toString().c_str());

  Serial.println("☁️  [WSS] Connecting to Render Cloud Relay via SSL...");
  Serial.printf("🔗 [WSS] URL: %s\n", RELAY_WSS_URL);
  
  // Set CA Certificate for ESP32 SSL validation
  wsClient.setCACert(RENDER_CA_CERT);
  bool connected = wsClient.connect(RELAY_WSS_URL);
  if (!connected) {
    wsClient.setCACert(GLOBALSIGN_ROOT_CA);
    connected = wsClient.connect(RELAY_WSS_URL);
  }
  if (!connected) {
    Serial.println("⚠️  [WSS] Connection attempt failed. Retrying in 3 seconds...");
  }
}

// =====================================================================================
// SETUP
// =====================================================================================
void setup() {
  // Initialize USB Serial for Monitor
  Serial.begin(115200);
  delay(1000); // 1-second delay for USB/UART to stabilize

  Serial.println();
  Serial.println("=========================================================");
  Serial.println("🚀 SAE INDIA — ESP32-S3 DIRECT CLOUD RELAY CLIENT");
  Serial.println("   Standalone Phone-to-Drone MAVLink Bridge");
  Serial.println("=========================================================");
  Serial.printf("📋 Hardware Target:     ESP32-S3\n");
  Serial.printf("🔌 Pixhawk TELEM2 RX:   GPIO %d (Connects to Pixhawk TX Pin 2)\n", PIXHAWK_RX_PIN);
  Serial.printf("🔌 Pixhawk TELEM2 TX:   GPIO %d (Connects to Pixhawk RX Pin 3)\n", PIXHAWK_TX_PIN);
  Serial.printf("⚡ Pixhawk Baud Rate:   %d baud\n", PIXHAWK_BAUD);
  Serial.printf("☁️  Cloud Relay Host:   %s\n", RELAY_HOST);
  Serial.println("=========================================================\n");

  if (STATUS_LED_PIN >= 0) {
    pinMode(STATUS_LED_PIN, OUTPUT);
    digitalWrite(STATUS_LED_PIN, LOW);
  }

  // Initialize Pixhawk Hardware UART1:
  // RX = GPIO 18 (connects to Pixhawk TELEM2 Pin 2 TX)
  // TX = GPIO 17 (connects to Pixhawk TELEM2 Pin 3 RX)
  PixhawkSerial.begin(PIXHAWK_BAUD, SERIAL_8N1, PIXHAWK_RX_PIN, PIXHAWK_TX_PIN);
  Serial.println("✅ [UART] Hardware Serial1 initialized on GPIO 18 (RX) and GPIO 17 (TX).");

  // Configure WebSocket Client callbacks and SSL CA
  wsClient.setCACert(RENDER_CA_CERT);
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
    updateLED(2); // Solid ON when fully connected
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
  if (bytesAvailable > 0) {
    size_t bytesToRead = (bytesAvailable > UART_BUFFER_SIZE) ? UART_BUFFER_SIZE : bytesAvailable;
    size_t bytesRead = PixhawkSerial.readBytes(uartBuffer, bytesToRead);

    if (bytesRead > 0) {
      totalRxBytesFromPixhawk += bytesRead;

      // Forward to Cloud Relay if connected
      if (wsClient.available()) {
        wsClient.sendBinary((const char*)uartBuffer, bytesRead);
        totalMavlinkPacketsSent++;
      }
    }
  }

  // 6. Periodic 3-Second Live Status Heartbeat (Guarantees Serial Monitor is clean and CPU is not blocked)
  if (millis() - lastDiagnosticPrint > DIAGNOSTIC_INTERVAL_MS) {
    lastDiagnosticPrint = millis();

    Serial.printf("📊 [MONITOR] Wi-Fi: %s | Cloud WSS: %s | Pixhawk RX: %lu bytes | Forwarded: %lu pkts | TX to Drone: %lu bytes\n",
                  WiFi.status() == WL_CONNECTED ? "ONLINE ✓" : "OFFLINE ✗",
                  wsClient.available() ? "STREAMING TO PHONE ✓" : "CONNECTING...",
                  totalRxBytesFromPixhawk,
                  totalMavlinkPacketsSent,
                  totalTxBytesToPixhawk);
  }
}
