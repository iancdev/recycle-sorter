"use client";

export const dynamic = "force-dynamic";

import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { authenticateBarcode } from "../../features/kiosk/api/authenticate-barcode";
import { closeSession } from "../../features/kiosk/api/close-session";
import { useBarcodeScanner } from "../../features/kiosk/hooks/useBarcodeScanner";
import { useSessionRealtime } from "../../features/kiosk/hooks/useSessionRealtime";
import { useSupabaseClient } from "../../features/kiosk/providers/SupabaseClientProvider";
import { useDepositAnnouncements } from "../../features/kiosk/audio/useDepositAnnouncements";
import { LinkPhoneCard } from "../../features/kiosk/components/LinkPhoneCard";
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
  scanning: "Scanning for student ID",
  error: "Camera unavailable",
} as const;

const REALTIME_STATUS_LABELS = {
  idle: "Idle",
  connecting: "Connecting…",
  online: "Online",
  error: "Disconnected",
} as const;


export default function KioskPage(): ReactElement {
  const [isClosing, setIsClosing] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showStartedOverlay, setShowStartedOverlay] = useState(false);
  const [showExpiredOverlay, setShowExpiredOverlay] = useState(false);
  const [showDiagnosticsPanel, setShowDiagnosticsPanel] = useState(false);

  const resetStore = useKioskStore((state) => state.reset);
  const status = useKioskStore((state) => state.status);
  const profile = useKioskStore((state) => state.profile);
  const session = useKioskStore((state) => state.session);
  const errorMessage = useKioskStore((state) => state.errorMessage);
  const lastScannedBarcode = useKioskStore((state) => state.lastScannedBarcode);
  const lastActivityAt = useKioskStore((state) => state.lastActivityAt);
  const sessionItems = useKioskStore((state) => state.sessionItems);
  const categories = useKioskStore((state) => state.categories);
  const realtimeStatus = useKioskStore((state) => state.realtimeStatus);
  const recentSessions = useKioskStore((state) => state.recentSessions);
  const setRecentSessions = useKioskStore((state) => state.setRecentSessions);

  // Supabase client used for silent auth after barcode scan and for data fetching
  const supabase = useSupabaseClient();

  useSessionRealtime(session?.id ?? null, profile?.id ?? null);

  const enableIdleTimeout = appConfig.enableIdleTimeout;
  const enableAudioFeedback = appConfig.enableAudioFeedback;

  const resetKiosk = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore sign-out errors; proceed to reset UI state
    }
    resetStore();
  }, [supabase, resetStore]);

  const handleBarcode = useCallback(async (rawBarcode: string) => {
    const trimmed = rawBarcode.trim();
    if (!trimmed) {
      console.debug("[barcode] Ignoring empty scan result", { rawBarcode });
      return;
    }

    console.log("[barcode] Received scan event", { rawBarcode, trimmed });

    const store = useKioskStore.getState();
    if (store.status === "authenticating") {
      console.debug("[barcode] Skipping scan while authenticating", { trimmed });
      return;
    }

    const now = Date.now();
    if (
      store.lastScannedBarcode === trimmed &&
      store.lastScannedAt &&
      now - store.lastScannedAt < 1500
    ) {
      console.debug("[barcode] Throttling duplicate barcode", {
        trimmed,
        sinceLast: now - store.lastScannedAt,
      });
      return;
    }

    store.setAuthenticating(trimmed);
    store.touchActivity();

    try {
      console.log("[barcode] Authenticating barcode", { trimmed });
      const payload = await authenticateBarcode({ barcode: trimmed });
      // Perform silent login using OTP returned by the edge function
      if (payload?.auth?.email && payload?.auth?.otp) {
        const { error } = await supabase.auth.verifyOtp({
          type: "email",
          email: payload.auth.email,
          token: payload.auth.otp,
        });
        if (error) {
          throw error;
        }

        // Ensure the authenticated session is available before subscribing/fetching
        // to avoid RLS-empty initial loads.
        for (let i = 0; i < 20; i += 1) {
          const { data } = await supabase.auth.getSession();
          if (data.session) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      // Promote to a fresh session bound to this device to ensure edge publishes
      // to the same session ID the kiosk is viewing.
      try {
        const res = await fetch("/api/kiosk/start-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profileId: payload.profile.id,
            edgeDeviceLabel: appConfig.edgeDeviceLabel,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            session: typeof payload.session;
          };
          payload.session = data.session;
        } else {
          console.warn("Failed to start fresh session; proceeding with existing.");
        }
      } catch (e) {
        console.warn("start-session API error", e);
      }

      console.log("[barcode] Barcode authenticated", {
        trimmed,
        sessionId: payload.session.id,
      });
      useKioskStore.getState().setReady(payload);
      setShowStartedOverlay(true);
      window.setTimeout(() => setShowStartedOverlay(false), 750);
    } catch (error) {
      console.error("[barcode] Failed to authenticate barcode", error);
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
    switchCamera,
    decoderInfo,
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

  // Supabase client declared above for use in handlers
  const receiptItems = useMemo(() => sessionItems.slice(0, 12), [sessionItems]);

  const { announcement, isSynthesizing, clearAnnouncement } = useDepositAnnouncements({
    latestItem,
    latestCategory,
    audioEnabled: enableAudioFeedback,
  });


  useEffect(() => {
    const profileId = profile?.id;

    if (!profileId) {
      setRecentSessions([]);
      return;
    }

    let cancelled = false;

    const load = async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("id,total_cents,started_at,status")
        .eq("profile_id", profileId)
        .eq("status", "complete")
        .order("started_at", { ascending: false })
        .limit(5);

      if (cancelled) {
        return;
      }

      if (error) {
        console.warn("Failed to load recent sessions", error);
        return;
      }

      setRecentSessions(data ?? []);
    };

    load();
    const intervalId = window.setInterval(load, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [profile?.id, session?.status, supabase, setRecentSessions]);

  // Ensure camera stream is healthy when returning to unauthenticated state
  useEffect(() => {
    if (status !== "ready") {
      const v = videoRef.current;
      const needsRestart = !v || !(v.srcObject instanceof MediaStream) ||
        (v.srcObject && (v.srcObject as MediaStream).getVideoTracks().every((t) => t.readyState !== "live"));
      if (needsRestart) {
        try {
          stop();
        } catch {}
        start().catch((e) => console.debug("[barcode] restart failed", e));
      } else {
        v?.play().catch(() => undefined);
      }
    }
  }, [status, start, stop, videoRef]);

  const showErrorOverlay = status === "error";
  const showEndedOverlay = Boolean(session && session.status && session.status !== "active");

  // Auto-dismiss error overlay after 3s by resetting kiosk
  useEffect(() => {
    if (showErrorOverlay) {
      const t = window.setTimeout(() => {
        void resetKiosk();
      }, 3000);
      return () => window.clearTimeout(t);
    }
  }, [showErrorOverlay, resetKiosk]);

  // Auto-dismiss ended overlay after 3s by resetting kiosk to idle
  useEffect(() => {
    if (showEndedOverlay) {
      const t = window.setTimeout(() => {
        void resetKiosk();
      }, 3000);
      return () => window.clearTimeout(t);
    }
  }, [showEndedOverlay, resetKiosk]);

  // Auto-dismiss expired overlay after 0.75s
  useEffect(() => {
    if (showExpiredOverlay) {
      const t = window.setTimeout(() => {
        setShowExpiredOverlay(false);
      }, 750);
      return () => window.clearTimeout(t);
    }
  }, [showExpiredOverlay]);

  const handleCloseSession = useCallback(async () => {
    if (isClosing) {
      return;
    }

    const store = useKioskStore.getState();
    const activeSession = store.session;
    if (!activeSession) {
      return;
    }

    // If session already not active, reset gracefully without error
    if (activeSession.status && activeSession.status !== "active") {
      store.reset();
      return;
    }

    setIsClosing(true);
    // Kick off server close and sign-out concurrently; don't block UI reset
    void closeSession({ sessionId: activeSession.id }).catch((error) =>
      console.warn("Close session failed; proceeding", error),
    );
    void supabase.auth.signOut().catch(() => undefined);
    // Optimistic local reset so UI returns to idle immediately
    store.reset();
    setIsClosing(false);
  }, [isClosing, supabase]);

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
          setShowExpiredOverlay(true);
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
    <div className="relative flex min-h-screen flex-col">
      {showErrorOverlay && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-neutral-950/90 px-8 text-center animate-fade-3s">
          <h2 className="text-2xl font-semibold text-rose-200">Session paused due to an error</h2>
          <p className="max-w-md text-sm text-neutral-200">
            {errorMessage ?? "Something went wrong while talking to Supabase. Please try again."}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => void resetKiosk()}
              className="rounded-full border border-rose-400/40 bg-rose-500/10 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-rose-200 transition hover:bg-rose-500/20"
            >
              Reset kiosk
            </button>
            <button
              type="button"
              onClick={() => useKioskStore.getState().touchActivity()}
              className="rounded-full border border-sky-400/40 bg-sky-500/10 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-sky-200 transition hover:bg-sky-500/20"
            >
              Extend session
            </button>
            <button
              type="button"
              onClick={switchCamera}
              className="rounded-full border border-neutral-700 bg-neutral-800 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-200 transition hover:bg-neutral-700"
            >
              Switch camera
            </button>
          </div>
        </div>
      )}
      {showStartedOverlay && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-neutral-950/80 px-8 text-center animate-fade-075">
          <h2 className="text-2xl font-semibold text-emerald-200">Session started</h2>
          <p className="text-sm text-neutral-200">You can begin scanning items.</p>
        </div>
      )}
      {showExpiredOverlay && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-neutral-950/80 px-8 text-center animate-fade-075">
          <h2 className="text-2xl font-semibold text-neutral-100">Session expired</h2>
          <p className="max-w-md text-sm text-neutral-300">
            Your session expired due to inactivity. Tap below to start a new session.
          </p>
          <div className="h-5" />
        </div>
      )}
      {showEndedOverlay && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-neutral-950/90 px-8 text-center animate-fade-3s">
          <h2 className="text-2xl font-semibold text-neutral-100">Session ended</h2>
          <p className="max-w-md text-sm text-neutral-300">
            Your previous session has been completed or expired. Start a new scan when ready.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => void resetKiosk()}
              className="rounded-full border border-neutral-700 bg-neutral-800 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-200 transition hover:bg-neutral-700"
            >
              Start new session
            </button>
          </div>
        </div>
      )}
      <header className="border-b border-neutral-800 px-8 py-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 text-left">
          <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-neutral-50">
                Eco Depot
              </h1>
              <p className="text-sm text-neutral-400">
                Scan your student barcode to start a new recycling session.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowDiagnosticsPanel((v) => !v)}
              className="rounded-full border border-neutral-700 bg-neutral-900/80 px-4 py-1 text-xs uppercase tracking-wide text-neutral-300 hover:bg-neutral-800"
              aria-pressed={showDiagnosticsPanel}
              aria-label="Toggle diagnostics"
            >
              Device: {appConfig.edgeDeviceLabel}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-8 py-10 lg:flex-row">
        <section className="flex w-full flex-1 flex-col gap-6">
          {status !== "ready" ? (
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
                  <p className="mt-2 text-xs text-neutral-400">
                    Hold your student ID in front of the camera.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
                <h2 className="text-lg font-semibold text-neutral-50">Latest item</h2>
                {latestItem && latestCategory ? (
                  <div className="space-y-3 text-sm text-neutral-200">
                    {enableAudioFeedback ? (
                      <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                        <div className="text-left">
                          <p>
                            {isSynthesizing
                              ? "Preparing announcement…"
                              : announcement?.text ?? "Ready to announce."}
                          </p>
                        </div>
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
                    ) : null}
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
                  <p className="mt-4 text-sm text-neutral-400">Waiting for first item…</p>
                )}
              </div>

              <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6 text-sm text-neutral-200">
                <h2 className="text-lg font-semibold text-neutral-50">Receipt</h2>
                {receiptItems.length > 0 ? (
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
                  <p className="mt-4 text-sm text-neutral-400">
                    Items you have scanned will appear here.
                  </p>
                )}
              </div>
            </>
          )}

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
                  onClick={() => void resetKiosk()}
                  className="rounded-full border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-200 transition hover:bg-neutral-700"
                >
                  Reset kiosk
                </button>
                {status === "ready" && (
                  <button
                    type="button"
                    onClick={() => useKioskStore.getState().touchActivity()}
                    className="rounded-full border border-sky-400/40 bg-sky-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-sky-200 transition hover:bg-sky-500/20"
                  >
                    Extend session
                  </button>
                )}
                <button
                  type="button"
                  onClick={switchCamera}
                  className="rounded-full border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-200 transition hover:bg-neutral-700"
                >
                  Switch camera
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
          {status !== "ready" && (
            <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
              <h2 className="text-lg font-semibold text-neutral-50">Latest item</h2>
              <div className="mt-4 space-y-3 text-sm text-neutral-400">
                {enableAudioFeedback ? (
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    <div className="text-left">
                      <p>
                        {isSynthesizing
                          ? "Preparing announcement…"
                          : announcement?.text ?? "Ready to announce."}
                      </p>
                    </div>
                  </div>
                ) : null}
                <p>Awaiting a valid scan. Latest item details will appear once authenticated.</p>
              </div>
            </div>
          )}

          {status === "ready" && (
            <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6 text-sm text-neutral-200">
              <h2 className="text-lg font-semibold text-neutral-50">Receipt</h2>
              {receiptItems.length > 0 ? (
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
                <p className="mt-4 text-sm text-neutral-400">
                  Once items are recognised, they will appear here with their
                  payout and detection confidence.
                </p>
              )}
            </div>
          )}

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

          {showDiagnosticsPanel && (
            <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6 text-sm text-neutral-200">
              <h2 className="text-lg font-semibold text-neutral-50">Diagnostics</h2>
              <dl className="mt-4 space-y-3 text-xs">
                <div className="flex items-center justify-between rounded-2xl border border-neutral-800 bg-neutral-950/70 px-3 py-2">
                  <dt className="uppercase tracking-wide text-neutral-500">Camera</dt>
                  <dd className="text-neutral-100">{SCANNER_STATUS_LABELS[scannerStatus]}</dd>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-neutral-800 bg-neutral-950/70 px-3 py-2">
                  <dt className="uppercase tracking-wide text-neutral-500">Realtime</dt>
                  <dd
                    className={
                      realtimeStatus === "error"
                        ? "text-rose-300"
                        : realtimeStatus === "online"
                        ? "text-emerald-300"
                        : "text-neutral-100"
                    }
                  >
                    {REALTIME_STATUS_LABELS[realtimeStatus]}
                  </dd>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-neutral-800 bg-neutral-950/70 px-3 py-2">
                  <dt className="uppercase tracking-wide text-neutral-500">Decoder</dt>
                  <dd className="text-neutral-100">
                    {decoderInfo ? (
                      <span className="font-mono text-xs">
                        {decoderInfo.path}
                        {decoderInfo.profile ? `:${decoderInfo.profile}` : ""}
                      </span>
                    ) : (
                      <span className="text-neutral-400">n/a</span>
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6 text-sm text-neutral-200">
            <h2 className="text-lg font-semibold text-neutral-50">Recent sessions</h2>
            {recentSessions.length > 0 ? (
              <ul className="mt-4 space-y-3">
                {recentSessions.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-2xl border border-neutral-800 bg-neutral-950/70 px-4 py-3 text-xs text-neutral-300"
                  >
                    <div className="flex items-center justify-between">
                      <span>{new Date(item.started_at).toLocaleDateString()}</span>
                      <span className="font-semibold text-sky-300">
                        {formatCurrencyFromCents(item.total_cents || 0)}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] uppercase tracking-wide text-neutral-500">
                      {item.status}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-xs text-neutral-500">
                Recent sessions will appear here after you finish earning.
              </p>
            )}
          </div>

          

          <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6 text-sm text-neutral-200">
            <h2 className="text-lg font-semibold text-neutral-50">Next steps</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-neutral-300">
              <li>Hold your student ID steady in front of the camera.</li>
              <li>Wait for the kiosk to confirm your account.</li>
              <li>Place the item on the bin platform when the prompt appears. The system will sort it automatically.</li>
            </ol>
          </div>

          <LinkPhoneCard />
        </aside>
      </main>
    </div>
  );
}
