-- ============================================================
-- Orçamento — condições comerciais de fechamento
--
-- O orçamento hoje diz só o preço. O que fecha venda no balcão é a
-- CONDIÇÃO: "à vista no Pix sai 5% mais barato" e "ou em até 6x sem
-- juros". Isso vinha sendo dito de boca ou escrito na observação, e se
-- perdia no caminho entre o vendedor e o cliente.
--
-- Os campos ficam no próprio orçamento, e não numa configuração da
-- empresa, porque a condição é negociada caso a caso — o desconto que se
-- dá num orçamento de R$ 200 não é o mesmo de um de R$ 8.000.
--
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE orcamentos
  -- Percentual de desconto para pagamento à vista. 0 = sem oferta.
  ADD COLUMN IF NOT EXISTS desconto_avista_pct NUMERIC NOT NULL DEFAULT 0,
  -- Quais formas dão direito ao desconto. Guardado como lista porque na
  -- prática varia: às vezes só Pix (sem taxa), às vezes dinheiro também.
  ADD COLUMN IF NOT EXISTS avista_formas TEXT[] NOT NULL DEFAULT '{}',
  -- Em quantas vezes o cliente pode parcelar. Nulo = não foi oferecido.
  ADD COLUMN IF NOT EXISTS parcelas_max INTEGER,
  ADD COLUMN IF NOT EXISTS parcelas_sem_juros BOOLEAN NOT NULL DEFAULT true,
  -- Texto livre que entra junto das condições no WhatsApp e na impressão
  -- (ex.: "frete grátis acima de R$ 300").
  ADD COLUMN IF NOT EXISTS condicoes_observacao TEXT,
  -- Marca quando o orçamento foi enviado ao cliente — separa "montei" de
  -- "mandei", que é a diferença entre orçamento parado e proposta viva.
  ADD COLUMN IF NOT EXISTS enviado_em TIMESTAMPTZ;

-- ============================================================
-- COMO DESFAZER:
--
--   ALTER TABLE orcamentos
--     DROP COLUMN IF EXISTS desconto_avista_pct,
--     DROP COLUMN IF EXISTS avista_formas,
--     DROP COLUMN IF EXISTS parcelas_max,
--     DROP COLUMN IF EXISTS parcelas_sem_juros,
--     DROP COLUMN IF EXISTS condicoes_observacao,
--     DROP COLUMN IF EXISTS enviado_em;
--
-- Nenhum orçamento existente é alterado — as colunas nascem com o padrão
-- "sem oferta", que é como os orçamentos de hoje já se comportam.
-- ============================================================
