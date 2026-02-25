import cron from "node-cron";
import fetch from "node-fetch";
import { readJsonStore, writeJsonStore } from "./memory-store.js";
import { ScheduleEntry } from "../types/analytics-types.js";

const SCHEDULE_FILE = "schedule-config.json";

// アクティブなcronジョブを管理
const activeJobs = new Map<string, cron.ScheduledTask>();

let mcpBaseUrl = "http://127.0.0.1:3000";

/**
 * MCPサーバーのベースURLを設定
 */
export function setMcpBaseUrl(url: string): void {
  mcpBaseUrl = url;
}

/**
 * スケジュールに基づいてMCPツールを内部呼び出し
 */
async function executeScheduledTool(schedule: ScheduleEntry): Promise<void> {
  const url = `${mcpBaseUrl}/mcp`;
  const rpcBody = {
    jsonrpc: "2.0",
    id: Date.now(),
    method: "tools/call",
    params: {
      name: schedule.workflow,
      arguments: schedule.params,
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rpcBody),
    });

    if (response.ok) {
      console.error(
        `[scheduler] ${schedule.name} (${schedule.workflow}) 実行成功`
      );
    } else {
      console.error(
        `[scheduler] ${schedule.name} 実行失敗: HTTP ${response.status}`
      );
    }
  } catch (error) {
    console.error(
      `[scheduler] ${schedule.name} 実行エラー:`,
      error instanceof Error ? error.message : error
    );
  }

  // lastRunを更新
  try {
    const schedules = readJsonStore<ScheduleEntry[]>(SCHEDULE_FILE, []);
    const idx = schedules.findIndex((s) => s.id === schedule.id);
    if (idx !== -1) {
      schedules[idx].lastRun = new Date().toISOString();
      writeJsonStore(SCHEDULE_FILE, schedules);
    }
  } catch {
    // lastRun更新失敗は無視
  }
}

/**
 * 単一スケジュールのcronジョブを開始
 */
function startJob(schedule: ScheduleEntry): boolean {
  if (!cron.validate(schedule.cron)) {
    console.error(
      `[scheduler] 無効なcron式: ${schedule.cron} (${schedule.name})`
    );
    return false;
  }

  // 既存ジョブがあれば停止
  stopJob(schedule.id);

  const task = cron.schedule(schedule.cron, () => {
    console.error(`[scheduler] ${schedule.name} トリガー`);
    executeScheduledTool(schedule);
  });

  activeJobs.set(schedule.id, task);
  return true;
}

/**
 * 単一スケジュールのcronジョブを停止
 */
function stopJob(id: string): void {
  const existing = activeJobs.get(id);
  if (existing) {
    existing.stop();
    activeJobs.delete(id);
  }
}

/**
 * 全スケジュールを読み込んでcronジョブを開始
 */
export function startAllSchedules(): { started: number; skipped: number } {
  // 既存ジョブを全停止
  stopAllSchedules();

  const schedules = readJsonStore<ScheduleEntry[]>(SCHEDULE_FILE, []);
  let started = 0;
  let skipped = 0;

  for (const schedule of schedules) {
    if (!schedule.enabled) {
      skipped++;
      continue;
    }
    if (startJob(schedule)) {
      started++;
    } else {
      skipped++;
    }
  }

  if (started > 0) {
    console.error(`[scheduler] ${started}件のスケジュールを開始`);
  }

  return { started, skipped };
}

/**
 * 全cronジョブを停止
 */
export function stopAllSchedules(): number {
  const count = activeJobs.size;
  for (const [id, task] of activeJobs) {
    task.stop();
    activeJobs.delete(id);
  }
  return count;
}

/**
 * スケジュール設定をリロード（設定変更後に呼ぶ）
 */
export function reloadSchedules(): { started: number; skipped: number } {
  return startAllSchedules();
}

/**
 * アクティブなジョブの状態を取得
 */
export function getSchedulerStatus(): {
  running: boolean;
  activeJobCount: number;
  activeJobs: string[];
} {
  return {
    running: activeJobs.size > 0,
    activeJobCount: activeJobs.size,
    activeJobs: Array.from(activeJobs.keys()),
  };
}
