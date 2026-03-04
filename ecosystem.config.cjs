module.exports = {
  apps: [
    {
      name: "note-com-mcp",
      script: "build/note-mcp-server.js",
      cwd: "/Users/yu01/Desktop/note-com-mcp",
      env: {
        MCP_HTTP_PORT: "3002",
      },
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
