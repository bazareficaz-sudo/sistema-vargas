-- ============================================================
-- CLIENTE UNIFICADO: REDIRECIONAR LANÇAMENTOS NOVOS
--
-- Unificar dois cadastros conserta o histórico, mas não impede que algo
-- continue lançando no cadastro que morreu. Medido hoje (18/08/2026): o
-- ROCHA RANGEL foi unificado por volta das 14h e, mesmo assim, duas vendas
-- de carteira entraram no cadastro antigo às 15:04 e 17:28 — R$ 99,50 a
-- receber pendurados num cliente inativo, fora do saldo de quem realmente
-- deve.
--
-- Quem lança é o PDV externo, que tem a própria cópia do cadastro e segue
-- mandando o id velho. Não dá pra corrigir isso só do lado de cá pedindo
-- pra ele parar; dá pra fazer o banco redirecionar sozinho.
--
-- É o mesmo raciocínio do gatilho criar_conta_carteira
-- (supabase-corrigir-carteira-e-clientes-duplicados.sql, ETAPA 4): a regra
-- desce da tela pro banco, e passa a valer por qualquer porta de entrada.
--
-- `mesclado_em` copia o padrão que produtos já usa pra merge
-- (supabase-unificar-produtos.sql): o registro perdedor nunca é apagado,
-- só passa a apontar pro vencedor.
-- ============================================================

-- ── 1. Marcar de onde pra onde ──────────────────────────────
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS mesclado_em UUID REFERENCES clientes(id),
  ADD COLUMN IF NOT EXISTS mesclado_em_data TIMESTAMPTZ;

COMMENT ON COLUMN clientes.mesclado_em IS
  'Quando preenchido, este cadastro foi unificado noutro: lançamentos novos que apontarem pra cá são redirecionados pro cliente indicado (ver gatilhos redirecionar_cliente_mesclado).';

-- Registra a unificação já feita do ESCRITORIO CONTABILIDADE ROCHA RANGEL.
UPDATE clientes
SET mesclado_em = 'a188415c-5cd1-4c1a-9514-3045e1e8f8d0',
    mesclado_em_data = now()
WHERE id = '2c73238a-6b8b-46b7-95fa-062e4cf88e2a'
  AND mesclado_em IS NULL;


-- ── 2. Redirecionar lançamento novo ─────────────────────────
--
-- BEFORE INSERT: troca o cliente_id antes de gravar, então a linha já
-- nasce no cadastro certo — nada precisa ser consertado depois.
--
-- O laço `WHILE` cobre unificação em cadeia (A virou B, B virou C), com
-- teto de 10 saltos pra nunca travar caso alguém crie um ciclo à mão.

CREATE OR REPLACE FUNCTION redirecionar_cliente_mesclado() RETURNS trigger AS $$
DECLARE
  destino UUID;
  saltos  INT := 0;
BEGIN
  IF NEW.cliente_id IS NULL THEN RETURN NEW; END IF;

  LOOP
    SELECT mesclado_em INTO destino FROM clientes WHERE id = NEW.cliente_id;
    EXIT WHEN destino IS NULL;
    NEW.cliente_id := destino;
    saltos := saltos + 1;
    EXIT WHEN saltos >= 10;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Nas tabelas onde um lançamento novo pode chegar por fora do sistema web.
-- vendas vem ANTES do gatilho de carteira (ordem alfabética do nome do
-- gatilho decide, e "a_" garante que a conta a receber já nasça no cliente
-- certo).
DROP TRIGGER IF EXISTS a_trg_redirecionar_cliente ON vendas;
CREATE TRIGGER a_trg_redirecionar_cliente
  BEFORE INSERT ON vendas
  FOR EACH ROW EXECUTE FUNCTION redirecionar_cliente_mesclado();

DROP TRIGGER IF EXISTS a_trg_redirecionar_cliente ON contas_receber;
CREATE TRIGGER a_trg_redirecionar_cliente
  BEFORE INSERT ON contas_receber
  FOR EACH ROW EXECUTE FUNCTION redirecionar_cliente_mesclado();

DROP TRIGGER IF EXISTS a_trg_redirecionar_cliente ON orcamentos;
CREATE TRIGGER a_trg_redirecionar_cliente
  BEFORE INSERT ON orcamentos
  FOR EACH ROW EXECUTE FUNCTION redirecionar_cliente_mesclado();

DROP TRIGGER IF EXISTS a_trg_redirecionar_cliente ON recebimentos;
CREATE TRIGGER a_trg_redirecionar_cliente
  BEFORE INSERT ON recebimentos
  FOR EACH ROW EXECUTE FUNCTION redirecionar_cliente_mesclado();


-- ── 3. Recolher o que já entrou errado ──────────────────────
UPDATE vendas v SET cliente_id = c.mesclado_em
FROM clientes c WHERE v.cliente_id = c.id AND c.mesclado_em IS NOT NULL;

UPDATE contas_receber cr SET cliente_id = c.mesclado_em
FROM clientes c WHERE cr.cliente_id = c.id AND c.mesclado_em IS NOT NULL;

UPDATE orcamentos o SET cliente_id = c.mesclado_em
FROM clientes c WHERE o.cliente_id = c.id AND c.mesclado_em IS NOT NULL;

UPDATE recebimentos r SET cliente_id = c.mesclado_em
FROM clientes c WHERE r.cliente_id = c.id AND c.mesclado_em IS NOT NULL;


-- ── 4. Recalcular saldo dos envolvidos ──────────────────────
-- Recalcula da fonte (contas em aberto), não soma o cache — mesmo
-- raciocínio da ETAPA 3 do conserto de 07/08.
UPDATE clientes c SET
  saldo_devedor = COALESCE((
    SELECT sum(cr.valor_original - COALESCE(cr.valor_recebido, 0))
    FROM contas_receber cr
    WHERE cr.cliente_id = c.id AND cr.status IN ('aberto', 'vencido')
  ), 0),
  updated_at = now()
WHERE c.mesclado_em IS NOT NULL
   OR c.id IN (SELECT mesclado_em FROM clientes WHERE mesclado_em IS NOT NULL);


-- ── Conferência ──────────────────────────────────────────────
--   SELECT id, nome, ativo, saldo_devedor, mesclado_em FROM clientes
--   WHERE mesclado_em IS NOT NULL OR id IN (SELECT mesclado_em FROM clientes WHERE mesclado_em IS NOT NULL);
--
--   Deve dar 0 — nada mais pendurado em cadastro unificado:
--   SELECT count(*) FROM contas_receber cr JOIN clientes c ON c.id = cr.cliente_id WHERE c.mesclado_em IS NOT NULL;
