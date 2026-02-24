import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSuccessResponse, createErrorResponse } from "../utils/error-handler.js";
import { EditorialVoice } from "../types/analytics-types.js";
import { readEditorialVoice, writeEditorialVoice } from "../utils/voice-reader.js";

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
      // soul拡張フィールド
      personality: z.object({
        traits: z.array(z.string()),
        speakingStyle: z.array(z.string()),
        favorites: z.array(z.string()),
        dislikes: z.array(z.string()),
      }).optional().describe("パーソナリティ設定"),
      expertise: z.array(z.object({
        field: z.string(),
        level: z.enum(["beginner", "intermediate", "advanced", "expert"]),
        keywords: z.array(z.string()),
      })).optional().describe("専門分野設定"),
      values: z.object({
        coreBeliefs: z.array(z.string()),
        prohibitions: z.array(z.string()),
        guidelines: z.string(),
      }).optional().describe("価値観・禁則事項"),
      styleGuide: z.object({
        punctuation: z.string(),
        honorifics: z.string(),
        narrative: z.string(),
      }).optional().describe("文体ガイド"),
    },
    async (updates) => {
      try {
        const current = readEditorialVoice();

        // 指定されたフィールドのみ上書き（soul拡張含む）
        const updated: EditorialVoice = {
          writingStyle: updates.writingStyle ?? current.writingStyle,
          targetAudience: updates.targetAudience ?? current.targetAudience,
          brandVoice: updates.brandVoice ?? current.brandVoice,
          topicFocus: updates.topicFocus ?? current.topicFocus,
          avoidTopics: updates.avoidTopics ?? current.avoidTopics,
          toneKeywords: updates.toneKeywords ?? current.toneKeywords,
          examplePhrases: updates.examplePhrases ?? current.examplePhrases,
          personality: updates.personality ?? current.personality,
          expertise: updates.expertise ?? current.expertise,
          values: updates.values ?? current.values,
          styleGuide: updates.styleGuide ?? current.styleGuide,
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
