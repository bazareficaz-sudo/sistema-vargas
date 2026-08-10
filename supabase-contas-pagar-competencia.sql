-- ============================================================
-- COMPETÊNCIA e DESPESAS RECORRENTES em contas a pagar
--
-- Competência é o mês a que a despesa PERTENCE, que nem sempre é o mês em
-- que ela vence. A conta de luz de julho chega e vence em agosto — o gasto
-- é de julho. Sem esse campo, todo relatório por mês joga o consumo de
-- julho dentro de agosto, e a comparação entre meses fica errada de um mês
-- inteiro.
--
-- Guardado como DATE no primeiro dia do mês (2026-07-01 = "julho/2026").
-- É a forma mais simples de ordenar, agrupar e comparar sem inventar um
-- formato de texto que depois ninguém consegue somar.
-- ============================================================


-- ── 1. Competência ──────────────────────────────────────────

ALTER TABLE contas_pagar
  ADD COLUMN IF NOT EXISTS competencia DATE;

COMMENT ON COLUMN contas_pagar.competencia IS
  'Mês a que a despesa pertence (sempre dia 1). Pode ser diferente do vencimento: luz de julho vence em agosto.';

CREATE INDEX IF NOT EXISTS idx_contas_pagar_competencia
  ON contas_pagar (empresa_id, competencia);


-- ── 2. Recorrência ──────────────────────────────────────────
-- Uma despesa recorrente gera N contas de uma vez, uma por mês. Elas ficam
-- ligadas por um id comum para ser possível editar ou cancelar a série
-- inteira depois — sem isso, "cancelei o plano" viraria 12 exclusões à mão.

ALTER TABLE contas_pagar
  ADD COLUMN IF NOT EXISTS recorrencia_id    UUID,
  ADD COLUMN IF NOT EXISTS recorrencia_indice SMALLINT,
  ADD COLUMN IF NOT EXISTS recorrencia_total  SMALLINT;

COMMENT ON COLUMN contas_pagar.recorrencia_id IS
  'Agrupa as contas geradas por uma mesma despesa recorrente.';

CREATE INDEX IF NOT EXISTS idx_contas_pagar_recorrencia
  ON contas_pagar (recorrencia_id) WHERE recorrencia_id IS NOT NULL;


-- ── 3. Preencher a competência do que já existe ─────────────
--
-- Para o passado, o melhor palpite disponível é o próprio vencimento — é o
-- que o sistema tinha. Não é sempre certo (a luz vencida em agosto era de
-- julho), mas deixar em branco significaria que todo relatório por
-- competência começaria ignorando as 79 contas atuais.
--
-- Exceção: conta vinda de nota fiscal usa a data de emissão da NF-e, que é
-- a competência de verdade da compra.

UPDATE contas_pagar cp
SET competencia = date_trunc('month', ne.data_emissao)::date
FROM nfe_entradas ne
WHERE cp.origem = 'entrada_xml'
  AND cp.origem_id = ne.id
  AND cp.competencia IS NULL
  AND ne.data_emissao IS NOT NULL;

UPDATE contas_pagar
SET competencia = date_trunc('month', vencimento)::date
WHERE competencia IS NULL AND vencimento IS NOT NULL;


-- ── 4. Conferência ──────────────────────────────────────────

SELECT to_char(competencia, 'MM/YYYY') AS competencia,
       count(*) AS contas,
       round(sum(valor)::numeric, 2) AS total
FROM contas_pagar
WHERE competencia IS NOT NULL
GROUP BY 1, competencia
ORDER BY competencia;
