require 'socket'
require 'thread'
require_relative 'player' # Include the Player class definition

# --- Configuration ---
HOST = '127.0.0.1'  # Standard loopback interface address (localhost)
PORT = 65432        # Port to listen on (non-privileged ports are > 1023)
BUFFER_SIZE = 1024  # Buffer size for reading from socket (though Ruby's gets is used)
ENCODING = 'utf-8'

# --- Global Data Structures (Shared State) ---
# Hash to store all active player objects, keyed by username for fast lookup.
$players_by_username = {}
# Mutex to ensure thread-safe access when modifying the global players hash.
$clients_mutex = Mutex.new
# Array of valid locations players can move between.
$locations = ["Tavern", "Forest"]

# --- Help Command Messages ---
IDLE_HELP = [
    "*** Available Commands ***",
    "ATTACK <username>: Start a fight with another player in your location.",
    "LOOK: See all players currently in your location.",
    "GO <location>: Move to a new location (e.g., GO Forest).",
    "HELP: Show this list of commands.",
    "QUIT: Disconnect from the server.",
    "*** Available Locations ***",
    "Tavern",
    "Forest"
].join("\n")

BATTLE_HELP = [
    "*** Combat Commands ***",
    "ATTACK: Inflict damage on your target.",
    "HEAL: Restore some of your health (consumes a turn).",
    "DEFEND: Enter a defensive stance to reduce incoming damage next turn (consumes a turn)."
].join("\n")

# --- Utility Function: Broadcast ---

def broadcast(message, sender_socket)
    """
    Sends a public message to all clients except the sender.
    """
    # Create a list of sockets to iterate over outside the mutex to minimize lock time.
    sockets_to_send = []
    $clients_mutex.synchronize do
        # Get the socket object from every Player object in the hash values.
        sockets_to_send = $players_by_username.values.map(&:socket).dup
    end

    sockets_to_send.each do |client_socket|
        # Check if the client socket is not the sender's socket.
        if client_socket != sender_socket
            begin
                # Send the message, followed by a newline.
                client_socket.puts message
            rescue => e
                # Handle potential error (e.g., client disconnected unexpectedly).
                print "[BROADCAST ERROR] #{e.message}"
            end
        end
    end
end

# --- Combat Functions ---

def attack(target_player, target_socket, target_username, player, client_socket, username)
    # Ensure the target's socket is valid before proceeding.
    if target_socket
        attack = player.attack
        # Calculate damage, applying defense and the 'defending' modifier if active.
        damage_taken = target_player.take_damage(attack)

        if target_player.alive?
            # --- Successful Hit (Target Survives) ---
            message_to_target = "#{username} has attacked you for #{damage_taken} dmg. Remaining health: #{target_player.health}"
            message_to_player = "You have attacked #{target_username} for #{damage_taken} dmg"
            
            # Swap turns for the next action.
            target_player.player_turn = true
            player.player_turn = false
            
            begin
                target_socket.puts message_to_target
                client_socket.puts message_to_player
            rescue => e
                # Handle socket errors during communication.
                error_msg = "[SERVER ERROR] Could not complete ATTACK to #{target_username}. Try again."
                client_socket.puts error_msg
                puts "[ATTACK failed] #{e.message}"
            end
        else
            # --- Target Dies ---
            message_to_target = "You have died"
            
            # Award experience to the winner. `add_experience` handles level-up logic.
            experience = player.add_experience(target_player.level)
            message_to_player = "#{target_username} has died. You have gained #{experience} experience. You are now level #{player.level}"
            
            # Reset fight state for both players.
            player.in_fight = false
            player.player_turn = true
            target_player.in_fight = false
            target_player.player_turn = true
            
            # Crucial: Clear all dangling target references for a clean state.
            player.target_player = nil 
            target_player.target_player = nil
            
            # Full heal and reset for both players (respawn/refresh logic).
            player.full_heal
            target_player.full_heal

            begin
                target_socket.puts message_to_target
                client_socket.puts message_to_player
            rescue => e
                error_msg = "[SERVER ERROR] Could not complete ATTACK. Try again."
                client_socket.puts error_msg
                puts "[ATTACK failed] #{e.message}"
            end
        end
    end
end

def heal(target_player, target_socket, target_username, player, client_socket, username)
    # Heal is restricted to in-fight and when the player is alive.
    if player.in_fight && player.alive?
        # Player.heal() calculates the amount (e.g., 20% of max health) and updates health.
        heal_amount = player.heal 
        message_to_target = "#{username} has healed for #{heal_amount} health. Their remaining health is now: #{player.health}."
        message_to_player = "You have healed for #{heal_amount} health."
        
        # Swap turns.
        player.target_player.player_turn = true
        player.player_turn = false
        
        begin
            target_socket.puts message_to_target
            client_socket.puts message_to_player
        rescue => e
            error_msg = "[SERVER ERROR] Could not complete heal for #{username}. Try again."
            client_socket.puts error_msg
            puts "[Heal failed] #{e.message}"
        end
    else
        # Command failed because the player is not in battle.
        message = "You can only heal in battle."
        begin
            client_socket.puts message
        rescue => e
            error_msg = "[SERVER ERROR] Could not message #{username}. Try again."
            client_socket.puts error_msg
            puts "[Message failed] #{e.message}"  
        end
    end
end

def defend(target_player, target_socket, target_username, player, client_socket, username)
    # Defend is restricted to in-fight and when the player is alive.
    if player.in_fight && player.alive?
        # Set the defending flag on the player object (will reduce next incoming damage).
        player.defending =  true 
        message_to_target = "#{username} has entered a defensive stance."
        message_to_player = "You have entered a defensive stance."
        
        # Swap turns.
        player.target_player.player_turn = true
        player.player_turn = false
        
        begin
            target_socket.puts message_to_target
            client_socket.puts message_to_player
        rescue => e
            error_msg = "[SERVER ERROR] #{username} could not defend. Try again."
            client_socket.puts error_msg
            puts "[Defend failed] #{e.message}"
        end
    else
        # Command failed because the player is not in battle.
        message = "You can only defend in battle."
        begin
            client_socket.puts message
        rescue => e
            error_msg = "[SERVER ERROR] Could not message #{username}. Try again."
            client_socket.puts error_msg
            puts "[Message failed] #{e.message}"  
        end
    end
end

# --- Client Thread Handler ---

def handle_client(client_socket)
    """
    Manages communication with a single client in its own thread, including routing.
    """
    client_address = client_socket.peeraddr.last
    puts "[NEW CONNECTION] #{client_address} has joined."
    username = nil 
    player = nil
    target_player = nil
    target_socket = nil
    target_username = nil

    # 1. Get the username from the client
    begin
        # Ruby's `gets` on a socket reads until a newline.
        username = client_socket.gets.chomp
        # Fallback if the user does not provide a username.
        username = "Player #{client_address}" unless username && !username.empty? 
    rescue => e
        puts "[username ERROR] #{client_address}: #{e.message}"
        username = "Player #{client_address}"
    end

    # 2. Register the new client (thread-safe)
    $clients_mutex.synchronize do
        # Create a new Player object, placing them in the first defined location.
        player = Player.new(username, client_socket, $locations[0])
        $players_by_username[username] = player
    end

    # 3. Announce the new client
    join_message = "[SERVER] #{username} has entered #{$locations[0]}."
    puts join_message
    broadcast(join_message, client_socket) # Notify all other connected clients.

    # --- Main Client Loop ---
    while true
        begin
            # Read a full line from the client (this is a blocking call).
            message = nil
            message = client_socket.gets
            break unless message # Client disconnected (sends EOF)
            
            message.chomp! # Remove trailing newline

            # --- In-Combat Command Handling ---
            if player.in_fight
                # Establish combat targets for ease of access.
                target_player = player.target_player
                target_socket = target_player.socket
                target_username = target_player.username
                
                # Check player turn status. If not their turn, send a wait message and skip.
                if message != nil && !player.player_turn
                    client_socket.puts "Waiting for #{target_username}."
                    next
                end
                
                # --- Combat Help Command ---
                if message.start_with?("HELP")
                    client_socket.puts BATTLE_HELP
                end
                # Route combat commands to the dedicated functions.
                if message.start_with?("ATTACK")
                    attack(target_player, target_socket, target_username, player, client_socket, username)
                end
                if message.start_with?("HEAL")
                    heal(target_player, target_socket, target_username, player, client_socket, username)
                end
                if message.start_with?("DEFEND")
                    defend(target_player, target_socket, target_username, player, client_socket, username)
                end
                next # Processed a command, skip the rest of the loop checks.
            end

            # --- Idle/Out-of-Combat Command Handling ---

            # Initiating combat (ATTACK <username>)
            if message.start_with?("ATTACK")
                parts = message.split(' ', 2)
                # Check for required argument.
                if parts.length < 2
                    error_msg = "[SERVER] Usage: ATTACK <username> "
                    client_socket.puts error_msg
                    next
                end
                target_username = parts[1]

                $clients_mutex.synchronize do
                    target_player = $players_by_username[target_username]
                end

                if target_player != nil
                    if target_player.location == player.location
                        target_socket = target_player.socket

                        if target_player.in_fight
                            client_socket.puts "Target is already in battle."
                            next
                        end
                        if !target_player.alive?
                            client_socket.puts "Target is dead."
                            next
                        end

                        # Set up the fight state for both players.
                        player.target_player = target_player
                        target_player.target_player = player
                        
                        player.in_fight = true
                        target_player.in_fight = true
                        # Start the fight by having the initiator attack first.
                        attack(target_player, target_socket, target_username, player, client_socket, username);
                    else
                        client_socket.puts "Target is not in range"
                    end
                else
                    client_socket.puts "Target player not found"
                end
                next
            end

            # LOOK command (Lists players in current location)
            if message.start_with?("LOOK")
                players_in_location = []
                $clients_mutex.synchronize do 
                    # Iterate through all Player objects in the global hash.
                    $players_by_username.each do |key, value|
                        # The iteration must use both key and value, where 'value' is the Player object.
                        if value.location == player.location
                            players_in_location.push(value.username)
                        end
                    end
                end
                begin
                    # Send formatted list to the client.
                    client_socket.puts "Players in #{player.location}: #{players_in_location.join(', ')}"
                rescue => e
                    error_msg = "[SERVER ERROR] Could not message #{username}. Try again."
                    client_socket.puts error_msg
                    puts "[Message failed] #{e.message}"  
                end
            end
            
            # GO command (Movement)
            if message.start_with?("GO")
                parts = message.split(' ', 2)
                if parts.length < 2 # Check if the location argument exists
                    client_socket.puts "[SERVER] Usage: GO <location>"
                    next
                end
                target_location = parts[1]

                # Validate the location exists and is different from current location.
                if $locations.include?(target_location) && target_location != player.location
                    # Announce departure to the previous location's players.
                    leave_message = "[SERVER] #{username} has left #{player.location} and entered #{target_location}."
                    broadcast(leave_message, client_socket)

                    # Update player state.
                    player.location = target_location
                    client_socket.puts "[SERVER] You have entered #{target_location}."

                else
                    client_socket.puts "[SERVER] Invalid location or already there."
                end
            end
            
            # --- Idle Help Command ---
            if message.start_with?("HELP")
                client_socket.puts IDLE_HELP
                next
            end

        rescue EOFError # Client closed connection gracefully
            break
        rescue Errno::ECONNRESET # Client closed connection abruptly
            break
        rescue => e
            puts "An error occurred with #{client_address}: #{e.message}"
            break
        end
    end

    # 4. Clean up and notify everyone on disconnection
    if username
        leave_message = "[SERVER] #{username} has left the chat."
        puts leave_message
        broadcast(leave_message, client_socket)

        # Remove player from the global hash (thread-safe).
        $clients_mutex.synchronize do
            $players_by_username.delete(username)
        end
    end

    client_socket.close
    puts "[DISCONNECTION] #{client_address} closed."
end


# --- Server Initialization ---

def start_server
    """
    Initializes and starts the server.
    """
    # Create a server socket bound to the host and port.
    server = TCPServer.new(HOST, PORT)
    puts "[STARTING] Server is listening on #{HOST}:#{PORT}"

    # Handle Ctrl+C (Interrupt signal) for graceful shutdown.
    trap("INT") do
        puts "\n[SHUTDOWN] Server shutting down..."
        server.close
        exit
    end

    begin
        while true
            # Accept a new connection (blocking call).
            client_socket = server.accept

            # Start a new thread to handle the client asynchronously.
            Thread.new(client_socket) do |socket|
                handle_client(socket)
            end

            # Display the number of active connections.
            $clients_mutex.synchronize do
                active_clients = $players_by_username.size
                # + 1 for the client that was just accepted but is still registering in its thread.
                puts "[ACTIVE CONNECTIONS] #{active_clients + 1} (1 pending registration)" 
            end
        end
    rescue IOError => e
        # Raised when server.close is called from the trap block.
        puts "Server socket closed."
    rescue => e
        puts "Server error: #{e.message}"
    ensure
        server.close if server
    end
end

# Main execution: Only runs the server logic when the script is executed directly.
if __FILE__ == $0
    start_server
end
