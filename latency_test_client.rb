require 'socket'
require 'thread'
require 'time'
require 'timeout'

# --- Configuration ---
HOST = '127.0.0.1'
PORT = 65432
NUM_CLIENTS = ARGV[0].to_i         # The requested number of clients to connect sequentially
DELAY_BETWEEN_CLIENTS = 0.1     # Time to pause before starting the next client (in seconds)
HOLD_TIME_SECONDS = 5            # Time to keep all clients connected before disconnection

# --- Global Data Structures ---
$active_sockets = []
$sockets_mutex = Mutex.new

# --- NEW UTILITY FUNCTION: Clear Socket Buffer ---
def clear_socket_buffer(socket)
    puts "[DEBUG] Clearing socket buffer for test client..."
    # Set a very short non-blocking timeout for reading.
    read_timeout = 0.01 
    cleared_count = 0
    
    loop do
        begin
            # Wait for any data to be readable on the socket with a timeout
            readable, _, _ = IO.select([socket], nil, nil, read_timeout)
            
            # If nothing is readable within the timeout, break the loop
            break if readable.nil? || readable.empty?

            # If the socket is readable, read the message
            message = socket.gets
            break unless message # Should only happen if the socket is closed unexpectedly

            # puts "[CLEARED] #{message.chomp}"
            cleared_count += 1
            
        rescue IOError, Errno::ECONNRESET, Timeout::Error
            # Stop clearing if an error occurs (socket closed, etc.)
            break
        end
    end
    puts "[DEBUG] Cleared #{cleared_count} buffered messages."
    return cleared_count
end

# --- Core Connection Logic for a Single Client ---
def connect_and_store(client_id)
    username = "SeqHold_#{client_id}"
    client = nil

    # 1. Establish Connection
    begin
        client = TCPSocket.new(HOST, PORT)
        
        # 2. Send Registration (Username)
        client.puts username

        # 3. Store the active, registered socket (Thread-safe)
        $sockets_mutex.synchronize do
            $active_sockets << client
        end
        
        # We do not attempt to read from the socket to prevent the script from hanging.
        #puts "[Client #{client_id}] Connected and registered as #{username}. Active: #{$active_sockets.size}"
        return true
        
    rescue Errno::ECONNREFUSED
        puts "[Client #{client_id} ERROR] Connection failed (Server offline?)."
    rescue => e
        puts "[Client #{client_id} ERROR] An error occurred: #{e.message}"
    end
    
    # Ensure the socket is closed if connection fails early
    client.close if client
    return false
end

# --- Main Execution ---
def start_sequential_hold_test
    puts "Starting Sequential Hold Test: Connecting #{NUM_CLIENTS} clients one-by-one."
    
    successful_connections = 0
    connection_start_time = Time.now

    # 1. Sequential Connection Phase
    (1..NUM_CLIENTS).each do |i|
        # Connect and store one client
        if connect_and_store(i)
            successful_connections += 1
        end
        
        # Pause before starting the next client
        sleep(DELAY_BETWEEN_CLIENTS)
    end

    connection_end_time = Time.now
    connection_duration = (connection_end_time - connection_start_time).round(2)
    
    puts "\n========================================================"
    puts "        TEST PHASE 1: CONNECTION SUMMARY         "
    puts "========================================================"
    puts "Target Clients: #{NUM_CLIENTS}"
    puts "Successful Connections: **#{successful_connections}**"
    puts "Connection Duration: #{connection_duration} seconds"
    puts "========================================================"

    # 2. Hold Phase
    puts "\n\n========================================================"
    puts "          TEST PHASE 2: HOLDING CONNECTIONS           "
    puts "========================================================"
    puts "\n[HOLD] Holding all #{successful_connections} connections open for **#{HOLD_TIME_SECONDS} seconds**..."
    puts "Observe the server console for active connection count."
    sleep(HOLD_TIME_SECONDS)
 
    test_socket = nil
    $sockets_mutex.synchronize do
        test_socket = $active_sockets[0]
    end
    clear_socket_buffer(test_socket)
    time_before_prompt = Time.now
    test_socket.puts "LOOK"
    response = nil
    begin
        response = test_socket.gets
        time_after_prompt = Time.now
    rescue => e
        puts "[ERROR] Failed to receive response: #{e.message}"
    end
    if response.nil? || !response.start_with?("Players in")
        puts "\n[ERROR] Server disconnected or sent an unexpected response."
        puts "Received: #{response.chomp if response}"
    end
    latency_seconds = time_after_prompt - time_before_prompt

    puts "\n\n========================================================"
    puts "        TEST PHASE 3: LATENCY OF A COMMAND         "
    puts "========================================================"
    puts "Latency of Look command: #{latency_seconds}"
    sleep(0.1)


    # 3. Disconnection Phase
    puts "\n[DISCONNECT] Starting graceful shutdown of all clients..."
    
    # Use a thread-safe copy of the sockets for iteration
    sockets_to_close = []
    $sockets_mutex.synchronize { sockets_to_close.concat($active_sockets) }
    
    # Disconnect all sockets one after the other
    sockets_to_close.each_with_index do |socket, index|
        begin
            # Send the QUIT command and close the socket.
            socket.puts "QUIT" 
            socket.close
            sleep(DELAY_BETWEEN_CLIENTS)
        rescue => e
            # Handle potential errors if the server already closed a socket
        end
    end
    
    puts "[COMPLETE] All #{successful_connections} clients disconnected."
    puts "Test finished."
end

# Main execution
if __FILE__ == $0
    start_sequential_hold_test
end