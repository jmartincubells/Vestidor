-- ============================================================
-- VESTIDOR — Schema inicial
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────
-- TABLA: maniqui
-- Medidas corporales extraídas de la foto de onboarding
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maniqui (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  ancho_hombros    numeric,
  cintura          numeric,
  cadera           numeric,
  largo_torso      numeric,
  largo_piernas    numeric,
  altura_estimada  numeric,
  landmarks_json   jsonb,
  updated_at       timestamptz DEFAULT now() NOT NULL
);

-- ─────────────────────────────────────────────
-- TABLA: colecciones
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS colecciones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  nombre     text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- ─────────────────────────────────────────────
-- TABLA: prendas
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prendas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  coleccion_id  uuid REFERENCES colecciones(id) ON DELETE SET NULL,
  categoria     text NOT NULL CHECK (categoria IN ('top','bottom','dress','outerwear','shoes','accessory')),
  color         text,
  etiquetas     jsonb,
  variantes     jsonb,
  url_png       text,
  url_original  text,
  estado        text NOT NULL DEFAULT 'pendiente'
                CHECK (estado IN ('pendiente','procesando','listo','reintentar','fallo_permanente')),
  error_msg     text,
  intentos      integer NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now() NOT NULL,
  updated_at    timestamptz DEFAULT now() NOT NULL
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prendas_updated_at
  BEFORE UPDATE ON prendas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER maniqui_updated_at
  BEFORE UPDATE ON maniqui
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Índices
CREATE INDEX IF NOT EXISTS idx_prendas_user_id ON prendas(user_id);
CREATE INDEX IF NOT EXISTS idx_prendas_estado ON prendas(estado);
CREATE INDEX IF NOT EXISTS idx_prendas_coleccion ON prendas(coleccion_id);
CREATE INDEX IF NOT EXISTS idx_colecciones_user_id ON colecciones(user_id);

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
ALTER TABLE maniqui ENABLE ROW LEVEL SECURITY;
ALTER TABLE colecciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE prendas ENABLE ROW LEVEL SECURITY;

-- maniqui: solo el propio usuario
CREATE POLICY maniqui_own ON maniqui
  FOR ALL USING (auth.uid() = user_id);

-- colecciones: solo el propio usuario
CREATE POLICY colecciones_own ON colecciones
  FOR ALL USING (auth.uid() = user_id);

-- prendas: solo el propio usuario
CREATE POLICY prendas_own ON prendas
  FOR ALL USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- STORAGE BUCKET
-- Crear en Supabase Dashboard > Storage > New bucket:
--   Nombre: prendas-png
--   Public: true (para acceso directo a URLs)
-- ─────────────────────────────────────────────
-- O via SQL (requiere extensión storage):
-- INSERT INTO storage.buckets (id, name, public) VALUES ('prendas-png', 'prendas-png', true)
-- ON CONFLICT DO NOTHING;

-- Storage RLS: solo el dueño puede subir/borrar
-- CREATE POLICY "Owner can upload" ON storage.objects
--   FOR INSERT WITH CHECK (auth.uid()::text = (storage.foldername(name))[1]);
-- CREATE POLICY "Owner can delete" ON storage.objects
--   FOR DELETE USING (auth.uid()::text = (storage.foldername(name))[1]);
-- CREATE POLICY "Public read" ON storage.objects
--   FOR SELECT USING (bucket_id = 'prendas-png');
