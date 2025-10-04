"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../database.types";
import { appConfig } from "../config";

let browserClient: SupabaseClient<Database> | null = null;

export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (browserClient) {
    return browserClient;
  }

  browserClient = createBrowserClient<Database>(
    appConfig.supabaseUrl,
    appConfig.supabaseAnonKey,
  );

  return browserClient;
}
