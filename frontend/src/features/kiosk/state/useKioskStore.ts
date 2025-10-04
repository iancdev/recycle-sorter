import { create } from "zustand";

import type { AuthenticateBarcodeResponse } from "../api/authenticate-barcode";
import type {
  CategoryRow,
  SessionItemRecord,
  SessionRow,
} from "../types";

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
  categories: Record<string, CategoryRow>;
  sessionItems: SessionItemRecord[];
  setAuthenticating: (barcode: string) => void;
  setReady: (payload: SessionPayload) => void;
  setError: (message: string) => void;
  reset: () => void;
  setCategories: (categories: CategoryRow[]) => void;
  setSessionItems: (items: SessionItemRecord[]) => void;
  prependSessionItem: (item: SessionItemRecord) => void;
  updateSession: (session: SessionRow) => void;
  clearSessionData: () => void;
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
  | "categories"
  | "sessionItems"
> = {
  status: "idle",
  errorMessage: undefined,
  lastScannedBarcode: null,
  lastScannedAt: null,
  session: null,
  profile: null,
  identifier: null,
  authMeta: null,
  categories: {},
  sessionItems: [],
};

function sortItemsDesc(items: SessionItemRecord[]): SessionItemRecord[] {
  return [...items].sort(
    (a, b) =>
      new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime(),
  );
}

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
      sessionItems: [],
    })),
  setError: (message) =>
    set(() => ({
      status: "error",
      errorMessage: message,
    })),
  reset: () => set(() => ({ ...initialState })),
  setCategories: (categories) =>
    set((state) => {
      const merged = { ...state.categories };
      for (const category of categories) {
        merged[category.id] = category;
      }
      return { categories: merged };
    }),
  setSessionItems: (items) => set(() => ({ sessionItems: sortItemsDesc(items) })),
  prependSessionItem: (item) =>
    set((state) => {
      const exists = state.sessionItems.find((entry) => entry.id === item.id);
      const next = exists
        ? [item, ...state.sessionItems.filter((entry) => entry.id !== item.id)]
        : [item, ...state.sessionItems];
      return { sessionItems: sortItemsDesc(next) };
    }),
  updateSession: (session) =>
    set((state) => ({
      session:
        state.session && state.session.id === session.id ? session : state.session,
    })),
  clearSessionData: () =>
    set(() => ({
      sessionItems: [],
      session: null,
    })),
}));
