
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "books": {
                  Row: {
                    "author": string | null,"created_at": string,"extracted_at": string | null,"format": string,"id": string,"last_opened_at": string | null,"owner_id": string,"segment_count": number,"size_bytes": number,"storage_path": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author"?: string | null,"created_at"?: string,"extracted_at"?: string | null,"format": string,"id"?: string,"last_opened_at"?: string | null,"owner_id"?: string,"segment_count"?: number,"size_bytes": number,"storage_path": string,"title": string
                  }
                  Update: {
                    "author"?: string | null,"created_at"?: string,"extracted_at"?: string | null,"format"?: string,"id"?: string,"last_opened_at"?: string | null,"owner_id"?: string,"segment_count"?: number,"size_bytes"?: number,"storage_path"?: string,"title"?: string
                  }
                  Relationships: [
                    
                  ]
                },"highlights": {
                  Row: {
                    "anchor": NonNullable<Json>,"book_id": string,"color": string,"created_at": string,"id": string,"kind": string,"note": string | null,"owner_id": string,"prefix": string,"quote": string,"segment_seq": number
                  }
                  ComputedFields: never
                  Insert: {
                    "anchor": NonNullable<Json>,"book_id": string,"color": string,"created_at"?: string,"id"?: string,"kind": string,"note"?: string | null,"owner_id"?: string,"prefix"?: string,"quote": string,"segment_seq": number
                  }
                  Update: {
                    "anchor"?: NonNullable<Json>,"book_id"?: string,"color"?: string,"created_at"?: string,"id"?: string,"kind"?: string,"note"?: string | null,"owner_id"?: string,"prefix"?: string,"quote"?: string,"segment_seq"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "highlights_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books"
      referencedColumns: ["id"]
    }
                  ]
                },"messages": {
                  Row: {
                    "content": string,"cost_usd": number,"created_at": string,"id": string,"input_tokens": number,"model_id": string | null,"output_tokens": number,"owner_id": string,"role": string,"status": string,"thread_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content"?: string,"cost_usd"?: number,"created_at"?: string,"id"?: string,"input_tokens"?: number,"model_id"?: string | null,"output_tokens"?: number,"owner_id"?: string,"role": string,"status"?: string,"thread_id": string
                  }
                  Update: {
                    "content"?: string,"cost_usd"?: number,"created_at"?: string,"id"?: string,"input_tokens"?: number,"model_id"?: string | null,"output_tokens"?: number,"owner_id"?: string,"role"?: string,"status"?: string,"thread_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "messages_thread_id_fkey"
      columns: ["thread_id"]
isOneToOne: false
      referencedRelation: "threads"
      referencedColumns: ["id"]
    }
                  ]
                },"reading_positions": {
                  Row: {
                    "book_id": string,"location": NonNullable<Json>,"owner_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "book_id": string,"location": NonNullable<Json>,"owner_id"?: string,"updated_at"?: string
                  }
                  Update: {
                    "book_id"?: string,"location"?: NonNullable<Json>,"owner_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reading_positions_book_id_fkey"
      columns: ["book_id"]
isOneToOne: true
      referencedRelation: "books"
      referencedColumns: ["id"]
    }
                  ]
                },"segments": {
                  Row: {
                    "book_id": string,"label": string,"owner_id": string,"paragraphs": (string)[],"seq": number
                  }
                  ComputedFields: never
                  Insert: {
                    "book_id": string,"label": string,"owner_id"?: string,"paragraphs"?: (string)[],"seq": number
                  }
                  Update: {
                    "book_id"?: string,"label"?: string,"owner_id"?: string,"paragraphs"?: (string)[],"seq"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "segments_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books"
      referencedColumns: ["id"]
    }
                  ]
                },"settings": {
                  Row: {
                    "action_models": NonNullable<Json>,"explanation_language": string,"monthly_cap_usd": number,"owner_id": string,"theme": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action_models"?: NonNullable<Json>,"explanation_language"?: string,"monthly_cap_usd"?: number,"owner_id"?: string,"theme"?: string
                  }
                  Update: {
                    "action_models"?: NonNullable<Json>,"explanation_language"?: string,"monthly_cap_usd"?: number,"owner_id"?: string,"theme"?: string
                  }
                  Relationships: [
                    
                  ]
                },"threads": {
                  Row: {
                    "action": string,"context_scope": string,"created_at": string,"highlight_id": string,"id": string,"owner_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"context_scope": string,"created_at"?: string,"highlight_id": string,"id"?: string,"owner_id"?: string
                  }
                  Update: {
                    "action"?: string,"context_scope"?: string,"created_at"?: string,"highlight_id"?: string,"id"?: string,"owner_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "threads_highlight_id_fkey"
      columns: ["highlight_id"]
isOneToOne: false
      referencedRelation: "highlights"
      referencedColumns: ["id"]
    }
                  ]
                },"usage_events": {
                  Row: {
                    "cost_usd": number,"created_at": string,"id": string,"input_tokens": number,"model_id": string,"output_tokens": number,"owner_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cost_usd"?: number,"created_at"?: string,"id"?: string,"input_tokens"?: number,"model_id": string,"output_tokens"?: number,"owner_id"?: string
                  }
                  Update: {
                    "cost_usd"?: number,"created_at"?: string,"id"?: string,"input_tokens"?: number,"model_id"?: string,"output_tokens"?: number,"owner_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"vocab_entries": {
                  Row: {
                    "anchor": Json | null,"book_id": string | null,"created_at": string,"id": string,"meaning": string,"owner_id": string,"sentence": string,"term": string
                  }
                  ComputedFields: never
                  Insert: {
                    "anchor"?: Json | null,"book_id"?: string | null,"created_at"?: string,"id"?: string,"meaning"?: string,"owner_id"?: string,"sentence"?: string,"term": string
                  }
                  Update: {
                    "anchor"?: Json | null,"book_id"?: string | null,"created_at"?: string,"id"?: string,"meaning"?: string,"owner_id"?: string,"sentence"?: string,"term"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "vocab_entries_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            [_ in never]: never
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
