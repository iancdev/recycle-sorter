import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "../../../../lib/database.types";

const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  (process.env.SUPABASE_PROJECT_ID
    ? `https://${process.env.SUPABASE_PROJECT_ID}.supabase.co`
    : "");

export async function POST(request: Request) {
  if (!SUPABASE_SERVICE_KEY || !SUPABASE_URL) {
    return NextResponse.json(
      { error: "Server configuration missing for Supabase access." },
      { status: 500 },
    );
  }

  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const body = (await request.json().catch(() => ({}))) as {
      profileId?: string;
      edgeDeviceLabel?: string | null;
    };

    const profileId = (body.profileId || "").trim();
    const edgeLabel = (body.edgeDeviceLabel || "").trim();

    if (!profileId) {
      return NextResponse.json(
        { error: "profileId is required" },
        { status: 400 },
      );
    }

    // Resolve edge device id from label (create if missing)
    let edgeDeviceId: string | null = null;
    if (edgeLabel) {
      const existing = await supabase
        .from("edge_devices")
        .select("id")
        .eq("label", edgeLabel)
        .maybeSingle();

      if (existing.error && existing.error.code !== "PGRST116") {
        throw existing.error;
      }

      if (existing.data?.id) {
        edgeDeviceId = existing.data.id;
      } else {
        const inserted = await supabase
          .from("edge_devices")
          .insert({ label: edgeLabel })
          .select("id")
          .single();
        if (inserted.error) {
          throw inserted.error;
        }
        edgeDeviceId = inserted.data.id;
      }
    }

    // Close any existing active session for this profile
    const active = await supabase
      .from("sessions")
      .select("id")
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();

    if (!active.error && active.data?.id) {
      try {
        await supabase.rpc("close_session", {
          session_id: active.data.id,
          next_status: "expired",
        });
      } catch {
        // ignore close errors
      }
    }

    // Ensure no other active sessions remain for this device
    if (edgeDeviceId) {
      await supabase
        .from("sessions")
        .update({ status: "expired", completed_at: new Date().toISOString() })
        .eq("edge_device_id", edgeDeviceId)
        .eq("status", "active");
    }

    // Create a new session bound to this device
    const sessionInsert = await supabase
      .from("sessions")
      .insert({
        profile_id: profileId,
        edge_device_id: edgeDeviceId,
        metadata: edgeDeviceId ? {} : { note: "no_edge_device" },
      })
      .select(
        "id, profile_id, edge_device_id, status, started_at, completed_at, total_cents, metadata",
      )
      .single();

    if (sessionInsert.error) {
      throw sessionInsert.error;
    }

    return NextResponse.json({ session: sessionInsert.data }, { status: 200 });
  } catch (error) {
    console.error("start-session error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
