-- ============================================================
-- SINCRONIZAR PREÇO ENTRE EMPRESAS PARCEIRAS
--
-- Até aqui, produto vinculado entre empresas do grupo nunca compartilhava
-- preço/custo — regra deliberada, documentada em src/lib/produtos/vinculo.ts:
-- "cada empresa mantém os seus, sempre". Fazia sentido como padrão seguro,
-- mas trava exatamente o caso que motivou o pedido: um gestor cuidando de
-- várias lojas que vendem o MESMO produto não quer manter uma tabela de
-- preço e uma tabela de custo por loja.
--
-- Em vez de mudar a regra pra todo mundo, vira uma ESCOLHA por parceria —
-- desligada por padrão, então nenhuma parceria já existente muda de
-- comportamento sozinha. Quem administra as duas empresas decide.
--
-- Estoque e campos fiscais CONTINUAM nunca sincronizando — isso não muda.
-- Estoque é fato físico (uma loja não ganha mercadoria porque outra mudou
-- um número); fiscal depende do regime tributário de cada empresa (ver
-- src/lib/fiscal/regimeDefault.ts) e sincronizar cegamente rejeitaria nota
-- na SEFAZ.
-- ============================================================

ALTER TABLE empresa_parcerias
  ADD COLUMN IF NOT EXISTS sincronizar_preco BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN empresa_parcerias.sincronizar_preco IS
  'Quando true, editar preco_venda/preco_custo/markup de um produto vinculado propaga pro produto equivalente na empresa parceira (as duas direções). Desligado por padrão — precisa ser ligado explicitamente em Empresas > Parcerias.';

-- ── Conferência ──────────────────────────────────────────────
--   SELECT id, empresa_id_a, empresa_id_b, sincronizar_preco FROM empresa_parcerias;
