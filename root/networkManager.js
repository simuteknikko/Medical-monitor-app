// networkManager.js - Handles WebSocket connection and communication for the client
// VERSION: Allowed role switching even when in a session.
//          + Added sound state synchronization.
//          + ADDED: Deactivate monitor on session creation if it's active.
//          + MODIFIED: Reload page on 'session_not_found' or critical session error for 'monitor' role.
//          + FIX: Manual session ID input and join button functionality.
//          + MODIFIED: Controller also gets UI reset and alert on session_not_found/error, without page reload.
//          + MODIFIED (v3.3): Universal page reload for ALL roles on session_not_found/critical_error after alert.
//          + MODIFIED (v3.4): All user-facing alerts and console logs translated to English.

// --- Configuration ---
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.host}`;
console.log(`[Network] WebSocket URL: ${wsUrl}`);
const RECONNECT_INITIAL_DELAY = 1000; // ms
const RECONNECT_MAX_DELAY = 30000; // ms

// --- State ---
let ws = null;
let currentSessionId = null;
let currentRole = 'controller'; // Default role overall
let isConnected = false;
let onParamUpdateCallback = null;
let onActivateReceivedCallback = null;
let onDeactivateReceivedCallback = null;
let onShockReceivedCallback = null;
let onNibpTriggerReceivedCallback = null;
let onSoundStateReceivedCallback = null;
let monitorInterface = null;
let reconnectTimerId = null;
let reconnectDelay = RECONNECT_INITIAL_DELAY;
let sessionIdFromUrl = null;
let isAttemptingAutoJoin = false;
let onSessionCreatedCallback = null;
let onSessionJoinedCallback = null;
let onSessionListCallback = null;

// --- DOM Elements ---
let sessionIdInput, createSessionBtn, joinSessionBtn, connectionStatusLabel;
let roleControllerRadio, roleMonitorRadio, sessionControlsDiv, mainControlsAccordion;
let fullscreenButton = null;
let sessionShareArea = null;
let sessionLinkInput = null;
let copyLinkBtn = null;
let qrCodeContainer = null;

// --- Initialization ---
/**
 * Initializes the network manager.
 * @param {object} callbacks - Callbacks for various network events.
 * @param {object} mInterface - Interface to interact with the main monitor (script.js).
 */
export function initializeNetwork(callbacks, mInterface) {
    console.log('[Network] Initializing (v3.4 - English Alerts)...');
    onParamUpdateCallback = callbacks.onParamUpdate;
    onActivateReceivedCallback = callbacks.onActivate;
    onDeactivateReceivedCallback = callbacks.onDeactivate;
    onShockReceivedCallback = callbacks.onShock;
    onNibpTriggerReceivedCallback = callbacks.onNibpTrigger;
    onSoundStateReceivedCallback = callbacks.onSoundState;
    onSessionCreatedCallback = callbacks.onSessionCreated;
    onSessionJoinedCallback = callbacks.onSessionJoined;
    onSessionListCallback = callbacks.onSessionList;
    monitorInterface = mInterface;

    sessionIdInput = document.getElementById('session-id-input');
    createSessionBtn = document.getElementById('create-session-btn');
    joinSessionBtn = document.getElementById('join-session-btn');
    connectionStatusLabel = document.getElementById('connection-status-label');
    roleControllerRadio = document.getElementById('role-selector-controller');
    roleMonitorRadio = document.getElementById('role-selector-monitor');
    sessionControlsDiv = document.getElementById('session-controls');
    mainControlsAccordion = document.getElementById('controlAccordion');
    fullscreenButton = document.getElementById('fullscreen-button');
    sessionShareArea = document.getElementById('session-share-area');
    sessionLinkInput = document.getElementById('session-link-input');
    copyLinkBtn = document.getElementById('copy-link-btn');
    qrCodeContainer = document.getElementById('qr-code-container');

    if (!sessionIdInput || !createSessionBtn || !joinSessionBtn || !connectionStatusLabel ||
        !roleControllerRadio || !roleMonitorRadio || !sessionControlsDiv ||
        !mainControlsAccordion || !fullscreenButton || !sessionShareArea ||
        !sessionLinkInput || !copyLinkBtn || !qrCodeContainer) {
        console.error("[Network] FATAL: Could not find all required UI elements for session management.");
        try { alert("Error: Session UI elements missing. Cannot initialize multi-device mode."); } catch (e) {}
        return;
    }

    createSessionBtn.addEventListener('click', handleCreateSession);
    joinSessionBtn.addEventListener('click', handleJoinSession);
    roleControllerRadio.addEventListener('change', handleRoleChange);
    roleMonitorRadio.addEventListener('change', handleRoleChange);
    copyLinkBtn.addEventListener('click', handleCopyLink);

    const urlParams = new URLSearchParams(window.location.search);
    sessionIdFromUrl = urlParams.get('session');
    if (sessionIdFromUrl) {
        sessionIdFromUrl = sessionIdFromUrl.toUpperCase();
        console.log(`[Network] Session ID found in URL: ${sessionIdFromUrl}. Preparing for auto-join.`);
        if (sessionIdInput) sessionIdInput.value = sessionIdFromUrl;
        if (roleControllerRadio) roleControllerRadio.checked = true;
        if (roleMonitorRadio) roleMonitorRadio.checked = false;
        currentRole = 'controller';
        isAttemptingAutoJoin = true;
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        currentRole = roleControllerRadio?.checked ? 'controller' : 'monitor';
    }

    connectWebSocket();
    updateUIForRole(currentRole);
    console.log('[Network] Initialization complete.');
}

// --- WebSocket Connection Handling ---
function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        console.log('[Network] WebSocket connection already open or connecting.');
        return;
    }
    console.log('[Network] Attempting to connect to WebSocket server...');
    updateConnectionStatus('Connecting...', 'bg-warning', true);
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        isConnected = true;
        console.log('[Network] WebSocket connection established.');
        updateConnectionStatus('Connected (No Session)', 'bg-success');
        reconnectDelay = RECONNECT_INITIAL_DELAY;
        stopReconnectionAttempts();

        if (isAttemptingAutoJoin && sessionIdFromUrl) {
            console.log(`[Network] Auto-joining session ${sessionIdFromUrl} from URL...`);
            handleJoinSession(sessionIdFromUrl);
            isAttemptingAutoJoin = false;
        } else if (currentSessionId && currentRole) {
            console.log(`[Network] Reconnected. Attempting to re-join session ${currentSessionId} as ${currentRole}.`);
            try {
                // If we previously persisted a device ID+token for this session, attempt rejoin with it
                const deviceKey = `medicalMonitorDevice_${currentSessionId}_id`;
                const tokenKey = `medicalMonitorDevice_${currentSessionId}_token`;
                let deviceId = null, deviceToken = null;
                try { deviceId = localStorage.getItem(deviceKey); deviceToken = localStorage.getItem(tokenKey); } catch (e) { deviceId = null; deviceToken = null; }
                if (deviceId && deviceToken) {
                    console.log('[Network] Found stored device credentials, attempting device rejoin.');
                    sendMessage({ type: 'rejoin_with_device', sessionId: currentSessionId, deviceId: deviceId, deviceToken: deviceToken });
                } else {
                    sendMessage({ type: 'join_session', sessionId: currentSessionId });
                }
            } catch (e) {
                sendMessage({ type: 'join_session', sessionId: currentSessionId });
            }
        }
    };

    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            console.log('[Network] Message received:', message);
            handleServerMessage(message);
        } catch (error) {
            console.error('[Network] Error parsing message from server:', event.data, error);
        }
    };

    ws.onclose = (event) => {
        isConnected = false;
        const reason = event.reason || 'No reason provided';
        const code = event.code;
        console.log(`[Network] WebSocket connection closed. Code: ${code}, Reason: ${reason}`);
        ws = null;

        if (code !== 1000 && code !== 1001 && reconnectTimerId === null) {
             console.log(`[Network] Connection lost unexpectedly. Starting reconnection attempts...`);
             scheduleReconnection();
        } else {
            console.log(`[Network] Connection closed cleanly or reconnection already in progress. Not attempting reconnection.`);
            updateConnectionStatus('Disconnected', 'bg-danger');
            if (reconnectTimerId === null) {
                if (currentSessionId) {
                     console.log("[Network] ws.onclose: Connection closed and active session existed. Handling session end.");
                     handleSessionEndedOrNotFoundAndReload("Connection to server lost. Reloading page.");
                } else {
                    currentSessionId = null;
                    if(sessionIdInput) sessionIdInput.value = '';
                    updateUIForRole(currentRole);
                    hideSessionShareArea();
                }
            }
        }
    };

    ws.onerror = (error) => {
        isConnected = false;
        console.error('[Network] WebSocket error:', error);
        updateConnectionStatus('Error', 'bg-danger');
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            ws.close(1011, "WebSocket error occurred");
        } else {
            if (reconnectTimerId === null) {
                scheduleReconnection();
            }
        }
        ws = null;
    };
}

// --- Reconnection Logic ---
function scheduleReconnection() {
    if (reconnectTimerId !== null) return;
    updateConnectionStatus(`Offline. Retrying in ${reconnectDelay / 1000}s...`, 'bg-warning', true);
    console.log(`[Network] Scheduling reconnection attempt in ${reconnectDelay} ms.`);

    reconnectTimerId = setTimeout(() => {
        reconnectTimerId = null;
        console.log("[Network] Reconnection timer expired. Attempting to reconnect...");
        connectWebSocket();
        reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_DELAY);
    }, reconnectDelay);
}

function stopReconnectionAttempts() {
    if (reconnectTimerId !== null) {
        console.log("[Network] Stopping reconnection attempts.");
        clearTimeout(reconnectTimerId);
        reconnectTimerId = null;
        reconnectDelay = RECONNECT_INITIAL_DELAY;
        if (!isConnected) {
            updateConnectionStatus('Disconnected', 'bg-danger');
        }
    }
}

// --- MODIFIED Helper function for session end/not found UI update AND RELOAD ---
function handleSessionEndedOrNotFoundAndReload(alertMessage = "Session not found or has ended. Reloading page.") {
    console.log(`[Network] handleSessionEndedOrNotFoundAndReload: ${alertMessage}`);
    currentSessionId = null;
    if(sessionIdInput) sessionIdInput.value = '';
    updateConnectionStatus('Disconnected / Session Ended', 'bg-danger');
    hideSessionShareArea();
    alert(alertMessage);

    setTimeout(() => {
        console.log("[Network] Reloading page due to session end.");
        window.location.reload();
    }, 2500);
}


// --- Message Handling ---
function handleServerMessage(message) {
    switch (message.type) {
        case 'connection_ack':
            console.log(`[Network] Server Ack: ${message.message}`);
            break;
        case 'session_created':
            currentSessionId = message.sessionId;
            if(sessionIdInput) sessionIdInput.value = currentSessionId;
            console.log(`[Network] Session created with ID: ${currentSessionId}`);
            // Store admin token (if provided) for session owner recoverability
            if (message.adminToken) {
                try { localStorage.setItem(`medicalMonitorAdminToken_${currentSessionId}`, message.adminToken); console.log('[Network] Admin token saved to localStorage.'); } catch (e) { console.warn('[Network] Failed to save admin token:', e); }
            }
            // Persist per-device credentials if server issued them
            if (message.deviceId && message.deviceToken) {
                try {
                    localStorage.setItem(`medicalMonitorDevice_${currentSessionId}_id`, message.deviceId);
                    localStorage.setItem(`medicalMonitorDevice_${currentSessionId}_token`, message.deviceToken);
                    console.log('[Network] Device credentials saved to localStorage for session:', currentSessionId);
                } catch (e) { console.warn('[Network] Failed to save device credentials:', e); }
            }
            if (typeof onSessionCreatedCallback === 'function') {
                onSessionCreatedCallback(currentSessionId);
            }
            alert(`Session created! Share this ID or link with monitor devices: ${currentSessionId}`);
            sendSetRole(currentRole);
            updateConnectionStatus(`Session: ${currentSessionId}`, 'bg-success');
            break;
        case 'session_ended':
            console.log('[Network] Session ended by server or owner.');
            // Clean up local state and inform user
            if (message && message.sessionId) {
                // Remove any stored admin token for this session (it's ended)
                try {
                    const key = `medicalMonitorAdminToken_${message.sessionId}`;
                    localStorage.removeItem(key);
                    localStorage.removeItem(`medicalMonitorDevice_${message.sessionId}_id`);
                    localStorage.removeItem(`medicalMonitorDevice_${message.sessionId}_token`);
                } catch (e) { /* ignore */ }
                // Refresh sessions list UI if present
                try { requestSessionList(); } catch (e) { /* ignore */ }
            }
            if (message && message.sessionId === currentSessionId) {
                currentSessionId = null;
                if (sessionIdInput) sessionIdInput.value = '';
                hideSessionShareArea();
                updateConnectionStatus('Disconnected / Session Ended', 'bg-danger');
                alert(message.reason || 'Session ended. Returning to home.');
                try {
                    const landingView = document.getElementById('landing-view');
                    const appView = document.getElementById('app-view');
                    const landingMenu = document.getElementById('landing-menu');
                    const landingJoin = document.getElementById('landing-join');
                    const landingLobby = document.getElementById('landing-lobby');
                    if (landingView && appView) {
                        appView.style.display = 'none';
                        landingView.style.display = 'block';
                    }
                    if (landingMenu) landingMenu.classList.remove('d-none');
                    if (landingJoin) landingJoin.classList.add('d-none');
                    if (landingLobby) landingLobby.classList.add('d-none');
                } catch(e){}
            }
            break;
        case 'session_joined':
            currentSessionId = message.sessionId;
            console.log(`[Network] Successfully joined session: ${currentSessionId}`);
                if (typeof onSessionJoinedCallback === 'function') {
                    try { onSessionJoinedCallback(currentSessionId, !!message.admin); } catch(e) { onSessionJoinedCallback(currentSessionId); }
                }
            // If server confirmed admin, ensure admin token remains in storage (no-op if already present)
            if (message.admin && currentSessionId) {
                const key = `medicalMonitorAdminToken_${currentSessionId}`;
                try { if (!localStorage.getItem(key)) localStorage.setItem(key, 'RETAINED'); } catch (e) {}
            }
            // Persist per-device credentials if server issued them
            if (message.deviceId && message.deviceToken) {
                try {
                    localStorage.setItem(`medicalMonitorDevice_${currentSessionId}_id`, message.deviceId);
                    localStorage.setItem(`medicalMonitorDevice_${currentSessionId}_token`, message.deviceToken);
                    console.log('[Network] Device credentials saved to localStorage for session:', currentSessionId);
                } catch (e) { console.warn('[Network] Failed to save device credentials:', e); }
            }
            if (!isAttemptingAutoJoin && !reconnectTimerId) {
                 alert(`Joined session: ${currentSessionId}`);
            }
            sendSetRole(currentRole);
            updateConnectionStatus(`Session: ${currentSessionId}`, 'bg-success');
            break;
        case 'session_rejoined':
            // Server confirmed rejoin using stored device credentials
            currentSessionId = message.sessionId;
            console.log(`[Network] Successfully rejoined session: ${currentSessionId} as stored device.`);
            if (typeof onSessionJoinedCallback === 'function') {
                try { onSessionJoinedCallback(currentSessionId, false); } catch(e) { onSessionJoinedCallback(currentSessionId); }
            }
            sendSetRole(currentRole);
            updateConnectionStatus(`Session: ${currentSessionId}`, 'bg-success');
            updateUIForRole(currentRole);
            break;
        case 'session_not_found':
            console.warn(`[Network] Session not found: ${message.sessionId}`);
            const sessionNotFoundMsg = `Error: Session with ID '${message.sessionId}' not found. The page will reload.`;
            handleSessionEndedOrNotFoundAndReload(sessionNotFoundMsg);
            break;
        case 'role_set':
            console.log(`[Network] Role confirmed by server: ${message.role}`);
            if (currentRole !== message.role) {
                console.warn(`[Network] Role mismatch! Local was ${currentRole}, server confirmed ${message.role}. Updating local role.`);
                currentRole = message.role;
                if (roleControllerRadio) roleControllerRadio.checked = (currentRole === 'controller');
                if (roleMonitorRadio) roleMonitorRadio.checked = (currentRole === 'monitor');
            }
            updateUIForRole(currentRole);
            break;
        case 'param_update':
            console.log('[Network] Parameter update received.');
            if (currentRole === 'monitor') {
                if (typeof onParamUpdateCallback === 'function' && message.params) {
                     console.log('[Network] Calling onParamUpdateCallback for Monitor with full params (including colors).');
                     onParamUpdateCallback(message.params);
                } else {
                     console.log('[Network] Ignoring param update as callback missing or params missing.');
                }
            } else {
                console.log('[Network] Ignoring param update as role is not Controller.');
            }
            break;
        case 'activate_sim':
            console.log('[Network] Activate simulation command received.');
            if (currentRole === 'monitor' && typeof onActivateReceivedCallback === 'function') {
                console.log('[Network] Calling onActivateReceivedCallback for Monitor.');
                onActivateReceivedCallback();
            } else {
                console.log('[Network] Ignoring activate_sim as role is not Monitor or callback missing.');
            }
            break;
        case 'deactivate_sim':
            console.log('[Network] Deactivate simulation command received.');
            if (currentRole === 'monitor' && typeof onDeactivateReceivedCallback === 'function') {
                console.log('[Network] Calling onDeactivateReceivedCallback for Monitor.');
                onDeactivateReceivedCallback();
            } else {
                console.log('[Network] Ignoring deactivate_sim as role is not Monitor or callback missing.');
            }
            break;
         case 'shock':
             console.log('[Network] Shock command received with rhythm:', message.rhythm);
             if (currentRole === 'monitor' && typeof onShockReceivedCallback === 'function') {
                  console.log('[Network] Calling onShockReceivedCallback for Monitor.');
                  onShockReceivedCallback(message.rhythm);
             } else {
                   console.log('[Network] Ignoring shock command as role is not Monitor or callback missing.');
             }
             break;
        case 'nibp_trigger':
            console.log('[Network] NIBP trigger received.');
            if (currentRole === 'monitor' && typeof onNibpTriggerReceivedCallback === 'function') {
                console.log('[Network] Calling onNibpTriggerReceivedCallback for Monitor.');
                onNibpTriggerReceivedCallback(message.nibpData);
            } else {
                console.log('[Network] Ignoring NIBP trigger as role is not Monitor or callback missing.');
            }
            break;
        case 'sound_state_update':
            console.log('[Network] Sound state update received:', message.soundState);
            if (currentRole === 'monitor' && typeof onSoundStateReceivedCallback === 'function') {
                console.log('[Network] Calling onSoundStateReceivedCallback for Monitor.');
                onSoundStateReceivedCallback(message.soundState);
            } else {
                console.log('[Network] Ignoring sound_state_update as role is not Monitor or callback missing.');
            }
            break;
        case 'session_list':
            console.log('[Network] Received current session list from server.');
            if (typeof onSessionListCallback === 'function') {
                onSessionListCallback(message.sessions || []);
            }
            break;
        case 'error':
            console.error(`[Network] Server Error: ${message.message}`);
            if (message.details === 'session_does_not_exist' || message.message.includes("Session not found") || message.message.includes("Sessiota ei löytynyt")) { // Keep Finnish check for compatibility if server sends it
                const errorMsg = `Server Error: ${message.message}. The session likely ended. The page will reload.`;
                handleSessionEndedOrNotFoundAndReload(errorMsg);
            } else {
                alert(`Server Error: ${message.message}`);
            }
            break;
        default:
            console.log('[Network] Received unknown message type:', message.type);
    }
}

// --- Sending Messages ---
function sendMessage(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            const messageString = JSON.stringify(message);
            console.log('[Network] Sending:', message);
            ws.send(messageString);
        } catch (error) {
            console.error('[Network] Error sending message:', error);
        }
    } else {
        console.warn('[Network] Cannot send message, WebSocket is not open.');
        if (ws === null && reconnectTimerId === null) {
            console.log("[Network] WebSocket not open, initiating reconnection process.");
            scheduleReconnection();
        }
    }
}

function handleCreateSession() {
    console.log('[Network] Create Session button clicked.');
    stopReconnectionAttempts();

    if (monitorInterface && typeof monitorInterface.isMonitorActive === 'function' && monitorInterface.isMonitorActive()) {
        if (typeof monitorInterface.deactivateMonitor === 'function') {
            console.log('[Network] Monitor is active. Deactivating before creating session.');
            monitorInterface.deactivateMonitor();
        } else {
            console.warn('[Network] Monitor is active, but deactivateMonitor function is missing from monitorInterface.');
        }
    } else if (!monitorInterface) {
        console.warn('[Network] monitorInterface not available to check/deactivate monitor status.');
    }

    currentRole = 'controller';
    if (roleControllerRadio) roleControllerRadio.checked = true;
    if (roleMonitorRadio) roleMonitorRadio.checked = false;
    updateUIForRole(currentRole);
    sendMessage({ type: 'create_session' });
}

function handleJoinSession(sessionIdToJoinFromCall = null) {
    stopReconnectionAttempts();
    if (!sessionIdInput) {
        console.error("[Network] sessionIdInput is not defined in handleJoinSession.");
        alert("Error: Session ID input field not found.");
        return;
    }

    let sessionIdToAttempt;
    if (typeof sessionIdToJoinFromCall === 'string' && sessionIdToJoinFromCall.trim() !== '') {
        sessionIdToAttempt = sessionIdToJoinFromCall.trim().toUpperCase();
        console.log(`[Network] Joining session with explicit ID: ${sessionIdToAttempt}`);
    } else {
        sessionIdToAttempt = sessionIdInput.value.trim().toUpperCase();
        console.log(`[Network] Joining session with ID from input field: ${sessionIdToAttempt}`);
    }

    if (!sessionIdToAttempt) {
        alert("Please enter a Session ID to join.");
        return;
    }
    // If an admin token exists for this session (owner returning), include it so server can validate owner reclaim
    const storedKey = `medicalMonitorAdminToken_${sessionIdToAttempt}`;
    const storedToken = (() => { try { return localStorage.getItem(storedKey); } catch (e) { return null; } })();
    const joinPayload = { type: 'join_session', sessionId: sessionIdToAttempt };
    if (storedToken) joinPayload.adminToken = storedToken;
    sendMessage(joinPayload);
}

/**
 * Join a session by ID programmatically. Includes stored adminToken if present.
 * @param {string} sessionIdToAttempt
 */
export function joinSessionById(sessionIdToAttempt) {
    if (!sessionIdToAttempt || typeof sessionIdToAttempt !== 'string') {
        console.warn('[Network] joinSessionById called with invalid sessionId:', sessionIdToAttempt);
        alert('Please enter a Session ID to join.');
        return;
    }
    sessionIdToAttempt = sessionIdToAttempt.trim().toUpperCase();
    // Include admin token if available
    const storedKey = `medicalMonitorAdminToken_${sessionIdToAttempt}`;
    let storedToken = null;
    try { storedToken = localStorage.getItem(storedKey); } catch (e) { storedToken = null; }
    const joinPayload = { type: 'join_session', sessionId: sessionIdToAttempt };
    if (storedToken) joinPayload.adminToken = storedToken;
    sendMessage(joinPayload);
}

/**
 * End a session by ID using a stored admin token for that session.
 * @param {string} sessionId
 * @returns {boolean} true if request sent, false otherwise
 */
export function endSessionById(sessionId) {
    if (!sessionId) {
        console.warn('[Network] endSessionById called without sessionId');
        alert('No session specified to end.');
        return false;
    }
    const key = `medicalMonitorAdminToken_${sessionId}`;
    let token = null;
    try { token = localStorage.getItem(key); } catch (e) { token = null; }
    if (!token) {
        alert('Admin token not found for this session. Only the owner can end it.');
        return false;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('Not connected to server. Cannot end session remotely.');
        return false;
    }
    try {
        sendMessage({ type: 'end_session', sessionId: sessionId, adminToken: token });
        console.log('[Network] Sent end_session request for session:', sessionId);
        return true;
    } catch (e) {
        console.error('[Network] Failed to send end_session request:', e);
        alert('Failed to send end session request.');
        return false;
    }
}

function sendSetRole(role) {
    if (!currentSessionId) {
        console.warn('[Network] Cannot set role, not in a session yet.');
        return;
    }
    if (role !== 'controller' && role !== 'monitor') {
        console.error(`[Network] Invalid role specified: ${role}`);
        return;
    }
    console.log(`[Network] Sending role selection to server: ${role}`);
    sendMessage({ type: 'set_role', sessionId: currentSessionId, role: role });
}

export function sendParamUpdate(params) {
    if (currentRole !== 'controller') return;
    if (!currentSessionId) { console.warn('[Network] Cannot send param update, not in a session.'); return; }
    sendMessage({ type: 'param_update', sessionId: currentSessionId, params: params });
}

export function sendActivateCommand() {
    if (currentRole !== 'controller') return;
    if (!currentSessionId) { console.warn('[Network] Cannot send activate command, not in a session.'); return; }
    console.log('[Network] Sending activate_sim command.');
    sendMessage({ type: 'activate_sim', sessionId: currentSessionId });
}
export function sendDeactivateCommand() {
    if (currentRole !== 'controller') return;
    if (!currentSessionId) { console.warn('[Network] Cannot send deactivate command, not in a session.'); return; }
    console.log('[Network] Sending deactivate_sim command.');
    sendMessage({ type: 'deactivate_sim', sessionId: currentSessionId });
}
export function sendShockCommand(rhythmKey) {
    if (currentRole !== 'controller') return;
    if (!currentSessionId) { console.warn('[Network] Cannot send shock command, not in a session.'); return; }
    if (!rhythmKey) { console.error('[Network] Cannot send shock command: rhythmKey is missing.'); return; }
    console.log(`[Network] Sending shock command with target rhythm: ${rhythmKey}`);
    sendMessage({ type: 'shock', sessionId: currentSessionId, rhythm: rhythmKey });
}
export function sendNibpTrigger(nibpData) {
    if (currentRole !== 'controller') return;
    if (!currentSessionId) { console.warn('[Network] Cannot send NIBP trigger, not in a session.'); return; }
    console.log('[Network] Sending NIBP trigger command with data:', nibpData);
    sendMessage({ type: 'nibp_trigger', sessionId: currentSessionId, nibpData: nibpData });
}

export function requestSessionList() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn('[Network] Cannot request session list: WebSocket not open.');
        // still try to connect and schedule request after connect? For now notify caller by returning false
        return false;
    }
    // Gather stored admin tokens and device credentials from localStorage so the server
    // can reveal only sessions this client is authorized to see.
    const devices = [];
    const adminTokens = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key) continue;
            // device id key: medicalMonitorDevice_<SESSION>_id
            const m = key.match(/^medicalMonitorDevice_(.+)_id$/);
            if (m) {
                const sid = m[1];
                const idKey = `medicalMonitorDevice_${sid}_id`;
                const tokKey = `medicalMonitorDevice_${sid}_token`;
                try {
                    const deviceId = localStorage.getItem(idKey);
                    const deviceToken = localStorage.getItem(tokKey);
                    if (deviceId && deviceToken) devices.push({ sessionId: sid, deviceId, deviceToken });
                } catch (e) {}
            }
            // admin token key: medicalMonitorAdminToken_<SESSION>
            const ma = key.match(/^medicalMonitorAdminToken_(.+)$/);
            if (ma) {
                const sid = ma[1];
                try {
                    const adminToken = localStorage.getItem(key);
                    if (adminToken) adminTokens.push({ sessionId: sid, adminToken });
                } catch (e) {}
            }
        }
    } catch (e) {
        console.warn('[Network] Failed to read stored session credentials:', e);
    }

    // Send credentials to server so server can reveal only authorized sessions
    sendMessage({ type: 'list_sessions', devices, adminTokens });
    return true;
}

export function sendSoundStateUpdate(soundState) {
    if (currentRole !== 'controller') return;
    if (!currentSessionId) { console.warn('[Network] Cannot send sound state update, not in a session.'); return; }
    if (typeof soundState !== 'boolean') { console.warn('[Network] Invalid soundState for update:', soundState); return; }
    console.log(`[Network] Sending sound state update: ${soundState}`);
    sendMessage({ type: 'sound_state_update', sessionId: currentSessionId, soundState: soundState });
}

// --- UI Updates ---
function updateConnectionStatus(text, bgClass, textDark = false) {
    if (connectionStatusLabel) {
        connectionStatusLabel.textContent = text;
        connectionStatusLabel.className = `badge ${bgClass}`;
        if (textDark) {
            connectionStatusLabel.classList.add('text-dark');
        } else {
            connectionStatusLabel.classList.remove('text-dark');
        }
    }
}

function handleRoleChange() {
    stopReconnectionAttempts();
    if(!roleControllerRadio) return;
    const newRole = roleControllerRadio.checked ? 'controller' : 'monitor';
    if (newRole !== currentRole) {
        console.log(`[Network] Role changed locally to: ${newRole}`);
        currentRole = newRole;
        updateUIForRole(currentRole);
        if (isConnected && currentSessionId) {
            sendSetRole(currentRole);
        } else {
             console.log("[Network] Role changed locally (not in session).");
        }
    }
}

function updateUIForRole(role) {
    console.log(`[Network] Updating UI for role: ${role}, Session ID: ${currentSessionId}`);
    if (!mainControlsAccordion || !sessionControlsDiv || !sessionIdInput || !createSessionBtn || !joinSessionBtn || !roleControllerRadio || !roleMonitorRadio || !fullscreenButton || !sessionShareArea) {
        console.warn("[Network] Cannot update UI for role, some UI elements not found yet.");
        return;
    }

    const isMonitor = (role === 'monitor');
    const isInSession = !!currentSessionId;

    document.body.classList.toggle('monitor-role', isMonitor);
    document.body.classList.toggle('controller-role', !isMonitor);

    const disableSessionInputs = isMonitor && isInSession;
    sessionIdInput.disabled = disableSessionInputs;
    createSessionBtn.disabled = disableSessionInputs;
    joinSessionBtn.disabled = disableSessionInputs;

    roleControllerRadio.checked = !isMonitor;
    roleMonitorRadio.checked = isMonitor;

    if(roleControllerRadio) roleControllerRadio.disabled = false;
    if(roleMonitorRadio) roleMonitorRadio.disabled = false;

    sessionShareArea.style.display = (role === 'controller' && isInSession) ? '' : 'none';
    if (role === 'controller' && isInSession) {
        displaySessionShareInfo(currentSessionId);
    } else {
        hideSessionShareArea();
    }

    if (!fullscreenButton) {
        console.warn("[Network] Fullscreen button element not found during UI update.");
    }

    console.log(`[Network] UI Updated. Monitor Role Active: ${isMonitor}, Controls Hidden: ${isMonitor}, Session Inputs Disabled: ${disableSessionInputs}`);
}

// --- Session Sharing UI ---
function displaySessionShareInfo(sessionId) {
    if (!sessionLinkInput || !qrCodeContainer || !sessionShareArea || !sessionId) return;

    const sessionLink = `${window.location.origin}/?session=${sessionId}`;
    sessionLinkInput.value = sessionLink;

    qrCodeContainer.innerHTML = '';
    try {
        if (typeof QRCode === 'undefined') {
            console.error("[Network] QRCode library is not loaded. Cannot generate QR code.");
            qrCodeContainer.textContent = "QR Error";
            return;
        }
        new QRCode(qrCodeContainer, {
            text: sessionLink,
            width: 100,
            height: 100,
            colorDark : "#ffffff",
            colorLight : "#2c2c2c",
            correctLevel : QRCode.CorrectLevel.M
        });
        console.log("[Network] QR code generated/updated for session:", sessionId);
    } catch (error) {
        console.error("[Network] Error generating QR code:", error);
        qrCodeContainer.textContent = "QR Error";
    }

    sessionShareArea.style.display = '';
}

function hideSessionShareArea() {
    if (sessionShareArea) {
        sessionShareArea.style.display = 'none';
    }
    if (sessionLinkInput) {
        sessionLinkInput.value = '';
    }
    if (qrCodeContainer) {
        qrCodeContainer.innerHTML = '';
    }
}

function handleCopyLink() {
    if (!sessionLinkInput) return;
    const linkToCopy = sessionLinkInput.value;
    if (!linkToCopy) return;

    navigator.clipboard.writeText(linkToCopy).then(() => {
        console.log('[Network] Session link copied to clipboard!');
        const originalText = copyLinkBtn.innerHTML;
        // Assuming Font Awesome is used for icons
        copyLinkBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        setTimeout(() => {
            copyLinkBtn.innerHTML = originalText; // Restore original text/icon
        }, 2000);
    }).catch(err => {
        console.error('[Network] Failed to copy session link: ', err);
        alert('Failed to copy link. Please copy it manually.');
    });
}

// --- Get Current Role ---
export function getCurrentRole() {
    return currentRole;
}

export function leaveSession(skipConfirm = false) {
    console.log('[Network] leaveSession called by UI. skipConfirm=', !!skipConfirm);
    // Ask user for confirmation before leaving session unless skipConfirm requested
    if (!skipConfirm) {
        try {
            if (!confirm('Are you sure you want to leave the session and return to Home?')) return;
        } catch (e) {
            // If confirm is unavailable, proceed
        }
    }

    // Do not send a 'leave_session' message - server does not recognize it.
    // Perform local cleanup and UI update instead.
    try {
        if (currentSessionId) {
            localStorage.removeItem(`medicalMonitorDevice_${currentSessionId}_id`);
            localStorage.removeItem(`medicalMonitorDevice_${currentSessionId}_token`);
        }
    } catch (e) {}
    currentSessionId = null;
    if (sessionIdInput) sessionIdInput.value = '';
    updateConnectionStatus('Disconnected', 'bg-danger');
    hideSessionShareArea();
    updateUIForRole(currentRole);

    // Navigate UI back to landing view if present
    try {
        const landingView = document.getElementById('landing-view');
        const appView = document.getElementById('app-view');
        if (landingView && appView) {
            appView.style.display = 'none';
            landingView.style.display = 'block';
            const landingMenu = document.getElementById('landing-menu');
            const landingJoin = document.getElementById('landing-join');
            const landingLobby = document.getElementById('landing-lobby');
            const landingSessions = document.getElementById('landing-sessions');
            const sessionIdDisplay = document.getElementById('landing-session-id-display');
            const qrContainer = document.getElementById('landing-qr-container');
            const sessionsList = document.getElementById('landing-sessions-list');
            if (landingMenu) landingMenu.classList.remove('d-none');
            if (landingJoin) landingJoin.classList.add('d-none');
            if (landingLobby) landingLobby.classList.add('d-none');
            if (landingSessions) landingSessions.classList.add('d-none');
            if (sessionIdDisplay) sessionIdDisplay.textContent = '--';
            if (qrContainer) qrContainer.innerHTML = '';
            if (sessionsList) sessionsList.innerHTML = '';
        }
    } catch (e) { console.warn('[Network] leaveSession UI navigation failed:', e); }
}

export function endSession() {
    // Attempt to end current session by sending adminToken to server
    if (!currentSessionId) { alert('No active session to end.'); return; }
    const key = `medicalMonitorAdminToken_${currentSessionId}`;
    const token = localStorage.getItem(key);
    if (!token) { alert('Admin token not found. Only session owner can end the session.'); return; }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('Not connected to server. Cannot end session remotely.');
        return;
    }
    try {
        sendMessage({ type: 'end_session', sessionId: currentSessionId, adminToken: token });
        console.log('[Network] Sent end_session request to server.');
        try {
            localStorage.removeItem(`medicalMonitorDevice_${currentSessionId}_id`);
            localStorage.removeItem(`medicalMonitorDevice_${currentSessionId}_token`);
            localStorage.removeItem(`medicalMonitorAdminToken_${currentSessionId}`);
        } catch (e) {}
    } catch (e) {
        console.error('[Network] Failed to send end_session request:', e);
        alert('Failed to send end session request.');
    }
}
