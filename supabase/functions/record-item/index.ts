import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseClient.ts";

type Json = Record<string, unknown> | Array<unknown> | string | number | boolean | null;

interface RecordItemRequest {
  sessionId?: string;
  categorySlug?: string;
  amountOverrideCents?: number;
  confidence?: number;
  rawPayload?: Json;
  clientRef?: string;
}

const VALID_SLUG_REGEX = /^[a-z0-9_-]+$/;

function parseBody(raw: Record<string, unknown>): RecordItemRequest {
  return {
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : undefined,
    categorySlug: typeof raw.categorySlug === "string" ? raw.categorySlug : undefined,
    amountOverrideCents:
      typeof raw.amountOverrideCents === "number" ? Math.trunc(raw.amountOverrideCents) : undefined,
    confidence: typeof raw.confidence === "number" ? raw.confidence : undefined,
    rawPayload: "rawPayload" in raw ? (raw.rawPayload as Json) : undefined,
    clientRef: typeof raw.clientRef === "string" ? raw.clientRef : undefined,
  };
}

function validatePayload(payload: RecordItemRequest): string | null {
  if (!payload.sessionId) {
    return "Missing sessionId";
  }

  if (!payload.categorySlug) {
    return "Missing categorySlug";
  }

  if (!VALID_SLUG_REGEX.test(payload.categorySlug)) {
    return "Invalid categorySlug format";
  }

  if (
    payload.amountOverrideCents !== undefined &&
    !Number.isFinite(payload.amountOverrideCents)
  ) {
    return "amountOverrideCents must be a finite number";
  }

  if (payload.confidence !== undefined) {
    if (!Number.isFinite(payload.confidence)) {
      return "confidence must be a finite number";
    }

    if (payload.confidence < 0 || payload.confidence > 1) {
      return "confidence must be between 0 and 1";
    }
  }

  if (payload.clientRef !== undefined && payload.clientRef.trim() === "") {
    return "clientRef cannot be empty";
  }

  return null;
}

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
    const payload = parseBody(body as Record<string, unknown>);

    const validationError = validatePayload(payload);
    if (validationError) {
      return new Response(JSON.stringify({ error: validationError }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await supabaseAdmin.rpc("record_session_item", {
      session_id: payload.sessionId,
      category_slug: payload.categorySlug,
      amount_override: payload.amountOverrideCents ?? null,
      confidence: payload.confidence ?? null,
      raw_payload: payload.rawPayload ?? {},
      client_ref: payload.clientRef ?? null,
    });

    if (error) {
      const message = error.message ?? "Failed to record item";
      let status = 400;

      if (error.code === "P0002") {
        status = 404;
      } else if (error.code === "P0001") {
        status = 409;
      }

      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ result: data }), {
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
