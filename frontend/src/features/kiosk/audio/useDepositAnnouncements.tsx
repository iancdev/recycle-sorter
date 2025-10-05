"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { formatCurrencyFromCents } from "../../../lib/format";
import type { CategoryRow, SessionItemRecord } from "../types";

export interface DepositAnnouncement {
  itemId: string;
  text: string;
  generatedAt: number;
  audioUrl?: string | null;
  provider: { text: string; audio: string };
}

interface UseDepositAnnouncementsOptions {
  latestItem: SessionItemRecord | undefined;
  latestCategory: CategoryRow | null | undefined;
  audioEnabled: boolean;
}

interface UseDepositAnnouncementsResult {
  announcement: DepositAnnouncement | null;
  isSynthesizing: boolean;
  clearAnnouncement: () => void;
}

export function useDepositAnnouncements(
  options: UseDepositAnnouncementsOptions,
): UseDepositAnnouncementsResult {
  const { latestItem, latestCategory, audioEnabled } = options;
  const [announcement, setAnnouncement] = useState<DepositAnnouncement | null>(
    null,
  );
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const handledItemIds = useRef<Set<string>>(new Set());

  const description = useMemo(() => {
    if (!latestItem || !latestCategory) {
      return null;
    }

    const amount = formatCurrencyFromCents(latestItem.amount_cents);
    const base = `${latestCategory.display_name} detected. Credit ${amount}.`;

    if (typeof latestItem.confidence === "number") {
      const confidence = Math.round(latestItem.confidence * 100);
      return `${base} Confidence ${confidence} percent.`;
    }

    return base;
  }, [latestCategory, latestItem]);

  useEffect(() => {
    if (!audioEnabled || !latestItem || !latestCategory || !description) {
      return;
    }

    if (handledItemIds.current.has(latestItem.id)) {
      return;
    }

    handledItemIds.current.add(latestItem.id);
    setIsSynthesizing(true);

    const controller = new AbortController();

    const payload = {
      categoryName: latestCategory.display_name,
      amountCents: latestItem.amount_cents,
      confidence: latestItem.confidence ?? null,
    };

    fetch("/api/kiosk/announcement", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await response.text());
        }
        return (await response.json()) as {
          text: string;
          audio?: { type: string; value: string } | null;
          provider: { text: string; audio: string };
        };
      })
      .then((data) => {
        const audioUrl = data.audio?.type === "base64" ? data.audio.value : data.audio?.value;
        setAnnouncement({
          itemId: latestItem.id,
          text: data.text,
          generatedAt: Date.now(),
          audioUrl: audioUrl ?? null,
          provider: data.provider,
        });
        if (audioUrl) {
          const audio = new Audio(audioUrl);
          void audio.play().catch((error) => {
            console.warn("Failed to play announcement audio", error);
          });
        }
      })
      .catch((error) => {
        console.warn("Announcement generation failed", error);
        setAnnouncement({
          itemId: latestItem.id,
          text: description,
          generatedAt: Date.now(),
          audioUrl: null,
          provider: { text: "fallback", audio: "fallback" },
        });
      })
      .finally(() => {
        setIsSynthesizing(false);
      });

    return () => controller.abort();
  }, [audioEnabled, description, latestCategory, latestItem]);

  const clearAnnouncement = () => setAnnouncement(null);

  return { announcement, isSynthesizing, clearAnnouncement };
}
