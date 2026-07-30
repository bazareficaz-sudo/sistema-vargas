-- Restaura a configuração "Empresa que emite o documento fiscal" da Bazar
-- Eficaz, que aponta para a BAZAR OURO E PRATA.
--
-- Ela foi apagada por um bug (já corrigido) em dashboard/empresas/page.tsx:
-- o select não trazia `empresa_fiscal_id`, então o wizard hidratava o campo
-- vazio e o salvamento gravava null. Salvar a aba Fiscal para mexer no CSC
-- foi suficiente para zerar a configuração — e a NFC-e passou a ser emitida
-- com o CNPJ da própria Bazar Eficaz.
--
-- O mesmo bug afetava `empresa_estoque_id` (aba Estoque). Nenhuma das duas
-- empresas usa esse override hoje, então não há o que restaurar ali.

UPDATE empresa_config_fiscal
SET empresa_fiscal_id = '681ab72f-fd5b-4de9-8623-59eeb32e6d18', -- BAZAR OURO E PRATA
    updated_at = now()
WHERE empresa_id = 'a1000000-0000-0000-0000-000000000001';      -- Bazar Eficaz

-- Confere o resultado
SELECT e.nome AS empresa,
       COALESCE(f.nome, '(emite com o próprio CNPJ)') AS quem_emite,
       cf.csc_nfce IS NOT NULL AS tem_csc
FROM empresa_config_fiscal cf
JOIN empresas e ON e.id = cf.empresa_id
LEFT JOIN empresas f ON f.id = cf.empresa_fiscal_id
WHERE cf.empresa_id IN (
  'a1000000-0000-0000-0000-000000000001',
  '681ab72f-fd5b-4de9-8623-59eeb32e6d18'
);
