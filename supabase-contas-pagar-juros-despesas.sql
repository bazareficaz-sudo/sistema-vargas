-- ============================================================
-- CONTAS A PAGAR: juros, multa, valor realmente pago e tipo de despesa
--
-- Hoje a tabela `contas_pagar` só guarda `valor` (o que era devido) e
-- `status='pago'`. Não existe nenhum campo dizendo QUANTO saiu do caixa.
-- Na prática isso significa que:
--
--   • pagar R$ 500 de um boleto de R$ 480 registra R$ 480 — os R$ 20 de
--     juros somem do sistema;
--   • o relatório não tem como mostrar juros que ninguém grava;
--   • "quanto essa empresa custa de multa por atraso" é uma pergunta que o
--     banco de dados não consegue responder.
--
-- Estas colunas fecham esse buraco. Todas são opcionais e com padrão zero:
-- as 79 contas que já existem continuam se comportando exatamente como hoje.
-- ============================================================


-- ── 1. Tipos de despesa ─────────────────────────────────────
-- Categoria da saída (Fornecedor, Luz, Impostos...). Fica em tabela própria,
-- e não como texto livre na conta, porque o relatório precisa agrupar — e
-- texto digitado à mão vira "Energia", "energia", "Luz/Energia" e nenhum
-- agrupamento fecha.

CREATE TABLE IF NOT EXISTS tipos_despesa (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  cor         TEXT,                      -- badge na tela; opcional
  ativo       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mesmo nome duas vezes na mesma empresa é sempre erro de digitação.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tipos_despesa_nome
  ON tipos_despesa (empresa_id, lower(trim(nome)));

CREATE INDEX IF NOT EXISTS idx_tipos_despesa_empresa
  ON tipos_despesa (empresa_id) WHERE ativo;

ALTER TABLE tipos_despesa DISABLE ROW LEVEL SECURITY;


-- ── 2. Colunas novas em contas_pagar ────────────────────────

ALTER TABLE contas_pagar
  ADD COLUMN IF NOT EXISTS valor_pago      NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS juros           NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS multa           NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS desconto        NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tipo_despesa_id UUID REFERENCES tipos_despesa(id);

COMMENT ON COLUMN contas_pagar.valor_pago IS
  'Quanto saiu do caixa de verdade (valor - desconto + juros + multa). NULL enquanto não pago.';
COMMENT ON COLUMN contas_pagar.juros IS
  'Juros pagos por atraso. Inclui a diferença quando o usuário informa só o total pago.';
COMMENT ON COLUMN contas_pagar.multa IS 'Multa por atraso.';
COMMENT ON COLUMN contas_pagar.desconto IS 'Desconto obtido no pagamento (antecipação, negociação).';

CREATE INDEX IF NOT EXISTS idx_contas_pagar_tipo_despesa
  ON contas_pagar (tipo_despesa_id) WHERE tipo_despesa_id IS NOT NULL;

-- Relatório sempre filtra por empresa + data de pagamento.
CREATE INDEX IF NOT EXISTS idx_contas_pagar_pagamento
  ON contas_pagar (empresa_id, data_pagamento) WHERE status = 'pago';


-- ── 3. Contas já pagas: valor_pago = valor ──────────────────
-- Sem juros e sem multa, porque é a única coisa que se sabe de verdade sobre
-- elas. Inventar juros retroativo seria pior do que assumir zero.

UPDATE contas_pagar
SET valor_pago = valor
WHERE status = 'pago' AND valor_pago IS NULL;


-- ── 4. Tipos iniciais, um conjunto por empresa ──────────────
-- Os que o usuário citou, mais os que aparecem em toda empresa. São só uma
-- partida — a tela permite renomear, desativar e criar outros.

INSERT INTO tipos_despesa (empresa_id, nome, cor)
SELECT e.id, t.nome, t.cor
FROM empresas e
CROSS JOIN (VALUES
  ('Fornecedor',       '#2563eb'),
  ('Luz',              '#f59e0b'),
  ('Água',             '#0891b2'),
  ('Aluguel',          '#7c3aed'),
  ('Impostos',         '#dc2626'),
  ('Folha de pagamento','#059669'),
  ('Internet/Telefone','#4f46e5'),
  ('Frete',            '#ea580c'),
  ('Manutenção',       '#65a30d'),
  ('Outros',           '#6b7280')
) AS t(nome, cor)
ON CONFLICT DO NOTHING;


-- ── 5. Classificar o passado ────────────────────────────────
-- Conta com fornecedor vinculado é compra de mercadoria — é o único palpite
-- que se sustenta sozinho. O resto fica sem tipo, para o usuário classificar
-- (ou não) conforme a necessidade.

UPDATE contas_pagar cp
SET tipo_despesa_id = td.id
FROM tipos_despesa td
WHERE td.empresa_id = cp.empresa_id
  AND td.nome = 'Fornecedor'
  AND cp.fornecedor_id IS NOT NULL
  AND cp.tipo_despesa_id IS NULL;


-- ── 6. Contas "aberto" que nasceram invisíveis ──────────────
--
-- A entrada por XML gravava status 'aberto'; a tela de Contas a Pagar só
-- conhece 'pendente', 'vencido', 'pago' e 'cancelado'. Resultado medido na
-- base em 09/08/2026: 32 das 79 contas estavam com 'aberto' — fora de todas
-- as abas, fora dos cards de total, e nunca promovidas a 'vencido' pela
-- rotina automática (que só olha 'pendente').
--
-- A origem já foi corrigida no código. Aqui ficam as que já existem.

UPDATE contas_pagar SET status = 'pendente' WHERE status = 'aberto';

-- E promove imediatamente as que já venceram.
UPDATE contas_pagar SET status = 'vencido'
WHERE status = 'pendente' AND vencimento < CURRENT_DATE;


-- ── 7. Conferência ──────────────────────────────────────────

SELECT 'contas por status: ' || status AS o, count(*) AS n FROM contas_pagar GROUP BY status
UNION ALL
SELECT 'tipos criados', count(*) FROM tipos_despesa
UNION ALL
SELECT 'contas classificadas', count(*) FROM contas_pagar WHERE tipo_despesa_id IS NOT NULL
UNION ALL
SELECT 'contas pagas com valor_pago', count(*) FROM contas_pagar WHERE valor_pago IS NOT NULL;
