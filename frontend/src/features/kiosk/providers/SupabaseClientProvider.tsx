"use client";

import { createContext, useContext, useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../../lib/database.types";
import { getSupabaseBrowserClient } from "../../../lib/supabase/browser-client";

const SupabaseClientContext =
  createContext<SupabaseClient<Database> | null>(null);

export function SupabaseClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const client = useMemo(() => getSupabaseBrowserClient(), []);

  return (
    <SupabaseClientContext.Provider value={client}>
      {children}
    </SupabaseClientContext.Provider>
  );
}

export function useSupabaseClient(): SupabaseClient<Database> {
  const context = useContext(SupabaseClientContext);

  if (!context) {
    throw new Error(
      "useSupabaseClient must be used within a SupabaseClientProvider",
    );
  }

  return context;
}
