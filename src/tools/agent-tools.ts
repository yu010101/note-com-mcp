import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createSuccessResponse,
  createErrorResponse,
} from "../utils/error-handler.js";
import { readJsonStore, writeJsonStore } from "../utils/memory-store.js";
import {
  AgentMode,
  AgentGoal,
  AgentCycleLog,
} from "../types/analytics-types.js";
import {
  runAgentCycle,
  buildSystemPrompt,
  getAgentGoal,
  getDailySpend,
} from "../utils/agent-runner.js";
import { env } from "../config/environment.js";

const AGENT_LOG_FILE = "agent-log.json";
const AGENT_GOAL_FILE = "agent-goal.json";

const agentModeEnum = z.enum([
  "morning-check",
  "content-creation",
  "promotion",
  "pdca-review",
  "engagement-check",
  "outbound",
  "full-auto",
]);

export function registerAgentTools(server: McpServer) {
  // --- run-agent ---
  server.tool(
    "run-agent",
    "Claude CLIベースの自律エージェントを起動する。指定モードに従いMCPツールを自律的に呼び出して分析・企画・投稿・振り返りを実行する。dryRun=trueでプロンプト内容だけを確認できる。",
    {
      mode: agentModeEnum.describe(
        "実行モード: morning-check(朝PV確認), content-creation(記事企画), promotion(SNS宣伝), pdca-review(PDCA振り返り), full-auto(完全自律)"
      ),
      dryRun: z
        .boolean()
        .default(false)
        .describe("trueの場合、実際のCLI実行をスキップしプロンプト内容だけ返す"),
    },
    async ({ mode, dryRun }) => {
      try {
        if (dryRun) {
          const prompt = buildSystemPrompt(mode as AgentMode);
          const goal = getAgentGoal();
          const dailySpend = getDailySpend();
          return createSuccessResponse({
            dryRun: true,
            mode,
            systemPrompt: prompt,
            goal,
            config: {
              agentEnabled: env.AGENT_ENABLED,
              model: env.AGENT_MODEL,
              maxBudgetPerRun: env.AGENT_MAX_BUDGET_USD,
              dailyBudget: env.AGENT_DAILY_BUDGET_USD,
              dailySpendSoFar: dailySpend.toFixed(2),
              cliPath: env.CLAUDE_CLI_PATH,
            },
          });
        }

        const log = await runAgentCycle(mode as AgentMode);
        return createSuccessResponse({
          executed: true,
          log,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`エージェント実行に失敗しました: ${message}`);
      }
    }
  );

  // --- get-agent-log ---
  server.tool(
    "get-agent-log",
    "エージェントの実行履歴とコスト情報を取得する。モードでフィルタリング可能。",
    {
      limit: z
        .number()
        .default(20)
        .describe("取得件数（デフォルト: 20）"),
      mode: agentModeEnum
        .optional()
        .describe("フィルタするモード（省略時は全モード）"),
    },
    async ({ limit, mode }) => {
      try {
        let logs = readJsonStore<AgentCycleLog[]>(AGENT_LOG_FILE, []);

        if (mode) {
          logs = logs.filter((log) => log.mode === mode);
        }

        // 新しい順にソートしてlimit件返す
        logs.sort(
          (a, b) =>
            new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
        );
        const result = logs.slice(0, limit);

        // コスト集計
        const todayStr = new Date().toISOString().split("T")[0];
        const todayLogs = logs.filter((l) => l.startedAt.startsWith(todayStr));
        const totalCost = logs.reduce((s, l) => s + l.costUsd, 0);
        const todayCost = todayLogs.reduce((s, l) => s + l.costUsd, 0);

        return createSuccessResponse({
          logs: result,
          summary: {
            totalEntries: logs.length,
            returned: result.length,
            totalCostUsd: totalCost.toFixed(2),
            todayCostUsd: todayCost.toFixed(2),
            dailyBudgetUsd: env.AGENT_DAILY_BUDGET_USD,
            successRate:
              logs.length > 0
                ? `${((logs.filter((l) => l.success).length / logs.length) * 100).toFixed(0)}%`
                : "N/A",
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(
          `エージェントログの取得に失敗しました: ${message}`
        );
      }
    }
  );

  // --- set-agent-goal ---
  server.tool(
    "set-agent-goal",
    "エージェントの目標を設定・更新する。目標はエージェントのシステムプロンプトに反映される。",
    {
      weeklyPVTarget: z
        .number()
        .optional()
        .describe("週間PV目標"),
      monthlyArticleTarget: z
        .number()
        .optional()
        .describe("月間記事投稿目標"),
      promotionFrequency: z
        .enum(["daily", "every-other-day", "weekly"])
        .optional()
        .describe("SNS宣伝頻度"),
      focusTopics: z
        .array(z.string())
        .optional()
        .describe("注力トピックリスト"),
      customInstructions: z
        .string()
        .optional()
        .describe("カスタム指示（自由記述）"),
    },
    async ({
      weeklyPVTarget,
      monthlyArticleTarget,
      promotionFrequency,
      focusTopics,
      customInstructions,
    }) => {
      try {
        const current = getAgentGoal();

        if (weeklyPVTarget !== undefined)
          current.weeklyPVTarget = weeklyPVTarget;
        if (monthlyArticleTarget !== undefined)
          current.monthlyArticleTarget = monthlyArticleTarget;
        if (promotionFrequency !== undefined)
          current.promotionFrequency = promotionFrequency;
        if (focusTopics !== undefined) current.focusTopics = focusTopics;
        if (customInstructions !== undefined)
          current.customInstructions = customInstructions;

        writeJsonStore(AGENT_GOAL_FILE, current);

        return createSuccessResponse({
          status: "updated",
          goal: current,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(
          `エージェント目標の設定に失敗しました: ${message}`
        );
      }
    }
  );
}
