#!/bin/bash
export MCP_HTTP_PORT=3002
cd /Users/yu01/Desktop/note-com-mcp
exec node build/note-mcp-server.js
