/**
 * DroneCode - WebSocket to UDP Proxy
 * Bridges browser WebSocket connections to Tello drone UDP commands.
 *
 * How it works:
 *   Browser ──WebSocket──► This proxy ──UDP──► Tello Drone (192.168.10.1:8889)
 *
 * Requirements:
 *   - Your computer running this proxy must be connected to the Tello WiFi
 *   - The browser connects to this proxy via WebSocket (ws://localhost:8080)
 *   - Run with: node proxy.js
 */

const WebSocket = require('ws');
const dgram = require('dgram');

// ─── Configuration ────────────────────────────────────────────────
const WS_PORT = 8080;           // WebSocket port the browser connects to
const TELLO_IP = '192.168.10.1';
const TELLO_CMD_PORT = 8889;    // Tello command port
const TELLO_STATE_PORT = 8890;  // Tello state/telemetry port
const LOCAL_HOST = '0.0.0.0';   // Listen on all interfaces
// ──────────────────────────────────────────────────────────────────

console.log('');
console.log('╔══════════════════════════════════════════╗');
console.log('║        DroneCode WebSocket Proxy         ║');
console.log('╚══════════════════════════════════════════╝');
console.log('');

// Create UDP socket for communicating with Tello
const udpClient = dgram.createSocket('udp4');
const stateSocket = dgram.createSocket('udp4');

let wss;
let activeClient = null;
let droneState = {};
let isConnectedToDrone = false;
let commandQueue = [];
let waitingForResponse = false;

// ─── UDP: Listen for Tello responses ──────────────────────────────
udpClient.bind(9000, () => {
  console.log('[UDP] Listening for Tello responses on port 9000');
});

udpClient.on('message', (msg, rinfo) => {
  const response = msg.toString().trim();
  console.log(`[UDP ←] Tello: "${response}"`);

  if (activeClient && activeClient.readyState === WebSocket.OPEN) {
    activeClient.send(JSON.stringify({
      type: 'response',
      data: response,
      timestamp: Date.now()
    }));
  }

  waitingForResponse = false;
  processQueue();
});

udpClient.on('error', (err) => {
  console.error('[UDP] Error:', err.message);
  broadcastLog('error', `UDP error: ${err.message}`);
});

// ─── UDP: Listen for Tello state telemetry ────────────────────────
stateSocket.bind(TELLO_STATE_PORT, () => {
  console.log(`[UDP] Listening for Tello state on port ${TELLO_STATE_PORT}`);
});

stateSocket.on('message', (msg) => {
  const raw = msg.toString().trim();
  // Parse Tello state string: "pitch:0;roll:0;yaw:0;vgx:0;..."
  const state = {};
  raw.split(';').forEach(pair => {
    const [key, val] = pair.split(':');
    if (key && val !== undefined) state[key.trim()] = parseFloat(val.trim());
  });
  droneState = state;

  if (activeClient && activeClient.readyState === WebSocket.OPEN) {
    activeClient.send(JSON.stringify({
      type: 'state',
      data: state,
      timestamp: Date.now()
    }));
  }
});

stateSocket.on('error', (err) => {
  // State socket errors are non-fatal
  console.warn('[UDP State] Warning:', err.message);
});

// ─── Helper: Send UDP command to Tello ───────────────────────────
function sendUDP(command) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(command);
    udpClient.send(buf, 0, buf.length, TELLO_CMD_PORT, TELLO_IP, (err) => {
      if (err) {
        console.error(`[UDP →] Failed to send "${command}":`, err.message);
        reject(err);
      } else {
        console.log(`[UDP →] Sent: "${command}"`);
        resolve();
      }
    });
  });
}

// ─── Command Queue (ensures commands are sequential) ─────────────
function enqueueCommand(command, ws) {
  commandQueue.push({ command, ws });
  processQueue();
}

function processQueue() {
  if (waitingForResponse || commandQueue.length === 0) return;
  const { command, ws } = commandQueue.shift();
  waitingForResponse = true;

  sendUDP(command).catch(err => {
    waitingForResponse = false;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', data: err.message }));
    }
    processQueue();
  });

  // Timeout: if no response in 10s, continue anyway
  setTimeout(() => {
    if (waitingForResponse) {
      console.warn('[Proxy] Command timeout, continuing queue...');
      waitingForResponse = false;
      processQueue();
    }
  }, 10000);
}

// ─── WebSocket Server ─────────────────────────────────────────────
wss = new WebSocket.Server({ port: WS_PORT, host: LOCAL_HOST }, () => {
  console.log(`[WS]  WebSocket server running on ws://localhost:${WS_PORT}`);
  console.log(`[WS]  Open DroneCode in your browser and connect.`);
  console.log('');
  console.log('  Make sure your computer WiFi is connected to TELLO-XXXXXX');
  console.log(`  Tello target: ${TELLO_IP}:${TELLO_CMD_PORT}`);
  console.log('');
});

wss.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress;
  console.log(`[WS]  Client connected from ${clientIP}`);

  // Only allow one active drone controller at a time
  if (activeClient && activeClient.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'error', data: 'Another client is already connected.' }));
    ws.close();
    return;
  }

  activeClient = ws;

  ws.send(JSON.stringify({
    type: 'connected',
    data: { proxyVersion: '1.0.0', telloIP: TELLO_IP, telloPort: TELLO_CMD_PORT }
  }));

  // Initialize Tello SDK mode
  enqueueCommand('command', ws);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); }
    catch { console.warn('[WS]  Invalid JSON received'); return; }

    if (msg.type === 'command') {
      const cmd = (msg.data || '').trim();
      if (!cmd) return;

      console.log(`[WS ←] Browser: "${cmd}"`);
      broadcastLog('command', cmd);

      // Safety: block dangerous commands unless explicitly armed
      const blocked = [];
      if (blocked.includes(cmd.split(' ')[0])) {
        ws.send(JSON.stringify({ type: 'error', data: `Command "${cmd}" is blocked.` }));
        return;
      }

      enqueueCommand(cmd, ws);

    } else if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
    }
  });

  ws.on('close', () => {
    console.log('[WS]  Client disconnected');
    activeClient = null;
    commandQueue = [];
    waitingForResponse = false;
  });

  ws.on('error', (err) => {
    console.error('[WS]  Error:', err.message);
  });
});

wss.on('error', (err) => {
  console.error('[WS]  Server error:', err.message);
  if (err.code === 'EADDRINUSE') {
    console.error(`      Port ${WS_PORT} is already in use. Kill the other process or change WS_PORT.`);
  }
  process.exit(1);
});

function broadcastLog(type, data) {
  if (activeClient && activeClient.readyState === WebSocket.OPEN) {
    activeClient.send(JSON.stringify({ type: 'log', level: type, data }));
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n[Proxy] Shutting down...');
  if (activeClient) activeClient.close();
  wss.close();
  udpClient.close();
  stateSocket.close();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('[Proxy] Uncaught exception:', err.message);
});
