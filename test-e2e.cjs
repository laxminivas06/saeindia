const WebSocket = require('./relay-server/node_modules/ws');
const { spawn } = require('child_process');

console.log('--- STARTING END-TO-END PIPELINE VERIFICATION ---');

// 1. Launch Cloud Relay on port 8765
const relay = spawn('node', ['relay-server/server.js'], {
  env: { ...process.env, PORT: '8765', RELAY_TOKEN: 'e2e-secret-key-456' }
});

relay.stdout.on('data', d => console.log('[RELAY]', d.toString().trim()));
relay.stderr.on('data', d => console.error('[RELAY ERROR]', d.toString().trim()));

setTimeout(() => {
  // 2. Connect Browser client to Relay
  console.log('\n[TEST] Connecting Browser client to Relay /ws?token=e2e-secret-key-456...');
  const browserWs = new WebSocket('ws://localhost:8765/ws?token=e2e-secret-key-456');
  browserWs.binaryType = 'arraybuffer';

  let binaryPacketsReceived = 0;
  let controlMessagesReceived = [];

  browserWs.on('open', () => {
    console.log('[BROWSER] WebSocket connected to relay endpoint successfully.');

    // 3. Now start the Local Connector
    console.log('\n[TEST] Launching Local Connector pointing to ESP32 (192.168.31.194:8080/ws) & Relay...');
    const connector = spawn('node', ['local-connector/connector.js'], {
      env: {
        ...process.env,
        ESP32_HOST: '192.168.31.194',
        ESP32_PORT: '8080',
        ESP32_PATH: '/ws',
        RELAY_URL: 'ws://localhost:8765/connector',
        RELAY_TOKEN: 'e2e-secret-key-456'
      }
    });

    connector.stdout.on('data', d => console.log('[CONNECTOR]', d.toString().trim()));
    connector.stderr.on('data', d => console.error('[CONNECTOR ERROR]', d.toString().trim()));

    // 4. Send uplink command from browser through relay -> connector -> ESP32
    setTimeout(() => {
      console.log('\n[TEST] Sending simulated uplink MAVLink heartbeat from Browser to ESP32...');
      const dummyHeartbeat = Buffer.from([0xFD, 0x09, 0x00, 0x00, 0x01, 0xFF, 0xBE, 0x00, 0x00, 0x00, 0x06, 0x08, 0x00, 0x00, 0x00, 0x03, 0x85, 0x47, 0x5a]);
      browserWs.send(dummyHeartbeat);
    }, 1500);

    setTimeout(() => {
      console.log('\n--- VERIFICATION SUMMARY ---');
      console.log('Total Control Messages Received:', controlMessagesReceived.length);
      console.log('Total Binary MAVLink Packets Received by Browser:', binaryPacketsReceived);
      const passed = binaryPacketsReceived > 0;
      console.log('Result:', passed ? 'SUCCESS - E2E Pipeline fully operational' : 'FAILED - No binary packets');

      browserWs.close();
      connector.kill();
      relay.kill();
      process.exit(passed ? 0 : 1);
    }, 4500);
  });

  browserWs.on('message', (data, isBinary) => {
    if (!isBinary) {
      const msg = data.toString();
      controlMessagesReceived.push(msg);
      console.log('[BROWSER] Received JSON Control Message:', msg);
    } else {
      binaryPacketsReceived++;
      const bytes = new Uint8Array(data);
      const magic = bytes[0] === 0xFD ? 'MAVLink v2 (0xFD)' : (bytes[0] === 0xFE ? 'MAVLink v1 (0xFE)' : '0x' + bytes[0].toString(16));
      if (binaryPacketsReceived <= 5) {
        console.log(`[BROWSER] Received Binary MAVLink Frame #${binaryPacketsReceived}: len=${bytes.length}, header=${magic}, seq=${bytes[2]}`);
      }
    }
  });

}, 1000);
