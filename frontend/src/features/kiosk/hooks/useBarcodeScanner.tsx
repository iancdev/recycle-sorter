"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  prepareZXingModule,
  readBarcodes,
} from "zxing-wasm/reader";
import type { ReadResult } from "zxing-wasm/reader";
import { type ReaderOptions } from "zxing-wasm/reader";

type ScannerStatus = "idle" | "requesting" | "scanning" | "error";

type UseBarcodeScannerOptions = {
  onScan?: (barcode: string) => void;
  facingMode?: "environment" | "user";
  debounceMs?: number;
  decodeIntervalMs?: number;
};

interface UseBarcodeScannerResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: ScannerStatus;
  errorMessage?: string;
  start: () => Promise<void>;
  stop: () => void;
  switchCamera: () => Promise<void>;
}

const TARGET_CAMERA_LABEL = "Front Camera";
const MAX_FRAME_DIMENSION = 1920;
const DEFAULT_DECODE_INTERVAL_MS = 80; // ~12.5 fps
const MAX_DEBUG_SAMPLES = 10;

const BASE_VIDEO_CONSTRAINTS: Pick<MediaTrackConstraints, "width" | "height" | "frameRate" | "aspectRatio"> = {
  width: { ideal: 1920, min: 960 },
  height: { ideal: 1080, min: 540 },
  aspectRatio: { ideal: 4 / 3 },
  frameRate: { ideal: 30, max: 60 },
};

function buildSupportedAdvancedConstraints(track: MediaStreamTrack): MediaTrackConstraintSet[] {
  // Capabilities are not standardized across browsers; gate each property.
  const caps = (track.getCapabilities ? track.getCapabilities() : undefined) as unknown as
    | {
        focusMode?: string[];
        exposureMode?: string[];
        whiteBalanceMode?: string[];
      }
    | undefined;

  const advanced: MediaTrackConstraintSet[] = [];
  if (caps?.focusMode?.includes?.("continuous")) {
    advanced.push({ focusMode: "continuous" } as unknown as MediaTrackConstraintSet);
  }
  if (caps?.exposureMode?.includes?.("continuous")) {
    advanced.push({ exposureMode: "continuous" } as unknown as MediaTrackConstraintSet);
  }
  if (caps?.whiteBalanceMode?.includes?.("continuous")) {
    advanced.push({ whiteBalanceMode: "continuous" } as unknown as MediaTrackConstraintSet);
  }
  return advanced;
}

const ZXING_OPTIONS: ReaderOptions = {
  formats: ["Codabar"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: false,
  maxNumberOfSymbols: 1,
  binarizer: "LocalAverage",
};

const ZXING_FALLBACK_PROFILES: ReadonlyArray<ReaderOptions> = [
  {
    formats: ["Codabar"],
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    tryDownscale: true,
    maxNumberOfSymbols: 1,
    binarizer: "LocalAverage",
  },
  {
    formats: ["Codabar"],
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    tryDownscale: true,
    maxNumberOfSymbols: 1,
    binarizer: "GlobalHistogram",
  },
  {
    formats: ["Codabar"],
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    tryDownscale: true,
    maxNumberOfSymbols: 1,
    binarizer: "FixedThreshold",
  },
];

let zxingReadyPromise: Promise<void> | null = null;

function ensureZXingModuleReady(): Promise<void> {
  if (!zxingReadyPromise) {
    zxingReadyPromise = prepareZXingModule({ fireImmediately: true }).then(() => undefined);
  }
  return zxingReadyPromise;
}

function calculateScale(video: HTMLVideoElement): number | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  return Math.min(1, MAX_FRAME_DIMENSION / Math.max(width, height));
}

// no manual rotation; allow ZXing to rotate internally

async function selectFrontCamera(fallbackFacingMode: "user" | "environment"): Promise<MediaTrackConstraints> {
  const selectByLabel = async (): Promise<MediaTrackConstraints | null> => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      // Priority: exact hardcoded label first, then heuristic front-facing labels
      const exact = devices.find(
        (d) => d.kind === "videoinput" && d.label && d.label.trim() === TARGET_CAMERA_LABEL,
      );
      const lower = (s: string) => s.toLowerCase();
      const isFrontLabel = (l: string) => /front|facetime|truedepth|user/.test(lower(l));
      const heuristic = devices.find(
        (d) => d.kind === "videoinput" && d.label && isFrontLabel(d.label),
      );
      const match = exact ?? heuristic ?? null;

      if (match) {
        return {
          deviceId: { exact: match.deviceId },
          facingMode: { ideal: "user" },
          ...BASE_VIDEO_CONSTRAINTS,
        };
      }
    } catch (error) {
      console.warn("Unable to enumerate media devices", error);
    }

    return null;
  };

  const initialSelection = await selectByLabel();
  if (initialSelection) {
    return initialSelection;
  }

  try {
    const probeStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: fallbackFacingMode } },
      audio: false,
    });
    probeStream.getTracks().forEach((track) => track.stop());
  } catch (probeError) {
    console.warn("Unable to probe camera for label access", probeError);
  }

  const postPermissionSelection = await selectByLabel();
  if (postPermissionSelection) {
    return postPermissionSelection;
  }

  return {
    facingMode: { ideal: fallbackFacingMode },
    ...BASE_VIDEO_CONSTRAINTS,
  };
}

export function useBarcodeScanner(
  options: UseBarcodeScannerOptions = {},
): UseBarcodeScannerResult {
  const { onScan, facingMode = "user", debounceMs = 1200, decodeIntervalMs } = options;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasContextRef = useRef<CanvasRenderingContext2D | null>(null);
  const rafRef = useRef<number | null>(null);
  const decodingRef = useRef(false);
  const lastScanRef = useRef<{ value: string; timestamp: number } | null>(null);
  const debugSampleRef = useRef(0);
  const lastAttemptAtRef = useRef<number | null>(null);
  const lastDecodeAtRef = useRef(0);
  const decodeIntervalRef = useRef<number>(decodeIntervalMs ?? DEFAULT_DECODE_INTERVAL_MS);
  const useBarcodeDetectorRef = useRef(false);
  const barcodeDetectorRef = useRef<BarcodeDetector | null>(null);
  const devicesRef = useRef<MediaDeviceInfo[]>([]);
  const currentDeviceIndexRef = useRef<number>(-1);

  const [status, setStatus] = useState<ScannerStatus>("idle");
  const statusRef = useRef<ScannerStatus>("idle");
  const attemptCounterRef = useRef(0);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const cleanupMedia = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    decodingRef.current = false;

    const video = videoRef.current;
    if (video?.srcObject instanceof MediaStream) {
      video.srcObject.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    }
  }, []);

  const stop = useCallback(() => {
    cleanupMedia();
    attemptCounterRef.current = 0;
    console.log("[barcode] Scanner stopped");
    statusRef.current = "idle";
    setStatus("idle");
  }, [cleanupMedia]);

  useEffect(() => {
    return () => {
      cleanupMedia();
    };
  }, [cleanupMedia]);

  const decodeCurrentFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
    }

    if (!canvasContextRef.current) {
      const context = canvasRef.current.getContext("2d", { willReadFrequently: true });
      if (!context) {
        console.error("[barcode] Unable to create canvas context for decoding");
        return;
      }
      context.imageSmoothingEnabled = false;
      canvasContextRef.current = context;
    }

    const context = canvasContextRef.current;
    const scale = calculateScale(video);
    if (scale == null) return;

    const vWidth = video.videoWidth;
    const vHeight = video.videoHeight;
    const outputWidth = Math.max(1, Math.round(vWidth * scale));
    const outputHeight = Math.max(1, Math.round(vHeight * scale));

    if (debugSampleRef.current < MAX_DEBUG_SAMPLES) {
      console.debug("[barcode] Decoding frame", {
        videoDimensions: { width: vWidth, height: vHeight },
        outputDimensions: { width: outputWidth, height: outputHeight },
      });
    }
    if (
      canvasRef.current.width !== outputWidth ||
      canvasRef.current.height !== outputHeight
    ) {
      canvasRef.current.width = outputWidth;
      canvasRef.current.height = outputHeight;
    }

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, outputWidth, outputHeight);
    // Draw full frame (no cropping)
    context.drawImage(video, 0, 0, vWidth, vHeight, 0, 0, outputWidth, outputHeight);

    // Fast path: BarcodeDetector if supported for Codabar
    if (useBarcodeDetectorRef.current && barcodeDetectorRef.current) {
      try {
        const results = await barcodeDetectorRef.current.detect(canvasRef.current);
        const raw = (results[0]?.rawValue ?? "").trim();
        if (raw) {
          const now = Date.now();
          const last = lastScanRef.current;
          if (!last || last.value !== raw || now - last.timestamp >= debounceMs) {
            lastScanRef.current = { value: raw, timestamp: now };
            attemptCounterRef.current = 0;
            console.log("[barcode] Detected via BarcodeDetector", { value: raw });
            onScan?.(raw);
            return;
          }
        }
      } catch (e) {
        // On failure, fall back to ZXing below in the same frame
        if (debugSampleRef.current < MAX_DEBUG_SAMPLES) {
          console.debug("[barcode] BarcodeDetector error; falling back to ZXing", e);
        }
      }
    }

    // ZXing fallback (multi-pass)
    let readResults: ReadResult[] = [];
    let imageData: ImageData | null = null;
    try {
      imageData = context.getImageData(0, 0, outputWidth, outputHeight);
    } catch (e) {
      console.warn("[barcode] getImageData failed", e);
      return;
    }
    try {
      readResults = await readBarcodes(imageData, ZXING_OPTIONS);
    } catch (error) {
      if (debugSampleRef.current < MAX_DEBUG_SAMPLES) {
        console.debug("[barcode] ZXing decode error", error);
      }
      readResults = [];
    }

    if (readResults.length === 0) {
      for (const profile of ZXING_FALLBACK_PROFILES) {
        try {
          readResults = await readBarcodes(imageData, profile);
        } catch (e) {
          if (debugSampleRef.current < MAX_DEBUG_SAMPLES) {
            console.debug("[barcode] ZXing fallback error", { binarizer: profile.binarizer }, e);
          }
          readResults = [];
        }
        if (readResults.length > 0) {
          break;
        }
      }
      if (readResults.length === 0) {
        return;
      }
    }

    const [firstResult] = readResults;
    const value = firstResult.text?.trim();
    if (!value) {
      return;
    }

    const now = Date.now();
    const last = lastScanRef.current;
    if (last && last.value === value && now - last.timestamp < debounceMs) {
      if (debugSampleRef.current < MAX_DEBUG_SAMPLES) {
        console.debug("[barcode] Duplicate scan ignored", {
          value,
          sinceLast: now - last.timestamp,
        });
      }
      return;
    }

    lastScanRef.current = { value, timestamp: now };
    attemptCounterRef.current = 0;
    console.log("[barcode] Successfully detected barcode", {
      value,
      format: firstResult.format,
    });
    onScan?.(value);
    return;
  
    attemptCounterRef.current += 1;
    lastAttemptAtRef.current = Date.now();
    if (attemptCounterRef.current % 20 === 0) {
      const v = videoRef.current;
      let dims: { width: number; height: number } | null = null;
      if (v) {
        dims = { width: v!.videoWidth, height: v!.videoHeight };
      }
      console.log("[barcode] Scanning… no barcode yet", {
        attemptsSinceLast: attemptCounterRef.current,
        lastAttemptAt: lastAttemptAtRef.current,
        videoDimensions: dims,
      });
    }
    if (debugSampleRef.current < MAX_DEBUG_SAMPLES) debugSampleRef.current += 1;
  }, [debounceMs, onScan]);

  const start = useCallback(async () => {
    if (statusRef.current === "scanning" || statusRef.current === "requesting") {
      return;
    }

    const video = videoRef.current;
    if (!video) {
      throw new Error("Video element is not ready");
    }

    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      setErrorMessage("Camera access is not supported in this browser");
      statusRef.current = "error";
      setStatus("error");
      return;
    }

    try {
      statusRef.current = "requesting";
      console.log("[barcode] Requesting access to barcode scanner camera");
      setStatus("requesting");
      setErrorMessage(undefined);

      await ensureZXingModuleReady();

      const videoConstraints = await selectFrontCamera(facingMode);
      console.log("[barcode] Starting scanner with constraints", videoConstraints);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });

      const [track] = stream.getVideoTracks();
      if (track?.applyConstraints) {
        const advanced = buildSupportedAdvancedConstraints(track);
        if (advanced.length > 0) {
          try {
            await track.applyConstraints({ advanced });
          } catch (constraintError) {
            // Silently ignore on browsers that reject unsupported constraints despite gating
            console.debug("[barcode] Advanced constraints rejected by browser", constraintError);
          }
        }
      }

      video.srcObject = stream;
      // iOS Safari specific hints
      video.playsInline = true;
      // Avoid echo/auto-play issues
      video.muted = true;
      await video.play().catch(() => undefined);

      attemptCounterRef.current = 0;
      lastDecodeAtRef.current = 0;

      // Determine if BarcodeDetector is available for Codabar
      useBarcodeDetectorRef.current = false;
      barcodeDetectorRef.current = null;
      try {
        const BD = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorConstructor })
          .BarcodeDetector;
        if (BD) {
          const supported = BD.getSupportedFormats ? await BD.getSupportedFormats() : [];
          const supportedLower = supported.map((s: string) => s.toLowerCase());
          const codabar = supportedLower.find((s) => s.includes("codabar"));
          if (codabar) {
            const detector = new BD({ formats: ["codabar"] });
            barcodeDetectorRef.current = detector;
            useBarcodeDetectorRef.current = true;
            console.log("[barcode] Using BarcodeDetector fast path", { format: "codabar" });
          }
        }
      } catch {
        // Fallback to ZXing
        useBarcodeDetectorRef.current = false;
        barcodeDetectorRef.current = null;
      }

      const useRVFC = typeof (video as unknown as { requestVideoFrameCallback?: unknown }).requestVideoFrameCallback === "function";

      const onVideoFrame = async () => {
        if (statusRef.current !== "scanning") return;
        if (!videoRef.current || videoRef.current.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          scheduleNext();
          return;
        }
        if (decodingRef.current) {
          scheduleNext();
          return;
        }
        const now = Date.now();
        if (now - lastDecodeAtRef.current < decodeIntervalRef.current) {
          scheduleNext();
          return;
        }
        lastDecodeAtRef.current = now;
        decodingRef.current = true;
        try {
          await decodeCurrentFrame();
        } finally {
          decodingRef.current = false;
          scheduleNext();
        }
      };

      const scheduleNext = () => {
        if (statusRef.current !== "scanning") return;
        if (useRVFC) {
          // Safari/Chrome
          (video as unknown as { requestVideoFrameCallback: (cb: () => void) => number }).requestVideoFrameCallback(onVideoFrame);
        } else {
          rafRef.current = requestAnimationFrame(onVideoFrame);
        }
      };

      statusRef.current = "scanning";
      console.log("[barcode] Scanner ready and watching for Codabar/NW7 barcodes");
      setStatus("scanning");
      // Populate device list for switching
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        devicesRef.current = devices.filter((d) => d.kind === "videoinput");
        // Try to set current index to the active track's deviceId
        const activeTrack = stream.getVideoTracks()[0];
        const activeSettings = activeTrack?.getSettings();
        const activeDeviceId = (activeSettings?.deviceId as string | undefined) ?? undefined;
        if (activeDeviceId) {
          const idx = devicesRef.current.findIndex((d) => d.deviceId === activeDeviceId);
          currentDeviceIndexRef.current = idx >= 0 ? idx : 0;
        } else {
          currentDeviceIndexRef.current = 0;
        }
        console.log("[barcode] Video inputs available", {
          count: devicesRef.current.length,
          currentIndex: currentDeviceIndexRef.current,
          labels: devicesRef.current.map((d) => d.label),
        });
      } catch (e) {
        console.debug("[barcode] Unable to enumerate devices after start", e);
      }
      scheduleNext();
    } catch (error) {
      console.error("[barcode] Failed to start scanner", error);
      cleanupMedia();
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to start camera stream",
      );
      statusRef.current = "error";
      setStatus("error");
    }
  }, [cleanupMedia, decodeCurrentFrame, facingMode]);

  const switchCamera = useCallback(async () => {
    // Ensure we have a device list; if empty, try to load it
    if (devicesRef.current.length === 0) {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        devicesRef.current = devices.filter((d) => d.kind === "videoinput");
      } catch (e) {
        console.warn("[barcode] Unable to enumerate devices for switching", e);
        return;
      }
    }
    const n = devicesRef.current.length;
    if (n === 0) {
      console.warn("[barcode] No cameras available to switch");
      return;
    }
    // Compute next index
    const nextIndex = (currentDeviceIndexRef.current + 1) % n;
    const next = devicesRef.current[nextIndex];
    if (!next) {
      console.warn("[barcode] Next camera not found");
      return;
    }
    console.log("[barcode] Switching camera", { to: next.label || next.deviceId, index: nextIndex });

    // Stop existing stream
    const video = videoRef.current;
    const oldStream = video?.srcObject instanceof MediaStream ? (video.srcObject as MediaStream) : null;
    oldStream?.getTracks().forEach((t) => t.stop());

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: next.deviceId },
          ...BASE_VIDEO_CONSTRAINTS,
        },
        audio: false,
      });
      const [track] = stream.getVideoTracks();
      if (track?.applyConstraints) {
        const advanced = buildSupportedAdvancedConstraints(track);
        if (advanced.length > 0) {
          try {
            await track.applyConstraints({ advanced });
          } catch (constraintError) {
            console.debug("[barcode] Advanced constraints rejected on switch", constraintError);
          }
        }
      }
      if (video) {
        video.srcObject = stream;
        video.playsInline = true;
        video.muted = true;
        await video.play().catch(() => undefined);
      }
      currentDeviceIndexRef.current = nextIndex;
    } catch (e) {
      console.error("[barcode] Failed to switch camera", e);
    }
  }, []);

  return {
    videoRef,
    status,
    errorMessage,
    start,
    stop,
    switchCamera,
  };
}
