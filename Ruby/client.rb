require 'socket'
require 'thread'

# Configuration
HOST = '127.0.0.1'  # The server's hostname or IP address
PORT = 65432        # The port used by the server
ENCODING = 'utf-8'

def receive_messages(client_socket)
    """
    Thread function to continuously listen for and print messages from the server.
    """
    while true
        begin
            # Ruby's `gets` reads until a newline, which is convenient for line-based chat
            message = client_socket.gets
            break unless message # Server disconnected or sent empty data

            # Print the message, overwriting the current input prompt (> )
            # We use $stdout.write to bypass standard IO buffering and directly write
            $stdout.write "\r#{message.chomp}\n> "
            $stdout.flush

        rescue Errno::ECONNRESET
            # Handle abrupt disconnection
            puts "\n[ERROR] Connection to server was reset."
            break
        rescue IOError
            # Socket closed by main thread
            break
        rescue => e
            # Handle other errors
            puts "\n[ERROR] An unexpected error occurred: #{e.message}"
            break
        end
    end

    # Ensure the socket is closed if the thread exits unexpectedly
    client_socket.close unless client_socket.closed?
    # Print a newline to ensure the message starts on a fresh line,
    # regardless of where the "> " prompt was.
    $stdout.write "\n"
    puts "[CONNECTION LOST] Server closed the connection or client exited."
end

def start_client
    """
    Initializes and starts the client application.
    """
    puts "Welcome to the Ruby MMO"
    puts"Enter your username: "
    # Get user input for nickname and remove the newline
    nickname = STDIN.gets.chomp

    # Create a TCP/IP socket
    client = nil

    begin
        # Connect to the server
        client = TCPSocket.new(HOST, PORT)
    rescue Errno::ECONNREFUSED
        puts "[ERROR] Connection failed. Is the server running on #{HOST}:#{PORT}?"
        return
    rescue => e
        puts "[ERROR] Could not connect: #{e.message}"
        return
    end

    puts "[CONNECTED] Connected to #{HOST}:#{PORT}."
    puts "Type 'quit' to exit."
    puts "Available commands:"
    puts " ATTACK <username>"
    puts " LOOK"
    puts " GO <location>"
    puts " HELP"

    # 1. Send the nickname immediately after connecting (must include a newline for server's `gets`)
    client.puts nickname

    # 2. Start a separate thread to receive messages
    receive_thread = Thread.new { receive_messages(client) }

    # 3. Main thread handles sending messages (user input loop)
    while true
        begin
            # Prompt for user input
            print "> "
            # Use STDIN.gets to ensure input is read from the console, not the socket
            message = STDIN.gets

            break unless message # Handle EOF (Ctrl+D)

            message.chomp!

            if message.downcase == 'quit'
                # Graceful exit
                puts "\n[EXIT] Disconnecting from server..."
                client.close
                # Join the receive thread to ensure a clean exit (though it should break on socket close)
                receive_thread.join
                break
            end

            # Send the message to the server (must include a newline for server's `gets`)
            client.puts message

        rescue Interrupt
            # Handle Ctrl+C
            puts "\n[EXIT] Disconnecting from server..."
            client.close
            break
        rescue => e
            puts "\n[ERROR] Send error: #{e.message}"
            client.close
            break
        end
    end
end

# Main execution
if __FILE__ == $0
    start_client
end
