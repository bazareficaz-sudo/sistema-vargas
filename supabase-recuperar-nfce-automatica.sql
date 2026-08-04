-- Recuperar as vendas que a emissão automática deixou passar
-- ============================================================
--
-- CONTEXTO
--
-- A regra "Emissão para Pedidos Nfce Pix" nunca emitiu nada. O filtro que
-- deveria dizer "venda ainda não autorizada" usava `nfce_status != 'autorizada'`,
-- e em SQL `NULL != 'autorizada'` NÃO é verdadeiro — é NULO — então a linha é
-- descartada. Venda recém-feita tem nfce_status NULO, porque ninguém tentou
-- emitir ainda. O filtro excluía exatamente as vendas que interessavam.
--
-- Medido em produção antes da correção:
--   consulta antiga ............ 0 vendas elegíveis
--   consulta corrigida ......... 90 vendas (23 em pix)
--
-- O código já foi corrigido e está no ar. Daqui pra frente a regra funciona
-- sozinha para vendas NOVAS.
--
-- ⚠️ ESTE ARQUIVO É PARA AS VENDAS ANTIGAS, E É OPCIONAL.
--
-- A regra guarda um marcador (`cursor_processado`) do momento até onde já
-- olhou, e ele está em 04/08 01:10. Vendas anteriores a isso NÃO serão
-- pegas, mesmo com o código corrigido — elas ficaram para trás.
--
-- ⚠️ LEIA ANTES DE RODAR
--
-- Rodar o bloco abaixo faz a automação EMITIR NOTA FISCAL de verdade para
-- todas as vendas em pix desde a data escolhida. Isso é ato fiscal, gera
-- numeração na SEFAZ e não se desfaz sem cancelamento. Só rode se for isso
-- que você quer.
--
-- Alternativa sem risco: na tela de Vendas, filtre por pix, selecione as que
-- quiser e use a ação em massa "Emitir NFC-e". Aí você escolhe uma a uma e vê
-- o resultado de cada.


-- ── Passo 1: ver o que seria emitido, ANTES de mexer em qualquer coisa ──────
--
-- Troque a data se quiser outro período.

SELECT
  numero,
  created_at,
  forma_pagamento,
  total,
  COALESCE(nfce_status, '(nunca tentou)') AS situacao_fiscal
FROM vendas
WHERE empresa_id = 'a1000000-0000-0000-0000-000000000001'
  AND status = 'concluida'
  AND tipo_operacao = 'venda'
  AND forma_pagamento = 'pix'
  AND (nfce_status IS NULL OR nfce_status <> 'autorizada')
  AND created_at >= '2026-08-03T00:00:00Z'
ORDER BY created_at;


-- ── Passo 2: só rode depois de conferir a lista acima ──────────────────────
--
-- Volta o marcador da regra para a data escolhida. Na próxima passagem do
-- robô (a cada 5 minutos), ela emite para todas as vendas em pix do período.
--
-- Emissão é uma por vez e a rotina tem 5 minutos de teto por execução; se
-- forem muitas, ela continua de onde parou na passagem seguinte.

-- UPDATE automacoes
--    SET cursor_processado = '2026-08-03T00:00:00Z'
--  WHERE tipo = 'emissao_fiscal_forma_pagamento'
--    AND empresa_id = 'a1000000-0000-0000-0000-000000000001';


-- ── Passo 3: acompanhar o resultado ────────────────────────────────────────
--
-- Rode alguns minutos depois. `ultimo_status` deve sair de 'sem_acao' para
-- 'ok' (ou 'erro', com o motivo em ultimo_erro).

-- SELECT nome, ultimo_status, ultimo_erro, total_execucoes,
--        ultima_execucao, cursor_processado
--   FROM automacoes
--  WHERE tipo = 'emissao_fiscal_forma_pagamento';

-- E as vendas que foram emitidas:

-- SELECT numero, nfce_status, nfce_numero, nfce_motivo_rejeicao
--   FROM vendas
--  WHERE empresa_id = 'a1000000-0000-0000-0000-000000000001'
--    AND forma_pagamento = 'pix'
--    AND created_at >= '2026-08-03T00:00:00Z'
--  ORDER BY created_at;
