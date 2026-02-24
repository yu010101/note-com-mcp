import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// ESMでの__dirnameの代替
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 環境変数を読み込む（ビルドディレクトリを考慮）
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

export interface Environment {
  DEBUG: boolean;
  NOTE_SESSION_V5: string;
  NOTE_XSRF_TOKEN: string;
  NOTE_GQL_AUTH_TOKEN: string;
  NOTE_EMAIL: string;
  NOTE_PASSWORD: string;
  NOTE_USER_ID: string;
  MCP_HTTP_PORT?: string;
  MCP_HTTP_HOST?: string;
  NOTION_TOKEN: string;
  WEBHOOK_URL: string;
  WEBHOOK_FORMAT: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}

export const env: Environment = {
  DEBUG: process.env.DEBUG === "true",
  NOTE_SESSION_V5: process.env.NOTE_SESSION_V5 || "",
  NOTE_XSRF_TOKEN: process.env.NOTE_XSRF_TOKEN || "",
  NOTE_GQL_AUTH_TOKEN: process.env.NOTE_GQL_AUTH_TOKEN || "",
  NOTE_EMAIL: process.env.NOTE_EMAIL || "",
  NOTE_PASSWORD: process.env.NOTE_PASSWORD || "",
  NOTE_USER_ID: process.env.NOTE_USER_ID || "",
  MCP_HTTP_PORT: process.env.MCP_HTTP_PORT || "3000",
  MCP_HTTP_HOST: process.env.MCP_HTTP_HOST || "127.0.0.1",
  NOTION_TOKEN: process.env.NOTION_TOKEN || "",
  WEBHOOK_URL: process.env.WEBHOOK_URL || "",
  WEBHOOK_FORMAT: process.env.WEBHOOK_FORMAT || "generic",
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || "",
};

// 認証状態の判定
export const authStatus = {
  hasCookie: env.NOTE_SESSION_V5 !== "" || env.NOTE_XSRF_TOKEN !== "",
  hasGqlToken: env.NOTE_GQL_AUTH_TOKEN !== "",
  anyAuth:
    env.NOTE_SESSION_V5 !== "" ||
    env.NOTE_XSRF_TOKEN !== "" ||
    env.NOTE_GQL_AUTH_TOKEN !== "" ||
    (env.NOTE_EMAIL !== "" && env.NOTE_PASSWORD !== ""),
};

// デバッグログ
if (env.DEBUG) {
  console.error(`Working directory: ${process.cwd()}`);
  console.error(`Script directory: ${__dirname}`);
  console.error(`Authentication status: Cookie=${authStatus.hasCookie}`);
}
