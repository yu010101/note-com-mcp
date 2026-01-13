#!/usr/bin/env node

import { createServer } from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllTools } from "./tools/index.js";
import { loginToNote } from "./utils/auth.js";
import { noteApiRequest } from "./utils/api-client.js";

// ツールリストを取得
async function getToolsList() {
  return {
    tools: [
      {
        name: "search-notes",
        description: "note.comの記事を検索",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "検索キーワード" },
          },
        },
      },
      {
        name: "post-draft-note",
        description: "下書き記事を作成・更新",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "記事タイトル" },
            content: { type: "string", description: "記事内容" },
          },
        },
      },
    ],
  };
}

const HOST = "localhost";
const PORT = 3001;

// n8n用のシンプルなHTTP MCPサーバー
async function startN8nServer() {
  console.error("🚀 n8n用MCPサーバーを起動します...");

  // MCPサーバーを作成
  const server = new McpServer(
    {
      name: "note-api-mcp-n8n",
      version: "2.0.0-n8n",
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
        resources: {},
      },
    }
  );

  // 認証
  try {
    await loginToNote();
    console.error("✅ 認証成功");
  } catch (error) {
    console.error("❌ 認証失敗:", error);
  }

  // ツールを登録
  await registerAllTools(server);

  // HTTPサーバーを作成
  const httpServer = createServer(async (req, res) => {
    // Healthエンドポイント
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          server: "note-api-mcp-n8n",
          version: "2.0.0-n8n",
          transport: "HTTP-JSON-RPC",
          endpoint: `/mcp`,
        })
      );
      return;
    }

    // CORSヘッダー
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    if (!req.url?.startsWith("/mcp")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    try {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });

      req.on("end", async () => {
        try {
          const message = JSON.parse(body);
          console.error("📨 n8nリクエスト:", message.method);

          // 簡易的なJSON-RPC処理
          let response;

          if (message.method === "initialize") {
            response = {
              jsonrpc: "2.0",
              id: message.id,
              result: {
                protocolVersion: "2025-06-18",
                capabilities: {
                  tools: {},
                  prompts: {},
                  resources: {},
                },
                serverInfo: {
                  name: "note-api-mcp-n8n",
                  version: "2.0.0-n8n",
                },
              },
            };
          } else if (message.method === "tools/list") {
            const toolsList = await getToolsList();
            response = {
              jsonrpc: "2.0",
              id: message.id,
              result: toolsList,
            };
          } else if (message.method?.startsWith("tools/")) {
            const toolName = message.method.replace("tools/", "");
            try {
              // ツールを直接実行する簡易的な実装
              const tools = await getToolsList();
              const tool = tools.tools?.find((t: any) => t.name === toolName);

              if (!tool) {
                response = {
                  jsonrpc: "2.0",
                  id: message.id,
                  error: {
                    code: -32601,
                    message: `Tool ${toolName} not found`,
                  },
                };
              } else {
                // 簡易的なレスポンス（実際のツール実装は別途必要）
                response = {
                  jsonrpc: "2.0",
                  id: message.id,
                  result: {
                    content: [
                      {
                        type: "text",
                        text: `Tool ${toolName} executed with args: ${JSON.stringify(message.params?.arguments || {})}`,
                      },
                    ],
                  },
                };
              }
            } catch (error) {
              response = {
                jsonrpc: "2.0",
                id: message.id,
                error: {
                  code: -32603,
                  message: error instanceof Error ? error.message : "Unknown error",
                  data: error,
                },
              };
            }
          } else {
            response = {
              jsonrpc: "2.0",
              id: message.id,
              error: {
                code: -32601,
                message: "Method not found",
              },
            };
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(response));
          console.error("✅ n8nレスポンス送信:", message.method);
        } catch (error) {
          console.error("❌ JSON-RPC処理エラー:", error);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: {
                code: -32603,
                message: "Internal error",
                data: error instanceof Error ? error.message : "Unknown error",
              },
            })
          );
        }
      });
    } catch (error) {
      console.error("❌ リクエスト処理エラー:", error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Internal server error",
          details: error instanceof Error ? error.message : "Unknown error",
        })
      );
    }
  });

  httpServer.listen(PORT, HOST, () => {
    console.error(`🌐 n8n用MCPサーバーが起動しました:`);
    console.error(`   URL: http://${HOST}:${PORT}/mcp`);
    console.error(`   Health: http://${HOST}:${PORT}/health`);
  });
}

startN8nServer().catch(console.error);
