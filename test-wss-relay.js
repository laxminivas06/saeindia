import http from 'http';
import { WebSocket } from 'ws';
import { spawn } from 'child_process';

console.log('========================================================');
console.log('🧪 RUNNING PRODUCTION WSS RELAY INTEGRATION TEST SUITE');
console.log('========================================================\n');

// 1. Start Relay Server on Test Port 9443
const serverProcess = spawn('node', ['relay-server/server.js'], {
  env: { ...process.env, PORT: '9443' },
  stdio: 'pipe'
});

serverProcess.stdout.on('data', (d) => {
  // console.log('[SERVER LOG]:', d.toString().trim());
});

serverProcess.stderr.on('data', (d) => {
  console.error('[SERVER ERR]:', d.toString().trim());
});

async function runTests() {
  // Wait for server to start
  await new Promise((r) => setTimeout(r, 1200));

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`✅ [PASS] ${message}`);
      passedTests++;
    } else {
      console.error(`❌ [FAIL] ${message}`);
      throw new Error(`Test assertion failed: ${message}`);
    }
  }

  try {
    // --- TEST 1: Health Check Endpoint ---
    console.log('\n--- Test 1: GET /health ---');
    const healthRes = await new Promise((resolve, reject) => {
      http.get('http://localhost:9443/health', (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(data) }));
      }).on('error', reject);
    });

    assert(healthRes.statusCode === 200, 'Health endpoint returns HTTP 200');
    assert(healthRes.body.status === 'ok', 'Status is "ok"');
    assert(healthRes.body.service === 'sae-india-drone-relay', 'Service name is "sae-india-drone-relay"');
    assert(healthRes.body.websocket === true, 'WebSocket is enabled');
    assert(healthRes.body.endpoint === '/ws', 'Endpoint is "/ws"');

    // --- TEST 2: Frontend Client Connection & ACK ---
    console.log('\n--- Test 2: Frontend WebSocket Connection & ACK ---');
    let frontendAckReceived = false;
    let frontendSocket = new WebSocket('ws://localhost:9443/ws?client=frontend');
    frontendSocket.binaryType = 'arraybuffer';

    await new Promise((resolve, reject) => {
      frontendSocket.on('open', () => {
        console.log('[Frontend] Connected to WSS relay');
        frontendSocket.send(JSON.stringify({ type: 'register', client: 'frontend' }));
      });
      frontendSocket.on('message', (data, isBinary) => {
        if (!isBinary) {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'connection_ack') {
            frontendAckReceived = true;
            assert(msg.status === 'connected', 'Received connection_ack with status=connected');
            assert(msg.client === 'frontend', 'Ack recognizes client as frontend');
            resolve();
          }
        }
      });
      frontendSocket.on('error', reject);
    });
    assert(frontendAckReceived, 'Frontend received connection_ack from relay');

    // --- TEST 3: ESP32 Client Connection & ACK ---
    console.log('\n--- Test 3: ESP32 WebSocket Connection & ACK ---');
    let esp32AckReceived = false;
    let esp32Socket = new WebSocket('ws://localhost:9443/ws?client=esp32');
    esp32Socket.binaryType = 'arraybuffer';

    await new Promise((resolve, reject) => {
      esp32Socket.on('open', () => {
        console.log('[ESP32] Connected to WSS relay');
        esp32Socket.send(JSON.stringify({ type: 'register', client: 'esp32', device_id: 'drone-01' }));
      });
      esp32Socket.on('message', (data, isBinary) => {
        if (!isBinary) {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'connection_ack') {
            esp32AckReceived = true;
            assert(msg.status === 'connected', 'ESP32 received connection_ack');
            assert(msg.client === 'esp32', 'Ack recognizes client as esp32');
            resolve();
          }
        }
      });
      esp32Socket.on('error', reject);
    });
    assert(esp32AckReceived, 'ESP32 received connection_ack from relay');

    // --- TEST 4: Telemetry ESP32 -> Render -> Frontend ---
    console.log('\n--- Test 4: ESP32 -> Render -> Frontend Binary Telemetry ---');
    // Simulated MAVLink packet (e.g. HEARTBEAT packet bytes: 0xFD, len, sysid 1, compid 1)
    const testMavlinkPacket = new Uint8Array([0xFD, 0x09, 0x00, 0x00, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00]);
    let frontendReceivedTelemetry = false;

    const telemetryPromise = new Promise((resolve) => {
      frontendSocket.on('message', (data, isBinary) => {
        if (isBinary) {
          const received = new Uint8Array(data);
          assert(received.length === testMavlinkPacket.length, `Frontend received binary chunk of length ${received.length}`);
          assert(received[0] === 0xFD, 'First byte is 0xFD (MAVLink V2 magic)');
          frontendReceivedTelemetry = true;
          resolve();
        }
      });
    });

    // Send from ESP32
    esp32Socket.send(testMavlinkPacket);
    await telemetryPromise;
    assert(frontendReceivedTelemetry, 'Telemetry successfully travelled ESP32 -> Render -> Frontend');

    // --- TEST 5: Command Frontend -> Render -> ESP32 ---
    console.log('\n--- Test 5: Frontend -> Render -> ESP32 Binary Command ---');
    const testCommandPacket = new Uint8Array([0xFD, 0x05, 0x00, 0x00, 0x4C, 0x01, 0x01, 0xAA, 0xBB, 0xCC]);
    let esp32ReceivedCommand = false;

    const commandPromise = new Promise((resolve) => {
      esp32Socket.on('message', (data, isBinary) => {
        if (isBinary) {
          const received = new Uint8Array(data);
          assert(received.length === testCommandPacket.length, `ESP32 received binary chunk of length ${received.length}`);
          assert(received[received.length - 1] === 0xCC, 'Packet content verified');
          esp32ReceivedCommand = true;
          resolve();
        }
      });
    });

    // Send from Frontend
    frontendSocket.send(testCommandPacket);
    await commandPromise;
    assert(esp32ReceivedCommand, 'Command successfully travelled Frontend -> Render -> ESP32');

    // --- TEST 6: Heartbeat Ping / Pong ---
    console.log('\n--- Test 6: Heartbeat Ping / Pong ---');
    let pongReceived = false;
    const testTimestamp = 1791170000000;

    const pongPromise = new Promise((resolve) => {
      const handler = (data, isBinary) => {
        if (!isBinary) {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'pong') {
            assert(msg.timestamp === testTimestamp, 'Pong preserves timestamp');
            assert(typeof msg.serverTimestamp === 'number', 'Pong includes serverTimestamp');
            pongReceived = true;
            frontendSocket.off('message', handler);
            resolve();
          }
        }
      };
      frontendSocket.on('message', handler);
    });

    frontendSocket.send(JSON.stringify({ type: 'ping', timestamp: testTimestamp }));
    await pongPromise;
    assert(pongReceived, 'Heartbeat ping/pong round-trip verified');

    // --- TEST 7: Bi-Directional Test Message (Requirement 20 Test 7) ---
    console.log('\n--- Test 7: Bi-Directional Test Message Relay ---');
    let testRelayedToEsp32 = false;

    const testRelayPromise = new Promise((resolve) => {
      const handler = (data, isBinary) => {
        if (!isBinary) {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'test_relay' && msg.message === 'WSS relay test') {
            testRelayedToEsp32 = true;
            esp32Socket.off('message', handler);
            resolve();
          }
        }
      };
      esp32Socket.on('message', handler);
    });

    frontendSocket.send(JSON.stringify({ type: 'test', message: 'WSS relay test' }));
    await testRelayPromise;
    assert(testRelayedToEsp32, 'Test message relayed from Frontend through Render to ESP32');

    // Clean up sockets
    frontendSocket.close();
    esp32Socket.close();

    console.log('\n========================================================');
    console.log(`🎉 ALL ${passedTests}/${totalTests} INTEGRATION TESTS PASSED!`);
    console.log('========================================================');
    process.exit(0);

  } catch (err) {
    console.error('\n❌ TEST SUITE FAILED:', err);
    process.exit(1);
  } finally {
    serverProcess.kill();
  }
}

runTests();
