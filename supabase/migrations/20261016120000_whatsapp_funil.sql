-- CAIXA DE ENTRADA DO WHATSAPP (etapa 3): etapas do atendimento e lembrete
-- de retorno.
--
-- 1. Etapa de cada conversa: novo → atendimento → orçamento → comprou, ou
--    perdido. A pessoa muda na tela; o banco também avança sozinho quando a
--    loja ENVIA de fato (status 'enviado'):
--      resposta/produto/celular  → 'atendimento' (só se ainda era 'novo')
--      orçamento                 → 'orcamento'   (de novo/atendimento/perdido)
--      comprovante de compra     → 'comprou'     (de qualquer etapa aberta ou perdido)
--    Nunca volta etapa sozinho.
-- 2. Lembrete de retorno: uma data (e uma nota curta) por conversa. É só
--    lembrete para a pessoa: nada é enviado automaticamente.
-- 3. View whatsapp_conversas ganha etapa, lembrete, "retorno_vencido" (data
--    de hoje ou passada, no fuso de São Paulo) e "orcamento_parado"
--    (orçamento enviado há 3 dias ou mais e o cliente não escreveu depois).
-- 4. Logado pode alterar etapa e lembrete (o RLS de UPDATE já limita à empresa).
--
-- Depende de 20261015200000_whatsapp_conversas.sql. Aditiva e idempotente.

ALTER TABLE whatsapp_contatos ADD COLUMN IF NOT EXISTS etapa TEXT NOT NULL DEFAULT 'novo';
ALTER TABLE whatsapp_contatos ADD COLUMN IF NOT EXISTS etapa_em TIMESTAMPTZ;
ALTER TABLE whatsapp_contatos ADD COLUMN IF NOT EXISTS retorno_em DATE;
ALTER TABLE whatsapp_contatos ADD COLUMN IF NOT EXISTS retorno_nota TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_contatos_etapa_check') THEN
    ALTER TABLE whatsapp_contatos ADD CONSTRAINT whatsapp_contatos_etapa_check
      CHECK (etapa IN ('novo', 'atendimento', 'orcamento', 'comprou', 'perdido'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_contatos_retorno_nota_check') THEN
    ALTER TABLE whatsapp_contatos ADD CONSTRAINT whatsapp_contatos_retorno_nota_check
      CHECK (retorno_nota IS NULL OR char_length(retorno_nota) <= 200);
  END IF;
END $$;

COMMENT ON COLUMN whatsapp_contatos.etapa IS 'novo, atendimento, orcamento, comprou ou perdido.';
COMMENT ON COLUMN whatsapp_contatos.etapa_em IS 'Quando a etapa mudou pela última vez.';
COMMENT ON COLUMN whatsapp_contatos.retorno_em IS 'Lembrete: dia de voltar a falar com o contato. Nada é enviado sozinho.';

GRANT UPDATE (etapa, retorno_em, retorno_nota) ON whatsapp_contatos TO authenticated;

CREATE INDEX IF NOT EXISTS idx_whatsapp_contatos_retorno
  ON whatsapp_contatos (empresa_id, retorno_em) WHERE retorno_em IS NOT NULL;

-- ── Etapa mudou → etapa_em ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION whatsapp_contato_etapa_em()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Quem informa a data junto (carga do histórico) fica com ela; o logado
  -- não tem permissão de alterar etapa_em, então na tela vale sempre now().
  IF NEW.etapa IS DISTINCT FROM OLD.etapa AND NEW.etapa_em IS NOT DISTINCT FROM OLD.etapa_em THEN
    NEW.etapa_em := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_whatsapp_contato_etapa_em ON whatsapp_contatos;
CREATE TRIGGER trg_whatsapp_contato_etapa_em
  BEFORE UPDATE OF etapa ON whatsapp_contatos
  FOR EACH ROW EXECUTE FUNCTION whatsapp_contato_etapa_em();

-- ── Mensagem enviada → etapa avança ─────────────────────────────────────
CREATE OR REPLACE FUNCTION whatsapp_mensagem_avancar_etapa()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.contato_id IS NULL OR NEW.status IS DISTINCT FROM 'enviado' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'enviado' AND OLD.contato_id IS NOT DISTINCT FROM NEW.contato_id THEN
    RETURN NEW;
  END IF;

  IF NEW.tipo = 'cupom' THEN
    UPDATE whatsapp_contatos SET etapa = 'comprou'
     WHERE id = NEW.contato_id AND etapa IN ('novo', 'atendimento', 'orcamento', 'perdido');
  ELSIF NEW.tipo = 'orcamento' THEN
    UPDATE whatsapp_contatos SET etapa = 'orcamento'
     WHERE id = NEW.contato_id AND etapa IN ('novo', 'atendimento', 'perdido');
  ELSIF NEW.tipo IN ('atendimento', 'enviada_celular', 'produto_individual') THEN
    UPDATE whatsapp_contatos SET etapa = 'atendimento'
     WHERE id = NEW.contato_id AND etapa = 'novo';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION whatsapp_mensagem_avancar_etapa() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_whatsapp_mensagem_avancar_etapa ON whatsapp_mensagens;
CREATE TRIGGER trg_whatsapp_mensagem_avancar_etapa
  AFTER INSERT OR UPDATE OF status, contato_id ON whatsapp_mensagens
  FOR EACH ROW EXECUTE FUNCTION whatsapp_mensagem_avancar_etapa();

-- ── View das conversas (colunas novas no fim) ───────────────────────────
CREATE OR REPLACE VIEW whatsapp_conversas
WITH (security_invoker = true) AS
SELECT
  w.id, w.empresa_id, w.telefone, w.chave, w.nome_whatsapp, w.status, w.cliente_id,
  c.nome AS cliente_nome,
  w.total_mensagens, w.primeira_em, w.ultima_entrada_em, w.ultima_saida_em, w.lida_em,
  greatest(w.ultima_entrada_em, w.ultima_saida_em) AS ultima_atividade,
  (w.ultima_entrada_em IS NOT NULL AND w.ultima_entrada_em > coalesce(w.ultima_saida_em, '-infinity'::timestamptz)) AS aguardando,
  (w.ultima_entrada_em IS NOT NULL AND w.ultima_entrada_em > coalesce(w.lida_em, '-infinity'::timestamptz)) AS nao_lida,
  w.etapa, w.etapa_em, w.retorno_em, w.retorno_nota,
  (w.retorno_em IS NOT NULL AND w.retorno_em <= (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS retorno_vencido,
  (w.etapa = 'orcamento' AND w.etapa_em < now() - interval '3 days'
    AND coalesce(w.ultima_entrada_em, '-infinity'::timestamptz) < w.etapa_em) AS orcamento_parado
FROM whatsapp_contatos w
LEFT JOIN clientes c ON c.id = w.cliente_id;

REVOKE ALL ON whatsapp_conversas FROM anon;
GRANT SELECT ON whatsapp_conversas TO authenticated;

-- ── Histórico: etapa inicial pelo que a loja já enviou ──────────────────
-- A mensagem enviada mais recente de cada tipo decide; comprovante vence
-- orçamento, que vence resposta. Só mexe em quem ainda está 'novo'.
WITH ult AS (
  SELECT m.contato_id,
         max(coalesce(m.enviado_em, m.created_at)) FILTER (WHERE m.tipo = 'cupom') AS cupom,
         max(coalesce(m.enviado_em, m.created_at)) FILTER (WHERE m.tipo = 'orcamento') AS orcamento,
         max(coalesce(m.enviado_em, m.created_at)) FILTER (WHERE m.tipo IN ('atendimento', 'enviada_celular', 'produto_individual')) AS atendimento
  FROM whatsapp_mensagens m
  WHERE m.contato_id IS NOT NULL AND m.status = 'enviado'
  GROUP BY m.contato_id
)
UPDATE whatsapp_contatos w SET
  etapa = CASE WHEN u.cupom IS NOT NULL THEN 'comprou'
               WHEN u.orcamento IS NOT NULL THEN 'orcamento'
               ELSE 'atendimento' END,
  etapa_em = coalesce(u.cupom, u.orcamento, u.atendimento)
FROM ult u
WHERE u.contato_id = w.id AND w.etapa = 'novo'
  AND coalesce(u.cupom, u.orcamento, u.atendimento) IS NOT NULL;

UPDATE whatsapp_contatos SET etapa_em = coalesce(primeira_em, created_at) WHERE etapa_em IS NULL;
