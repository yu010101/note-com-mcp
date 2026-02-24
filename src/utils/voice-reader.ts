import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { EditorialVoice } from "../types/analytics-types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * editorial-voice.json のパスを返す（プロジェクトルート基準）
 * src/utils/ → src/ → project root
 */
export function getVoicePath(): string {
  return path.resolve(__dirname, "../../editorial-voice.json");
}

/**
 * editorial-voice.json を読み込む
 * ファイルが存在しない場合はデフォルト値を返す
 */
export function readEditorialVoice(): EditorialVoice {
  const voicePath = getVoicePath();
  if (!fs.existsSync(voicePath)) {
    return {
      writingStyle: "丁寧だが親しみやすい",
      targetAudience: "20-40代のビジネスパーソン",
      brandVoice: "実践的で具体的",
      topicFocus: ["AI活用", "自動化", "生産性"],
      avoidTopics: [],
      toneKeywords: ["わかりやすい", "実践的", "前向き"],
      examplePhrases: ["具体的に言うと、", "実際にやってみると、"],
    };
  }
  const raw = fs.readFileSync(voicePath, "utf-8");
  return JSON.parse(raw) as EditorialVoice;
}

/**
 * editorial-voice.json を書き込む
 */
export function writeEditorialVoice(voice: EditorialVoice): void {
  const voicePath = getVoicePath();
  const dir = path.dirname(voicePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(voicePath, JSON.stringify(voice, null, 2) + "\n", "utf-8");
}

/**
 * editorial-voice.json を読み込む（null返却版）
 * ファイルが存在しないまたはパースエラー時は null を返す
 */
export function readEditorialVoiceOrNull(): EditorialVoice | null {
  const voicePath = getVoicePath();
  if (!fs.existsSync(voicePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(voicePath, "utf-8")) as EditorialVoice;
  } catch {
    return null;
  }
}
