"use client";


import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { authenticateBarcode } from "../../features/kiosk/api/authenticate-barcode";
import { closeSession } from "../../features/kiosk/api/close-session";
import { useBarcodeScanner } from "../../features/kiosk/hooks/useBarcodeScanner";
import { useSessionRealtime } from "../../features/kiosk/hooks/useSessionRealtime";
import { useDepositAnnouncements } from "../../features/kiosk/audio/useDepositAnnouncements";
import { useKioskStore } from "../../features/kiosk/state/useKioskStore";
import { appConfig } from "../../lib/config";
import { formatCurrencyFromCents } from "../../lib/format";

const INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000;

const STATUS_LABELS = {
  idle: "Ready to scan",
  authenticating: "Authenticating…",
  ready: "Session active",
  error: "Action required",
} as const;

const SCANNER_STATUS_LABELS = {
  idle: "Camera initialising",
  requesting: "Requesting camera permissions…",
  scanning: "Scanning for barcodes",
  error: "Camera unavailable",
} as const;


export default function KioskPage(): ReactElement {
  const [isClosing, setIsClosing] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const reset = useKioskStore((state) => state.reset);
  const status = useKioskStore((state) => state.status);
  const profile = useKioskStore((state) => state.profile);
  const session = useKioskStore((state) => state.session);
  const errorMessage = useKioskStore((state) => state.errorMessage);
  const lastScannedBarcode = useKioskStore((state) => state.lastScannedBarcode);
  const lastActivityAt = useKioskStore((state) => state.lastActivityAt);
  const sessionItems = useKioskStore((state) => state.sessionItems);
  const categories = useKioskStore((state) => state.categories);

  useSessionRealtime(session?.id ?? null, profile?.id ?? null);

  const enableIdleTimeout = appConfig.enableIdleTimeout;
  const enableAudioFeedback = appConfig.enableAudioFeedback;

  const handleBarcode = useCallback(async (rawBarcode: string) => {
    const trimmed = rawBarcode.trim();
    if (!trimmed) {
      return;
    }

    const store = useKioskStore.getState();
    if (store.status === "authenticating") {
      return;
    }

    const now = Date.now();
    if (
      store.lastScannedBarcode === trimmed &&
      store.lastScannedAt &&
      now - store.lastScannedAt < 1500
    ) {
      return;
    }

    store.setAuthenticating(trimmed);
    store.touchActivity();

    try {
      const payload = await authenticateBarcode({ barcode: trimmed });
      useKioskStore.getState().setReady(payload);
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error ? error.message : "Failed to authenticate barcode";
      useKioskStore.getState().setError(message);
    }
  }, []);

  const {
    start,
    stop,
    videoRef,
    status: scannerStatus,
    errorMessage: scannerError,
  } = useBarcodeScanner({
    onScan: handleBarcode,
    facingMode: "user",
  });

  useEffect(() => {
    let cancelled = false;

    start().catch((error) => {
      if (!cancelled) {
        console.error(error);
      }
    });

    return () => {
      cancelled = true;
      stop();
    };
  }, [start, stop]);

  const sessionTotal = session?.total_cents ?? 0;
  const formattedTotal = formatCurrencyFromCents(sessionTotal);
  const statusLabel = STATUS_LABELS[status];
  const scannerLabel = SCANNER_STATUS_LABELS[scannerStatus];

  const latestItem = sessionItems[0];
  const latestCategory = latestItem
    ? categories[latestItem.category_id] ?? null
    : null;
  const latestAmount = latestItem ? formatCurrencyFromCents(latestItem.amount_cents) : null;

  const receiptItems = useMemo(() => sessionItems.slice(0, 12), [sessionItems]);

  const { announcement, isSynthesizing, clearAnnouncement } = useDepositAnnouncements({
    latestItem,
    latestCategory,
    audioEnabled: enableAudioFeedback,
  });

  const handleCloseSession = useCallback(async () => {
    if (isClosing) {
      return;
    }

    const store = useKioskStore.getState();
    const activeSession = store.session;
    if (!activeSession) {
      return;
    }

    setIsClosing(true);
    try {
      await closeSession({ sessionId: activeSession.id });
      store.reset();
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error ? error.message : "Unable to close session";
      store.setError(message);
    } finally {
      setIsClosing(false);
    }
  }, [isClosing]);

  useEffect(() => {
    if (!enableIdleTimeout || status !== "ready" || !session || !lastActivityAt) {
      setCountdown(null);
      return;
    }

    let closed = false;

    const tick = () => {
      const remaining = INACTIVITY_TIMEOUT_MS - (Date.now() - lastActivityAt);

      if (remaining <= 0) {
        setCountdown(0);
        if (!closed) {
          closed = true;
          handleCloseSession().catch((error) => {
            console.error("Failed to auto-close session", error);
          });
        }
        return;
      }

      setCountdown(Math.ceil(remaining / 1000));
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, [enableIdleTimeout, handleCloseSession, lastActivityAt, session, status]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-neutral-800 px-8 py-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 text-left">
          <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-neutral-50">
                Recycle Sorter Kiosk
              </h1>
              <p className="text-sm text-neutral-400">
                Scan your student barcode to start a new recycling session.
              </p>
            </div>
            <div className="rounded-full border border-neutral-700 bg-neutral-900/80 px-4 py-1 text-xs uppercase tracking-wide text-neutral-300">
              Device: {appConfig.edgeDeviceLabel}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-8 py-10 lg:flex-row">
        <section className="flex w-full flex-1 flex-col gap-6">
          <div className="relative aspect-[4/3] overflow-hidden rounded-3xl border border-neutral-800 bg-black">
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              muted
              playsInline
              autoPlay
            />
            <div className="pointer-events-none absolute inset-x-6 bottom-6 rounded-2xl bg-neutral-900/80 px-4 py-3 text-sm text-neutral-200 shadow-lg">
              <div className="flex items-center justify-between">
                <span className="font-medium">Scanner status</span>
                <span className="text-neutral-100">{scannerLabel}</span>
              </div>
              {scannerError ? (
                <p className="mt-2 text-xs text-rose-400">{scannerError}</p>
              ) : (
                <>
                  {enableAudioFeedback && (
                    <p className="mt-2 text-xs text-neutral-500">
                      Audio feedback idle. Scan an item to generate announcements.
                    </p>
                  )}
                  <p className="mt-2 text-xs text-neutral-400">
                    Hold your card in front of the camera until it beeps. The
                    front-facing camera is optimised for landscape orientation.
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-5 text-sm text-neutral-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-neutral-400">Kiosk status</p>
                <p className="text-lg font-medium text-neutral-50">{statusLabel}</p>
                {countdown !== null && status === "ready" && (
                  <p className="mt-1 text-xs text-neutral-400">
                    Session ends automatically in <span className="font-semibold text-neutral-200">{countdown}</span> seconds.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-full border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-200 transition hover:bg-neutral-700"
                >
                  Reset kiosk
                </button>
                {status === "ready" && session && (
                  <button
                    type="button"
                    onClick={handleCloseSession}
                    disabled={isClosing}
                    className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-300 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isClosing ? "Closing…" : "Complete session"}
                  </button>
                )}
              </div>
            </div>
            {errorMessage && (
              <p className="mt-3 text-xs text-rose-400">{errorMessage}</p>
            )}
            {lastScannedBarcode && (
              <p className="mt-3 text-xs text-neutral-400">
                Last scan: <span className="font-mono">{lastScannedBarcode}</span>
              </p>
            )}
          </div>
        </section>

        <aside className="w-full max-w-[22rem] space-y-6">
          <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
            <h2 className="text-lg font-semibold text-neutral-50">Latest item</h2>
            {status === "ready" && latestItem && latestCategory ? (
              <div className="space-y-3 text-sm text-neutral-200">
                {enableAudioFeedback ? (
                  <div className="flex items-center justify-between rounded-2xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    <span>
                      {isSynthesizing
                        ? "Preparing announcement…"
                        : announcement?.text ?? "Ready to announce."}
                    </span>
                    {announcement && (
                      <button
                        type="button"
                        onClick={clearAnnouncement}
                        className="rounded-full border border-amber-400/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-200 transition hover:bg-amber-400/10"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-neutral-500">
                    Audio feedback disabled. Set NEXT_PUBLIC_ENABLE_AUDIO_FEEDBACK=true to enable.
                  </p>
                )}
                <div>
                  <p className="text-neutral-400">Category</p>
                  <p className="text-base font-semibold text-neutral-50">
                    {latestCategory.display_name}
                  </p>
                </div>
                <div className="flex items-center justify-between text-sm text-neutral-300">
                  <span>Payout</span>
                  <span className="font-semibold text-sky-300">{latestAmount}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-neutral-400">
                  <span>Detected</span>
                  <span>
                    {new Date(latestItem.detected_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                </div>
                {typeof latestItem.confidence === "number" && (
                  <div className="flex items-center justify-between text-xs text-neutral-400">
                    <span>Confidence</span>
                    <span>{Math.round(latestItem.confidence * 100)}%</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 space-y-3 text-sm text-neutral-400">
                <p>
                  Deposited items will appear here with category, reward, and
                  detection confidence.
                </p>
                {enableAudioFeedback && (
                  <p className="text-xs text-neutral-500">
                    Audio feedback idle. Scan an item to generate announcements.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
            <h2 className="text-lg font-semibold text-neutral-50">Active session</h2>
            {status === "ready" && profile && session ? (
              <div className="mt-4 space-y-3 text-sm text-neutral-200">
                <div>
                  <p className="text-neutral-400">Student</p>
                  <p className="text-base font-medium text-neutral-100">
                    {profile.display_name ?? profile.email ?? "Unnamed"}
                  </p>
                </div>
                <div>
                  <p className="text-neutral-400">Current balance</p>
                  <p className="text-base font-semibold text-emerald-300">
                    {formatCurrencyFromCents(profile.balance_cents)}
                  </p>
                </div>
                <div>
                  <p className="text-neutral-400">Session total</p>
                  <p className="text-base font-semibold text-sky-300">
                    {formattedTotal}
                  </p>
                </div>
                <div>
                  <p className="text-neutral-400">Session started</p>
                  <p className="text-sm text-neutral-200">
                    {new Date(session.started_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            ) : (
              <>
                {enableAudioFeedback && (
                  <p className="mt-4 text-xs text-neutral-500">
                    Audio feedback idle. Scan an item to generate announcements.
                  </p>
                )}
                <p className="mt-4 text-sm text-neutral-400">
                  Awaiting a valid scan. Session details will appear here once the
                  barcode is authenticated.
                </p>
              </>
            )}
          </div>

          <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6 text-sm text-neutral-200">
            <h2 className="text-lg font-semibold text-neutral-50">Receipt</h2>
            {status === "ready" && receiptItems.length > 0 ? (
              <ul className="mt-4 max-h-72 space-y-3 overflow-y-auto pr-1">
                {receiptItems.map((item) => {
                  const category = categories[item.category_id];
                  return (
                    <li
                      key={item.id}
                      className="rounded-2xl border border-neutral-800 bg-neutral-950/60 px-4 py-3"
                    >
                      <div className="flex items-center justify-between text-sm text-neutral-100">
                        <span className="font-medium">
                          {category?.display_name ?? "Item"}
                        </span>
                        <span className="font-semibold text-sky-300">
                          {formatCurrencyFromCents(item.amount_cents)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-xs text-neutral-500">
                        <span>
                          {new Date(item.detected_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </span>
                        {typeof item.confidence === "number" && (
                          <span>{Math.round(item.confidence * 100)}%</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <>
                {enableAudioFeedback && (
                  <p className="mt-4 text-xs text-neutral-500">
                    Audio feedback idle. Scan an item to generate announcements.
                  </p>
                )}
                <p className="mt-4 text-sm text-neutral-400">
                  Once items are recognised, they will appear here with their
                  payout and detection confidence.
                </p>
              </>
            )}
          </div>

          <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6 text-sm text-neutral-200">
            <h2 className="text-lg font-semibold text-neutral-50">Next steps</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-neutral-300">
              <li>Hold the barcode steady in front of the camera.</li>
              <li>Wait for the kiosk to confirm your account.</li>
              <li>Deposit items once the Lazy Susan rotates to the highlighted bin.</li>
            </ol>
          </div>
        </aside>
      </main>
    </div>
  );
}