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
};

interface UseBarcodeScannerResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: ScannerStatus;
  errorMessage?: string;
  start: () => Promise<void>;
  stop: () => void;
}

const TARGET_CAMERA_LABEL = "Front Camera";
const MAX_FRAME_DIMENSION = 1920;
const DECODE_INTERVAL_MS = 80; // ~12.5 fps
const MAX_DEBUG_SAMPLES = 10;

const BASE_VIDEO_CONSTRAINTS: Pick<MediaTrackConstraints, "width" | "height" | "frameRate" | "aspectRatio"> = {
  width: { ideal: 1920, min: 960 },
  height: { ideal: 1080, min: 540 },
  aspectRatio: { ideal: 4 / 3 },
  frameRate: { ideal: 30, max: 60 },
};
const ADVANCED_VIDEO_SETTINGS: MediaTrackConstraintSet[] = [
  { focusMode: "continuous" } as unknown as MediaTrackConstraintSet,
  { exposureMode: "continuous" } as unknown as MediaTrackConstraintSet,
  { whiteBalanceMode: "continuous" } as unknown as MediaTrackConstraintSet,
];

const ZXING_OPTIONS: ReaderOptions = {
  formats: ["Code128"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: false,
  maxNumberOfSymbols: 1,
  binarizer: "LocalAverage",
};

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
      const lower = (s: string) => s.toLowerCase();
      const isFrontLabel = (l: string) =>
        /front|facetime|truedepth|user/.test(lower(l));
      const frontDevices = devices.filter(
        (d) => d.kind === "videoinput" && d.label && isFrontLabel(d.label),
      );
      const match = frontDevices[0] ?? devices.find(
        (d) => d.kind === "videoinput" && d.label.trim() === TARGET_CAMERA_LABEL,
      );

      if (match) {
        return {
          deviceId: { exact: match.deviceId },
          facingMode: { ideal: "user" },
          advanced: ADVANCED_VIDEO_SETTINGS,
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
    advanced: ADVANCED_VIDEO_SETTINGS,
    ...BASE_VIDEO_CONSTRAINTS,
  };
}

export function useBarcodeScanner(
  options: UseBarcodeScannerOptions = {},
): UseBarcodeScannerResult {
  const { onScan, facingMode = "user", debounceMs = 1200 } = options;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasContextRef = useRef<CanvasRenderingContext2D | null>(null);
  const rafRef = useRef<number | null>(null);
  const decodingRef = useRef(false);
  const lastScanRef = useRef<{ value: string; timestamp: number } | null>(null);
  const debugSampleRef = useRef(0);
  const lastAttemptAtRef = useRef<number | null>(null);
  const lastDecodeAtRef = useRef(0);
  const useBarcodeDetectorRef = useRef(false);
  const barcodeDetectorRef = useRef<BarcodeDetector | null>(null);

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

    // Fast path: BarcodeDetector if supported for Code 128
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

    // ZXing fallback
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
      return;
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
        try {
          await track.applyConstraints({ advanced: ADVANCED_VIDEO_SETTINGS });
        } catch (constraintError) {
          console.warn("[barcode] Unable to apply advanced camera constraints", constraintError);
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

      // Determine if BarcodeDetector is available for Code 128
      useBarcodeDetectorRef.current = false;
      barcodeDetectorRef.current = null;
      try {
        const BD = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorConstructor })
          .BarcodeDetector;
        if (BD) {
          const supported = BD.getSupportedFormats ? await BD.getSupportedFormats() : [];
          const supportedLower = supported.map((s: string) => s.toLowerCase());
          const code128 = supportedLower.find((s) => s.includes("code_128") || s.includes("code-128"));
          if (code128) {
            const detector = new BD({ formats: [code128] });
            barcodeDetectorRef.current = detector;
            useBarcodeDetectorRef.current = true;
            console.log("[barcode] Using BarcodeDetector fast path", { format: code128 });
          }
        }
      } catch {
        // Fallback to ZXing
        useBarcodeDetectorRef.current = false;
        barcodeDetectorRef.current = null;
      }

      const loop = async () => {
        rafRef.current = requestAnimationFrame(loop);
        if (statusRef.current !== "scanning") {
          return;
        }
        if (!videoRef.current || videoRef.current.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          return;
        }
        if (decodingRef.current) {
          return;
        }
        const now = Date.now();
        if (now - lastDecodeAtRef.current < DECODE_INTERVAL_MS) {
          return;
        }
        lastDecodeAtRef.current = now;
        decodingRef.current = true;
        try {
          await decodeCurrentFrame();
        } finally {
          decodingRef.current = false;
        }
      };

      statusRef.current = "scanning";
      console.log("[barcode] Scanner ready and watching for code 128 barcodes");
      setStatus("scanning");
      loop();
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

  return {
    videoRef,
    status,
    errorMessage,
    start,
    stop,
  };
}
