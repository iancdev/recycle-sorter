export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      categories: {
        Row: {
          created_at: string
          deposit_cents: number
          display_name: string
          id: string
          is_refundable: boolean
          routing_slot: number
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deposit_cents: number
          display_name: string
          id?: string
          is_refundable?: boolean
          routing_slot: number
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deposit_cents?: number
          display_name?: string
          id?: string
          is_refundable?: boolean
          routing_slot?: number
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      edge_devices: {
        Row: {
          created_at: string
          id: string
          label: string
          notes: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          notes?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          notes?: string | null
        }
        Relationships: []
      }
      profile_identifiers: {
        Row: {
          created_at: string
          id: string
          identifier: string
          profile_id: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          identifier: string
          profile_id: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          identifier?: string
          profile_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_identifiers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          balance_cents: number
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          balance_cents?: number
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          balance_cents?: number
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      session_items: {
        Row: {
          amount_cents: number
          category_id: string
          client_ref: string | null
          confidence: number | null
          detected_at: string
          id: string
          raw_payload: Json
          session_id: string
          transaction_id: string | null
        }
        Insert: {
          amount_cents: number
          category_id: string
          client_ref?: string | null
          confidence?: number | null
          detected_at?: string
          id?: string
          raw_payload?: Json
          session_id: string
          transaction_id?: string | null
        }
        Update: {
          amount_cents?: number
          category_id?: string
          client_ref?: string | null
          confidence?: number | null
          detected_at?: string
          id?: string
          raw_payload?: Json
          session_id?: string
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "session_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_items_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: true
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          completed_at: string | null
          edge_device_id: string | null
          id: string
          metadata: Json
          profile_id: string
          started_at: string
          status: string
          total_cents: number
        }
        Insert: {
          completed_at?: string | null
          edge_device_id?: string | null
          id?: string
          metadata?: Json
          profile_id: string
          started_at?: string
          status?: string
          total_cents?: number
        }
        Update: {
          completed_at?: string | null
          edge_device_id?: string | null
          id?: string
          metadata?: Json
          profile_id?: string
          started_at?: string
          status?: string
          total_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "sessions_edge_device_id_fkey"
            columns: ["edge_device_id"]
            isOneToOne: false
            referencedRelation: "edge_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount_cents: number
          category_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          profile_id: string
          session_id: string | null
          type: string
        }
        Insert: {
          amount_cents: number
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          profile_id: string
          session_id?: string | null
          type?: string
        }
        Update: {
          amount_cents?: number
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          profile_id?: string
          session_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      close_session: {
        Args: { next_status?: string; session_id: string }
        Returns: {
          completed_at: string | null
          edge_device_id: string | null
          id: string
          metadata: Json
          profile_id: string
          started_at: string
          status: string
          total_cents: number
        }
      }
      record_session_item: {
        Args: {
          amount_override?: number
          category_slug: string
          client_ref?: string
          confidence?: number
          raw_payload?: Json
          session_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
