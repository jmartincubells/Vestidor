import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check .env.local')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})

export type Database = {
  public: {
    Tables: {
      maniqui: {
        Row: {
          id: string
          user_id: string
          ancho_hombros: number | null
          cintura: number | null
          cadera: number | null
          largo_torso: number | null
          largo_piernas: number | null
          altura_estimada: number | null
          landmarks_json: Record<string, unknown> | null
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['maniqui']['Row'], 'id' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['maniqui']['Insert']>
      }
      colecciones: {
        Row: {
          id: string
          user_id: string
          nombre: string
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['colecciones']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['colecciones']['Insert']>
      }
      prendas: {
        Row: {
          id: string
          user_id: string
          coleccion_id: string | null
          categoria: 'top' | 'bottom' | 'dress' | 'outerwear' | 'shoes' | 'accessory'
          color: string | null
          etiquetas: Record<string, unknown> | null
          variantes: Record<string, string> | null
          url_png: string | null
          url_original: string | null
          estado: 'pendiente' | 'procesando' | 'listo' | 'reintentar' | 'fallo_permanente'
          error_msg: string | null
          intentos: number
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['prendas']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['prendas']['Insert']>
      }
    }
  }
}
