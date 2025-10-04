import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseClient.ts";

const IDENTIFIER_TYPE = "student_barcode";
const DEFAULT_REDIRECT = Deno.env.get("KIOSK_REDIRECT_URL") ?? "http://localhost:3000/kiosk";

interface AuthRequestPayload {
  barcode?: string;
  displayName?: string;
  edgeDeviceLabel?: string;
}

function normalizeIdentifier(raw: string): string {
  return raw.trim();
}

async function resolveEdgeDeviceId(label?: string | null): Promise<string | null> {
  if (!label) return null;

  const normalizedLabel = label.trim();
  if (!normalizedLabel) return null;

  const existing = await supabaseAdmin
    .from("edge_devices")
    .select("id")
    .eq("label", normalizedLabel)
    .maybeSingle();

  if (existing.error && existing.error.code !== "PGRST116") {
    throw existing.error;
  }

  if (existing.data) {
    return existing.data.id;
  }

  const inserted = await supabaseAdmin
    .from("edge_devices")
    .insert({ label: normalizedLabel })
    .select("id")
    .single();

  if (inserted.error) {
    throw inserted.error;
  }

  return inserted.data.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }

  try {
    const payload = (await req.json().catch(() => ({}))) as AuthRequestPayload;
    const rawBarcode = payload.barcode ?? "";
    const normalizedBarcode = normalizeIdentifier(rawBarcode);

    if (!normalizedBarcode) {
      return new Response(JSON.stringify({ error: "Missing barcode" }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    const syntheticEmail = `${normalizedBarcode}@recycle-sorter.com`;
    const preferredDisplayName = payload.displayName?.trim();

    const identifierLookup = await supabaseAdmin
      .from("profile_identifiers")
      .select(
        `id, profile_id,
         profiles:profile_id (id, display_name, email, phone, balance_cents, created_at, updated_at)`
      )
      .eq("type", IDENTIFIER_TYPE)
      .eq("identifier", normalizedBarcode)
      .maybeSingle();

    if (identifierLookup.error && identifierLookup.error.code !== "PGRST116") {
      throw identifierLookup.error;
    }

    const existingProfile = identifierLookup.data?.profiles ?? null;
    const profileId = existingProfile?.id ?? identifierLookup.data?.profile_id ?? null;

    const userLookup = await supabaseAdmin.auth.admin.getUserByEmail(syntheticEmail);

    if (userLookup.error && userLookup.error.message !== "User not found") {
      throw userLookup.error;
    }

    const resolvedDisplayName =
      preferredDisplayName ??
      (existingProfile?.display_name ?? (userLookup.data.user?.user_metadata?.display_name as string | undefined)) ??
      `Student ${normalizedBarcode.slice(-4).padStart(4, "0")}`;

    const user = userLookup.data.user
      ? userLookup.data.user
      : (await (async () => {
          const created = await supabaseAdmin.auth.admin.createUser({
            email: syntheticEmail,
            email_confirm: true,
            user_metadata: {
              display_name: resolvedDisplayName,
              barcode: normalizedBarcode,
              identifier_type: IDENTIFIER_TYPE,
            },
          });

          if (created.error) {
            throw created.error;
          }

          return created.data.user;
        })());

    if (!user) {
      throw new Error("Failed to resolve Supabase auth user");
    }

    const profileMutation = await supabaseAdmin
      .from("profiles")
      .upsert(
        {
          id: user.id,
          display_name: resolvedDisplayName,
          email: syntheticEmail,
        },
        { onConflict: "id" }
      )
      .select("id, display_name, email, phone, balance_cents, created_at, updated_at")
      .single();

    if (profileMutation.error) {
      throw profileMutation.error;
    }

    const profile = profileMutation.data;

    const identifierMutation = await supabaseAdmin
      .from("profile_identifiers")
      .upsert(
        {
          profile_id: profile.id,
          type: IDENTIFIER_TYPE,
          identifier: normalizedBarcode,
        },
        { onConflict: "type,identifier" }
      )
      .select("id, profile_id, type, identifier, created_at")
      .single();

    if (identifierMutation.error) {
      throw identifierMutation.error;
    }

    const edgeDeviceId = await resolveEdgeDeviceId(payload.edgeDeviceLabel);

    const activeSession = await supabaseAdmin
      .from("sessions")
      .select("id, profile_id, edge_device_id, status, started_at, completed_at, total_cents, metadata")
      .eq("profile_id", profile.id)
      .eq("status", "active")
      .maybeSingle();

    if (activeSession.error && activeSession.error.code !== "PGRST116") {
      throw activeSession.error;
    }

    let sessionRecord = activeSession.data ?? null;

    if (sessionRecord && edgeDeviceId && sessionRecord.edge_device_id !== edgeDeviceId) {
      const updatedSession = await supabaseAdmin
        .from("sessions")
        .update({ edge_device_id: edgeDeviceId })
        .eq("id", sessionRecord.id)
        .select("id, profile_id, edge_device_id, status, started_at, completed_at, total_cents, metadata")
        .single();

      if (updatedSession.error) {
        throw updatedSession.error;
      }

      sessionRecord = updatedSession.data;
    }

    if (!sessionRecord) {
      const sessionInsert = await supabaseAdmin
        .from("sessions")
        .insert({
          profile_id: profile.id,
          edge_device_id: edgeDeviceId,
          metadata: edgeDeviceId ? {} : { note: "no_edge_device" },
        })
        .select("id, profile_id, edge_device_id, status, started_at, completed_at, total_cents, metadata")
        .single();

      if (sessionInsert.error) {
        throw sessionInsert.error;
      }

      sessionRecord = sessionInsert.data;
    }

    const magicLink = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: syntheticEmail,
      options: {
        redirectTo: DEFAULT_REDIRECT,
      },
    });

    if (magicLink.error) {
      throw magicLink.error;
    }

    const responsePayload = {
      profile,
      identifier: identifierMutation.data,
      session: sessionRecord,
      auth: {
        email: syntheticEmail,
        action_link: magicLink.data?.action_link,
        otp: magicLink.data?.properties?.email_otp,
      },
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Unexpected error";

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }
});
