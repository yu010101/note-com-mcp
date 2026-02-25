import { z } from "zod";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSuccessResponse, createErrorResponse } from "../utils/error-handler.js";
import { readJsonStore, appendToJsonArray } from "../utils/memory-store.js";
import { readEditorialVoice } from "../utils/voice-reader.js";
import { fetchAllStats, computeTrends, categorizeArticles } from "../utils/analytics-helpers.js";
import { noteApiRequest } from "../utils/api-client.js";
import { MemoryEntry, PDCACycleEntry, WorkflowStepResult } from "../types/analytics-types.js";

const MEMORY_FILE = "memory-data.json";
const PDCA_FILE = "pdca-history.json";

export function registerAutonomousTools(server: McpServer) {
  // --- run-autonomous-cycle ---
  server.tool(
    "run-autonomous-cycle",
    "全自動PDCAサイクルを1コマンドで実行する。記憶参照→パフォーマンス分析→PDCA比較→編集方針確認→洞察生成→記憶保存→アクション提案の全ステップを自動実行。",
    {
      period: z
        .enum(["week", "month"])
        .default("week")
        .describe("分析期間"),
      dryRun: z
        .boolean()
        .default(false)
        .describe("trueでAPI呼び出しスキップ"),
    },
    async ({ period, dryRun }) => {
      try {
        const steps: WorkflowStepResult[] = [];
        const insights: string[] = [];
        const nextActions: string[] = [];

        // Step 1: 記憶参照
        let recentMemories: MemoryEntry[] = [];
        try {
          const allMemories = readJsonStore<MemoryEntry[]>(MEMORY_FILE, []);
          recentMemories = allMemories
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, 20);
          steps.push({
            step: "記憶参照",
            status: "success",
            data: { memoriesFound: recentMemories.length, totalMemories: allMemories.length },
          });
        } catch (e) {
          steps.push({ step: "記憶参照", status: "error", error: String(e) });
        }

        // Step 2: パフォーマンス分析
        let totalPV = 0;
        let risingCount = 0;
        let decliningCount = 0;
        let topArticles: { title: string; pv: number }[] = [];

        if (dryRun) {
          steps.push({ step: "パフォーマンス分析", status: "skipped", data: "dryRun: スキップ" });
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
            const categorized = categorizeArticles(trends, 5);

            totalPV = trends.reduce((s, t) => s + t.totalPV, 0);
            risingCount = trends.filter((t) => t.trend === "rising").length;
            decliningCount = trends.filter((t) => t.trend === "declining").length;
            topArticles = categorized.topArticles.slice(0, 5).map((a) => ({
              title: a.title,
              pv: a.totalPV,
            }));

            steps.push({
              step: "パフォーマンス分析",
              status: "success",
              data: { totalArticles: trends.length, totalPV, risingCount, decliningCount },
            });

            // 洞察生成
            if (risingCount > decliningCount) {
              insights.push(`上昇トレンド記事(${risingCount})が下降(${decliningCount})を上回っている。現在の方針は有効。`);
            } else if (decliningCount > risingCount) {
              insights.push(`下降トレンド記事(${decliningCount})が上昇(${risingCount})を上回っている。コンテンツ戦略の見直しが必要。`);
            }

            if (categorized.topArticles.length > 0) {
              const topTitle = categorized.topArticles[0].title;
              insights.push(`最もPVの高い記事「${topTitle}」のテーマを横展開する余地がある。`);
            }
          } catch (e) {
            steps.push({ step: "パフォーマンス分析", status: "error", error: String(e) });
          }
        }

        // Step 3: PDCA比較
        let pdcaCyclesAvailable = 0;
        try {
          const history = readJsonStore<PDCACycleEntry[]>(PDCA_FILE, []);
          pdcaCyclesAvailable = history.length;

          if (history.length >= 2) {
            const sorted = [...history].sort(
              (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
            );
            const current = sorted[0];
            const previous = sorted[1];

            const pvChange = current.checkResult.totalPV - previous.checkResult.totalPV;
            const changeDirection = pvChange >= 0 ? "増加" : "減少";

            insights.push(
              `前回サイクル比でPVが${Math.abs(pvChange)}${changeDirection}。`
            );

            // 未消化のactItemsを次アクションに
            const unreflected = previous.actItems.filter(
              (act) => !current.plan.some((p) => p.includes(act) || act.includes(p))
            );
            for (const item of unreflected.slice(0, 2)) {
              nextActions.push(`前回未消化: ${item}`);
            }

            steps.push({
              step: "PDCA比較",
              status: "success",
              data: { cyclesCompared: 2, pvChange, unreflectedActions: unreflected.length },
            });
          } else {
            steps.push({
              step: "PDCA比較",
              status: "skipped",
              data: `履歴${history.length}件（比較には2件以上必要）`,
            });
          }
        } catch (e) {
          steps.push({ step: "PDCA比較", status: "error", error: String(e) });
        }

        // Step 4: 編集方針確認
        try {
          const voice = readEditorialVoice();
          steps.push({
            step: "編集方針確認",
            status: "success",
            data: {
              writingStyle: voice.writingStyle,
              topicFocus: voice.topicFocus,
              hasSoulExtension: Boolean(voice.personality || voice.expertise),
            },
          });

          // 方針に基づくアクション
          if (voice.topicFocus.length > 0) {
            nextActions.push(`注力トピック「${voice.topicFocus[0]}」で新記事を企画`);
          }
        } catch (e) {
          steps.push({ step: "編集方針確認", status: "error", error: String(e) });
        }

        // Step 5: データ駆動アクション提案
        if (risingCount > 0) {
          nextActions.push("上昇トレンド記事のテーマで続編・関連記事を作成");
        }
        if (decliningCount > 3) {
          nextActions.push("下降トレンド記事のタイトル・アイキャッチをリライト");
        }
        if (nextActions.length === 0) {
          nextActions.push("auto-generate-articleでデータ駆動の新テーマを生成");
          nextActions.push("run-feedback-loopで詳細なフィードバック分析を実行");
        }

        // Step 6: 記憶保存
        let memoryRecorded: { id: string; timestamp: string } | null = null;
        try {
          const reflectionContent = [
            `自律サイクル実行 (${period}):`,
            ...insights,
            `次アクション: ${nextActions.join(" / ")}`,
          ].join("\n");

          const entry: MemoryEntry = {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            type: "reflection",
            content: reflectionContent,
            source: "run-autonomous-cycle",
            tags: ["autonomous-cycle", period],
          };
          appendToJsonArray(MEMORY_FILE, entry);
          memoryRecorded = { id: entry.id, timestamp: entry.timestamp };

          steps.push({
            step: "記憶保存",
            status: "success",
            data: { memoryId: entry.id },
          });
        } catch (e) {
          steps.push({ step: "記憶保存", status: "error", error: String(e) });
        }

        return createSuccessResponse({
          executedAt: new Date().toISOString(),
          period,
          dryRun,
          steps,
          summary: {
            totalPV,
            risingCount,
            decliningCount,
            topArticles,
            recentMemories: recentMemories.length,
            pdcaCyclesAvailable,
          },
          insights,
          nextActions,
          memoryRecorded,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`自律サイクルの実行に失敗しました: ${message}`);
      }
    }
  );

  // --- auto-generate-article ---
  server.tool(
    "auto-generate-article",
    "パフォーマンスデータ・成功パターン・編集方針・トレンドからテーマ候補と構成案を自動生成する。記事本文の生成はLLMクライアント側で行う前提。",
    {
      count: z
        .number()
        .default(3)
        .describe("生成するテーマ候補数（デフォルト: 3）"),
    },
    async ({ count }) => {
      try {
        // Step 1: データ収集（並列）
        const [monthlyStats, memories, hashtagResult] = await Promise.all([
          fetchAllStats("month"),
          Promise.resolve(readJsonStore<MemoryEntry[]>(MEMORY_FILE, [])),
          noteApiRequest("/v2/hashtags").catch(() => null),
        ]);
        const voice = readEditorialVoice();

        // 成功パターン（insight）を抽出
        const successInsights = memories
          .filter((m) => m.type === "insight")
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, 10);

        // PV上位記事
        const topStats = [...monthlyStats]
          .sort((a, b) => b.readCount - a.readCount)
          .slice(0, 10);

        // トレンドハッシュタグ
        const trendHashtags: string[] = [];
        if (hashtagResult?.data) {
          const tags = hashtagResult.data.hashtags || hashtagResult.data.trending_hashtags || [];
          for (const tag of Array.isArray(tags) ? tags : []) {
            const name = typeof tag === "string" ? tag : tag.name || tag.hashtag || "";
            if (name) trendHashtags.push(name);
          }
        }

        // Step 2: テーマ候補生成
        interface Candidate {
          rank: number;
          score: number;
          theme: string;
          titleSuggestion: string;
          outline: string[];
          hashtags: string[];
          suggestedDate: string;
          reasoning: string;
          voiceAlignment: string;
        }

        const candidates: Candidate[] = [];
        const today = new Date();

        // 候補A: PV上位記事の横展開
        if (topStats.length > 0) {
          for (let i = 0; i < Math.min(topStats.length, Math.ceil(count / 2)); i++) {
            const ref = topStats[i];
            const postDate = new Date(today);
            postDate.setDate(postDate.getDate() + (i + 1) * 2);
            // 週末なら翌営業日にずらす
            while (postDate.getDay() === 0 || postDate.getDay() === 6) {
              postDate.setDate(postDate.getDate() + 1);
            }

            candidates.push({
              rank: 0,
              score: 80 + Math.min(ref.readCount / 100, 20),
              theme: `「${ref.title}」の深掘り・関連テーマ`,
              titleSuggestion: `${ref.title}の裏側：知っておきたいポイント`,
              outline: [
                "導入: 前回記事の反響と読者の関心",
                "本文1: より深い知見・実践テクニック",
                "本文2: よくある質問・誤解への回答",
                "まとめ: 次のステップとアクション",
              ],
              hashtags: [
                ...trendHashtags.slice(0, 2),
                ...(voice.topicFocus.length > 0 ? [voice.topicFocus[0]] : []),
              ],
              suggestedDate: postDate.toISOString().split("T")[0],
              reasoning: `PV ${ref.readCount} の高パフォーマンス記事の横展開`,
              voiceAlignment: `${voice.writingStyle} / ${voice.brandVoice}`,
            });
          }
        }

        // 候補B: トレンドハッシュタグ活用
        if (trendHashtags.length > 0) {
          for (let i = 0; i < Math.min(trendHashtags.length, Math.ceil(count / 3)); i++) {
            const tag = trendHashtags[i];
            const postDate = new Date(today);
            postDate.setDate(postDate.getDate() + (i + 1) * 3);

            candidates.push({
              rank: 0,
              score: 60 + i * -5,
              theme: `#${tag} トレンドに乗った記事`,
              titleSuggestion: `今話題の「${tag}」を${voice.targetAudience}向けに解説`,
              outline: [
                `導入: なぜ今「${tag}」が注目されているか`,
                "本文1: 基本の理解と現状",
                "本文2: 実践的な活用方法",
                "まとめ: 今すぐ始められるアクション",
              ],
              hashtags: [tag, ...voice.topicFocus.slice(0, 1)],
              suggestedDate: postDate.toISOString().split("T")[0],
              reasoning: `トレンドハッシュタグ「${tag}」の活用`,
              voiceAlignment: `${voice.writingStyle} / ${voice.brandVoice}`,
            });
          }
        }

        // 候補C: 編集方針の注力トピック
        for (const topic of voice.topicFocus.slice(0, Math.ceil(count / 3))) {
          const postDate = new Date(today);
          postDate.setDate(postDate.getDate() + 5);

          // 成功パターンからの補強
          const relatedInsight = successInsights.find(
            (ins) => ins.tags.some((t) => topic.includes(t) || t.includes(topic)) || ins.content.includes(topic)
          );

          candidates.push({
            rank: 0,
            score: 50 + (relatedInsight ? 20 : 0),
            theme: `${topic}の実践ガイド`,
            titleSuggestion: `${topic}を始めるための完全ガイド【${new Date().getFullYear()}年版】`,
            outline: [
              `導入: ${topic}が${voice.targetAudience}に必要な理由`,
              "本文1: 基礎知識と準備",
              "本文2: ステップバイステップの実践方法",
              "本文3: よくある失敗と対策",
              "まとめ: 今日からできるアクション",
            ],
            hashtags: [topic, ...trendHashtags.slice(0, 1)],
            suggestedDate: postDate.toISOString().split("T")[0],
            reasoning: relatedInsight
              ? `編集方針の注力トピック＋成功パターン「${relatedInsight.content.slice(0, 30)}...」を反映`
              : "編集方針の注力トピックに基づく",
            voiceAlignment: `${voice.writingStyle} / ${voice.brandVoice}`,
          });
        }

        // スコア順にソートしてランク付け
        candidates.sort((a, b) => b.score - a.score);
        const result = candidates.slice(0, count).map((c, i) => ({
          ...c,
          rank: i + 1,
        }));

        return createSuccessResponse({
          generatedAt: new Date().toISOString(),
          dataContext: {
            articlesAnalyzed: monthlyStats.length,
            insightsReferenced: successInsights.length,
            trendHashtags: trendHashtags.slice(0, 10),
          },
          candidates: result,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`記事テーマ自動生成に失敗しました: ${message}`);
      }
    }
  );
}
