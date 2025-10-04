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

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const supabaseUrl = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = getRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
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
