"use client";

import { useEffect } from "react";

import { useSupabaseClient } from "../providers/SupabaseClientProvider";
import { useKioskStore } from "../state/useKioskStore";
import type { ProfileRow, SessionItemRecord, SessionRow } from "../types";

export function useSessionRealtime(
  sessionId: string | null | undefined,
  profileId: string | null | undefined,
): void {
  const supabase = useSupabaseClient();
  const setCategories = useKioskStore((state) => state.setCategories);
  const setSessionItems = useKioskStore((state) => state.setSessionItems);
  const prependSessionItem = useKioskStore((state) => state.prependSessionItem);
  const updateSession = useKioskStore((state) => state.updateSession);
  const updateProfile = useKioskStore((state) => state.updateProfile);
  const clearSessionData = useKioskStore((state) => state.clearSessionData);
  const touchActivity = useKioskStore((state) => state.touchActivity);

  useEffect(() => {
    if (!sessionId) {
      clearSessionData();
      return;
    }

    let isCancelled = false;
    const channel = supabase.channel(`session-${sessionId}`);

    const loadInitialData = async () => {
      try {
        const [categoriesResult, itemsResult] = await Promise.all([
          supabase.from("categories").select("*"),
          supabase
            .from("session_items")
            .select("*, categories(*), transactions(*)")
            .eq("session_id", sessionId)
            .order("detected_at", { ascending: false }),
        ]);

        if (!isCancelled && categoriesResult.data) {
          setCategories(categoriesResult.data);
        }

        if (!isCancelled && itemsResult.data) {
          setSessionItems(itemsResult.data as SessionItemRecord[]);
        }
      } catch (error) {
        console.error("Failed to load session data", error);
      }
    };

    loadInitialData();

    channel
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "session_items",
          filter: `session_id=eq.${sessionId}`,
        },
        async (payload) => {
          try {
            const { data, error } = await supabase
              .from("session_items")
              .select("*, categories(*), transactions(*)")
              .eq("id", payload.new.id as string)
              .single();

            if (!error && data && !isCancelled) {
              prependSessionItem(data as SessionItemRecord);
              touchActivity();
            }
          } catch (error) {
            console.error("Failed to fetch new session item", error);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "sessions",
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          if (!isCancelled) {
            updateSession(payload.new as SessionRow);
          }
        },
      );

    if (profileId) {
      channel.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${profileId}`,
        },
        (payload) => {
          if (!isCancelled) {
            updateProfile(payload.new as ProfileRow);
            touchActivity();
          }
        },
      );
    }

    channel.subscribe((status) => {
      if (status === "CHANNEL_ERROR") {
        console.error("Realtime channel error for session", sessionId);
      }
    });

    return () => {
      isCancelled = true;
      supabase
        .removeChannel(channel)
        .catch((error) => console.error("Failed to remove channel", error));
    };
  }, [
    clearSessionData,
    prependSessionItem,
    profileId,
    sessionId,
    setCategories,
    setSessionItems,
    supabase,
    touchActivity,
    updateProfile,
    updateSession,
  ]);
}
