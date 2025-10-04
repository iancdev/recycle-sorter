import type { Database } from "../../lib/database.types";

export type SessionRow = Database["public"]["Tables"]["sessions"]["Row"];
export type CategoryRow = Database["public"]["Tables"]["categories"]["Row"];
export type TransactionRow = Database["public"]["Tables"]["transactions"]["Row"];
export type SessionItemRow = Database["public"]["Tables"]["session_items"]["Row"];
export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

export type SessionItemRecord = SessionItemRow & {
  categories?: CategoryRow | null;
  transactions?: TransactionRow | null;
};
