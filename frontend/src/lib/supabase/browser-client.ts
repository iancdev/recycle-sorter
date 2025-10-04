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

  if (!appConfig.supabaseUrl || !appConfig.supabaseAnonKey) {
    if (typeof window === "undefined") {
      const noop = new Proxy(
        {},
        {
          get() {
            throw new Error(
              "Supabase client unavailable during build. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
            );
          },
        },
      ) as SupabaseClient<Database>;
      return noop;
    }

    throw new Error(
      "Missing Supabase environment configuration. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  browserClient = createBrowserClient<Database>(
    appConfig.supabaseUrl,
    appConfig.supabaseAnonKey,
  );

  return browserClient;
}
