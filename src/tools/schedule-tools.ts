import { z } from "zod";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSuccessResponse, createErrorResponse } from "../utils/error-handler.js";
import { readJsonStore, writeJsonStore } from "../utils/memory-store.js";
import { ScheduleEntry } from "../types/analytics-types.js";

const SCHEDULE_FILE = "schedule-config.json";

export function registerScheduleTools(server: McpServer) {
  // --- manage-schedule ---
  server.tool(
    "manage-schedule",
    "自動実行スケジュールを管理する。追加・更新・削除・有効/無効切り替えが可能。実際のcron実行はn8n等の外部スケジューラに委譲する。",
    {
      action: z
        .enum(["add", "update", "remove", "toggle"])
        .describe("操作種別"),
      id: z.string().optional().describe("update/remove/toggle時の対象ID"),
      name: z.string().optional().describe("スケジュール名（add時に必須）"),
      cron: z.string().optional().describe("cron式（例: '0 9 * * *' = 毎朝9時）"),
      workflow: z.string().optional().describe("実行するツール/ワークフロー名"),
      params: z.record(z.unknown()).optional().describe("ツールに渡すパラメータ"),
      description: z.string().optional().describe("説明"),
    },
    async ({ action, id, name, cron, workflow, params, description }) => {
      try {
        const schedules = readJsonStore<ScheduleEntry[]>(SCHEDULE_FILE, []);

        switch (action) {
          case "add": {
            if (!name || !cron || !workflow) {
              return createErrorResponse(
                "add操作にはname, cron, workflowが必須です。"
              );
            }
            const entry: ScheduleEntry = {
              id: randomUUID(),
              name,
              cron,
              workflow,
              params: params ?? {},
              enabled: true,
              description: description ?? "",
              createdAt: new Date().toISOString(),
            };
            schedules.push(entry);
            writeJsonStore(SCHEDULE_FILE, schedules);
            return createSuccessResponse({
              status: "added",
              schedule: entry,
            });
          }

          case "update": {
            if (!id) {
              return createErrorResponse("update操作にはidが必須です。");
            }
            const idx = schedules.findIndex((s) => s.id === id);
            if (idx === -1) {
              return createErrorResponse(`スケジュールID「${id}」が見つかりません。`);
            }
            if (name !== undefined) schedules[idx].name = name;
            if (cron !== undefined) schedules[idx].cron = cron;
            if (workflow !== undefined) schedules[idx].workflow = workflow;
            if (params !== undefined) schedules[idx].params = params;
            if (description !== undefined) schedules[idx].description = description;
            writeJsonStore(SCHEDULE_FILE, schedules);
            return createSuccessResponse({
              status: "updated",
              schedule: schedules[idx],
            });
          }

          case "remove": {
            if (!id) {
              return createErrorResponse("remove操作にはidが必須です。");
            }
            const removeIdx = schedules.findIndex((s) => s.id === id);
            if (removeIdx === -1) {
              return createErrorResponse(`スケジュールID「${id}」が見つかりません。`);
            }
            const removed = schedules.splice(removeIdx, 1)[0];
            writeJsonStore(SCHEDULE_FILE, schedules);
            return createSuccessResponse({
              status: "removed",
              removedSchedule: removed,
            });
          }

          case "toggle": {
            if (!id) {
              return createErrorResponse("toggle操作にはidが必須です。");
            }
            const toggleIdx = schedules.findIndex((s) => s.id === id);
            if (toggleIdx === -1) {
              return createErrorResponse(`スケジュールID「${id}」が見つかりません。`);
            }
            schedules[toggleIdx].enabled = !schedules[toggleIdx].enabled;
            writeJsonStore(SCHEDULE_FILE, schedules);
            return createSuccessResponse({
              status: "toggled",
              schedule: schedules[toggleIdx],
            });
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`スケジュール管理に失敗しました: ${message}`);
      }
    }
  );

  // --- get-schedule ---
  server.tool(
    "get-schedule",
    "現在のスケジュール設定と概要を取得する。",
    {},
    async () => {
      try {
        const schedules = readJsonStore<ScheduleEntry[]>(SCHEDULE_FILE, []);
        const enabled = schedules.filter((s) => s.enabled);
        const disabled = schedules.filter((s) => !s.enabled);

        return createSuccessResponse({
          schedules,
          summary: {
            totalSchedules: schedules.length,
            enabledCount: enabled.length,
            disabledCount: disabled.length,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`スケジュール取得に失敗しました: ${message}`);
      }
    }
  );

  // --- export-n8n-workflow ---
  server.tool(
    "export-n8n-workflow",
    "スケジュール設定からn8nインポート用のワークフローJSONを生成する。n8nにインポートするだけで自動運用を開始できる。",
    {
      mcpUrl: z
        .string()
        .default("http://localhost:3000/mcp")
        .describe("MCPサーバーのURL"),
    },
    async ({ mcpUrl }) => {
      try {
        const schedules = readJsonStore<ScheduleEntry[]>(SCHEDULE_FILE, []);
        const enabled = schedules.filter((s) => s.enabled);

        if (enabled.length === 0) {
          return createSuccessResponse({
            status: "no_schedules",
            message:
              "有効なスケジュールがありません。manage-scheduleでスケジュールを追加してください。",
          });
        }

        // n8nワークフロー生成
        const workflows = enabled.map((schedule) => {
          const workflowId = randomUUID();

          // JSON-RPC リクエストボディ
          const rpcBody = {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: schedule.workflow,
              arguments: schedule.params,
            },
          };

          return {
            name: `note-mcp: ${schedule.name}`,
            nodes: [
              {
                parameters: {
                  rule: {
                    interval: [{ expression: schedule.cron }],
                  },
                },
                id: randomUUID(),
                name: "Cron Trigger",
                type: "n8n-nodes-base.scheduleTrigger",
                typeVersion: 1.2,
                position: [250, 300],
              },
              {
                parameters: {
                  method: "POST",
                  url: mcpUrl,
                  sendHeaders: true,
                  headerParameters: {
                    parameters: [
                      { name: "Content-Type", value: "application/json" },
                    ],
                  },
                  sendBody: true,
                  specifyBody: "json",
                  jsonBody: JSON.stringify(rpcBody),
                },
                id: randomUUID(),
                name: `Execute: ${schedule.workflow}`,
                type: "n8n-nodes-base.httpRequest",
                typeVersion: 4.2,
                position: [500, 300],
              },
            ],
            connections: {
              "Cron Trigger": {
                main: [[{ node: `Execute: ${schedule.workflow}`, type: "main", index: 0 }]],
              },
            },
            settings: {
              executionOrder: "v1",
            },
            meta: {
              templateId: workflowId,
              description: schedule.description,
              generated: true,
              generatedAt: new Date().toISOString(),
              source: "note-mcp-server/export-n8n-workflow",
            },
          };
        });

        return createSuccessResponse({
          status: "generated",
          workflowCount: workflows.length,
          mcpUrl,
          workflows,
          importInstructions: [
            "1. n8nを開き、左メニューから「Workflows」を選択",
            "2. 右上の「...」→「Import from JSON」をクリック",
            "3. 上記のworkflowsの各要素を個別にペーストしてインポート",
            "4. 各ワークフローをアクティベート（トグルON）",
            "5. MCPサーバーがHTTPモードで起動していることを確認",
          ],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`n8nワークフロー生成に失敗しました: ${message}`);
      }
    }
  );
}
