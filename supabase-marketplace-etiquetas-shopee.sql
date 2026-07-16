-- ============================================================
-- CENTRAL DE PEDIDOS — Fase 6 (etiqueta de envio Shopee)
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. marketplace_pedido_pacotes (já existe, da Fase 1): campos novos pra
--    acompanhar o fluxo de postagem. `status_etiqueta` já existia, sem uso
--    até agora — passa a guardar: processando | pronta | erro.
ALTER TABLE marketplace_pedido_pacotes
  ADD COLUMN IF NOT EXISTS modalidade_envio TEXT,     -- pickup | dropoff | non_integrated
  ADD COLUMN IF NOT EXISTS endereco_coleta_id TEXT,   -- address_id (pickup)
  ADD COLUMN IF NOT EXISTS filial_dropoff_id TEXT,    -- branch_id (dropoff)
  ADD COLUMN IF NOT EXISTS arquivo_etiqueta_url TEXT, -- path no bucket etiquetas-envio
  ADD COLUMN IF NOT EXISTS etiqueta_gerada_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS etiqueta_erro TEXT;

-- 2. Bucket privado — o PDF carrega nome/endereço reais do comprador
--    (a Shopee só devolve isso mascarado via API de pedido, mas o documento
--    de postagem em si precisa do endereço legível pra transportadora ler).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'etiquetas-envio',
  'etiquetas-envio',
  false,
  5242880,  -- 5 MB por arquivo
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Autenticados podem inserir/ler/remover — a autorização por empresa é
-- feita no código da rota (mesmo padrão do resto do projeto: RLS não é a
-- fronteira de isolamento por tenant, os filtros de empresa_id são).
-- Acesso real do navegador ao arquivo é sempre via signed URL de curta
-- duração gerada pela rota, nunca por URL pública.
CREATE POLICY "Upload autenticado etiquetas-envio"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'etiquetas-envio');

CREATE POLICY "Leitura autenticada etiquetas-envio"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'etiquetas-envio');

CREATE POLICY "Delete autenticado etiquetas-envio"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'etiquetas-envio');
