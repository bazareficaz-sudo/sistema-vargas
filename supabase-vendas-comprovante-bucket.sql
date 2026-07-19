-- ============================================================
-- Vendas: bucket pra comprovante em PDF (impressão + envio WhatsApp)
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

-- Privado: o comprovante carrega nome/telefone do cliente e valores da
-- venda. Acesso sempre via signed URL de curta duração gerada pela rota,
-- nunca por URL pública (mesmo padrão do bucket etiquetas-envio).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'comprovantes-venda',
  'comprovantes-venda',
  false,
  5242880,  -- 5 MB por arquivo
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Upload autenticado comprovantes-venda"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'comprovantes-venda');

CREATE POLICY "Leitura autenticada comprovantes-venda"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'comprovantes-venda');

CREATE POLICY "Delete autenticado comprovantes-venda"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'comprovantes-venda');
