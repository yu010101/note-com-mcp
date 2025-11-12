import fetch from "node-fetch";
import { API_BASE_URL, DEFAULT_HEADERS } from "../config/api-config.js";
import { env } from "../config/environment.js";
import { NoteApiResponse } from "../types/api-types.js";
import { buildAuthHeaders, loginToNote, hasAuth } from "./auth.js";

// APIリクエスト用のヘルパー関数
export async function noteApiRequest(
  endpoint: string,
  method: string = "GET",
  body: any = null,
  requireAuth: boolean = false,
  customHeaders?: { [key: string]: string }
): Promise<NoteApiResponse> {
  const headers: { [key: string]: string } = {
    ...DEFAULT_HEADERS
  };

  // 認証ヘッダーを追加
  if (requireAuth || hasAuth()) {
    const authHeaders = buildAuthHeaders();
    if (requireAuth && Object.keys(authHeaders).length === 0 && env.NOTE_EMAIL && env.NOTE_PASSWORD) {
      // 認証情報が必要で、メールアドレスとパスワードが設定されている場合はログイン試行
      const loggedIn = await loginToNote();
      if (loggedIn) {
        const newAuthHeaders = buildAuthHeaders();
        Object.assign(headers, newAuthHeaders);
      } else {
        throw new Error("認証が必要です。ログインに失敗しました。");
      }
    } else if (requireAuth && Object.keys(authHeaders).length === 0) {
      throw new Error("認証情報が必要です。.envファイルに認証情報を設定してください。");
    } else {
      Object.assign(headers, authHeaders);
    }
  }

  // POST/PUTリクエストの場合、OriginとRefererヘッダーを追加（CSRF対策）
  if (method === "POST" || method === "PUT") {
    headers["Origin"] = "https://note.com";
    headers["Referer"] = "https://note.com/";
  }

  // customHeadersがある場合は最後に適用（優先）
  if (customHeaders) {
    Object.assign(headers, customHeaders);
  }

  const options: any = {
    method,
    headers,
  };

  if (body && (method === "POST" || method === "PUT")) {
    options.body = JSON.stringify(body);
  }

  try {
    if (env.DEBUG) {
      console.error(`Requesting ${API_BASE_URL}${endpoint}`);
      console.error(`Request Headers: ${JSON.stringify(headers)}`);
      if (body && (method === "POST" || method === "PUT")) {
        console.error(`Request Body: ${JSON.stringify(body)}`);
      }
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, options);

    if (!response.ok) {
      let errorText = "";
      try {
        errorText = await response.text();
      } catch (e) {
        errorText = "（レスポンステキストの取得に失敗）";
      }

      if (env.DEBUG) {
        console.error(`API error on endpoint ${endpoint}: ${response.status} ${response.statusText}`);
        console.error(`API error response body: ${errorText}`);
        
        // エンドポイントのバージョンをチェック
        if (endpoint.includes("/v1/") || endpoint.includes("/v3/")) {
          console.error(`Note: This endpoint uses API version ${endpoint.includes("/v1/") ? "v1" : "v3"}. Consider trying v2 version if available.`);
          if (endpoint.includes("/v3/notes/")) {
            const altPath = endpoint.replace("/v3/notes/", "/v2/notes/");
            console.error(`Alternative endpoint suggestion: ${altPath}`);
          } else if (endpoint.includes("/v3/searches")) {
            const altPath = endpoint.replace("/v3/searches", "/v2/searches");
            console.error(`Alternative endpoint suggestion: ${altPath}`);
          }
        }
      }

      // エラー種別ごとの詳細な説明
      if (response.status === 401 || response.status === 403) {
        throw new Error("認証エラー: noteへのアクセス権限がありません。認証情報を確認してください。");
      } else if (response.status === 404) {
        console.error(`404 Not Found: エンドポイント ${endpoint} が存在しないか、変更された可能性があります。APIバージョンを確認してください。`);
      } else if (response.status === 400) {
        console.error(`400 Bad Request: リクエストパラメータが不正な可能性があります。`);
      }

      throw new Error(`API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json() as NoteApiResponse;
    return data;
  } catch (error) {
    if (env.DEBUG) {
      console.error(`Error calling note API: ${error}`);
    }
    throw error;
  }
}