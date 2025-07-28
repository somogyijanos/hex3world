#!/usr/bin/env python3
"""
Simple HTTP server to serve the Hex3World demo
"""

import http.server
import socketserver
import os
import sys
import socket

def find_free_port(start_port=8000):
    """Find a free port starting from start_port"""
    for port in range(start_port, start_port + 100):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('', port))
                return port
        except OSError:
            continue
    raise OSError("No free ports found")

def main():
    try:
        port = find_free_port(8000)
    except OSError:
        print("❌ Could not find a free port")
        sys.exit(1)
    
    # Change to the project directory
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    # Create server
    handler = http.server.SimpleHTTPRequestHandler
    
    # Add CORS headers for local development
    class CORSRequestHandler(handler):
        def do_GET(self):
            # Handle STL files with proper MIME type
            if self.path.endswith('.stl'):
                self.send_response(200)
                self.send_header('Content-type', 'application/octet-stream')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                
                try:
                    with open(self.path[1:], 'rb') as f:  # Remove leading slash
                        self.wfile.write(f.read())
                except FileNotFoundError:
                    self.send_error(404)
                return
            
            # Default handling for other files
            super().do_GET()
            
        def end_headers(self):
            self.send_header('Access-Control-Allow-Origin', '*')
            super().end_headers()
    
    # Allow socket reuse
    socketserver.TCPServer.allow_reuse_address = True
    
    with socketserver.TCPServer(("", port), CORSRequestHandler) as httpd:
        print(f"🌍 Serving Hex3World demo at http://localhost:{port}")
        print(f"📁 Serving from: {os.getcwd()}")
        print(f"🎮 Open http://localhost:{port}/demo.html in your browser")
        print("Press Ctrl+C to stop the server")
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n👋 Server stopped")
            sys.exit(0)

if __name__ == "__main__":
    main()