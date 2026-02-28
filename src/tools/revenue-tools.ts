import { z } from "zod";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSuccessResponse, createErrorResponse } from "../utils/error-handler.js";
import { readJsonStore, appendToJsonArray } from "../utils/memory-store.js";
import { readEditorialVoice } from "../utils/voice-reader.js";
import { fetchAllStats, computeTrends, categorizeArticles } from "../utils/analytics-helpers.js";
import { noteApiRequest } from "../utils/api-client.js";
import { env } from "../config/environment.js";
import { MemoryEntry, PDCACycleEntry, WorkflowStepResult } from "../types/analytics-types.js";

const MEMORY_FILE = "memory-data.json";
const PDCA_FILE = "pdca-history.json";

export function registerRevenueTools(server: McpServer) {
  // --- analyze-revenue ---
  server.tool(
    "analyze-revenue",
    "有料記事と無料記事のパフォーマンスを比較分析する。価格帯別のPV分布、有料化の効果、価格最適化の提案を行う。",
    {
      period: z
        .enum(["week", "month", "all"])
        .default("month")
        .describe("分析期間"),
    },
    async ({ period }) => {
      try {
        // PVデータ取得
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

        // 記事詳細を取得して有料/無料を判定
        let paidArticles: { title: string; pv: number; price: number; url: string }[] = [];
        let freeArticles: { title: string; pv: number; url: string }[] = [];

        // ユーザーの記事一覧を取得
        try {
          const userArticlesData = await noteApiRequest(
            `/v2/creators/${encodeURIComponent(env.NOTE_USER_ID)}/contents?kind=note&page=1`,
          );
          const contents = userArticlesData?.data?.contents || [];

          if (Array.isArray(contents)) {
            for (const article of contents) {
              const noteId = String(article.id || "");
              const trendData = trends.find((t) => t.articleId === noteId);
              const pv = trendData?.totalPV ?? 0;
              const url = trendData?.url ?? `https://note.com/${env.NOTE_USER_ID}/n/${article.key || ""}`;

              const price = article.price || 0;
              const isFree = price === 0 || article.is_free === true;

              if (isFree) {
                freeArticles.push({ title: article.name || article.title || "", pv, url });
              } else {
                paidArticles.push({ title: article.name || article.title || "", pv, price, url });
              }
            }
          }
        } catch {
          // 記事一覧取得失敗時はPVデータのみで分析
        }

        // 統計
        const totalPV = trends.reduce((s, t) => s + t.totalPV, 0);
        const paidTotalPV = paidArticles.reduce((s, a) => s + a.pv, 0);
        const freeTotalPV = freeArticles.reduce((s, a) => s + a.pv, 0);

        const paidAvgPV = paidArticles.length > 0 ? Math.round(paidTotalPV / paidArticles.length) : 0;
        const freeAvgPV = freeArticles.length > 0 ? Math.round(freeTotalPV / freeArticles.length) : 0;

        // 価格帯分析
        const priceRanges = {
          free: { count: freeArticles.length, avgPV: freeAvgPV },
          low: { count: 0, avgPV: 0, range: "100-500円" },
          mid: { count: 0, avgPV: 0, range: "500-1000円" },
          high: { count: 0, avgPV: 0, range: "1000円以上" },
        };

        const lowPriced = paidArticles.filter((a) => a.price <= 500);
        const midPriced = paidArticles.filter((a) => a.price > 500 && a.price <= 1000);
        const highPriced = paidArticles.filter((a) => a.price > 1000);

        priceRanges.low.count = lowPriced.length;
        priceRanges.low.avgPV = lowPriced.length > 0
          ? Math.round(lowPriced.reduce((s, a) => s + a.pv, 0) / lowPriced.length)
          : 0;
        priceRanges.mid.count = midPriced.length;
        priceRanges.mid.avgPV = midPriced.length > 0
          ? Math.round(midPriced.reduce((s, a) => s + a.pv, 0) / midPriced.length)
          : 0;
        priceRanges.high.count = highPriced.length;
        priceRanges.high.avgPV = highPriced.length > 0
          ? Math.round(highPriced.reduce((s, a) => s + a.pv, 0) / highPriced.length)
          : 0;

        // 提案生成
        const suggestions: string[] = [];

        if (freeArticles.length > 0 && paidArticles.length === 0) {
          suggestions.push("有料記事がまだありません。PVが高い無料記事をベースに有料版を検討してください。");
          // PV上位の無料記事を有料化候補として提案
          const topFree = [...freeArticles].sort((a, b) => b.pv - a.pv).slice(0, 3);
          for (const article of topFree) {
            suggestions.push(`有料化候補: 「${article.title}」（PV: ${article.pv}）— 深掘り版を有料で提供`);
          }
        }

        if (paidAvgPV > freeAvgPV) {
          suggestions.push("有料記事のPVが無料記事を上回っています。有料コンテンツへの需要が高いです。");
        } else if (paidArticles.length > 0) {
          suggestions.push("無料記事の方がPVが高い傾向です。無料→有料への導線を強化してください。");
        }

        if (lowPriced.length > 0 && midPriced.length === 0) {
          suggestions.push("低価格帯のみです。価値の高いコンテンツは500-1000円帯でのテストを推奨。");
        }

        // 上昇トレンド記事の有料化提案
        const risingFree = trends
          .filter((t) => t.trend === "rising")
          .filter((t) => freeArticles.some((f) => f.url === t.url));
        if (risingFree.length > 0) {
          suggestions.push(
            `上昇トレンドの無料記事「${risingFree[0].title}」の深掘り版を有料で提供すると効果的`
          );
        }

        return createSuccessResponse({
          analyzedAt: new Date().toISOString(),
          period,
          overview: {
            totalArticles: trends.length,
            totalPV,
            paidArticles: paidArticles.length,
            freeArticles: freeArticles.length,
            paidTotalPV,
            freeTotalPV,
            paidAvgPV,
            freeAvgPV,
          },
          priceRanges,
          topPaidArticles: [...paidArticles].sort((a, b) => b.pv - a.pv).slice(0, 5),
          topFreeArticles: [...freeArticles].sort((a, b) => b.pv - a.pv).slice(0, 5),
          suggestions,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`収益分析に失敗しました: ${message}`);
      }
    }
  );

  // --- run-monetization-workflow ---
  server.tool(
    "run-monetization-workflow",
    "収益分析→宣伝戦略→テキスト生成の統合ワークフローを実行する。マネタイズの全体最適化を1コマンドで行う。",
    {
      dryRun: z
        .boolean()
        .default(false)
        .describe("trueでAPI呼び出しスキップ"),
    },
    async ({ dryRun }) => {
      try {
        const steps: WorkflowStepResult[] = [];

        // Step 1: 収益分析
        if (dryRun) {
          steps.push({ step: "収益分析", status: "skipped", data: "dryRun: スキップ" });
        } else {
          try {
            const allStats = await fetchAllStats("month");
            const totalPV = allStats.reduce((s, n) => s + n.readCount, 0);

            // 記事一覧取得
            let paidCount = 0;
            let freeCount = 0;
            try {
              const userArticles = await noteApiRequest(
                `/v2/creators/${encodeURIComponent(env.NOTE_USER_ID)}/contents?kind=note&page=1`,
              );
              const contents = userArticles?.data?.contents || [];
              if (Array.isArray(contents)) {
                for (const c of contents) {
                  if (c.price && c.price > 0) paidCount++;
                  else freeCount++;
                }
              }
            } catch {
              // 無視
            }

            steps.push({
              step: "収益分析",
              status: "success",
              data: {
                totalArticles: allStats.length,
                totalMonthlyPV: totalPV,
                paidArticles: paidCount,
                freeArticles: freeCount,
              },
            });
          } catch (e) {
            steps.push({ step: "収益分析", status: "error", error: String(e) });
          }
        }

        // Step 2: 宣伝候補選定
        if (dryRun) {
          steps.push({ step: "宣伝候補選定", status: "skipped", data: "dryRun: スキップ" });
        } else {
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
            const { risingArticles, topArticles } = categorizeArticles(trends, 3);

            const candidates = [
              ...risingArticles.map((a) => ({ title: a.title, url: a.url, reason: "上昇トレンド" })),
              ...topArticles.slice(0, 2).map((a) => ({ title: a.title, url: a.url, reason: "高PV" })),
            ];

            steps.push({
              step: "宣伝候補選定",
              status: "success",
              data: { candidates: candidates.slice(0, 5) },
            });
          } catch (e) {
            steps.push({ step: "宣伝候補選定", status: "error", error: String(e) });
          }
        }

        // Step 3: 編集方針確認
        try {
          const voice = readEditorialVoice();
          steps.push({
            step: "編集方針確認",
            status: "success",
            data: {
              targetAudience: voice.targetAudience,
              topicFocus: voice.topicFocus,
            },
          });
        } catch (e) {
          steps.push({ step: "編集方針確認", status: "error", error: String(e) });
        }

        // Step 4: アクション提案
        const actions: string[] = [
          "analyze-revenueで有料/無料記事の詳細比較を確認",
          "suggest-promotion-strategyでSNS宣伝候補を確認",
          "generate-promotionで宣伝テキストを生成",
          "cross-postでTwitterに投稿",
        ];

        steps.push({
          step: "アクション提案",
          status: "success",
          data: { nextActions: actions },
        });

        // 記憶に記録
        try {
          const entry: MemoryEntry = {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            type: "observation",
            content: `マネタイズワークフロー実行: ${steps.filter((s) => s.status === "success").length}/${steps.length}ステップ成功`,
            source: "run-monetization-workflow",
            tags: ["monetization", "workflow"],
          };
          appendToJsonArray(MEMORY_FILE, entry);
        } catch {
          // 記憶保存失敗は無視
        }

        return createSuccessResponse({
          executedAt: new Date().toISOString(),
          dryRun,
          steps,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`マネタイズワークフローに失敗しました: ${message}`);
      }
    }
  );

  // --- dashboard-summary ---
  server.tool(
    "dashboard-summary",
    "noteアカウントの統合ダッシュボード。PV推移・成長率・トレンド記事・SNS状況・PDCA進捗・記憶数をまとめて1画面で確認。",
    {},
    async () => {
      try {
        // PVデータ取得
        const [weekly, monthly, all] = await Promise.all([
          fetchAllStats("week"),
          fetchAllStats("month"),
          fetchAllStats("all"),
        ]);

        const weeklyTotalPV = weekly.reduce((s, n) => s + n.readCount, 0);
        const monthlyTotalPV = monthly.reduce((s, n) => s + n.readCount, 0);
        const allTotalPV = all.reduce((s, n) => s + n.readCount, 0);

        // トレンド分析
        const weeklyMap = new Map(weekly.map((s) => [s.noteId, s.readCount]));
        const monthlyMap = new Map(monthly.map((s) => [s.noteId, s.readCount]));
        const allMap = new Map(
          all.map((s) => [s.noteId, { title: s.title, key: s.key, user: s.user, readCount: s.readCount }])
        );
        const trends = computeTrends(weeklyMap, monthlyMap, allMap);
        const { topArticles, risingArticles, decliningArticles } = categorizeArticles(trends, 5);

        // 記事数・有料/無料内訳
        let totalArticles = 0;
        let paidCount = 0;
        let freeCount = 0;
        let followerCount: number | null = null;
        try {
          const userArticles = await noteApiRequest(
            `/v2/creators/${encodeURIComponent(env.NOTE_USER_ID)}/contents?kind=note&page=1`,
          );
          const contents = userArticles?.data?.contents || [];
          totalArticles = userArticles?.data?.totalCount ?? contents.length;
          if (Array.isArray(contents)) {
            for (const c of contents) {
              if (c.price && c.price > 0) paidCount++;
              else freeCount++;
            }
          }
        } catch { /* 無視 */ }

        // フォロワー数
        try {
          const userData = await noteApiRequest(
            `/v2/creators/${encodeURIComponent(env.NOTE_USER_ID)}`,
          );
          followerCount = userData?.data?.followerCount ?? null;
        } catch { /* 無視 */ }

        // PDCA履歴
        const pdcaHistory = readJsonStore<PDCACycleEntry[]>(PDCA_FILE, []);
        const latestPdca = pdcaHistory.length > 0 ? pdcaHistory[pdcaHistory.length - 1] : null;

        // 記憶統計
        const memories = readJsonStore<MemoryEntry[]>(MEMORY_FILE, []);
        const recentMemories = memories.slice(-5);
        const crossPostSuccesses = memories.filter(
          (m) => m.tags.includes("cross-post") && m.tags.includes("success")
        ).length;

        // 成長率計算（週間PV÷月間PV×4 で月間ペースを推定）
        const weeklyPace = weeklyTotalPV * 4;
        const growthRate =
          monthlyTotalPV > 0
            ? Math.round(((weeklyPace - monthlyTotalPV) / monthlyTotalPV) * 100)
            : 0;

        // SNS設定状況
        const snsStatus = {
          twitter: Boolean(env.TWITTER_API_KEY && env.TWITTER_ACCESS_TOKEN),
          threads: Boolean(env.THREADS_ACCESS_TOKEN && env.THREADS_USER_ID),
          webhook: Boolean(env.SNS_WEBHOOK_URL || env.WEBHOOK_URL),
        };

        return createSuccessResponse({
          generatedAt: new Date().toISOString(),
          account: {
            userId: env.NOTE_USER_ID,
            totalArticles,
            paidArticles: paidCount,
            freeArticles: freeCount,
            followerCount,
          },
          pvSummary: {
            weekly: weeklyTotalPV,
            monthly: monthlyTotalPV,
            allTime: allTotalPV,
            weeklyGrowthRate: `${growthRate > 0 ? "+" : ""}${growthRate}%`,
            avgPVPerArticle: totalArticles > 0 ? Math.round(allTotalPV / totalArticles) : 0,
          },
          trendingArticles: {
            rising: risingArticles.slice(0, 3).map((a) => ({
              title: a.title,
              weeklyPV: a.weeklyPV,
              url: a.url,
            })),
            top: topArticles.slice(0, 3).map((a) => ({
              title: a.title,
              totalPV: a.totalPV,
              url: a.url,
            })),
            declining: decliningArticles.slice(0, 3).map((a) => ({
              title: a.title,
              weeklyPV: a.weeklyPV,
              url: a.url,
            })),
          },
          pdca: latestPdca
            ? {
                lastCycleDate: latestPdca.completedAt,
                period: latestPdca.period,
                actItems: latestPdca.actItems,
                totalCycles: pdcaHistory.length,
              }
            : { message: "PDCAサイクル未実施", totalCycles: 0 },
          memory: {
            totalEntries: memories.length,
            recentInsights: recentMemories
              .filter((m) => m.type === "insight")
              .map((m) => m.content)
              .slice(0, 3),
            crossPostSuccesses,
          },
          snsStatus,
          quickActions: [
            risingArticles.length > 0
              ? `「${risingArticles[0].title}」をSNSで拡散（上昇トレンド）`
              : "新しい記事を作成して公開する",
            latestPdca
              ? "compare-pdca-cyclesで前回との比較を確認"
              : "record-pdca-cycleで初回PDCAサイクルを記録",
            growthRate < 0
              ? "run-feedback-loopでPV低下の原因を分析"
              : "auto-generate-articleでデータ駆動のテーマ生成",
          ],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`ダッシュボード生成に失敗しました: ${message}`);
      }
    }
  );
}
