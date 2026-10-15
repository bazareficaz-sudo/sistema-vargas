-- Parcelamento do orçamento: a regra é a PARCELA, não o número de vezes.
--
-- O QUE ISTO RESOLVE
--
-- O modal de condições do web nasce com o campo de parcelas em BRANCO. Medido
-- em produção: dos 72 orçamentos dos últimos 12 meses, apenas 8 têm
-- parcelamento preenchido, e 69 seguem com status 'aberto'. Uma condição
-- comercial que depende de o vendedor lembrar de digitar, com o cliente na
-- frente, não é usada.
--
-- A REGRA, E POR QUE ELA É MELHOR QUE UM NÚMERO FIXO
--
-- O número de parcelas sai do total: `floor(total / parcela_minima)`, com piso
-- de 1 e teto em `parcelas_max`. Com mínima de R$ 50:
--
--     R$  80  ->  1x   (só à vista — some sozinho no ticket baixo)
--     R$ 100  ->  2x de R$ 50,00
--     R$ 150  ->  3x de R$ 50,00
--     R$ 200  ->  4x de R$ 50,00
--
-- Um "sempre 3x" ofereceria 3x de R$ 26,67 num orçamento de R$ 80 — parcela
-- que não paga o custo de processar. O teto existe porque sem ele um orçamento
-- de R$ 5.000 viraria 100x.
--
-- ONDE MORA, E POR QUE AQUI
--
-- `saude_config` já guarda `orcamento_promo_vira_desconto` e
-- `orcamento_promo_formas` — a estratégia de apresentar a promoção como
-- desconto à vista. O parcelamento é a outra metade da mesma proposta
-- comercial; separá-las em duas tabelas criaria dois lugares para configurar
-- uma conversa só.
--
-- E o PDV externo já lê esta tabela inteira (`select('*')`), então recebe as
-- três colunas sem rota nova e sem mudança de contrato.
--
-- ADITIVA, COM DEFAULT. Nenhuma linha existente muda de comportamento por
-- acidente: quem não configurar nada passa a oferecer até 6x com parcela
-- mínima de R$ 50, que é a regra pedida pelo lojista. O orçamento continua
-- mandando no caso particular — estas colunas são só o ponto de partida.

ALTER TABLE saude_config
  ADD COLUMN IF NOT EXISTS orcamento_parcela_minima     numeric NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS orcamento_parcelas_max       integer NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS orcamento_parcelas_sem_juros boolean NOT NULL DEFAULT true;

-- Valores que não fazem proposta nenhuma. Parcela mínima zero faria
-- `floor(total/0)` explodir; teto zero ou negativo desligaria o parcelamento
-- por um caminho que não é o configurado (para desligar, basta teto = 1).
ALTER TABLE saude_config
  DROP CONSTRAINT IF EXISTS saude_config_orcamento_parcelamento_coerente;

ALTER TABLE saude_config
  ADD CONSTRAINT saude_config_orcamento_parcelamento_coerente
  CHECK (orcamento_parcela_minima > 0 AND orcamento_parcelas_max >= 1);

COMMENT ON COLUMN saude_config.orcamento_parcela_minima IS
  'Valor mínimo de cada parcela no orçamento. O número de parcelas é floor(total/este valor), com piso 1 e teto orcamento_parcelas_max.';
COMMENT ON COLUMN saude_config.orcamento_parcelas_max IS
  'Teto de parcelas do orçamento. 1 desliga a oferta de parcelamento.';
COMMENT ON COLUMN saude_config.orcamento_parcelas_sem_juros IS
  'Se o parcelamento oferecido no orçamento é anunciado como sem juros.';
