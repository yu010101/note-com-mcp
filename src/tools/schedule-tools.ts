import { z } from "zod";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSuccessResponse, createErrorResponse } from "../utils/error-handler.js";
import { readJsonStore, writeJsonStore } from "../utils/memory-store.js";
import { ScheduleEntry } from "../types/analytics-types.js";
import {
  startAllSchedules,
  stopAllSchedules,
  reloadSchedules,
  getSchedulerStatus,
} from "../utils/scheduler.js";

const SCHEDULE_FILE = "schedule-config.json";

export function registerScheduleTools(server: McpServer) {
  // --- manage-schedule ---
  server.tool(
    "manage-schedule",
    "自動実行スケジュールを管理する。追加・更新・削除・有効/無効切り替えが可能。変更後は自動でスケジューラをリロードする。",
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
            // スケジューラをリロード
            const reloaded = reloadSchedules();
            return createSuccessResponse({
              status: "added",
              schedule: entry,
              scheduler: reloaded,
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
            const reloaded = reloadSchedules();
            return createSuccessResponse({
              status: "updated",
              schedule: schedules[idx],
              scheduler: reloaded,
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
            const reloaded = reloadSchedules();
            return createSuccessResponse({
              status: "removed",
              removedSchedule: removed,
              scheduler: reloaded,
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
            const reloaded = reloadSchedules();
            return createSuccessResponse({
              status: "toggled",
              schedule: schedules[toggleIdx],
              scheduler: reloaded,
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
    "現在のスケジュール設定とスケジューラの稼働状態を取得する。",
    {},
    async () => {
      try {
        const schedules = readJsonStore<ScheduleEntry[]>(SCHEDULE_FILE, []);
        const enabled = schedules.filter((s) => s.enabled);
        const disabled = schedules.filter((s) => !s.enabled);
        const status = getSchedulerStatus();

        return createSuccessResponse({
          schedules,
          summary: {
            totalSchedules: schedules.length,
            enabledCount: enabled.length,
            disabledCount: disabled.length,
          },
          scheduler: status,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`スケジュール取得に失敗しました: ${message}`);
      }
    }
  );

  // --- start-scheduler ---
  server.tool(
    "start-scheduler",
    "内蔵スケジューラを起動する。schedule-config.jsonの有効なスケジュールに基づいてcronジョブを開始する。HTTPモードで起動している必要がある。",
    {},
    async () => {
      try {
        const result = startAllSchedules();
        const status = getSchedulerStatus();
        return createSuccessResponse({
          status: "started",
          ...result,
          scheduler: status,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`スケジューラの起動に失敗しました: ${message}`);
      }
    }
  );

  // --- stop-scheduler ---
  server.tool(
    "stop-scheduler",
    "内蔵スケジューラを停止する。全てのcronジョブを停止する。",
    {},
    async () => {
      try {
        const stopped = stopAllSchedules();
        return createSuccessResponse({
          status: "stopped",
          stoppedJobs: stopped,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`スケジューラの停止に失敗しました: ${message}`);
      }
    }
  );
}
