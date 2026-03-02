import { randomUUID } from "crypto";
import { InteractionEntry } from "../types/analytics-types.js";
import { readJsonStore, appendToJsonArray } from "./memory-store.js";

const INTERACTION_LOG_FILE = "interaction-log.json";

/**
 * インタラクションを記録する
 */
export function recordInteraction(
  entry: Omit<InteractionEntry, "id" | "timestamp">
): void {
  const full: InteractionEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  };
  appendToJsonArray(INTERACTION_LOG_FILE, full);
}

/**
 * インタラクション履歴を取得する（ユーザー/期間フィルタ）
 */
export function getInteractions(
  username?: string,
  days?: number
): InteractionEntry[] {
  const logs = readJsonStore<InteractionEntry[]>(INTERACTION_LOG_FILE, []);

  let filtered = logs;

  if (username) {
    filtered = filtered.filter((e) => e.username === username);
  }

  if (days) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString();
    filtered = filtered.filter((e) => e.timestamp >= cutoffStr);
  }

  return filtered;
}

/**
 * 特定ユーザーと既にインタラクション済みか判定（重複防止）
 */
export function hasInteractedWith(
  username: string,
  action?: InteractionEntry["action"]
): boolean {
  const logs = readJsonStore<InteractionEntry[]>(INTERACTION_LOG_FILE, []);
  return logs.some(
    (e) => e.username === username && (!action || e.action === action)
  );
}

/**
 * 今日の特定アクション実行数を取得（レート制限用）
 */
export function getDailyActionCount(action: InteractionEntry["action"]): number {
  const logs = readJsonStore<InteractionEntry[]>(INTERACTION_LOG_FILE, []);
  const todayStr = new Date().toISOString().split("T")[0];
  return logs.filter(
    (e) => e.action === action && e.timestamp.startsWith(todayStr)
  ).length;
}
