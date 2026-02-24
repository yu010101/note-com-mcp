import { z } from "zod";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSuccessResponse, createErrorResponse } from "../utils/error-handler.js";
import { readJsonStore, writeJsonStore, appendToJsonArray } from "../utils/memory-store.js";
import { MemoryEntry } from "../types/analytics-types.js";

const MEMORY_FILE = "memory-data.json";

export function registerMemoryTools(server: McpServer) {
  // --- record-memory ---
  server.tool(
    "record-memory",
    "記憶を記録する。ワークフロー実行後の気づき、パフォーマンス分析の洞察、クリエイターの判断などをセッション横断で蓄積する。",
    {
      type: z
        .enum(["observation", "insight", "decision", "reflection"])
        .describe("記憶の種別（observation: 観察, insight: 洞察, decision: 判断, reflection: 振り返り）"),
      content: z.string().describe("記憶の内容"),
      source: z.string().optional().describe("記憶の出典（ツール名やコンテキスト）"),
      tags: z.array(z.string()).optional().describe("分類タグ"),
    },
    async ({ type, content, source, tags }) => {
      try {
        const entry: MemoryEntry = {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          type,
          content,
          source: source ?? "manual",
          tags: tags ?? [],
        };
        appendToJsonArray(MEMORY_FILE, entry);
        return createSuccessResponse({
          status: "recorded",
          id: entry.id,
          timestamp: entry.timestamp,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`記憶の記録に失敗しました: ${message}`);
      }
    }
  );

  // --- get-memories ---
  server.tool(
    "get-memories",
    "蓄積された記憶を取得する。種別・出典・タグでフィルタリングし、新しい順に返す。過去の学びを参照して判断に活用する。",
    {
      type: z
        .enum(["observation", "insight", "decision", "reflection"])
        .optional()
        .describe("種別フィルタ"),
      source: z.string().optional().describe("出典フィルタ"),
      tag: z.string().optional().describe("タグフィルタ"),
      limit: z.number().optional().describe("取得件数上限（デフォルト: 20）"),
    },
    async ({ type, source, tag, limit }) => {
      try {
        const maxItems = limit ?? 20;
        let memories = readJsonStore<MemoryEntry[]>(MEMORY_FILE, []);

        if (type) {
          memories = memories.filter((m) => m.type === type);
        }
        if (source) {
          memories = memories.filter((m) => m.source === source);
        }
        if (tag) {
          memories = memories.filter((m) => m.tags.includes(tag));
        }

        // 新しい順にソート
        memories.sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

        const result = memories.slice(0, maxItems);
        return createSuccessResponse({
          totalCount: memories.length,
          returnedCount: result.length,
          memories: result,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`記憶の取得に失敗しました: ${message}`);
      }
    }
  );

  // --- get-success-patterns ---
  server.tool(
    "get-success-patterns",
    "成功パターンを抽出する。type=insightの記憶から「どんな記事が成功するか」のパターンを認識する。",
    {
      limit: z.number().optional().describe("取得件数上限（デフォルト: 10）"),
    },
    async ({ limit }) => {
      try {
        const maxItems = limit ?? 10;
        const memories = readJsonStore<MemoryEntry[]>(MEMORY_FILE, []);

        // insight タイプの記憶を抽出
        const insights = memories
          .filter((m) => m.type === "insight")
          .sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          )
          .slice(0, maxItems);

        // タグの出現頻度を集計
        const tagFrequency: Record<string, number> = {};
        for (const mem of insights) {
          for (const tag of mem.tags) {
            tagFrequency[tag] = (tagFrequency[tag] || 0) + 1;
          }
        }
        const topTags = Object.entries(tagFrequency)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([tag, count]) => ({ tag, count }));

        return createSuccessResponse({
          totalInsights: insights.length,
          patterns: insights.map((m) => ({
            content: m.content,
            tags: m.tags,
            source: m.source,
            recordedAt: m.timestamp,
          })),
          topTags,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`成功パターンの取得に失敗しました: ${message}`);
      }
    }
  );

  // --- clear-old-memories ---
  server.tool(
    "clear-old-memories",
    "古い記憶を削除して肥大化を防止する。指定日数より古いエントリを削除する。",
    {
      olderThanDays: z.number().optional().describe("この日数より古い記憶を削除（デフォルト: 90）"),
    },
    async ({ olderThanDays }) => {
      try {
        const days = olderThanDays ?? 90;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);

        const memories = readJsonStore<MemoryEntry[]>(MEMORY_FILE, []);
        const before = memories.length;
        const remaining = memories.filter(
          (m) => new Date(m.timestamp).getTime() >= cutoff.getTime()
        );
        const deleted = before - remaining.length;

        writeJsonStore(MEMORY_FILE, remaining);
        return createSuccessResponse({
          status: "cleaned",
          deletedCount: deleted,
          remainingCount: remaining.length,
          cutoffDate: cutoff.toISOString().split("T")[0],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`記憶のクリーンアップに失敗しました: ${message}`);
      }
    }
  );
}
