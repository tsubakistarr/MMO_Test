// latency_test_client.js

const net = require('net');
const process = require('process');

// --- Configuration ---
const HOST = '127.0.0.1';
const PORT = 65432;
// Use command line argument for NUM_CLIENTS, default to 10 if not provided
const NUM_CLIENTS = parseInt(process.argv[2], 10) || 10;
const DELAY_BETWEEN_CLIENTS = 100; // Time to pause before starting the next client (in milliseconds)
const HOLD_TIME_SECONDS = 5;       // Time to keep all clients connected before disconnection

// --- Global Data Structures ---
const activeSockets = [];
let successfulConnections = 0;

// --- Utility Function: Sleep ---
/**
 * Pauses execution for a specified duration.
 * @param {number} ms - Milliseconds to sleep.
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- NEW UTILITY FUNCTION: Clear Socket Buffer ---
/**
 * Clears any buffered, unread data from the socket.
 * This is crucial for latency testing to ensure the response isn't
 * already sitting in the buffer from a prior broadcast.
 * @param {net.Socket} socket
 * @returns {Promise<number>} - The number of messages cleared.
 */
async function clearSocketBuffer(socket) {
    // console.log("[DEBUG] Clearing socket buffer for test client...");
    let clearedCount = 0;
    
    // We'll use a Promise and a temporary 'data' listener that resolves 
    // after a short timeout, ensuring all immediately available data is read.
    return new Promise(async (resolve) => {
        let isClearing = true;
        
        const tempDrainer = (data) => {
            if (isClearing) {
                // console.log(`[CLEARED] ${data.toString().trim()}`);
                clearedCount++;
            }
        };

        socket.on('data', tempDrainer);

        // Give the event loop a chance to process any buffered data
        await sleep(10); // Sleep for 10ms (equivalent to Ruby's 0.01s read_timeout)

        isClearing = false;
        socket.removeListener('data', tempDrainer);
        // console.log(`[DEBUG] Cleared ${clearedCount} buffered messages.`);
        resolve(clearedCount);
    });
}


// --- Core Connection Logic for a Single Client ---
/**
 * Connects a client, sends the registration username, and stores the socket.
 * @param {number} clientId - The sequential ID of the client.
 * @returns {Promise<boolean>} - True if connection was successful, false otherwise.
 */
function connectAndStore(clientId) {
    return new Promise((resolve) => {
        const username = `SeqHold_${clientId}`;
        const client = new net.Socket();

        // 1. Establish Connection
        client.connect(PORT, HOST, () => {
            // 2. Send Registration (Username)
            client.write(username);
            
            // 3. Store the active, registered socket
            activeSockets.push(client);
            successfulConnections++;
            
            // Keep the socket active, but do nothing with incoming data for now.
            client.on('data', (data) => { /* ignore */ }); 
            
            // Handle unexpected disconnection
            client.on('end', () => {
                // Remove socket from the list if it closes unexpectedly
                const index = activeSockets.indexOf(client);
                if (index > -1) {
                    activeSockets.splice(index, 1);
                }
            });

            resolve(true);
        });

        // Handle connection errors
        client.on('error', (err) => {
            if (err.code === 'ECONNREFUSED') {
                console.error(`[Client ${clientId} ERROR] Connection failed (Server offline?).`);
            } else {
                console.error(`[Client ${clientId} ERROR] An error occurred: ${err.message}`);
            }
            client.destroy();
            resolve(false);
        });
    });
}

// --- Main Execution ---
async function startSequentialHoldTest() {
    console.log(`Starting Sequential Hold Test: Connecting ${NUM_CLIENTS} clients one-by-one.`);

    // 1. Sequential Connection Phase
    const connectionStartTime = Date.now();
    for (let i = 1; i <= NUM_CLIENTS; i++) {
        await connectAndStore(i);
        // Pause before starting the next client
        await sleep(DELAY_BETWEEN_CLIENTS);
    }
    const connectionEndTime = Date.now();
    const connectionDuration = (connectionEndTime - connectionStartTime) / 1000;
    
    console.log("\n========================================================");
    console.log("        TEST PHASE 1: CONNECTION SUMMARY         ");
    console.log("========================================================");
    console.log(`Target Clients: ${NUM_CLIENTS}`);
    console.log(`Successful Connections: **${successfulConnections}**`);
    console.log(`Connection Duration: ${connectionDuration.toFixed(2)} seconds`);
    console.log("========================================================");

    if (successfulConnections === 0) {
        console.log("\n[EXIT] No clients connected. Test aborted.");
        return;
    }

    // 2. Hold Phase
    console.log("\n\n========================================================");
    console.log("          TEST PHASE 2: HOLDING CONNECTIONS           ");
    console.log("========================================================");
    console.log(`\n[HOLD] Holding all ${successfulConnections} connections open for **${HOLD_TIME_SECONDS} seconds**...`);
    console.log("Observe the server console for active connection count.");
    await sleep(HOLD_TIME_SECONDS * 1000);

    // 3. Latency Test Phase
    console.log("\n\n========================================================");
    console.log("        TEST PHASE 3: LATENCY OF A COMMAND         ");
    console.log("========================================================");
    
    // Select the first connected socket for the test
    const testSocket = activeSockets[0];
    
    // Clear any messages broadcasted during the HOLD phase
    await clearSocketBuffer(testSocket);
    
    let response = null;
    const timeBeforePrompt = Date.now();
    
    // Send the LOOK command
    testSocket.write("LOOK");
    
    // Set up a listener to capture the next response and measure time
    await new Promise((resolve) => {
        const responseListener = (data) => {
            const message = data.toString().trim();
            if (message.startsWith("Players in")) {
                response = message;
                testSocket.removeListener('data', responseListener);
                resolve();
            }
        };
        
        // Temporarily override the silent listener with one that captures the response
        testSocket.removeAllListeners('data');
        testSocket.on('data', responseListener);
        
        // Set a timeout in case the server fails to respond
        setTimeout(() => {
            if (response === null) {
                testSocket.removeListener('data', responseListener);
                resolve(); // Resolve the promise to continue, but response remains null
            }
        }, 3000); // 3-second timeout for response
    });
    
    const timeAfterPrompt = Date.now();

    if (response === null || !response.startsWith("Players in")) {
        console.error("\n[ERROR] Server disconnected or sent an unexpected response.");
        console.log(`Received: ${response}`);
        var latencySeconds = "N/A (Error)";
    } else {
        var latencySeconds = (timeAfterPrompt - timeBeforePrompt) / 1000;
        console.log(`Latency of Look command: **${latencySeconds.toFixed(9)} seconds**`);
    }

    // 4. Disconnection Phase
    console.log("\n[DISCONNECT] Starting graceful shutdown of all clients...");
    
    // Disconnect all sockets one after the other
    for (let i = 0; i < NUM_CLIENTS; i++) {
        const socket = activeSockets[i];
        try {
            // Send the QUIT command and close the socket.
            socket.write("QUIT");
            socket.end(); // Send FIN packet
            await sleep(DELAY_BETWEEN_CLIENTS);
        } catch (e) {
            // Handle potential errors if the server already closed a socket
        }
    }
    
    console.log(`[COMPLETE] All ${successfulConnections} clients disconnected.`);
    console.log("Test finished.");
} // <-- This brace must be present to close startSequentialHoldTest

// Main execution
if (require.main === module) {
    if (NUM_CLIENTS <= 0) {
        console.error("Please provide a valid number of clients (e.g., node latency_test_client.js 50).");
        process.exit(1);
    }
    // Corrected function call:
    startSequentialHoldTest();
}