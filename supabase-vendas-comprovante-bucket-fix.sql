-- ============================================================
-- Corrige "new row violates row-level security policy" ao reimprimir
-- um comprovante já gerado antes.
--
-- A migration original (supabase-vendas-comprovante-bucket.sql) criou
-- políticas de INSERT/SELECT/DELETE em storage.objects, mas o upload usa
-- upsert:true — reimprimir uma venda cujo PDF já existe faz um UPDATE
-- no storage, que não tinha política nenhuma (por isso funcionava a
-- primeira vez e falhava da segunda em diante, e falhava em massa se
-- alguma das vendas selecionadas já tivesse comprovante gerado).
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

CREATE POLICY "Update autenticado comprovantes-venda"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'comprovantes-venda')
  WITH CHECK (bucket_id = 'comprovantes-venda');
