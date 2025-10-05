"use client";

import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { useCallback, useEffect, useRef, useState } from "react";

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

async function selectFrontCamera(fallbackFacingMode: "user" | "environment"): Promise<MediaTrackConstraints> {
  const selectByLabel = async (): Promise<MediaTrackConstraints | null> => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const match = devices.find(
        (device) => device.kind === "videoinput" && device.label.trim() === TARGET_CAMERA_LABEL,
      );

      if (match) {
        return { deviceId: { exact: match.deviceId } };
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

  return { facingMode: { ideal: fallbackFacingMode } };
}


export function useBarcodeScanner(
  options: UseBarcodeScannerOptions = {},
): UseBarcodeScannerResult {
  const { onScan, facingMode = "user", debounceMs = 1200 } = options;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lastScanRef = useRef<{ value: string; timestamp: number } | null>(null);

  const [status, setStatus] = useState<ScannerStatus>("idle");
  const statusRef = useRef<ScannerStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const stop = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;

    readerRef.current = null;

    if (videoRef.current?.srcObject instanceof MediaStream) {
      videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }

    statusRef.current = "idle";
    setStatus("idle");
  }, [setStatus]);

  const start = useCallback(async () => {
    if (statusRef.current === "scanning" || statusRef.current === "requesting") {
      return;
    }

    if (!videoRef.current) {
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
      setStatus("requesting");
      setErrorMessage(undefined);

      const videoConstraints = await selectFrontCamera(facingMode);
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]);
      const reader = new BrowserMultiFormatReader(hints);
      readerRef.current = reader;

      controlsRef.current = await reader.decodeFromConstraints(
        {
          video: videoConstraints,
          audio: false,
        },
        videoRef.current,
        (result, error) => {
          if (result) {
            const value = result.getText();
            if (!value) {
              return;
            }

            const now = Date.now();
            const last = lastScanRef.current;

            if (last && last.value === value && now - last.timestamp < debounceMs) {
              return;
            }

            lastScanRef.current = { value, timestamp: now };
            onScan?.(value);
          }

          if (error && statusRef.current !== "error") {
            // ZXing fires NotFoundExceptions during normal operation; ignore them.
            if (error.name === "NotFoundException") {
              return;
            }
          }
        },
      );

      statusRef.current = "scanning";
      setStatus("scanning");
    } catch (error) {
      console.error(error);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to start camera stream",
      );
      statusRef.current = "error";
      setStatus("error");
      stop();
    }
  }, [debounceMs, facingMode, onScan, stop]);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    videoRef,
    status,
    errorMessage,
    start,
    stop,
  };
}
