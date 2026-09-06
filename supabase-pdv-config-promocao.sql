-- CONFIGURAÇÃO DO PDV POR EMPRESA — como a loja trabalha no balcão.
--
-- Primeira necessidade que a criou: promoção condicionada à forma de
-- pagamento. "Este preço é só no Pix" é prática corrente, e existe por um
-- motivo concreto — cartão custa taxa de adquirente, Pix e dinheiro não. Quem
-- anuncia o preço promocional para todo mundo está pagando a taxa do próprio
-- desconto.
--
-- A tabela nasce com essa configuração e com espaço para as próximas: é
-- `empresa_config_pdv`, e não `empresa_promocao_pagamento`, porque a próxima
-- regra de balcão não merece outra tabela.
--
-- POR QUE UMA TABELA NOVA, e não uma coluna em `empresa_config_estoque`:
-- aquela descreve como o estoque se comporta (depósitos, custo, baixa,
-- lote). Regra de balcão não é regra de estoque, e juntar as duas faria o
-- nome da tabela mentir na primeira leitura de quem chega depois.

CREATE TABLE IF NOT EXISTS empresa_config_pdv (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                  UUID NOT NULL UNIQUE REFERENCES empresas(id) ON DELETE CASCADE,

  -- Interruptor. Desligado, o PDV se comporta exatamente como antes desta
  -- migração: promoção vigente vale para qualquer forma de pagamento.
  promocao_exige_forma        BOOLEAN NOT NULL DEFAULT false,

  -- As formas que autorizam o preço promocional, ex.: {pix,dinheiro}.
  --
  -- Lista VAZIA com o interruptor ligado é configuração pela metade, e o
  -- código a trata como "sem restrição" em vez de matar toda promoção em
  -- silêncio — tirar desconto que o cliente já viu na etiqueta, sem ninguém
  -- ter pedido, é o pior desfecho possível aqui. A tela recusa salvar assim.
  promocao_formas             TEXT[] NOT NULL DEFAULT '{}',

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mesmo tratamento das outras `empresa_config_*` deste banco: o acesso é
-- filtrado pela empresa da sessão na aplicação, e a escrita anônima já foi
-- fechada em supabase-fechar-escrita-anonima.sql.
ALTER TABLE empresa_config_pdv DISABLE ROW LEVEL SECURITY;

-- Uma linha por empresa existente, com o padrão desligado. Assim a leitura do
-- PDV nunca precisa distinguir "não configurado" de "configurado como não".
INSERT INTO empresa_config_pdv (empresa_id)
SELECT id FROM empresas
ON CONFLICT (empresa_id) DO NOTHING;

-- ── Conferência ────────────────────────────────────────────
-- Deve devolver uma linha por empresa, todas com o interruptor desligado.
--
--   SELECT e.nome, c.promocao_exige_forma, c.promocao_formas
--   FROM empresa_config_pdv c JOIN empresas e ON e.id = c.empresa_id
--   ORDER BY e.nome;
