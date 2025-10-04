import { callSupabaseFunction } from "../../../lib/supabase/functions";
import type { Database } from "../../../lib/database.types";
import { appConfig } from "../../../lib/config";

export interface AuthenticateBarcodeInput {
  barcode: string;
  displayName?: string;
}

export interface AuthenticateBarcodeResponse {
  profile: Database["public"]["Tables"]["profiles"]["Row"];
  identifier: Database["public"]["Tables"]["profile_identifiers"]["Row"];
  session: Database["public"]["Tables"]["sessions"]["Row"];
  auth: {
    email: string;
    action_link?: string | null;
    otp?: string | null;
  };
}

export async function authenticateBarcode(
  input: AuthenticateBarcodeInput,
): Promise<AuthenticateBarcodeResponse> {
  const payload = {
    barcode: input.barcode,
    displayName: input.displayName,
    edgeDeviceLabel: appConfig.edgeDeviceLabel,
  };

  return callSupabaseFunction<AuthenticateBarcodeResponse>(
    "authenticate-barcode",
    {
      body: payload,
    },
  );
}
