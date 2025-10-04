import { callSupabaseFunction } from "../../../lib/supabase/functions";
import type { Database } from "../../../lib/database.types";

export interface CloseSessionInput {
  sessionId: string;
  status?: "complete" | "expired" | "error";
}

export interface CloseSessionResponse {
  session: Database["public"]["Tables"]["sessions"]["Row"];
}

export async function closeSession(
  input: CloseSessionInput,
): Promise<CloseSessionResponse> {
  const payload = {
    sessionId: input.sessionId,
    status: input.status ?? "complete",
  };

  return callSupabaseFunction<CloseSessionResponse>("close-session", {
    body: payload,
  });
}
