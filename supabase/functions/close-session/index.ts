import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseClient.ts";

interface CloseSessionRequest {
  sessionId?: string;
  status?: "complete" | "expired" | "error";
}

const DEFAULT_STATUS: CloseSessionRequest["status"] = "complete";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const payload = body as CloseSessionRequest;

    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : undefined;
    const requestedStatus = payload.status ?? DEFAULT_STATUS;

    if (!sessionId) {
      return new Response(JSON.stringify({ error: "Missing sessionId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["complete", "expired", "error"].includes(requestedStatus)) {
      return new Response(JSON.stringify({ error: "Invalid status" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await supabaseAdmin.rpc("close_session", {
      session_id: sessionId,
      next_status: requestedStatus,
    });

    if (error) {
      const status = error.code === "P0002" ? 404 : 400;
      return new Response(JSON.stringify({ error: error.message ?? "Failed to close session" }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ session: data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Unexpected error";

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
