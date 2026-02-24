import { z } from "zod";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSuccessResponse, createErrorResponse } from "../utils/error-handler.js";
import { readJsonStore, appendToJsonArray } from "../utils/memory-store.js";
import { fetchAllStats, computeTrends, categorizeArticles } from "../utils/analytics-helpers.js";
import { PDCACycleEntry } from "../types/analytics-types.js";

const PDCA_FILE = "pdca-history.json";

export function registerPdcaTools(server: McpServer) {
  // --- record-pdca-cycle ---
  server.tool(
    "record-pdca-cycle",
    "PDCAサイクルを記録する。Plan/Doを入力し、Checkはパフォーマンスデータから自動取得、Actは改善アイテムとして記録する。",
    {
      period: z.enum(["week", "month"]).describe("サイクル期間"),
      plan: z.array(z.string()).describe("Plan: 計画した施策リスト"),
      doActions: z.array(z.string()).describe("Do: 実行した内容リスト"),
      actItems: z.array(z.string()).describe("Act: 次サイクルへの改善アイテム"),
    },
    async ({ period, plan, doActions, actItems }) => {
      try {
        // Check: パフォーマンスデータを自動取得
        const [weekly, monthly, all] = await Promise.all([
          fetchAllStats("week"),
          fetchAllStats("month"),
          fetchAllStats("all"),
        ]);

        const weeklyMap = new Map(weekly.map((s) => [s.noteId, s.readCount]));
        const monthlyMap = new Map(monthly.map((s) => [s.noteId, s.readCount]));
        const allMap = new Map(
          all.map((s) => [
            s.noteId,
            { title: s.title, key: s.key, user: s.user, readCount: s.readCount },
          ])
        );

        const trends = computeTrends(weeklyMap, monthlyMap, allMap);
        const { topArticles } = categorizeArticles(trends, 5);

        const totalPV = trends.reduce((s, t) => s + t.totalPV, 0);
        const averagePV = trends.length > 0 ? Math.round(totalPV / trends.length) : 0;

        const now = new Date();
        const startDate = new Date(now);
        startDate.setDate(startDate.getDate() - (period === "week" ? 7 : 30));

        const entry: PDCACycleEntry = {
          cycleId: randomUUID(),
          startDate: startDate.toISOString().split("T")[0],
          endDate: now.toISOString().split("T")[0],
          period,
          plan,
          doActions,
          checkResult: {
            totalPV,
            averagePV,
            risingCount: trends.filter((t) => t.trend === "rising").length,
            decliningCount: trends.filter((t) => t.trend === "declining").length,
            topArticles: topArticles.slice(0, 5).map((a) => ({
              title: a.title,
              pv: a.totalPV,
            })),
          },
          actItems,
          completedAt: now.toISOString(),
        };

        appendToJsonArray(PDCA_FILE, entry);
        return createSuccessResponse({
          status: "recorded",
          cycleId: entry.cycleId,
          period: entry.period,
          dateRange: `${entry.startDate} 〜 ${entry.endDate}`,
          checkResult: entry.checkResult,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`PDCAサイクルの記録に失敗しました: ${message}`);
      }
    }
  );

  // --- get-pdca-history ---
  server.tool(
    "get-pdca-history",
    "PDCAサイクルの履歴を取得する。新しい順に返却し、期間でフィルタリング可能。",
    {
      limit: z.number().optional().describe("取得件数上限（デフォルト: 10）"),
      period: z.enum(["week", "month"]).optional().describe("期間フィルタ"),
    },
    async ({ limit, period }) => {
      try {
        const maxItems = limit ?? 10;
        let history = readJsonStore<PDCACycleEntry[]>(PDCA_FILE, []);

        if (period) {
          history = history.filter((h) => h.period === period);
        }

        // 新しい順にソート
        history.sort(
          (a, b) =>
            new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
        );

        const result = history.slice(0, maxItems);
        return createSuccessResponse({
          totalCount: history.length,
          returnedCount: result.length,
          cycles: result,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`PDCA履歴の取得に失敗しました: ${message}`);
      }
    }
  );

  // --- compare-pdca-cycles ---
  server.tool(
    "compare-pdca-cycles",
    "直近2つのPDCAサイクルを自動比較する。PV変化率、上昇/下降記事数の差分、改善効果を算出する。",
    {},
    async () => {
      try {
        const history = readJsonStore<PDCACycleEntry[]>(PDCA_FILE, []);

        // 新しい順にソートして直近2件
        history.sort(
          (a, b) =>
            new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
        );

        if (history.length < 2) {
          return createSuccessResponse({
            status: "insufficient_data",
            message:
              "比較には最低2サイクルの履歴が必要です。record-pdca-cycleでサイクルを記録してください。",
            availableCycles: history.length,
          });
        }

        const current = history[0];
        const previous = history[1];

        const pvChange = current.checkResult.totalPV - previous.checkResult.totalPV;
        const pvChangePercent =
          previous.checkResult.totalPV > 0
            ? Math.round((pvChange / previous.checkResult.totalPV) * 100 * 10) / 10
            : 0;

        const risingDelta =
          current.checkResult.risingCount - previous.checkResult.risingCount;
        const decliningDelta =
          current.checkResult.decliningCount - previous.checkResult.decliningCount;

        // 前回のactItemsが今回のplanに反映されているか評価
        const improvements: string[] = [];
        for (const actItem of previous.actItems) {
          const reflected = current.plan.some(
            (p) => p.includes(actItem) || actItem.includes(p)
          );
          if (reflected) {
            improvements.push(`✓ 「${actItem}」→ 今回のPlanに反映済み`);
          } else {
            improvements.push(`○ 「${actItem}」→ 未反映（次回検討）`);
          }
        }

        return createSuccessResponse({
          previousCycle: {
            cycleId: previous.cycleId,
            period: previous.period,
            dateRange: `${previous.startDate} 〜 ${previous.endDate}`,
            checkResult: previous.checkResult,
            actItems: previous.actItems,
          },
          currentCycle: {
            cycleId: current.cycleId,
            period: current.period,
            dateRange: `${current.startDate} 〜 ${current.endDate}`,
            checkResult: current.checkResult,
            actItems: current.actItems,
          },
          comparison: {
            pvChange,
            pvChangePercent,
            risingDelta,
            decliningDelta,
            improvements,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`PDCAサイクル比較に失敗しました: ${message}`);
      }
    }
  );
}
