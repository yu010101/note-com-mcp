import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSuccessResponse, createErrorResponse } from "../utils/error-handler.js";
import { EditorialVoice } from "../types/analytics-types.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getVoicePath(): string {
  // プロジェクトルートの editorial-voice.json を参照
  // src/tools/ → src/ → project root
  return path.resolve(__dirname, "../../editorial-voice.json");
}

function readEditorialVoice(): EditorialVoice {
  const voicePath = getVoicePath();
  if (!fs.existsSync(voicePath)) {
    // デフォルト値を返す
    return {
      writingStyle: "丁寧だが親しみやすい",
      targetAudience: "20-40代のビジネスパーソン",
      brandVoice: "実践的で具体的",
      topicFocus: ["AI活用", "自動化", "生産性"],
      avoidTopics: [],
      toneKeywords: ["わかりやすい", "実践的", "前向き"],
      examplePhrases: ["具体的に言うと、", "実際にやってみると、"],
    };
  }
  const raw = fs.readFileSync(voicePath, "utf-8");
  return JSON.parse(raw) as EditorialVoice;
}

function writeEditorialVoice(voice: EditorialVoice): void {
  const voicePath = getVoicePath();
  const dir = path.dirname(voicePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(voicePath, JSON.stringify(voice, null, 2) + "\n", "utf-8");
}

export function registerVoiceTools(server: McpServer) {
  server.tool(
    "get-editorial-voice",
    "編集方針（ブランドボイス・ターゲット・トーン等）を取得する。記事作成や下書きレビュー時の品質基準として使用する。",
    {},
    async () => {
      try {
        const voice = readEditorialVoice();
        return createSuccessResponse(voice);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`編集方針の取得に失敗しました: ${message}`);
      }
    }
  );

  server.tool(
    "update-editorial-voice",
    "編集方針（ブランドボイス・ターゲット・トーン等）を部分更新する。指定したフィールドのみ上書きし、他は維持する。",
    {
      writingStyle: z.string().optional().describe("文章スタイル（例: 丁寧だが親しみやすい）"),
      targetAudience: z.string().optional().describe("ターゲット読者層"),
      brandVoice: z.string().optional().describe("ブランドの声のトーン"),
      topicFocus: z.array(z.string()).optional().describe("注力トピック一覧"),
      avoidTopics: z.array(z.string()).optional().describe("避けるトピック一覧"),
      toneKeywords: z.array(z.string()).optional().describe("トーンを表すキーワード"),
      examplePhrases: z.array(z.string()).optional().describe("例文フレーズ"),
    },
    async (updates) => {
      try {
        const current = readEditorialVoice();

        // 指定されたフィールドのみ上書き
        const updated: EditorialVoice = {
          writingStyle: updates.writingStyle ?? current.writingStyle,
          targetAudience: updates.targetAudience ?? current.targetAudience,
          brandVoice: updates.brandVoice ?? current.brandVoice,
          topicFocus: updates.topicFocus ?? current.topicFocus,
          avoidTopics: updates.avoidTopics ?? current.avoidTopics,
          toneKeywords: updates.toneKeywords ?? current.toneKeywords,
          examplePhrases: updates.examplePhrases ?? current.examplePhrases,
        };

        writeEditorialVoice(updated);
        return createSuccessResponse({ status: "updated", voice: updated });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`編集方針の更新に失敗しました: ${message}`);
      }
    }
  );
}
