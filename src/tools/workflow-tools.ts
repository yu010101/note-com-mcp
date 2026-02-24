import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { noteApiRequest } from "../utils/api-client.js";
import { formatNote } from "../utils/formatters.js";
import { createSuccessResponse, handleApiError } from "../utils/error-handler.js";
import { env } from "../config/environment.js";
import { fetchAllStats, computeTrends, categorizeArticles } from "../utils/analytics-helpers.js";
import { WorkflowStepResult, EditorialVoice } from "../types/analytics-types.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readEditorialVoice(): EditorialVoice | null {
  const voicePath = path.resolve(__dirname, "../../editorial-voice.json");
  if (!fs.existsSync(voicePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(voicePath, "utf-8")) as EditorialVoice;
  } catch {
    return null;
  }
}

async function sendWebhook(title: string, body: string): Promise<boolean> {
  if (!env.WEBHOOK_URL) return false;
  try {
    const format = env.WEBHOOK_FORMAT || "generic";
    let payload: any;

    if (format === "slack") {
      payload = {
        text: `*${title}*\n${body}`,
        blocks: [{ type: "section", text: { type: "mrkdwn", text: `*${title}*\n\n${body}` } }],
      };
    } else if (format === "discord") {
      payload = { content: title, embeds: [{ title, description: body.slice(0, 4096) }] };
    } else {
      payload = { title, body };
    }

    await fetch(env.WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return true;
  } catch {
    return false;
  }
}

export function registerWorkflowTools(server: McpServer) {
  server.tool(
    "run-content-workflow",
    "定型ワークフローを実行する。morning-check（朝チェック）、draft-review（下書きレビュー）、performance-report（パフォーマンスレポート）、content-planning（コンテンツ計画）、publish-readiness（公開準備チェック）に対応。",
    {
      workflow: z
        .enum(["morning-check", "draft-review", "performance-report", "content-planning", "publish-readiness"])
        .describe("実行するワークフロー"),
      dryRun: z
        .boolean()
        .default(false)
        .describe("trueの場合、実際のAPI呼び出しをスキップして手順のみ返す"),
    },
    async ({ workflow, dryRun }) => {
      try {
        const steps: WorkflowStepResult[] = [];

        switch (workflow) {
          case "morning-check": {
            // Step 1: PV統計取得
            if (dryRun) {
              steps.push({ step: "PV統計取得", status: "skipped", data: "dryRun: スキップ" });
            } else {
              try {
                const weeklyStats = await fetchAllStats("week");
                const totalWeeklyPV = weeklyStats.reduce((s, n) => s + n.readCount, 0);
                steps.push({
                  step: "PV統計取得",
                  status: "success",
                  data: { articlesTracked: weeklyStats.length, totalWeeklyPV },
                });
              } catch (e) {
                steps.push({ step: "PV統計取得", status: "error", error: String(e) });
              }
            }

            // Step 2: 通知件数確認
            if (dryRun) {
              steps.push({ step: "通知件数確認", status: "skipped", data: "dryRun: スキップ" });
            } else {
              try {
                const noticeData = await noteApiRequest("/v3/notice_counts", "GET", null, true);
                steps.push({
                  step: "通知件数確認",
                  status: "success",
                  data: noticeData?.data || {},
                });
              } catch (e) {
                steps.push({ step: "通知件数確認", status: "error", error: String(e) });
              }
            }

            // Step 3: 週間パフォーマンス概要
            if (dryRun) {
              steps.push({ step: "週間パフォーマンス概要", status: "skipped", data: "dryRun: スキップ" });
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
                const { topArticles, risingArticles } = categorizeArticles(trends, 5);

                steps.push({
                  step: "週間パフォーマンス概要",
                  status: "success",
                  data: {
                    totalArticles: trends.length,
                    risingCount: trends.filter((t) => t.trend === "rising").length,
                    decliningCount: trends.filter((t) => t.trend === "declining").length,
                    topArticles: topArticles.slice(0, 3).map((a) => ({ title: a.title, weeklyPV: a.weeklyPV })),
                    risingArticles: risingArticles.slice(0, 3).map((a) => ({ title: a.title, weeklyPV: a.weeklyPV })),
                  },
                });
              } catch (e) {
                steps.push({ step: "週間パフォーマンス概要", status: "error", error: String(e) });
              }
            }

            // Step 4: レポート生成
            const summaryLines = steps
              .map((s) => `- ${s.step}: ${s.status}`)
              .join("\n");
            steps.push({
              step: "朝チェックレポート生成",
              status: "success",
              data: { summary: summaryLines },
            });
            break;
          }

          case "draft-review": {
            // Step 1: 下書き一覧取得
            let drafts: any[] = [];
            if (dryRun) {
              steps.push({ step: "下書き一覧取得", status: "skipped", data: "dryRun: スキップ" });
            } else {
              try {
                const draftData = await noteApiRequest("/v3/notes/draft", "GET", null, true);
                const rawDrafts = draftData?.data?.contents || draftData?.data?.notes;
                drafts = Array.isArray(rawDrafts) ? rawDrafts : [];
                steps.push({
                  step: "下書き一覧取得",
                  status: "success",
                  data: { draftCount: drafts.length },
                });
              } catch (e) {
                steps.push({ step: "下書き一覧取得", status: "error", error: String(e) });
              }
            }

            // Step 2: 各下書きの完成度チェック
            if (dryRun) {
              steps.push({ step: "完成度チェック", status: "skipped", data: "dryRun: スキップ" });
            } else {
              const checks = drafts.slice(0, 10).map((d) => {
                const formatted = formatNote(d, env.NOTE_USER_ID, false, true);
                const hasTitle = Boolean(formatted.title && formatted.title.length > 0);
                const hasBody = Boolean(formatted.body && formatted.body.length > 100);
                const hasEyecatch = formatted.contentAnalysis?.hasEyecatch || false;
                const score = (hasTitle ? 30 : 0) + (hasBody ? 40 : 0) + (hasEyecatch ? 30 : 0);

                return {
                  title: formatted.title || "（無題）",
                  completionScore: score,
                  hasTitle,
                  hasBody,
                  hasEyecatch,
                  bodyLength: formatted.contentAnalysis?.bodyLength || 0,
                };
              });

              steps.push({
                step: "完成度チェック",
                status: "success",
                data: { drafts: checks },
              });
            }

            // Step 3: editorial-voice準拠チェック
            const voice = readEditorialVoice();
            if (voice) {
              steps.push({
                step: "編集方針チェック",
                status: "success",
                data: {
                  voiceLoaded: true,
                  writingStyle: voice.writingStyle,
                  topicFocus: voice.topicFocus,
                  hint: "各下書きのトーンが編集方針に合っているか確認してください",
                },
              });
            } else {
              steps.push({
                step: "編集方針チェック",
                status: "skipped",
                data: "editorial-voice.jsonが見つかりません",
              });
            }

            // Step 4: 改善提案
            steps.push({
              step: "改善提案生成",
              status: "success",
              data: {
                suggestions: [
                  "完成度スコア70未満の下書きは、本文の充実またはアイキャッチの追加を検討",
                  "タイトルが短い下書きは、検索性を高めるキーワードを追加",
                  voice ? `トーン: 「${voice.toneKeywords.join("・")}」に合っているか確認` : "",
                ].filter(Boolean),
              },
            });
            break;
          }

          case "performance-report": {
            // Step 1: PDCA分析実行
            if (dryRun) {
              steps.push({ step: "PDCA分析", status: "skipped", data: "dryRun: スキップ" });
              steps.push({ step: "レポート整形", status: "skipped", data: "dryRun: スキップ" });
              steps.push({ step: "Webhook送信", status: "skipped", data: "dryRun: スキップ" });
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
                const { topArticles, risingArticles, decliningArticles } = categorizeArticles(trends, 5);
                const totalPV = trends.reduce((s, t) => s + t.totalPV, 0);

                steps.push({
                  step: "PDCA分析",
                  status: "success",
                  data: {
                    totalArticles: trends.length,
                    totalPV,
                    risingCount: risingArticles.length,
                    decliningCount: decliningArticles.length,
                  },
                });

                // Step 2: レポート整形
                const reportLines = [
                  `## パフォーマンスレポート (${new Date().toISOString().split("T")[0]})`,
                  `- 総記事数: ${trends.length}`,
                  `- 総PV: ${totalPV}`,
                  `- 上昇記事: ${risingArticles.length}`,
                  `- 下降記事: ${decliningArticles.length}`,
                  "",
                  "### トップ記事",
                  ...topArticles.slice(0, 3).map((a) => `- ${a.title} (PV: ${a.totalPV})`),
                ];
                const reportText = reportLines.join("\n");

                steps.push({
                  step: "レポート整形",
                  status: "success",
                  data: { report: reportText },
                });

                // Step 3: Webhook送信
                const sent = await sendWebhook("パフォーマンスレポート", reportText);
                steps.push({
                  step: "Webhook送信",
                  status: sent ? "success" : "skipped",
                  data: sent ? "送信完了" : "WEBHOOK_URL未設定のためスキップ",
                });
              } catch (e) {
                steps.push({ step: "PDCA分析", status: "error", error: String(e) });
              }
            }
            break;
          }

          case "content-planning": {
            // Step 1: パフォーマンス分析
            if (dryRun) {
              steps.push({ step: "パフォーマンス分析", status: "skipped", data: "dryRun: スキップ" });
              steps.push({ step: "トレンド取得", status: "skipped", data: "dryRun: スキップ" });
              steps.push({ step: "カレンダー生成", status: "skipped", data: "dryRun: スキップ" });
            } else {
              try {
                const monthlyStats = await fetchAllStats("month");
                const topStats = [...monthlyStats]
                  .sort((a, b) => b.readCount - a.readCount)
                  .slice(0, 5);

                steps.push({
                  step: "パフォーマンス分析",
                  status: "success",
                  data: {
                    articlesAnalyzed: monthlyStats.length,
                    topPerformers: topStats.map((s) => s.title),
                  },
                });

                // Step 2: トレンド取得
                let trendTags: string[] = [];
                try {
                  const hashtagData = await noteApiRequest("/v2/hashtags");
                  const tags = hashtagData?.data?.hashtags || hashtagData?.data?.trending_hashtags || [];
                  trendTags = (Array.isArray(tags) ? tags : [])
                    .map((t: any) => (typeof t === "string" ? t : t.name || ""))
                    .filter(Boolean)
                    .slice(0, 10);
                } catch {
                  // ハッシュタグ取得失敗は無視
                }

                steps.push({
                  step: "トレンド取得",
                  status: trendTags.length > 0 ? "success" : "skipped",
                  data: { trendHashtags: trendTags },
                });

                // Step 3: カレンダー生成
                const voice = readEditorialVoice();
                const focusTopics = voice?.topicFocus || [];

                steps.push({
                  step: "カレンダー生成",
                  status: "success",
                  data: {
                    recommendation: "generate-content-planツールで詳細なカレンダーを生成できます",
                    topPerformers: topStats.map((s) => s.title),
                    trendHashtags: trendTags,
                    focusTopics,
                  },
                });
              } catch (e) {
                steps.push({ step: "パフォーマンス分析", status: "error", error: String(e) });
              }
            }
            break;
          }

          case "publish-readiness": {
            // Step 1: 下書き取得
            if (dryRun) {
              steps.push({ step: "下書き取得", status: "skipped", data: "dryRun: スキップ" });
              steps.push({ step: "公開チェック", status: "skipped", data: "dryRun: スキップ" });
              steps.push({ step: "公開推奨度", status: "skipped", data: "dryRun: スキップ" });
            } else {
              try {
                const draftData = await noteApiRequest("/v3/notes/draft", "GET", null, true);
                const drafts = draftData?.data?.contents || draftData?.data?.notes || [];
                const draftList = Array.isArray(drafts) ? drafts : [];

                steps.push({
                  step: "下書き取得",
                  status: "success",
                  data: { draftCount: draftList.length },
                });

                // Step 2: 各下書きのチェック
                const readinessChecks = draftList.slice(0, 5).map((d: any) => {
                  const formatted = formatNote(d, env.NOTE_USER_ID, false, true);
                  const checks = {
                    title: Boolean(formatted.title && formatted.title.length >= 5),
                    body: Boolean(formatted.body && formatted.body.length >= 300),
                    eyecatch: formatted.contentAnalysis?.hasEyecatch || false,
                    hashtags: Boolean(d.hashtags?.length > 0 || d.hashtag_notes?.length > 0),
                  };
                  const passedCount = Object.values(checks).filter(Boolean).length;

                  return {
                    title: formatted.title || "（無題）",
                    checks,
                    readinessScore: Math.round((passedCount / 4) * 100),
                    recommendation:
                      passedCount === 4
                        ? "公開可能"
                        : passedCount >= 3
                          ? "ほぼ準備完了（軽微な改善推奨）"
                          : "改善が必要",
                  };
                });

                steps.push({
                  step: "公開チェック",
                  status: "success",
                  data: { articles: readinessChecks },
                });

                // Step 3: 公開推奨度スコア
                steps.push({
                  step: "公開推奨度",
                  status: "success",
                  data: {
                    readyCount: readinessChecks.filter((c) => c.readinessScore === 100).length,
                    almostReady: readinessChecks.filter((c) => c.readinessScore >= 75 && c.readinessScore < 100).length,
                    needsWork: readinessChecks.filter((c) => c.readinessScore < 75).length,
                  },
                });
              } catch (e) {
                steps.push({ step: "下書き取得", status: "error", error: String(e) });
              }
            }
            break;
          }
        }

        return createSuccessResponse({
          workflow,
          dryRun,
          executedAt: new Date().toISOString(),
          steps,
        });
      } catch (error) {
        return handleApiError(error, `ワークフロー実行(${workflow})`);
      }
    }
  );
}
