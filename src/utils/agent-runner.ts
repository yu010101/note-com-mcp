import { execFile } from "child_process";
import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "../config/environment.js";
import { AgentMode, AgentGoal, AgentCycleLog, PostLogEntry } from "../types/analytics-types.js";
import { readJsonStore, appendToJsonArray } from "./memory-store.js";
import { readEditorialVoice } from "./voice-reader.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../../");

const AGENT_LOG_FILE = "agent-log.json";
const AGENT_GOAL_FILE = "agent-goal.json";
const MCP_CONFIG_FILE = "mcp-agent-config.json";
const POST_LOG_FILE = "post-log.json";

// ========== 投稿ログ・予算チェック ==========

/**
 * 今日の投稿数を取得する
 */
export function getDailyPostCount(): number {
  const logs = readJsonStore<PostLogEntry[]>(POST_LOG_FILE, []);
  const todayStr = new Date().toISOString().split("T")[0];
  return logs.filter((log) => log.timestamp.startsWith(todayStr)).length;
}

/**
 * 今日まだ投稿できるか判定
 */
export function canPostToday(): { allowed: boolean; remaining: number; mode: string; reason?: string } {
  const mode = env.AGENT_POST_MODE;
  const max = env.AGENT_MAX_TWEETS_PER_DAY;
  const count = getDailyPostCount();
  const remaining = Math.max(0, max - count);

  if (mode === "dry-run-only") {
    return { allowed: false, remaining, mode, reason: "AGENT_POST_MODE=dry-run-only のため実投稿は無効です" };
  }
  if (remaining <= 0) {
    return { allowed: false, remaining: 0, mode, reason: `日次投稿上限 (${max}) に達しました` };
  }
  return { allowed: true, remaining, mode };
}

/**
 * 投稿をログに記録する
 */
export function recordPost(entry: PostLogEntry): void {
  appendToJsonArray(POST_LOG_FILE, entry);
}

/**
 * 投稿ログを取得する（直近N日分）
 */
export function getPostLog(days: number = 7): PostLogEntry[] {
  const logs = readJsonStore<PostLogEntry[]>(POST_LOG_FILE, []);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString();
  return logs.filter((log) => log.timestamp >= cutoffStr);
}

const DEFAULT_GOAL: AgentGoal = {
  weeklyPVTarget: 1000,
  monthlyArticleTarget: 4,
  promotionFrequency: "every-other-day",
  focusTopics: ["AI活用", "自動化", "生産性"],
  customInstructions: "",
};

/**
 * エージェント目標を読み込む
 */
export function getAgentGoal(): AgentGoal {
  return readJsonStore<AgentGoal>(AGENT_GOAL_FILE, DEFAULT_GOAL);
}

/**
 * 当日のエージェント実行コストを合算する
 */
export function getDailySpend(): number {
  const logs = readJsonStore<AgentCycleLog[]>(AGENT_LOG_FILE, []);
  const todayStr = new Date().toISOString().split("T")[0];
  return logs
    .filter((log) => log.startedAt.startsWith(todayStr))
    .reduce((sum, log) => sum + log.costUsd, 0);
}

/**
 * モード別のシステムプロンプトを生成する
 */
export function buildSystemPrompt(mode: AgentMode): string {
  const voice = readEditorialVoice();
  const goal = getAgentGoal();

  const voiceSection = [
    "## ペルソナ・編集方針",
    `- 文体: ${voice.writingStyle}`,
    `- ターゲット: ${voice.targetAudience}`,
    `- ブランドボイス: ${voice.brandVoice}`,
    `- 注力トピック: ${voice.topicFocus.join(", ")}`,
    voice.toneKeywords.length > 0
      ? `- トーン: ${voice.toneKeywords.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const goalSection = [
    "## エージェント目標",
    `- 週間PV目標: ${goal.weeklyPVTarget}`,
    `- 月間記事目標: ${goal.monthlyArticleTarget}本`,
    `- SNS宣伝頻度: ${goal.promotionFrequency}`,
    `- 注力トピック: ${goal.focusTopics.join(", ")}`,
    goal.customInstructions
      ? `- カスタム指示: ${goal.customInstructions}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const basePrompt = [
    "あなたはnote.comコンテンツ運営の完全自律AIエージェントです。",
    "MCPツールを使って分析・企画・投稿・振り返りを自律実行します。",
    "",
    voiceSection,
    "",
    goalSection,
    "",
  ].join("\n");

  const modeInstructions: Record<AgentMode, string> = {
    "morning-check": [
      "## タスク: 朝のPVチェック",
      "1. `dashboard-summary` を呼び出して現在のPV・トレンドを確認",
      "2. 異常値（前日比30%以上の増減）があれば `send-notification` で通知",
      "3. 重要な気づきを `record-memory` で記録",
      "4. 結果を簡潔にまとめて報告",
    ].join("\n"),

    "content-creation": [
      "## タスク: コンテンツ企画・下書き生成",
      "1. `get-memories` で過去の洞察・成功パターンを確認",
      "2. `get-success-patterns` で高パフォーマンス記事の特徴を分析",
      "3. `generate-content-plan` でデータ駆動のコンテンツ企画を作成",
      "4. `auto-generate-article` でテーマ候補と構成案を生成",
      "5. 結果をまとめて報告",
    ].join("\n"),

    promotion: env.AGENT_POST_MODE === "full-auto"
      ? [
          "## タスク: SNS宣伝テキスト生成・投稿（自動投稿モード）",
          "0. `get-x-strategy` でX運用戦略を確認（フォーマット・タイミング・スコアリング基準）",
          "1. `check-post-budget` で今日の投稿残数を確認（残数0なら終了）",
          "2. `suggest-promotion-strategy` で最適な宣伝戦略を取得",
          "3. `generate-promotion` で宣伝テキストを生成（戦略のフォーマットを参考に）",
          "4. `cross-post` でSNS投稿（dryRun: false で実投稿）",
          "5. 結果をまとめて報告",
          "",
          "**自動投稿モード: 投稿前に必ず check-post-budget で残数を確認してください。**",
        ].join("\n")
      : [
          "## タスク: SNS宣伝テキスト生成・投稿",
          "0. `get-x-strategy` でX運用戦略を確認（フォーマット・タイミング・スコアリング基準）",
          "1. `suggest-promotion-strategy` で最適な宣伝戦略を取得",
          "2. `generate-promotion` で宣伝テキストを生成（戦略のフォーマットを参考に）",
          "3. `cross-post` でSNS投稿（必ず dryRun: true で実行すること）",
          "4. 結果をまとめて報告",
          "",
          "**重要: cross-post は必ず dryRun: true で実行してください。実投稿は人間の承認後に行います。**",
        ].join("\n"),

    "engagement-check": [
      "## タスク: エンゲージメント確認・分析",
      "0. `get-x-strategy` でX運用戦略を確認（スコアリング基準・エンゲージメント閾値）",
      "1. `check-all-recent-engagement` で直近の投稿エンゲージメントを一括取得",
      "2. 成功パターンを分析（高エンゲージメント投稿の共通点: 時間帯、文体、ハッシュタグ等）",
      "3. 改善ポイントを特定（低エンゲージメント投稿の原因分析）",
      "4. 分析結果を `record-memory` で記録（type: insight）",
      "5. 次回の投稿戦略改善提案をまとめて報告",
    ].join("\n"),

    "pdca-review": [
      "## タスク: PDCA振り返り",
      "1. `analyze-content-performance` で記事パフォーマンスを分析",
      "2. `compare-pdca-cycles` で前回サイクルと比較",
      "3. `record-pdca-cycle` で新しいPDCAサイクルを記録",
      "4. 重要な洞察を `record-memory` で記録",
      "5. 改善アクションを提案して報告",
    ].join("\n"),

    outbound: [
      "## タスク: アウトバウンドエンゲージメント",
      "0. `get-x-strategy` でX運用戦略を確認",
      "1. `search-tweets` で注力トピック関連のツイートを検索",
      "2. 関連性の高いツイートを選定（フォロワー数・内容の質で判断）",
      "3. `like-tweet` でいいね（1セッション最大5件）",
      "4. 価値あるリプライができる場合のみ `reply-to-tweet` でリプライ",
      "5. 特に親和性の高いアカウントには `follow-user` でフォロー",
      "6. 実行結果を `record-memory` で記録",
      "7. 結果をまとめて報告",
      "",
      "**重要: スパム的な大量エンゲージメントは禁止。質を重視。**",
    ].join("\n"),

    "full-auto": env.AGENT_POST_MODE === "full-auto"
      ? [
          "## タスク: 完全自律実行（自動投稿モード）",
          "状況を分析して最適なアクションを自律的に選択・実行します。",
          "",
          "0. `get-x-strategy` でX運用戦略を確認（フォーマット・タイミング・スコアリング基準）",
          "1. まず `dashboard-summary` で現在の状況を把握",
          "2. `check-post-budget` で今日の投稿残数を確認",
          "3. 状況に応じて以下を判断・実行:",
          "   - PVが目標を下回っている → コンテンツ企画・宣伝を強化",
          "   - 上昇トレンド記事がある → 横展開テーマを提案",
          "   - 下降トレンド記事が多い → リライト・改善を提案",
          "   - 定期振り返り時期 → PDCA分析を実行",
          "   - SNS投稿残数がある → `cross-post` で実投稿（dryRun: false）",
          "   - アウトバウンドが有効 → `search-tweets` でターゲット発見 → `like-tweet` / `reply-to-tweet` / `follow-user`",
          "4. 実行した内容を `record-memory` で記録",
          "5. 結果をまとめて報告",
          "",
          "**自動投稿モード: cross-post は投稿残数がある場合のみ dryRun: false で実投稿します。**",
        ].join("\n")
      : [
          "## タスク: 完全自律実行",
          "状況を分析して最適なアクションを自律的に選択・実行します。",
          "",
          "0. `get-x-strategy` でX運用戦略を確認（フォーマット・タイミング・スコアリング基準）",
          "1. まず `dashboard-summary` で現在の状況を把握",
          "2. 状況に応じて以下を判断・実行:",
          "   - PVが目標を下回っている → コンテンツ企画・宣伝を強化",
          "   - 上昇トレンド記事がある → 横展開テーマを提案",
          "   - 下降トレンド記事が多い → リライト・改善を提案",
          "   - 定期振り返り時期 → PDCA分析を実行",
          "   - アウトバウンドが有効 → `search-tweets` でターゲット発見 → `like-tweet` / `reply-to-tweet` / `follow-user`",
          "3. 実行した内容を `record-memory` で記録",
          "4. 結果をまとめて報告",
          "",
          "**重要: cross-post は必ず dryRun: true で実行してください。実投稿は人間の承認後に行います。**",
        ].join("\n"),
  };

  return basePrompt + modeInstructions[mode];
}

/**
 * Claude CLIを起動してエージェントサイクルを実行する
 */
export async function runAgentCycle(
  mode: AgentMode
): Promise<AgentCycleLog> {
  const cycleId = randomUUID();
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  // AGENT_ENABLED チェック
  if (!env.AGENT_ENABLED) {
    const log: AgentCycleLog = {
      id: cycleId,
      mode,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      toolsCalled: [],
      summary: "エージェントが無効です (AGENT_ENABLED=false)",
      costUsd: 0,
      tokensUsed: 0,
      success: false,
      error: "AGENT_ENABLED is not set to true",
    };
    appendToJsonArray(AGENT_LOG_FILE, log);
    return log;
  }

  // デイリー予算チェック
  const dailyBudget = parseFloat(env.AGENT_DAILY_BUDGET_USD);
  const dailySpend = getDailySpend();
  if (dailySpend >= dailyBudget) {
    const log: AgentCycleLog = {
      id: cycleId,
      mode,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      toolsCalled: [],
      summary: `デイリー予算上限に達しました ($${dailySpend.toFixed(2)} / $${dailyBudget.toFixed(2)})`,
      costUsd: 0,
      tokensUsed: 0,
      success: false,
      error: `Daily budget exceeded: $${dailySpend.toFixed(2)} >= $${dailyBudget.toFixed(2)}`,
    };
    appendToJsonArray(AGENT_LOG_FILE, log);
    return log;
  }

  // システムプロンプト生成
  const systemPrompt = buildSystemPrompt(mode);

  // MCP設定ファイルパス
  const mcpConfigPath = path.resolve(PROJECT_ROOT, MCP_CONFIG_FILE);

  // Claude CLI引数
  const args = [
    "-p",
    systemPrompt,
    "--mcp-config",
    mcpConfigPath,
    "--dangerously-skip-permissions",
    "--model",
    env.AGENT_MODEL,
    "--max-budget-usd",
    env.AGENT_MAX_BUDGET_USD,
    "--output-format",
    "json",
  ];

  return new Promise<AgentCycleLog>((resolve) => {
    const cliPath = env.CLAUDE_CLI_PATH;

    execFile(
      cliPath,
      args,
      {
        timeout: 300000, // 5分
        maxBuffer: 10 * 1024 * 1024, // 10MB
        env: { ...process.env, CLAUDECODE: "" }, // ネスト防止
      },
      (error, stdout, stderr) => {
        const completedAt = new Date().toISOString();
        const durationMs = Date.now() - startTime;

        if (error) {
          console.error(`[agent-runner] CLI error (${mode}):`, error.message);
          if (stderr) {
            console.error(`[agent-runner] stderr:`, stderr);
          }

          const log: AgentCycleLog = {
            id: cycleId,
            mode,
            startedAt,
            completedAt,
            durationMs,
            toolsCalled: [],
            summary: `エージェント実行失敗: ${error.message}`,
            costUsd: 0,
            tokensUsed: 0,
            success: false,
            error: error.message,
          };
          appendToJsonArray(AGENT_LOG_FILE, log);
          resolve(log);
          return;
        }

        // stdout をJSONパース
        let result: any = {};
        let costUsd = 0;
        let tokensUsed = 0;
        let summary = "";
        let toolsCalled: string[] = [];

        try {
          result = JSON.parse(stdout);
          costUsd = result.cost_usd ?? result.costUsd ?? 0;
          tokensUsed =
            result.num_input_tokens ??
            result.tokens_used ??
            result.tokensUsed ??
            0;
          summary =
            result.result ??
            result.text ??
            result.content ??
            (typeof result === "string" ? result : JSON.stringify(result).slice(0, 500));

          // ツール呼び出し情報の抽出
          if (Array.isArray(result.messages)) {
            toolsCalled = result.messages
              .filter(
                (m: any) =>
                  m.role === "assistant" &&
                  Array.isArray(m.content) &&
                  m.content.some((c: any) => c.type === "tool_use")
              )
              .flatMap((m: any) =>
                m.content
                  .filter((c: any) => c.type === "tool_use")
                  .map((c: any) => c.name)
              );
          }
        } catch {
          // JSONパース失敗時はstdoutをそのまま使用
          summary = stdout.slice(0, 500);
        }

        const log: AgentCycleLog = {
          id: cycleId,
          mode,
          startedAt,
          completedAt,
          durationMs,
          toolsCalled,
          summary: typeof summary === "string" ? summary.slice(0, 1000) : String(summary).slice(0, 1000),
          costUsd,
          tokensUsed,
          success: true,
        };
        appendToJsonArray(AGENT_LOG_FILE, log);
        resolve(log);
      }
    );
  });
}
