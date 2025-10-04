import { create } from "zustand";

import type { AuthenticateBarcodeResponse } from "../api/authenticate-barcode";

type KioskStatus = "idle" | "authenticating" | "ready" | "error";

type Nullable<T> = T | null;

type SessionPayload = AuthenticateBarcodeResponse;

interface KioskState {
  status: KioskStatus;
  errorMessage?: string;
  lastScannedBarcode: Nullable<string>;
  lastScannedAt: Nullable<number>;
  session: Nullable<SessionPayload["session"]>;
  profile: Nullable<SessionPayload["profile"]>;
  identifier: Nullable<SessionPayload["identifier"]>;
  authMeta: Nullable<SessionPayload["auth"]>;
  setAuthenticating: (barcode: string) => void;
  setReady: (payload: SessionPayload) => void;
  setError: (message: string) => void;
  reset: () => void;
}

const initialState: Pick<
  KioskState,
  | "status"
  | "errorMessage"
  | "lastScannedBarcode"
  | "lastScannedAt"
  | "session"
  | "profile"
  | "identifier"
  | "authMeta"
> = {
  status: "idle",
  errorMessage: undefined,
  lastScannedBarcode: null,
  lastScannedAt: null,
  session: null,
  profile: null,
  identifier: null,
  authMeta: null,
};

export const useKioskStore = create<KioskState>((set) => ({
  ...initialState,
  setAuthenticating: (barcode) =>
    set(() => ({
      status: "authenticating",
      errorMessage: undefined,
      lastScannedBarcode: barcode,
      lastScannedAt: Date.now(),
    })),
  setReady: (payload) =>
    set((state) => ({
      status: "ready",
      errorMessage: undefined,
      session: payload.session,
      profile: payload.profile,
      identifier: payload.identifier,
      authMeta: payload.auth,
      lastScannedBarcode: state.lastScannedBarcode,
      lastScannedAt: state.lastScannedAt,
    })),
  setError: (message) =>
    set(() => ({
      status: "error",
      errorMessage: message,
    })),
  reset: () => set(() => ({ ...initialState })),
}));
