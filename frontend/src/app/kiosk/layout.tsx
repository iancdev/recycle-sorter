import type { Metadata } from "next";

import { SupabaseClientProvider } from "../../features/kiosk/providers/SupabaseClientProvider";

export const metadata: Metadata = {
  title: "Recycle Sorter – Kiosk",
  description:
    "Self-service kiosk for barcode-based recycling deposits and live session feedback.",
};

export default function KioskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SupabaseClientProvider>
      <div className="min-h-screen bg-neutral-950 text-neutral-50">
        {children}
      </div>
    </SupabaseClientProvider>
  );
}
