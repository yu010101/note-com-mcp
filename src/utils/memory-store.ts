import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * プロジェクトルート基準のJSONファイルパスを返す
 * src/utils/ → src/ → project root
 */
function getStorePath(filename: string): string {
  return path.resolve(__dirname, "../../", filename);
}

/**
 * JSONファイルを読み込む。ファイルが存在しないまたはパースエラー時はデフォルト値を返す
 */
export function readJsonStore<T>(filename: string, defaultValue: T): T {
  const filePath = getStorePath(filename);
  if (!fs.existsSync(filePath)) {
    return defaultValue;
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * JSONファイルに書き込む
 */
export function writeJsonStore<T>(filename: string, data: T): void {
  const filePath = getStorePath(filename);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * JSON配列ファイルにエントリを追記する
 */
export function appendToJsonArray<T>(filename: string, entry: T): void {
  const current = readJsonStore<T[]>(filename, []);
  current.push(entry);
  writeJsonStore(filename, current);
}
