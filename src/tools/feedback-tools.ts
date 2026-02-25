import { z } from "zod";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSuccessResponse, createErrorResponse } from "../utils/error-handler.js";
import { readJsonStore, appendToJsonArray } from "../utils/memory-store.js";
import { fetchAllStats, computeTrends } from "../utils/analytics-helpers.js";
import { MemoryEntry, PDCACycleEntry } from "../types/analytics-types.js";

const MEMORY_FILE = "memory-data.json";
const PDCA_FILE = "pdca-history.json";

export function registerFeedbackTools(server: McpServer) {
  // --- run-feedback-loop ---
  server.tool(
    "run-feedback-loop",
    "記憶＋PDCA履歴＋現状パフォーマンスを突合し、優先度付きの次アクションを自動提案する。結果は記憶に自動保存。",
    {
      dryRun: z
        .boolean()
        .default(false)
        .describe("trueでAPI呼び出しスキップ"),
    },
    async ({ dryRun }) => {
      try {
        // Step 1: 記憶取得
        const allMemories = readJsonStore<MemoryEntry[]>(MEMORY_FILE, []);
        const recentMemories = allMemories
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, 20);

        // 前回の判断を抽出
        const previousDecisions = recentMemories
          .filter((m) => m.type === "decision")
          .slice(0, 5)
          .map((m) => m.content);

        // Step 2: PDCA履歴取得
        const pdcaHistory = readJsonStore<PDCACycleEntry[]>(PDCA_FILE, []);
        const sortedPdca = [...pdcaHistory].sort(
          (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
        );
        const latestCycle = sortedPdca[0] ?? null;

        // 未消化のactItems
        const unfinishedActions: string[] = [];
        if (latestCycle) {
          for (const act of latestCycle.actItems) {
            // 記憶に対応する実行記録がなければ未消化
            const executed = recentMemories.some(
              (m) =>
                (m.type === "observation" || m.type === "reflection") &&
                (m.content.includes(act) || act.includes(m.content.slice(0, 20)))
            );
            if (!executed) {
              unfinishedActions.push(act);
            }
          }
        }

        // Step 3: 現状パフォーマンス
        let currentPerformance: { totalPV: number; risingCount: number; decliningCount: number } | null = null;
        const currentStrengths: string[] = [];
        const currentWeaknesses: string[] = [];

        if (!dryRun) {
          try {
            const [weekly, monthly, all] = await Promise.all([
              fetchAllStats("week"),
              fetchAllStats("month"),
              fetchAllStats("all"),
            ]);

            const weeklyMap = new Map(weekly.map((s) => [s.noteId, s.readCount]));
            const monthlyMap = new Map(monthly.map((s) => [s.noteId, s.readCount]));
            const allMap = new Map(
              all.map((s) => [s.noteId, { title: s.title, key: s.key, user: s.user, readCount: s.readCount }])
            );

            const trends = computeTrends(weeklyMap, monthlyMap, allMap);
            const totalPV = trends.reduce((s, t) => s + t.totalPV, 0);
            const risingCount = trends.filter((t) => t.trend === "rising").length;
            const decliningCount = trends.filter((t) => t.trend === "declining").length;

            currentPerformance = { totalPV, risingCount, decliningCount };

            // 強み・弱みの分析
            if (risingCount > 0) {
              const risingTitles = trends
                .filter((t) => t.trend === "rising")
                .sort((a, b) => b.weeklyPV - a.weeklyPV)
                .slice(0, 3)
                .map((t) => t.title);
              currentStrengths.push(`上昇トレンド記事: ${risingTitles.join("、")}`);
            }
            if (decliningCount > 3) {
              currentWeaknesses.push(`${decliningCount}記事が下降トレンド — リライトまたはSEO改善が必要`);
            }
            if (totalPV > 0 && trends.length > 0) {
              const avgPV = Math.round(totalPV / trends.length);
              if (avgPV > 100) {
                currentStrengths.push(`記事あたり平均PV ${avgPV} — 安定した集客力`);
              } else {
                currentWeaknesses.push(`記事あたり平均PV ${avgPV} — 集客力の向上が必要`);
              }
            }

            // PDCA比較による変化検出
            if (latestCycle && latestCycle.checkResult.totalPV > 0) {
              const pvChange = totalPV - latestCycle.checkResult.totalPV;
              if (pvChange > 0) {
                currentStrengths.push(`前回サイクル比でPV +${pvChange} の成長`);
              } else if (pvChange < 0) {
                currentWeaknesses.push(`前回サイクル比でPV ${pvChange} の減少`);
              }
            }
          } catch {
            // パフォーマンス取得失敗は続行（記憶＋PDCAのみで判断）
          }
        }

        // Step 4: アクション提案生成
        const nextActions: { priority: "high" | "medium" | "low"; action: string; reasoning: string }[] = [];

        // 高優先度: 未消化のactItems
        for (const item of unfinishedActions.slice(0, 2)) {
          nextActions.push({
            priority: "high",
            action: item,
            reasoning: "前回PDCAサイクルのactItemsで未消化",
          });
        }

        // 中優先度: 弱みへの対策
        for (const weakness of currentWeaknesses.slice(0, 2)) {
          nextActions.push({
            priority: "medium",
            action: weakness.includes("リライト")
              ? "下降トレンド記事のトップ3をリライト"
              : "集客力改善のためSEO最適化・ハッシュタグ戦略を見直し",
            reasoning: weakness,
          });
        }

        // 中優先度: 強みの活用
        if (currentStrengths.length > 0 && nextActions.length < 4) {
          nextActions.push({
            priority: "medium",
            action: "上昇トレンド記事のテーマで関連記事を新規作成",
            reasoning: currentStrengths[0],
          });
        }

        // 低優先度: デフォルトアクション
        if (nextActions.length < 3) {
          nextActions.push({
            priority: "low",
            action: "auto-generate-articleでデータ駆動の新テーマを生成",
            reasoning: "継続的なコンテンツ制作のため",
          });
        }

        // Step 5: 記憶保存
        let memoryRecorded: { id: string; timestamp: string } | null = null;
        try {
          const decisionContent = [
            "フィードバックループ分析結果:",
            `前回判断: ${previousDecisions.length}件参照`,
            `未消化アクション: ${unfinishedActions.length}件`,
            `次アクション: ${nextActions.map((a) => `[${a.priority}] ${a.action}`).join(" / ")}`,
          ].join("\n");

          const entry: MemoryEntry = {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            type: "decision",
            content: decisionContent,
            source: "run-feedback-loop",
            tags: ["feedback-loop", "decision"],
          };
          appendToJsonArray(MEMORY_FILE, entry);
          memoryRecorded = { id: entry.id, timestamp: entry.timestamp };
        } catch {
          // 記憶保存失敗は続行
        }

        return createSuccessResponse({
          executedAt: new Date().toISOString(),
          dryRun,
          context: {
            memoriesReviewed: recentMemories.length,
            pdcaCyclesReviewed: sortedPdca.length,
            currentPerformance,
          },
          analysis: {
            previousDecisions,
            unfinishedActions,
            currentStrengths,
            currentWeaknesses,
          },
          nextActions,
          memoryRecorded,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`フィードバックループの実行に失敗しました: ${message}`);
      }
    }
  );
}
