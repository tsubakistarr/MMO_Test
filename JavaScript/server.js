// Node.js TCP Chat Server
const net = require('net');
const Player = require('./player');

// Configuration
const HOST = '127.0.0.1';
const PORT = 65432;

// Dictionary to map nicknames to players
const playersByUsername = new Map();
//Array of vailid locations players can move between.
const locations = ["Tavern", "Forest"];

/**** Help command messages ****/
const IdleHelp =[
    "*** Available Commands ***",
    "ATTACK <username>: Start a fight with another player in your location.",
    "LOOK: See all players currently in your location.",
    "GO <location>: Move to a new location (e.g., GO Forest).",
    "HELP: Show this list of commands.",
    "QUIT: Disconnect from the server.",
    "*** Available Locations ***",
    "Tavern",
    "Forest"
].join("\n");

const BattleHelp = [
    "*** Combat Commands ***",
    "ATTACK: Inflict damage on your target.",
    "HEAL: Restore some of your health (consumes a turn).",
    "DEFEND: Enter a defensive stance to reduce incoming damage next turn (consumes a turn)."
].join("\n");

/**** Utility Function: Broadcast ****/
function broadcast(message, senderSocket) {
    // Send to all clients currently connected
    for (const [username, playerObject] of playersByUsername.entries()) {
        const socketToWrite = playerObject.socket;
        if (socketToWrite !== senderSocket) {
            try {
                socketToWrite.write(message + '\n');
            } catch (e) {
                console.error(`[ERROR] Could not send to ${username}: ${e.message}`);
            }
        }
    }
}


/**** Combat Functions ****/

function attack(targetPlayer, targetSocket, targetUsername, player, clientSocket, username){
    // Ensure the target's socket is valid before proceding.
    if (targetSocket){
        let attack = player.attack;
        //Calculate damage, applying defense and the 'defending' modifier if active.
        let damageTaken = targetPlayer.takeDamage(attack);

        if(targetPlayer.isAlive()){
            /**** Successful Hit (Target Survives) ****/
            const messageToTarget = `${username} has attacked you for ${damageTaken} dmg. Remaining health: ${targetPlayer.health}`;
            const messageToPlayer = `You have attacked ${targetUsername} for ${damageTaken} dmg`;

            // Swap turns for the next action
            targetPlayer.playerTurn = true;
            player.playerTurn = false;

            try {
                targetSocket.write(messageToTarget + '\n');
                clientSocket.write(messageToPlayer + '\n');
            } catch (e) {
                // Handle socket errors during communication
                const errorMessage = `[SERVER ERROR] Could not complete ATTACK to ${targetUsername}. Try again.`;
                clientSocket.write(errorMessage + '\n');
                console.log(`[ATTACK failed] ${e.message}`);
            }
        }
        else{
            /**** Target Dies ****/
            const messageToTarget = "You have died";
            // Award experience to the winner. 'addExperience' handles level-up logic
            let experience = player.addExperience(targetPlayer.level);
            const messageToPlayer = `${targetUsername} has died. You have gained ${experience} experience. You are now level ${player.level}.`;

            //Reset fight state for both players
            player.inFight = false;
            player.playerTurn = true;
            targetPlayer.inFight = false;
            targetPlayer.playerTurn = true;

            //Crucial: Clear all dangling target references for a clean state.
            player.targetPlayer = null;
            targetPlayer.targetPlayer = null;

            //Full heal and reset for both players (respawn/refresh logic).
            player.fullHeal();
            targetPlayer.fullHeal();

            try {
                targetSocket.write(messageToTarget + '\n');
                clientSocket.write(messageToPlayer + '\n');
            } catch (e) {
                // Handle socket errors during communication
                const errorMessage = `[SERVER ERROR] Could not complete ATTACK to ${targetUsername}. Try again.`;
                clientSocket.write(errorMessage + '\n');
                console.log(`[ATTACK failed] ${e.message}`);
            }
        }
    }
}

function heal(targetPlayer, targetSocket, targetUsername, player, clientSocket, username){
    // Heal is restricted to in-fight and when the player is alive
    if(player.inFight && player.isAlive()){
        // Player.Heal() calculates the amount (e.g., 10% of max health) and updates health.
        let healAmount = player.heal();
        const messageToTarget = `${username} has healed for ${healAmount} health. Their remaining health is now: ${targetPlayer.health}`;
        const messageToPlayer = `You have healed for ${healAmount} health`;

        // Swap turns for the next action
        targetPlayer.playerTurn = true;
        player.playerTurn = false;

        try {
            targetSocket.write(messageToTarget + '\n');
            clientSocket.write(messageToPlayer + '\n');
        } catch (e) {
            // Handle socket errors during communication
            const errorMessage = `[SERVER ERROR] Could not complete Heal for ${username}. Try again.`;
            clientSocket.write(errorMessage + '\n');
            console.log(`[HEAL failed] ${e.message}`);
        }
    }
    else{
        //Commnad failed because the player is not in battle
        const message = "You can only heal in battle.";
        try {
            clientSocket.write(message + '\n');
        } catch (e) {
            // Handle socket errors during communication
            const errorMessage = `[SERVER ERROR] Could not message ${username}. Try again.`;
            clientSocket.write(errorMessage + '\n');
        }
    }
}

function defend(targetPlayer, targetSocket, targetUsername, player, clientSocket, username){
    // Defend is restricted to in-fight and when the player is alive.
    if(player.inFight && player.isAlive()){
        player.defending = true;
        const messageToTarget = `${username} has entered a defensive stance.`;
        const messageToPlayer = `You have entered a defensive stance`;

        // Swap turns for the next action
        targetPlayer.playerTurn = true;
        player.playerTurn = false;

        try {
            targetSocket.write(messageToTarget + '\n');
            clientSocket.write(messageToPlayer + '\n');
        } catch (e) {
            // Handle socket errors during communication
            const errorMessage = `[SERVER ERROR] ${username} could not defend. Try again.`;
            clientSocket.write(errorMessage + '\n');
            console.log(`[DEFEND failed] ${e.message}`);
        }
    }
    else{
        //Commnad failed because the player is not in battle
        const message = "You can only defend in battle.";
        try {
            clientSocket.write(message + '\n');
        } catch (e) {
            // Handle socket errors during communication
            const errorMessage = `[SERVER ERROR] Could not message ${username}. Try again.`;
            clientSocket.write(errorMessage + '\n');
            console.log(`[DEFEND failed] ${e.message}`);
        }
    }
}

/**** Client Thread Handler****/
function handleClient(clientSocket) {
    const clientAddress = `${clientSocket.remoteAddress}:${clientSocket.remotePort}`;
    console.log(`[NEW CONNECTION] ${clientAddress} connected.`);

    
    let username = null;
    let player = null;

    // Data handler for incoming messages
    clientSocket.on('data', (data) => {
        const message = data.toString().trim();

        // 1. Get the username (first message)
        if (!username) {
            username = message || `Client ${clientSocket.remotePort}`;
            
            // Handle username conflict (simple check)
            if (playersByUsername.has(username)) {
                let suffix = 1;
                let orignalUsername = username;
                while (playersByUsername.has(username)) {
                    username = `${orignalUsername}${suffix++}`;
                }
                clientSocket.write(`[SERVER] Nickname '${orignalUsername}' is taken. You are now known as '${username}'.\n`);
            }
            player =  new Player(username, clientSocket, locations[0]);
            playersByUsername.set(username,player);

            const joinMessage = `[SERVER] ${username} has entered ${locations[0]}.`;
            console.log(joinMessage);
            broadcast(joinMessage, clientSocket);
            console.log(`[ACTIVE CONNECTIONS] ${playersByUsername.size}`);
            return;
        }

        /**** In-Combat Command Handling****/
        if(player.inFight){
            // Establish combat targets for ease of access.
            let targetPlayer = player.targetPlayer;
            let targetSocket = targetPlayer.socket;
            let targetUsername = targetPlayer.username;

            // Check player turn status. If not their turn, send wait message and skip.
            if(message != null && !player.playerTurn){
                clientSocket.write(`Waiting for ${targetUsername}` + '\n');
                return;
            }

            /**** Combat Help Command ****/
            if (message.startsWith("HELP")){
                clientSocket.write(BattleHelp + '\n');
            }
            // Route combat commands to the dedicated functions
            if (message.startsWith("ATTACK")){
                attack(targetPlayer, targetSocket, targetUsername, player, clientSocket, username);
            }
            if (message.startsWith("HEAL")){
                heal(targetPlayer, targetSocket, targetUsername, player, clientSocket, username);
            }
            if (message.startsWith("DEFEND")){
                defend(targetPlayer, targetSocket, targetUsername, player, clientSocket, username);
            }
            return; // Processed a command, skip the rest of the loop checks.
        }

        /**** Idel/Out-of-Combat Command Handling ****/

        // Initiating combat (ATTACK <username>)
        if (message.startsWith("ATTACK")){
            const parts = message.split(' ', 2);
            //Check for required argument
            if (parts.length < 2) {
                const errorMessage = "[SERVER] Usage: ATTACK <username>";
                clientSocket.write(errorMessage + '\n');
                return;
            }
            let targetUsername = parts[1];
            let targetPlayer = playersByUsername.get(targetUsername);
            if (targetPlayer != null){
                if(targetPlayer.location == player.location){
                    let targetSocket = targetPlayer.socket;

                    if(targetPlayer.inFight){
                        clientSocket.write("Target is already in battle. \n");
                        return;
                    }
                    if(!targetPlayer.isAlive()){
                        clientSocket.write("Target is dead \n");
                        return;
                    }

                    //Set up the fight state for both players
                    player.targetPlayer = targetPlayer;
                    targetPlayer.targetPlayer = player;

                    player.inFight = true;
                    targetPlayer.inFight = true;
                    //Start the fight by having the initiator attack first
                    attack(targetPlayer, targetSocket, targetUsername, player, clientSocket, username);
                }
                else{
                    clientSocket.write("Target player not found. \n");
                }
                return;
            }
            else{
                clientSocket.write("Target player not found. \n");
            }
            return;
        }

        //LOOK command (Lists players in cureent location)
        if(message.startsWith("LOOK")){
            const playersInLocation = [];
            // Iterate through all Player objects in the global hash
            for (const [key, value] of playersByUsername.entries()) {
                // Check if the iterated player is in the same location as the current player
                if (value.location === player.location) {
                    playersInLocation.push(value.username);
                }
            }
            try {
                const messageToSend = `Players in ${player.location}: ${playersInLocation.join(', ')}`;
                // Use clientSocket.write() and manually append the newline ('\n')
                clientSocket.write(messageToSend + '\n');
            } catch (e) {
                // Handle socket errors during communication
                const errorMessage = `[SERVER ERROR] Could not message ${username}. Try again.`;
                clientSocket.write(errorMessage + '\n');
                console.log(`[LOOK failed] ${e.message}`);
            }
        }

        //Go command (Movement)
        if (message.startsWith("GO")){
            const parts = message.split(' ', 2);
            //Check for required argument
            if (parts.length < 2) {
                const errorMessage = "[SERVER] Usage: GO <location>";
                clientSocket.write(errorMessage + '\n');
                return;
            }
            targetLocation = parts[1];

            //validate the location exists and is different from the current location
            if(locations.includes(targetLocation)  && targetLocation != player.location){
                //Anounce departure to the previous location's players
                leaveMessage = `[SERVER] ${username} has left ${player.location} and entered ${targetLocation}.`;
                broadcast(leaveMessage, clientSocket);

                //Update player state
                player.location = targetLocation;
                clientSocket.write(`[SERVER] You have entered ${targetLocation} \n`);
            }
            else{
                clientSocket.write("[SERVER] Invalid location or already there. \n");
            }
        }

        /**** Idle HELP command****/
        if(message.startsWith("HELP")){
            clientSocket.write(IdleHelp+ '\n');
            return;
        }
    });

    // Event handlers for client disconnection
    clientSocket.on('end', () => disconnectClient(username, clientAddress));
    clientSocket.on('close', () => disconnectClient(username, clientAddress));
    clientSocket.on('error', (err) => {
        console.error(`[ERROR] Socket error for ${username || clientAddress}: ${err.message}`);
        disconnectClient(username, clientAddress);
    });
}

/**
 * Handles cleanup and notification when a client disconnects.
 * @param {string | null} username - The username of the disconnected client.
 * @param {string} clientAddress - The address string of the client.
 */
function disconnectClient(username, clientAddress) {
    if (username) {
        // Remove client from the map
        playersByUsername.delete(username);

        const leaveMessage = `[SERVER] ${username} has left the chat.`;
        console.log(`[DISCONNECTION] ${clientAddress} | ${leaveMessage}`);
        broadcast(leaveMessage, null); // Broadcast to everyone
    } else {
        console.log(`[DISCONNECTION] ${clientAddress} closed.`);
    }
    console.log(`[ACTIVE CONNECTIONS] ${playersByUsername.size}`);
}


/**
 * Initializes and starts the server.
 */
function startServer() {
    const server = net.createServer(handleClient);

    server.listen(PORT, HOST, () => {
        console.log(`[STARTING] Server is listening on ${HOST}:${PORT}`);
        console.log("Press Ctrl+C to stop the server.");
    });

    // Handle server error events
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`[ERROR] Port ${PORT} is already in use. Try running the server later.`);
        } else {
            console.error(`[ERROR] Server error: ${err.message}`);
        }
    });
}

startServer();
