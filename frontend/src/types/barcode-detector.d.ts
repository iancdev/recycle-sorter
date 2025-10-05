// Minimal types for BarcodeDetector to satisfy TypeScript in environments
// where the DOM lib does not declare it yet.

export {}; // ensure this file is a module

declare global {
  interface BarcodeDetectorOptions {
    formats?: string[];
  }

  interface DetectedBarcode {
    rawValue?: string;
    format?: string;
    boundingBox?: DOMRectReadOnly;
    cornerPoints?: ReadonlyArray<{ x: number; y: number }>;
  }

  interface BarcodeDetector {
    detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
  }

  interface BarcodeDetectorConstructor {
    new (options?: BarcodeDetectorOptions): BarcodeDetector;
    getSupportedFormats?: () => Promise<string[]>;
  }

  // Safari/Chrome expose it on window when available
  var BarcodeDetector: BarcodeDetectorConstructor | undefined;
}

