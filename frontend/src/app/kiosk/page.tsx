"use client";

import { useCallback, useEffect } from "react";

import { authenticateBarcode } from "../../features/kiosk/api/authenticate-barcode";
import { useBarcodeScanner } from "../../features/kiosk/hooks/useBarcodeScanner";
import { useKioskStore } from "../../features/kiosk/state/useKioskStore";
import { appConfig } from "../../lib/config";
import { formatCurrencyFromCents } from "../../lib/format";

const STATUS_LABELS: Record<ReturnType<typeof useKioskStore>["status"], string> = {
  idle: "Ready to scan",
  authenticating: "Authenticating…",
  ready: "Session active",
  error: "Action required",
};

export default function KioskPage(): JSX.Element {
  const reset = useKioskStore((state) => state.reset);
  const status = useKioskStore((state) => state.status);
  const profile = useKioskStore((state) => state.profile);
  const session = useKioskStore((state) => state.session);
  const errorMessage = useKioskStore((state) => state.errorMessage);
  const lastScannedBarcode = useKioskStore((state) => state.lastScannedBarcode);

  const handleBarcode = useCallback(
    async (rawBarcode: string) => {
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

      try {
        const payload = await authenticateBarcode({
          barcode: trimmed,
        });

        useKioskStore.getState().setReady(payload);
      } catch (error) {
        console.error(error);
        const message =
          error instanceof Error ? error.message : "Failed to authenticate barcode";
        useKioskStore.getState().setError(message);
      }
    },
    [],
  );

  const { start, stop, videoRef, status: scannerStatus, errorMessage: scannerError } =
    useBarcodeScanner({
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

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-neutral-800 px-8 py-6">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 text-left">
          <div className="flex items-center justify-between">
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

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-8 py-10 md:flex-row">
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
                <span className="text-neutral-100">{scannerStatus}</span>
              </div>
              {scannerError ? (
                <p className="mt-2 text-xs text-rose-400">{scannerError}</p>
              ) : (
                <p className="mt-2 text-xs text-neutral-400">
                  Hold your card in front of the camera until it beeps. The
                  front-facing camera is optimised for landscape orientation.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-5 text-sm text-neutral-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-neutral-400">Kiosk status</p>
                <p className="text-lg font-medium text-neutral-50">{statusLabel}</p>
              </div>
              <button
                type="button"
                onClick={reset}
                className="rounded-full border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-200 transition hover:bg-neutral-700"
              >
                Reset kiosk
              </button>
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

        <aside className="w-full max-w-sm space-y-6">
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
              <p className="mt-4 text-sm text-neutral-400">
                Awaiting a valid scan. Session details will appear here once the
                barcode is authenticated.
              </p>
            )}
          </div>

          <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6 text-sm text-neutral-200">
            <h2 className="text-lg font-semibold text-neutral-50">Next steps</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-neutral-300">
              <li>Hold the barcode steady in front of the camera.</li>
              <li>Wait for the kiosk to confirm your account.</li>
              <li>
                Deposit items once the Lazy Susan rotates to the highlighted bin.
              </li>
            </ol>
          </div>
        </aside>
      </main>
    </div>
  );
}
