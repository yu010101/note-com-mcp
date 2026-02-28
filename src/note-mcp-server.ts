import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import http from "http";
import { randomUUID } from "crypto";
import { refreshSessionWithPlaywright } from "./utils/playwright-session.js";
import {
  getActiveSessionCookie,
  setActiveSessionCookie,
  setActiveXsrfToken,
} from "./utils/auth.js";
import { env } from "./config/environment.js";

// ツール・プロンプト登録
import { registerAllTools } from "./tools/index.js";
import { registerPrompts } from "./prompts/prompts.js";

// スケジューラ
import { setMcpBaseUrl, startAllSchedules, stopAllSchedules } from "./utils/scheduler.js";

// MCP サーバーインスタンスを作成
const server = new McpServer({
  name: "note-api",
  version: "2.2.0",
});

// すべてのツールとプロンプトを登録
registerAllTools(server);
registerPrompts(server);

async function main() {
  try {
    console.error("Starting note API MCP Server...");

    // 認証情報の取得: Playwrightで最新Cookieを取得
    if (env.NOTE_EMAIL && env.NOTE_PASSWORD) {
      console.error("Playwrightで最新のセッションCookieを取得します...");
      try {
        const result = await refreshSessionWithPlaywright({
          headless: true,
          navigationTimeoutMs: 45_000,
        });
        if (result.sessionCookie) setActiveSessionCookie(result.sessionCookie);
        if (result.xsrfToken) setActiveXsrfToken(result.xsrfToken);
        console.error("✅ 最新のセッションCookieを取得しました。");
      } catch (playwrightError: any) {
        console.error("⚠️ Playwright headlessログインに失敗:", playwrightError.message);
        // フォールバック: .envの既存Cookieがあればそれを使用
        if (env.NOTE_SESSION_V5) {
          console.error("フォールバック: .envの既存セッションCookieを使用します。");
          setActiveSessionCookie(`_note_session_v5=${env.NOTE_SESSION_V5}`);
          if (env.NOTE_XSRF_TOKEN) {
            setActiveXsrfToken(env.NOTE_XSRF_TOKEN);
          }
        } else {
          console.error("❌ セッション取得に失敗しました。認証が必要な機能は使用できません。");
        }
      }
    } else if (env.NOTE_SESSION_V5) {
      console.error("既存のセッションCookieを使用します（Playwright更新不可: メール/PW未設定）。");
      setActiveSessionCookie(`_note_session_v5=${env.NOTE_SESSION_V5}`);
      if (env.NOTE_XSRF_TOKEN) {
        setActiveXsrfToken(env.NOTE_XSRF_TOKEN);
      }
    } else {
      // 何もない場合、Playwrightで手動ログインを試行
      console.error("認証情報が設定されていません。Playwrightでブラウザログインを試行します...");
      try {
        const result = await refreshSessionWithPlaywright({
          headless: false,
          navigationTimeoutMs: 150_000,
        });
        if (result.sessionCookie) setActiveSessionCookie(result.sessionCookie);
        if (result.xsrfToken) setActiveXsrfToken(result.xsrfToken);
        console.error("✅ Playwrightでのログインに成功しました。");
      } catch (playwrightError: any) {
        console.error("❌ Playwrightログインエラー:", playwrightError.message);
      }
    }

    // 認証状態を表示
    const showAuthStatus = () => {
      if (getActiveSessionCookie()) {
        console.error("✅ 認証情報が設定されています。認証が必要な機能も利用できます。");
      } else {
        console.error("⚠️ 認証情報が設定されていません。読み取り機能のみ利用可能です。");
      }
    };

    // トランスポート切り替え: MCP_HTTP_PORT環境変数 or --httpフラグ → HTTPモード
    const useHttp = process.env.MCP_HTTP_PORT || process.argv.includes("--http");

    if (useHttp) {
      const PORT = parseInt(process.env.MCP_HTTP_PORT || "3000", 10);
      const HOST = process.env.MCP_HTTP_HOST || "127.0.0.1";
      const transports: Record<string, StreamableHTTPServerTransport> = {};

      const httpServer = http.createServer(async (req, res) => {
        // CORSヘッダー
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");
        res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        // ヘルスチェック
        if (req.url === "/health" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
          return;
        }

        if (req.url !== "/mcp") {
          res.writeHead(404);
          res.end("Not Found");
          return;
        }

        if (req.method === "POST") {
          // レガシークライアント互換: Acceptヘッダーがない場合は自動補完
          const accept = req.headers["accept"] || "";
          if (!accept.includes("text/event-stream") || !accept.includes("application/json")) {
            const correctAccept = "application/json, text/event-stream";
            req.headers["accept"] = correctAccept;
            const newRawHeaders: string[] = [];
            for (let i = 0; i < req.rawHeaders.length; i += 2) {
              if (req.rawHeaders[i].toLowerCase() !== "accept") {
                newRawHeaders.push(req.rawHeaders[i], req.rawHeaders[i + 1]);
              }
            }
            newRawHeaders.push("Accept", correctAccept);
            (req as any).rawHeaders = newRawHeaders;
          }

          const body = await new Promise<string>((resolve) => {
            let data = "";
            req.on("data", (chunk: Buffer) => {
              data += chunk.toString();
            });
            req.on("end", () => resolve(data));
          });

          let parsedBody: unknown;
          try {
            parsedBody = JSON.parse(body);
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32700, message: "Parse error" },
                id: null,
              })
            );
            return;
          }

          const sessionId = req.headers["mcp-session-id"] as string | undefined;

          try {
            if (sessionId && transports[sessionId]) {
              await transports[sessionId].handleRequest(req, res, parsedBody);
            } else if (!sessionId && isInitializeRequest(parsedBody)) {
              const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (sid: string) => {
                  transports[sid] = transport;
                },
              });
              transport.onclose = () => {
                const sid = transport.sessionId;
                if (sid && transports[sid]) {
                  delete transports[sid];
                }
              };
              await server.connect(transport);
              await transport.handleRequest(req, res, parsedBody);
            } else if (!sessionId) {
              // セッションなしの直接リクエスト（レガシークライアント互換）
              const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
              });
              res.on("close", () => {
                transport.close();
              });

              // レガシークライアント向け: SSEレスポンスをプレーンJSONに変換
              const responseChunks: Buffer[] = [];
              const origWriteHead = res.writeHead.bind(res);
              const origWrite = res.write.bind(res) as (...args: unknown[]) => boolean;
              const origEnd = res.end.bind(res) as (...args: unknown[]) => http.ServerResponse;
              const origFlushHeaders = res.flushHeaders.bind(res);
              let intercepting = false;
              let capturedStatusCode = 200;

              (res as any).writeHead = (
                statusCode: number,
                headers?: Record<string, string>
              ): http.ServerResponse => {
                capturedStatusCode = statusCode;
                const h = headers || {};
                const contentType = h["Content-Type"] || h["content-type"] || "";
                if (contentType === "text/event-stream") {
                  intercepting = true;
                  return res;
                }
                return origWriteHead(statusCode, h);
              };

              (res as any).flushHeaders = () => {
                if (intercepting) return;
                origFlushHeaders();
              };

              (res as any).write = (chunk: unknown, ...args: unknown[]): boolean => {
                if (intercepting) {
                  responseChunks.push(
                    Buffer.isBuffer(chunk)
                      ? chunk
                      : chunk instanceof Uint8Array
                        ? Buffer.from(chunk)
                        : Buffer.from(String(chunk))
                  );
                  return true;
                }
                return origWrite(chunk, ...args);
              };

              (res as any).end = (chunk?: unknown, ...args: unknown[]): http.ServerResponse => {
                if (intercepting) {
                  if (chunk) {
                    responseChunks.push(
                      Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
                    );
                  }
                  const body = Buffer.concat(responseChunks).toString("utf-8");
                  const dataLines = body
                    .split("\n")
                    .filter((line) => line.startsWith("data: "))
                    .map((line) => line.slice(6));
                  if (dataLines.length > 0) {
                    const jsonResponse = dataLines.join("");
                    origWriteHead(capturedStatusCode, {
                      "Content-Type": "application/json",
                    });
                    return origEnd(jsonResponse);
                  }
                  origWriteHead(capturedStatusCode, {
                    "Content-Type": "application/json",
                  });
                  return origEnd(body);
                }
                return origEnd(chunk, ...args);
              };

              await server.connect(transport);
              await transport.handleRequest(req, res, parsedBody);
            } else {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  jsonrpc: "2.0",
                  error: {
                    code: -32000,
                    message: "Bad Request: Invalid session ID",
                  },
                  id: null,
                })
              );
            }
          } catch (error) {
            console.error("Error handling MCP request:", error);
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  jsonrpc: "2.0",
                  error: { code: -32603, message: "Internal server error" },
                  id: null,
                })
              );
            }
          }
        } else if (req.method === "GET") {
          const sessionId = req.headers["mcp-session-id"] as string | undefined;
          if (!sessionId || !transports[sessionId]) {
            res.writeHead(400);
            res.end("Invalid or missing session ID");
            return;
          }
          await transports[sessionId].handleRequest(req, res);
        } else if (req.method === "DELETE") {
          const sessionId = req.headers["mcp-session-id"] as string | undefined;
          if (!sessionId || !transports[sessionId]) {
            res.writeHead(400);
            res.end("Invalid or missing session ID");
            return;
          }
          await transports[sessionId].handleRequest(req, res);
        } else {
          res.writeHead(405);
          res.end("Method not allowed");
        }
      });

      httpServer.listen(PORT, HOST, () => {
        console.error(
          `note API MCP Server is running on HTTP transport at http://${HOST}:${PORT}/mcp`
        );
        showAuthStatus();

        // 内蔵スケジューラを起動
        setMcpBaseUrl(`http://${HOST}:${PORT}`);
        const schedResult = startAllSchedules();
        if (schedResult.started > 0) {
          console.error(`✅ スケジューラ起動: ${schedResult.started}件のジョブを開始`);
        }
      });

      // グレースフルシャットダウン
      const shutdown = async () => {
        console.error("Shutting down HTTP server...");
        stopAllSchedules();
        for (const sid of Object.keys(transports)) {
          try {
            await transports[sid].close();
            delete transports[sid];
          } catch {
            // shutdown中のエラーは無視
          }
        }
        httpServer.close();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    } else {
      // STDIOモード（デフォルト）
      const transport = new StdioServerTransport();
      await server.connect(transport);
      console.error("note API MCP Server is running on stdio transport");
      showAuthStatus();
    }
  } catch (error) {
    console.error("Fatal error during server startup:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
