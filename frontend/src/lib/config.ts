export type AppConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  edgeDeviceLabel: string;
};

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

export const appConfig: AppConfig = {
  supabaseUrl,
  supabaseAnonKey,
  edgeDeviceLabel,
};
