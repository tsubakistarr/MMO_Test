// Node.js TCP Chat Client
const net = require('net');
const readline = require('readline');
const process = require('process');

// Configuration
const HOST = '127.0.0.1';
const PORT = 65432;

// Interface for reading user input
const read = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> '
});

/**
 * Handles incoming messages from the server, printing them to the console
 * and refreshing the user prompt.
 * @param {string} message - The message received from the server.
 */
function handleIncomingMessage(message) {
    // Clear the current input line (the '> ' prompt)
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    
    // Print the message
    process.stdout.write(message + '\n');
    
    // Re-display the prompt
    read.prompt(true);
}

/**
 * Initializes and starts the client application.
 */
function startClient() {
    console.log("🎮 Welcome to the JS MMO 🎮")
    read.question("Enter your username: ", (username) => {
        if (!username.trim()) {
            console.log("[EXIT] Username required. Exiting.");
            read.close();
            return;
        }

        const client = new net.Socket();

        client.connect(PORT, HOST, () => {
            console.log(`[CONNECTED] Connected to ${HOST}:${PORT}.`);
            console.log("Type 'quit' to exit.");
            console.log("Available command:");
            console.log(" ATTACK <username>");
            console.log(" LOOK");
            console.log(" Go <location>");
            console.log(" HELP")
            
            // 1. Send the username immediately after connecting
            client.write(username);

            // 2. Start listening for user input
            read.prompt(); 
            
            read.on('line', (line) => {
                const message = line.trim();

                if (message.toLowerCase() === 'quit') {
                    // Graceful exit
                    console.log("\n[EXIT] Disconnecting from server...");
                    client.end(); // Send FIN packet to server
                    read.close(); // Close readline interface
                    return;
                }

                // Send the message to the server
                client.write(message);
                
                // Re-prompt for input
                read.prompt(true);
            });
        });

        // 3. Handle incoming data from the server
        client.on('data', (data) => {
            const message = data.toString().trim();
            handleIncomingMessage(message);
        });

        // 4. Handle server disconnection
        client.on('end', () => {
            handleIncomingMessage("[CONNECTION LOST] Server closed the connection.");
            client.destroy();
            read.close();
        });

        // 5. Handle errors
        client.on('error', (err) => {
            if (err.code === 'ECONNREFUSED') {
                console.error(`\n[ERROR] Connection failed. Is the server running on ${HOST}:${PORT}?`);
            } else {
                console.error(`\n[ERROR] An unexpected error occurred: ${err.message}`);
            }
            client.destroy();
            read.close();
        });
        
        // Ensure process exits when readline closes
        read.on('close', () => {
            process.exit(0);
        });
    });
}

startClient();