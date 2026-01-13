import { ToolResponse, ErrorResponse } from "../types/api-types.js";

export function createSuccessResponse(data: any): ToolResponse {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function createErrorResponse(error: string | Error): ErrorResponse {
  const errorMessage = error instanceof Error ? error.message : error;
  return {
    content: [
      {
        type: "text",
        text: errorMessage,
      },
    ],
    isError: true,
  };
}

export function createAuthErrorResponse(): ErrorResponse {
  return createErrorResponse(
    "認証情報がないため、この操作を実行できません。.envファイルに認証情報を設定してください。"
  );
}

export function createNotFoundResponse(resource: string): ErrorResponse {
  return createErrorResponse(`${resource}が見つかりませんでした。`);
}

export function createValidationErrorResponse(field: string, reason: string): ErrorResponse {
  return createErrorResponse(`入力検証エラー: ${field} - ${reason}`);
}

// 共通のエラーハンドラー
export function handleApiError(error: any, operation: string): ErrorResponse {
  console.error(`Error in ${operation}:`, error);

  if (error.message?.includes("認証")) {
    return createAuthErrorResponse();
  }

  if (error.message?.includes("404")) {
    return createNotFoundResponse(operation);
  }

  return createErrorResponse(`${operation}に失敗しました: ${error.message || error}`);
}

// レスポンスデータの安全な抽出
export function safeExtractData<T>(
  apiResponse: any,
  extractors: Array<(data: any) => T[] | null>,
  defaultValue: T[] = []
): T[] {
  if (!apiResponse?.data) {
    return defaultValue;
  }

  for (const extractor of extractors) {
    const result = extractor(apiResponse.data);
    if (result !== null && Array.isArray(result)) {
      return result;
    }
  }

  return defaultValue;
}

// 一般的なデータ抽出器
export const commonExtractors = {
  notes: [
    (data: any) => (Array.isArray(data.notes) ? data.notes : null),
    (data: any) => (data.notes?.contents ? data.notes.contents : null),
    (data: any) =>
      Array.isArray(data.contents)
        ? data.contents
            .filter((item: any) => item.type === "note")
            .map((item: any) => item.note || item)
        : null,
    (data: any) => (Array.isArray(data) ? data : null),
  ],

  users: [
    (data: any) => (Array.isArray(data.users) ? data.users : null),
    (data: any) => (Array.isArray(data) ? data : null),
  ],

  magazines: [
    (data: any) => (Array.isArray(data.magazines) ? data.magazines : null),
    (data: any) => (Array.isArray(data) ? data : null),
  ],

  memberships: [
    (data: any) => (Array.isArray(data.summaries) ? data.summaries : null),
    (data: any) => (Array.isArray(data.membership_summaries) ? data.membership_summaries : null),
    (data: any) => (Array.isArray(data.circles) ? data.circles : null),
    (data: any) => (Array.isArray(data.memberships) ? data.memberships : null),
    (data: any) => (Array.isArray(data) ? data : null),
  ],

  plans: [
    (data: any) => (Array.isArray(data.plans) ? data.plans : null),
    (data: any) => (Array.isArray(data.circle_plans) ? data.circle_plans : null),
    (data: any) => (Array.isArray(data) ? data : null),
  ],
};

// トータル件数の安全な抽出
export function safeExtractTotal(apiResponse: any, arrayLength: number): number {
  if (!apiResponse?.data) {
    return arrayLength;
  }

  const data = apiResponse.data;

  // 様々な総数プロパティを確認
  const totalFields = [
    "total_count",
    "totalCount",
    "notesCount",
    "usersCount",
    "magazinesCount",
    "total",
  ];

  for (const field of totalFields) {
    if (typeof data[field] === "number") {
      return data[field];
    }
  }

  // notesオブジェクトの中のtotal_countも確認
  if (data.notes && typeof data.notes.total_count === "number") {
    return data.notes.total_count;
  }

  return arrayLength;
}
