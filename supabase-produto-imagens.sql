-- ============================================================
-- PRODUTO: Código do Fornecedor + Imagens múltiplas
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Campo código do fornecedor na tabela produtos
ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS codigo_fornecedor TEXT;

-- 2. Tabela de imagens dos produtos
CREATE TABLE IF NOT EXISTS produto_imagens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL,
  produto_id  UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  ordem       INT NOT NULL DEFAULT 0,
  principal   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE produto_imagens DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_produto_imagens_produto ON produto_imagens(produto_id);
CREATE INDEX IF NOT EXISTS idx_produto_imagens_empresa ON produto_imagens(empresa_id);

-- 3. Bucket de storage para imagens de produtos
-- Execute este bloco no SQL Editor do Supabase:
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'produto-imagens',
  'produto-imagens',
  true,
  5242880,  -- 5 MB por arquivo
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Policy: acesso público de leitura
CREATE POLICY "Leitura pública produto-imagens"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'produto-imagens');

-- Policy: autenticados podem inserir
CREATE POLICY "Upload autenticado produto-imagens"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'produto-imagens');

-- Policy: autenticados podem deletar
CREATE POLICY "Delete autenticado produto-imagens"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'produto-imagens');
