// server.js - Node.js WebSocket server for multi-device synchronization
// VERSION: Added WebSocket ping/pong keep-alive mechanism.
//          + Added sound state synchronization message handling.

const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);

// Initialize WebSocket server with clientTracking enabled (default)
// perMessageDeflate can sometimes interfere with proxies/load balancers,
// but is generally fine. If issues arise, consider setting it to false.
const wss = new WebSocket.Server({
    server,
    maxPayload: 1 * 1024 * 1024, // 1MB limit
    // clientTracking: true, // Default
    // perMessageDeflate: false // Consider if proxy issues occur
});

// --- Configuration ---
const PORT = process.env.PORT || 3000;
const SESSION_ID_LENGTH = 4; // Length of the generated session IDs
const PING_INTERVAL = 30000; // Send ping every 30 seconds (ms)

// --- Serve static files from the root directory ---
app.use(express.static(path.join(__dirname, '/')));
app.use('/ecgGenerators', express.static(path.join(__dirname, 'ecgGenerators')));

// --- Server State ---
// Store active sessions. Key: sessionId, Value: Set of connected WebSocket clients (ws)
const sessions = {}; // E.g., { "ABCD": Set(ws1, ws2), "EFGH": Set(ws3) }
let keepAliveInterval = null; // Variable to hold the interval ID

// --- Helper Functions ---

/**
 * Generates a random alphanumeric session ID. Ensures uniqueness.
 * @param {number} length - The desired length of the ID.
 * @returns {string | null} A unique session ID or null if generation failed.
 */
function generateSessionId(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    let attempts = 0;
    const maxAttempts = 20; // Prevent infinite loop in unlikely scenario

    do {
        result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        attempts++;
    } while (sessions[result] && attempts < maxAttempts); // Check if ID already exists

    if (sessions[result]) {
        console.error("[Server] Failed to generate a unique session ID after multiple attempts.");
        return null;
    }
    return result;
}

/**
 * Sends a JSON message to a specific WebSocket client.
 * @param {WebSocket} ws - The WebSocket client instance.
 * @param {object} message - The message object to send.
 */
function sendMessage(ws, message) {
    // Check if the connection is open before sending
    if (ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(message));
        } catch (error) {
            console.error('[Server] Error sending message:', error);
        }
    } else {
        console.warn(`[Server] Attempted to send message to client ${ws.clientId} with readyState ${ws.readyState}.`);
        // Optionally try to clean up the connection here if it's closed/closing
        cleanupClientConnection(ws);
    }
}

/**
 * Broadcasts a message to all clients in a specific session, optionally excluding the sender
 * or targeting only specific roles.
 * @param {string} sessionId - The ID of the session to broadcast to.
 * @param {object} message - The message object to broadcast.
 * @param {WebSocket} [senderWs] - (Optional) The WebSocket client who sent the original message (to exclude them).
 * @param {string | null} [targetRole=null] - (Optional) Role to target ('controller', 'monitor'). If null, sends to all (excluding sender).
 */
function broadcastToSession(sessionId, message, senderWs, targetRole = null) {
    const sessionClients = sessions[sessionId];
    if (!sessionClients) {
        console.warn(`[Server] Attempted to broadcast to non-existent session: ${sessionId}`);
        return;
    }

    const messageString = JSON.stringify(message);
    console.log(`[Server] Broadcasting to session ${sessionId} (Target: ${targetRole || 'all'}):`, message);

    sessionClients.forEach(client => {
        const shouldSend =
            client !== senderWs &&
            client.readyState === WebSocket.OPEN &&
            (!targetRole || client.role === targetRole);

        if (shouldSend) {
            try {
                client.send(messageString);
            } catch (error) {
                console.error(`[Server] Error broadcasting message to client ${client.clientId}:`, error);
            }
        }
    });
}

/**
 * Removes a client connection from its session and deletes the session if empty.
 * @param {WebSocket} ws - The WebSocket client to clean up.
 */
function cleanupClientConnection(ws) {
     if (ws.sessionId && sessions[ws.sessionId]) {
        const wasRemoved = sessions[ws.sessionId].delete(ws); // Remove client from the session Set
        if(wasRemoved) {
             console.log(`[Server] Client ${ws.clientId} removed from session: ${ws.sessionId}`);
        }
        // If the session becomes empty, delete it
        if (sessions[ws.sessionId].size === 0) {
            delete sessions[ws.sessionId];
            console.log(`[Server] Deleted empty session: ${ws.sessionId}`);
        }
        ws.sessionId = null; // Clear session ID from the connection object
        ws.role = null;      // Clear role
    }
}


// --- WebSocket Server Logic ---

console.log('[Server] WebSocket server initializing...');

wss.on('connection', (ws, req) => {
    // Assign a unique ID for easier tracking
    ws.clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    console.log(`[Server] Client connected: ${ws.clientId}`);

    // Initialize client state properties
    ws.sessionId = null;
    ws.role = null; // 'controller' or 'monitor'
    ws.isAlive = true; // --- KEEP-ALIVE: Initialize as alive ---

    // --- KEEP-ALIVE: Handle pong response ---
    ws.on('pong', () => {
        // console.log(`[Server] Pong received from ${ws.clientId}`); // Optional: for debugging
        ws.isAlive = true;
    });
    // --- /KEEP-ALIVE ---

    // Send connection acknowledgment
    sendMessage(ws, { type: 'connection_ack', message: 'Connected successfully. Please create or join a session.' });

    // Handle incoming messages from this client
    ws.on('message', (messageBuffer) => {
        let messageString;
        let parsedMessage;
        try {
             messageString = messageBuffer.toString();
             parsedMessage = JSON.parse(messageString);
             console.log(`[Server] Received from ${ws.clientId} (Session: ${ws.sessionId}, Role: ${ws.role}):`, parsedMessage);
        } catch (error) {
            console.error(`[Server] Failed to parse message from ${ws.clientId}:`, messageString || messageBuffer, error);
            sendMessage(ws, { type: 'error', message: 'Invalid message format (not valid JSON).' });
            return;
        }

        // LISÄTTY: soundState destrukturointiin
        const { type, sessionId, role, params, nibpData, rhythm, soundState } = parsedMessage;

        // Reset keep-alive on any valid message received
        ws.isAlive = true;

        switch (type) {
            case 'create_session':
                cleanupClientConnection(ws); // Remove from previous session first
                const newSessionId = generateSessionId(SESSION_ID_LENGTH);
                if (newSessionId) {
                    sessions[newSessionId] = new Set([ws]); // Create session with this client
                    ws.sessionId = newSessionId;
                    ws.role = null; // Role needs to be set explicitly
                    console.log(`[Server] Client ${ws.clientId} created session: ${newSessionId}`);
                    sendMessage(ws, { type: 'session_created', sessionId: newSessionId });
                } else {
                    sendMessage(ws, { type: 'error', message: 'Failed to create a unique session ID. Please try again.' });
                }
                break;

            case 'join_session':
                if (!sessionId || typeof sessionId !== 'string') {
                     sendMessage(ws, { type: 'error', message: 'Invalid or missing sessionId for join request.' });
                     return;
                }
                const targetSessionId = sessionId.toUpperCase();
                if (sessions[targetSessionId]) {
                    cleanupClientConnection(ws); // Remove from previous session first
                    sessions[targetSessionId].add(ws); // Add to the existing session
                    ws.sessionId = targetSessionId;
                    ws.role = null; // Role needs to be set explicitly
                    console.log(`[Server] Client ${ws.clientId} joined session: ${targetSessionId}`);
                    sendMessage(ws, { type: 'session_joined', sessionId: targetSessionId });
                } else {
                    console.log(`[Server] Client ${ws.clientId} failed to join session: ${targetSessionId} (Not Found)`);
                    sendMessage(ws, { type: 'session_not_found', sessionId: targetSessionId });
                }
                break;

            case 'set_role':
                if (!ws.sessionId) {
                    sendMessage(ws, { type: 'error', message: 'Cannot set role: Not currently in a session.' });
                    return;
                }
                if (role === 'controller' || role === 'monitor') {
                    ws.role = role;
                    console.log(`[Server] Client ${ws.clientId} in session ${ws.sessionId} set role to: ${role}`);
                    sendMessage(ws, { type: 'role_set', role: ws.role });
                } else {
                    sendMessage(ws, { type: 'error', message: `Invalid role specified: ${role}. Use 'controller' or 'monitor'.` });
                }
                break;

            case 'param_update':
                if (!ws.sessionId) { sendMessage(ws, { type: 'error', message: 'Cannot send params: Not in a session.' }); return; }
                if (ws.role !== 'controller') { sendMessage(ws, { type: 'error', message: 'Cannot send params: Role is not controller.' }); return; }
                if (!params || typeof params !== 'object') { sendMessage(ws, { type: 'error', message: 'Invalid or missing params in update.' }); return; }
                broadcastToSession(ws.sessionId, { type: 'param_update', params: params }, ws, 'monitor');
                break;

            case 'activate_sim':
                if (!ws.sessionId) { sendMessage(ws, { type: 'error', message: 'Cannot send activate command: Not in a session.' }); return; }
                if (ws.role !== 'controller') { sendMessage(ws, { type: 'error', message: 'Cannot send activate command: Role is not controller.' }); return; }
                console.log(`[Server] Controller ${ws.clientId} sent activate command for session ${ws.sessionId}`);
                broadcastToSession(ws.sessionId, { type: 'activate_sim' }, ws, 'monitor');
                break;

            case 'deactivate_sim':
                 if (!ws.sessionId) { sendMessage(ws, { type: 'error', message: 'Cannot send deactivate command: Not in a session.' }); return; }
                 if (ws.role !== 'controller') { sendMessage(ws, { type: 'error', message: 'Cannot send deactivate command: Role is not controller.' }); return; }
                 console.log(`[Server] Controller ${ws.clientId} sent deactivate command for session ${ws.sessionId}`);
                 broadcastToSession(ws.sessionId, { type: 'deactivate_sim' }, ws, 'monitor');
                 break;

             case 'shock':
                 if (!ws.sessionId) { sendMessage(ws, { type: 'error', message: 'Cannot send shock command: Not in a session.' }); return; }
                 if (ws.role !== 'controller') { sendMessage(ws, { type: 'error', message: 'Cannot send shock command: Role is not controller.' }); return; }
                 if (!rhythm || typeof rhythm !== 'string') { sendMessage(ws, { type: 'error', message: 'Invalid or missing rhythm in shock command.' }); return; }
                 console.log(`[Server] Controller ${ws.clientId} sent shock command for session ${ws.sessionId} with target rhythm: ${rhythm}`);
                 broadcastToSession(ws.sessionId, { type: 'shock', rhythm: rhythm }, ws, 'monitor');
                 break;

             case 'nibp_trigger':
                 if (!ws.sessionId) { sendMessage(ws, { type: 'error', message: 'Cannot send NIBP trigger: Not in a session.' }); return; }
                 if (ws.role !== 'controller') { sendMessage(ws, { type: 'error', message: 'Cannot send NIBP trigger: Role is not controller.' }); return; }
                 if (!nibpData || typeof nibpData !== 'object') { sendMessage(ws, { type: 'error', message: 'Invalid or missing nibpData in NIBP trigger.' }); return; }
                 console.log(`[Server] Controller ${ws.clientId} sent NIBP trigger for session ${ws.sessionId} with data:`, nibpData);
                 broadcastToSession(ws.sessionId, { type: 'nibp_trigger', nibpData: nibpData }, ws, 'monitor');
                 break;

            // --- LISÄTTY: Äänitilan päivityksen käsittely palvelimella ---
            case 'sound_state_update':
                if (!ws.sessionId) { sendMessage(ws, { type: 'error', message: 'Cannot send sound state: Not in a session.' }); return; }
                if (ws.role !== 'controller') { sendMessage(ws, { type: 'error', message: 'Cannot send sound state: Role is not controller.' }); return; }
                if (typeof soundState !== 'boolean') { sendMessage(ws, { type: 'error', message: 'Invalid soundState in update.' }); return; }
                console.log(`[Server] Controller ${ws.clientId} sent sound state update for session ${ws.sessionId}: ${soundState}`);
                // Lähetä päivitys kaikille Monitor-roolissa oleville clienteille samassa sessiossa (paitsi lähettäjälle itselleen)
                broadcastToSession(ws.sessionId, { type: 'sound_state_update', soundState: soundState }, ws, 'monitor');
                break;
            // --- LISÄYS LOPPUU ---

            default:
                console.log(`[Server] Unknown message type from ${ws.clientId}: ${type}`);
                sendMessage(ws, { type: 'error', message: `Unknown message type: ${type}` });
        }
    });

    // Handle client disconnection
    ws.on('close', (code, reason) => {
        console.log(`[Server] Client disconnected: ${ws.clientId}. Code: ${code}, Reason: ${reason ? reason.toString() : 'N/A'}`);
        cleanupClientConnection(ws); // Remove from session etc.
    });

    // Handle WebSocket errors for this specific client
    ws.on('error', (error) => {
        console.error(`[Server] WebSocket error for client ${ws.clientId}:`, error);
        cleanupClientConnection(ws); // Clean up on error as well
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.terminate();
        }
    });
});

// --- KEEP-ALIVE: Start Ping Interval ---
function startKeepAlive() {
    console.log(`[Server] Starting keep-alive ping interval (${PING_INTERVAL}ms)...`);
    if (keepAliveInterval) clearInterval(keepAliveInterval); // Clear previous interval if any

    keepAliveInterval = setInterval(() => {
        // console.log(`[Server] Keep-alive check running for ${wss.clients.size} clients...`); // Debug log
        wss.clients.forEach((ws) => {
            if (!ws.isAlive) {
                console.log(`[Server] Keep-alive check failed for client ${ws.clientId}. Terminating connection.`);
                cleanupClientConnection(ws); // Clean up session data first
                return ws.terminate(); // Terminate the connection
            }

            ws.isAlive = false; // Assume client is dead until pong received
            // console.log(`[Server] Pinging client ${ws.clientId}...`); // Debug log
            ws.ping((err) => { // Add error handling for ping
                 if (err) {
                     console.error(`[Server] Error sending ping to ${ws.clientId}:`, err);
                     // Consider terminating immediately if ping fails to send
                     cleanupClientConnection(ws);
                     ws.terminate();
                 }
            });
        });
    }, PING_INTERVAL);
}
// --- /KEEP-ALIVE ---

// --- Start the HTTP server and Keep-Alive ---
server.listen(PORT, () => {
    console.log(`[Server] HTTP server listening on port ${PORT}`);
    console.log(`[Server] WebSocket server is running and ready for connections.`);
    startKeepAlive(); // Start the ping interval when server is ready
});

// --- Graceful Shutdown (Optional but Recommended) ---
process.on('SIGTERM', () => {
    console.log('[Server] SIGTERM signal received. Shutting down gracefully...');
    clearInterval(keepAliveInterval); // Stop pinging
    wss.close(() => {
        console.log('[Server] WebSocket server closed.');
        server.close(() => {
            console.log('[Server] HTTP server closed.');
            process.exit(0);
        });
    });
});

process.on('SIGINT', () => { // Handle Ctrl+C
    console.log('[Server] SIGINT signal received. Shutting down gracefully...');
    clearInterval(keepAliveInterval);
    wss.close(() => {
        console.log('[Server] WebSocket server closed.');
        server.close(() => {
            console.log('[Server] HTTP server closed.');
            process.exit(0);
        });
    });
});

console.log('[Server] server.js script finished initial execution.');
