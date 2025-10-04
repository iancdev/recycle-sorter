export type AppConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  edgeDeviceLabel: string;
  enableIdleTimeout: boolean;
  enableAudioFeedback: boolean;
};


function getBooleanEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }
  const normalized = raw.trim().toLowerCase();
  if (["0", "false", "off", "no"].includes(normalized)) {
    return false;
  }
  if (["1", "true", "on", "yes"].includes(normalized)) {
    return true;
  }
  return defaultValue;
}

function resolveSupabaseUrl(): string {
  const direct = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (direct && direct.length > 0) {
    return direct;
  }

  const projectId = process.env.SUPABASE_PROJECT_ID;
  if (projectId && projectId.length > 0) {
    const derived = `https://${projectId}.supabase.co`;
    console.warn(
      "NEXT_PUBLIC_SUPABASE_URL not set; deriving from SUPABASE_PROJECT_ID as",
      derived,
    );
    return derived;
  }

  if (typeof window === "undefined") {
    console.warn(
      "Missing NEXT_PUBLIC_SUPABASE_URL; falling back to empty string. Set NEXT_PUBLIC_SUPABASE_URL or SUPABASE_PROJECT_ID.",
    );
    return "";
  }

  throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL");
}

function resolveSupabaseAnonKey(): string {
  const direct = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (direct && direct.length > 0) {
    return direct;
  }

  const fallback = process.env.SUPABASE_ANON_KEY;
  if (fallback && fallback.length > 0) {
    console.warn(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY not set; using SUPABASE_ANON_KEY fallback.",
    );
    return fallback;
  }

  if (typeof window === "undefined") {
    console.warn(
      "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY; falling back to empty string. Set NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY.",
    );
    return "";
  }

  throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

const supabaseUrl = resolveSupabaseUrl();
const supabaseAnonKey = resolveSupabaseAnonKey();
const edgeDeviceLabel =
  process.env.NEXT_PUBLIC_KIOSK_EDGE_DEVICE_LABEL?.trim() || "demo_kiosk";
const enableIdleTimeout = getBooleanEnv(
  "NEXT_PUBLIC_ENABLE_IDLE_TIMEOUT",
  true,
);
const enableAudioFeedback = getBooleanEnv(
  "NEXT_PUBLIC_ENABLE_AUDIO_FEEDBACK",
  false,
);

export const appConfig: AppConfig = {
  supabaseUrl,
  supabaseAnonKey,
  edgeDeviceLabel,
  enableIdleTimeout,
  enableAudioFeedback,
};
