"use client";

import { useState } from "react";

import { useKioskStore } from "../state/useKioskStore";

const PHONE_REGEX = /^\+?[0-9]{7,15}$/;

function normalizePhone(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("+")) {
    return trimmed.replace(/[^0-9+]/g, "");
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  return `+${digits}`;
}

export function LinkPhoneCard() {
  const profile = useKioskStore((state) => state.profile);
  const updateProfile = useKioskStore((state) => state.updateProfile);

  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string>("");

  if (!profile) {
    return null;
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalized = normalizePhone(phone);
    if (!PHONE_REGEX.test(normalized)) {
      setStatus("error");
      setMessage("Enter a valid international phone number");
      return;
    }

    setStatus("submitting");
    setMessage("");

    try {
      const response = await fetch("/api/kiosk/link-phone", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ profileId: profile.id, phone: normalized }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to link phone number");
      }

      const data = (await response.json()) as {
        profile: { phone: string };
      };

      updateProfile({ ...profile, phone: data.profile.phone });
      setPhone(data.profile.phone ?? "");
      setStatus("success");
      setMessage("Phone number linked successfully");
    } catch (error) {
      console.error(error);
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to link phone number right now",
      );
    }
  };

  return (
    <div className="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6 text-sm text-neutral-200">
      <h2 className="text-lg font-semibold text-neutral-50">Link phone number</h2>
      <p className="mt-2 text-xs text-neutral-400">
        Add your phone number to access your balance later without a card.
      </p>
      <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
        <input
          type="tel"
          inputMode="tel"
          name="phone"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="e.g. +14155552671"
          className="w-full rounded-2xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-sky-400 focus:outline-none"
          disabled={status === "submitting"}
        />
        <button
          type="submit"
          className="w-full rounded-full border border-sky-400/40 bg-sky-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-sky-200 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={status === "submitting"}
        >
          {status === "submitting" ? "Linking…" : "Link phone"}
        </button>
      </form>
      {message && (
        <p
          className={`mt-3 text-xs ${
            status === "error"
              ? "text-rose-400"
              : status === "success"
              ? "text-emerald-300"
              : "text-neutral-400"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
