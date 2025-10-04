import { appConfig } from "../config";

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

type RequestBody = JsonValue | FormData | URLSearchParams;

interface FunctionCallOptions extends Omit<RequestInit, "body"> {
  body?: RequestBody;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS";
}

function buildUrl(functionName: string): string {
  const base = appConfig.supabaseUrl.replace(/\/$/, "");
  return `${base}/functions/v1/${functionName}`;
}

function serializeBody(body: RequestBody | undefined): BodyInit | undefined {
  if (body instanceof FormData || body instanceof URLSearchParams) {
    return body;
  }

  if (body === undefined) {
    return undefined;
  }

  return JSON.stringify(body);
}

export async function callSupabaseFunction<TResponse>(
  functionName: string,
  options: FunctionCallOptions = {},
): Promise<TResponse> {
  const { body, headers, method = "POST", ...rest } = options;

  const requestHeaders = new Headers(headers);
  requestHeaders.set("apikey", appConfig.supabaseAnonKey);
  requestHeaders.set("Authorization", `Bearer ${appConfig.supabaseAnonKey}`);

  if (!(body instanceof FormData) && !(body instanceof URLSearchParams)) {
    requestHeaders.set("Content-Type", "application/json");
  }

  const response = await fetch(buildUrl(functionName), {
    method,
    body: serializeBody(body),
    headers: requestHeaders,
    ...rest,
  });

  const responseText = await response.text();
  let parsed: unknown = undefined;

  if (responseText) {
    try {
      parsed = JSON.parse(responseText);
    } catch {
      parsed = responseText;
    }
  }

  if (!response.ok) {
    const message =
      (parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: string }).error)
        : response.statusText) || "Unknown error";

    throw new Error(message);
  }

  return parsed as TResponse;
}
