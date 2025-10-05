import { create } from "zustand";

import type { AuthenticateBarcodeResponse } from "../api/authenticate-barcode";
import type {
  CategoryRow,
  ProfileRow,
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
  lastActivityAt: Nullable<number>;
  session: Nullable<SessionPayload["session"]>;
  profile: Nullable<SessionPayload["profile"]>;
  identifier: Nullable<SessionPayload["identifier"]>;
  authMeta: Nullable<SessionPayload["auth"]>;
  categories: Record<string, CategoryRow>;
  sessionItems: SessionItemRecord[];
  realtimeStatus: "idle" | "connecting" | "online" | "error";
  recentSessions: Array<Pick<SessionRow, "id" | "started_at" | "total_cents" | "status">>;
  setAuthenticating: (barcode: string) => void;
  setReady: (payload: SessionPayload) => void;
  setError: (message: string) => void;
  reset: () => void;
  setCategories: (categories: CategoryRow[]) => void;
  setSessionItems: (items: SessionItemRecord[]) => void;
  prependSessionItem: (item: SessionItemRecord) => void;
  updateSession: (session: SessionRow) => void;
  updateProfile: (profile: ProfileRow) => void;
  clearSessionData: () => void;
  touchActivity: () => void;
  setRealtimeStatus: (status: "idle" | "connecting" | "online" | "error") => void;
  setRecentSessions: (sessions: Array<Pick<SessionRow, "id" | "started_at" | "total_cents" | "status">>) => void;
}

const initialState: Pick<
  KioskState,
  | "status"
  | "errorMessage"
  | "lastScannedBarcode"
  | "lastScannedAt"
  | "lastActivityAt"
  | "session"
  | "profile"
  | "identifier"
  | "authMeta"
  | "categories"
  | "sessionItems"
  | "realtimeStatus"
  | "recentSessions"
> = {
  status: "idle",
  errorMessage: undefined,
  lastScannedBarcode: null,
  lastScannedAt: null,
  lastActivityAt: null,
  session: null,
  profile: null,
  identifier: null,
  authMeta: null,
  categories: {},
  sessionItems: [],
  realtimeStatus: "idle",
  recentSessions: [],
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
      lastActivityAt: Date.now(),
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
      lastActivityAt: Date.now(),
      sessionItems: [],
      categories: {},
    })),
  setError: (message) =>
    set(() => ({
      status: "error",
      errorMessage: message,
      lastActivityAt: Date.now(),
    })),
  reset: () => set(() => ({ ...initialState })),
  setRealtimeStatus: (realtimeStatus) =>
    set(() => ({ realtimeStatus })),
  setRecentSessions: (sessions) =>
    set(() => ({ recentSessions: sessions })),
  setCategories: (categories) =>
    set(() => ({
      categories: categories.reduce<Record<string, CategoryRow>>((acc, item) => {
        acc[item.id] = item;
        return acc;
      }, {}),
      realtimeStatus: "online",
    })),
  setSessionItems: (items) =>
    set(() => ({
      sessionItems: sortItemsDesc(items),
    })),
  prependSessionItem: (item) =>
    set((state) => {
      const exists = state.sessionItems.find((entry) => entry.id === item.id);
      const next = exists
        ? [item, ...state.sessionItems.filter((entry) => entry.id !== item.id)]
        : [item, ...state.sessionItems];
      return {
        sessionItems: sortItemsDesc(next),
        lastActivityAt: Date.now(),
      };
    }),
  updateSession: (session) =>
    set((state) => ({
      session:
        state.session && state.session.id === session.id ? session : state.session,
      lastActivityAt: Date.now(),
    })),
  updateProfile: (profile) =>
    set((state) => ({
      profile:
        state.profile && state.profile.id === profile.id ? profile : state.profile,
      lastActivityAt: Date.now(),
    })),
  clearSessionData: () =>
    set(() => ({
      sessionItems: [],
      session: null,
      lastActivityAt: null,
    })),
  touchActivity: () => set(() => ({ lastActivityAt: Date.now() })),
}));
