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

if (!SUPABASE_URL) {
  console.warn(
    "SUPABASE_URL not provided. Set NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL for kiosk API routes.",
  );
}

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
    const body = (await request.json()) as {
      profileId?: string;
      phone?: string;
    };

    const profileId = body.profileId?.trim();
    const phone = normalizePhone(body.phone ?? "");

    if (!profileId || !phone) {
      return NextResponse.json(
        { error: "Profile ID and phone number are required." },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from("profiles")
      .update({ phone })
      .eq("id", profileId)
      .select("id, phone, display_name, balance_cents, email, created_at, updated_at")
      .single();

    if (error) {
      throw error;
    }

    try {
      await supabase.auth.admin.updateUserById(profileId, {
        phone,
        phone_confirm: false,
      });
    } catch (adminError) {
      console.warn("Failed to sync phone to auth user", adminError);
    }

    return NextResponse.json({ profile: data }, { status: 200 });
  } catch (error) {
    console.error("Failed to link phone", error);
    return NextResponse.json(
      { error: "Unable to link phone number right now." },
      { status: 500 },
    );
  }
}

function normalizePhone(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("+")) {
    return trimmed.replace(/[^0-9+]/g, "");
  }

  const digits = trimmed.replace(/\D/g, "");
  if (!digits) {
    return "";
  }

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  return `+${digits}`;
}

