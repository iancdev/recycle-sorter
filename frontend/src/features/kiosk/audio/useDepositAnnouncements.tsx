"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { formatCurrencyFromCents } from "../../../lib/format";
import type { CategoryRow, SessionItemRecord } from "../types";

export interface DepositAnnouncement {
  itemId: string;
  text: string;
  generatedAt: number;
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

    const timeout = window.setTimeout(() => {
      setAnnouncement({
        itemId: latestItem.id,
        text: description,
        generatedAt: Date.now(),
      });
      setIsSynthesizing(false);
      console.info("[kiosk] audio-placeholder", description);
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [audioEnabled, description, latestCategory, latestItem]);

  const clearAnnouncement = () => setAnnouncement(null);

  return { announcement, isSynthesizing, clearAnnouncement };
}
