import { z } from "zod";
import fetch from "node-fetch";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSuccessResponse, createErrorResponse } from "../utils/error-handler.js";
import { env } from "../config/environment.js";

export function registerNotificationTools(server: McpServer) {
  server.tool(
    "send-report",
    "レポートをWebhook経由で外部サービス（Slack, Discord, Telegram等）に送信する。",
    {
      title: z.string().describe("レポートのタイトル"),
      body: z.string().describe("レポートの本文（Markdown可）"),
      webhookUrl: z
        .string()
        .optional()
        .describe("送信先WebhookのURL（省略時は環境変数WEBHOOK_URLを使用）"),
      format: z
        .enum(["slack", "discord", "telegram", "generic"])
        .default("generic")
        .describe("送信フォーマット（slack, discord, telegram, generic）"),
    },
    async ({ title, body, webhookUrl, format }) => {
      try {
        const url = webhookUrl || env.WEBHOOK_URL;
        if (!url && format !== "telegram") {
          return createErrorResponse(
            "Webhook URLが設定されていません。webhookUrlパラメータを指定するか、環境変数WEBHOOK_URLを設定してください。"
          );
        }

        let payload: any;
        let targetUrl = url || "";
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };

        switch (format) {
          case "slack":
            payload = {
              text: `*${title}*\n${body}`,
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `*${title}*\n\n${body}`,
                  },
                },
              ],
            };
            break;

          case "discord":
            payload = {
              content: title,
              embeds: [
                {
                  title,
                  description: body.slice(0, 4096),
                },
              ],
            };
            break;

          case "telegram": {
            const botToken = env.TELEGRAM_BOT_TOKEN;
            const chatId = env.TELEGRAM_CHAT_ID;
            if (!botToken || !chatId) {
              return createErrorResponse(
                "Telegram設定が不足しています。環境変数TELEGRAM_BOT_TOKENとTELEGRAM_CHAT_IDを設定してください。"
              );
            }
            targetUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
            payload = {
              chat_id: chatId,
              text: `*${title}*\n\n${body}`,
              parse_mode: "Markdown",
            };
            break;
          }

          case "generic":
          default:
            payload = { title, body };
            break;
        }

        const response = await fetch(targetUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          return createErrorResponse(
            `Webhook送信に失敗しました: ${response.status} ${response.statusText} - ${errorText}`
          );
        }

        return createSuccessResponse({
          status: "sent",
          format,
          title,
          targetUrl: format === "telegram" ? "Telegram API" : targetUrl,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`レポート送信に失敗しました: ${message}`);
      }
    }
  );
}
