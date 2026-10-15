-- CAIXA DE ENTRADA DO WHATSAPP (etapa 2, parte A): conversas por contato.
--
-- 1. Toda mensagem (recebida ou enviada pelo sistema: orçamento, cupom,
--    atendimento…) é ligada ao contato pelo telefone (tel_chave), na hora
--    do insert. Antes só a recebida tinha contato_id.
-- 2. O contato guarda a última mensagem do cliente (ultima_entrada_em), a
--    última da loja (ultima_saida_em) e quando a conversa foi aberta no
--    sistema (lida_em). Daí saem "não lida" e "aguardando resposta".
-- 3. View whatsapp_conversas (security_invoker: respeita o RLS de quem
--    consulta) com esses cálculos e o nome do cliente.
-- 4. Logado pode marcar a conversa como lida (lida_em), além do status.
--
-- Depende de 20261015120000_whatsapp_contatos.sql. Aditiva e idempotente.

ALTER TABLE whatsapp_contatos ADD COLUMN IF NOT EXISTS ultima_entrada_em TIMESTAMPTZ;
ALTER TABLE whatsapp_contatos ADD COLUMN IF NOT EXISTS ultima_saida_em TIMESTAMPTZ;
ALTER TABLE whatsapp_contatos ADD COLUMN IF NOT EXISTS lida_em TIMESTAMPTZ;

COMMENT ON COLUMN whatsapp_contatos.ultima_entrada_em IS 'Última mensagem do cliente.';
COMMENT ON COLUMN whatsapp_contatos.ultima_saida_em IS 'Última mensagem da loja para o contato (sistema ou celular, quando a Z-API avisa).';
COMMENT ON COLUMN whatsapp_contatos.lida_em IS 'Quando a conversa foi aberta na caixa de entrada.';

GRANT UPDATE (lida_em) ON whatsapp_contatos TO authenticated;

CREATE INDEX IF NOT EXISTS idx_whatsapp_mensagens_conversa
  ON whatsapp_mensagens (contato_id, created_at DESC) WHERE contato_id IS NOT NULL;

-- ── 1. Mensagem nova → contato pelo telefone ────────────────────────────
CREATE OR REPLACE FUNCTION whatsapp_mensagem_ligar_contato()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.contato_id IS NULL AND NEW.telefone IS NOT NULL THEN
    SELECT w.id INTO NEW.contato_id
    FROM whatsapp_contatos w
    WHERE w.empresa_id = NEW.empresa_id
      AND w.chave = coalesce(tel_chave(NEW.telefone), 'x' || regexp_replace(NEW.telefone, '\D', '', 'g'));
  END IF;
  RETURN NEW;
END $$;

-- ── 2. Mensagem ligada → datas da conversa ──────────────────────────────
CREATE OR REPLACE FUNCTION whatsapp_mensagem_atualizar_conversa()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_quando TIMESTAMPTZ := coalesce(NEW.enviado_em, NEW.created_at, now());
BEGIN
  IF NEW.contato_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.tipo = 'recebida' THEN
    UPDATE whatsapp_contatos SET ultima_entrada_em = greatest(coalesce(ultima_entrada_em, v_quando), v_quando)
     WHERE id = NEW.contato_id;
  ELSE
    UPDATE whatsapp_contatos SET ultima_saida_em = greatest(coalesce(ultima_saida_em, v_quando), v_quando)
     WHERE id = NEW.contato_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_whatsapp_mensagem_ligar_contato ON whatsapp_mensagens;
CREATE TRIGGER trg_whatsapp_mensagem_ligar_contato
  BEFORE INSERT ON whatsapp_mensagens
  FOR EACH ROW EXECUTE FUNCTION whatsapp_mensagem_ligar_contato();

DROP TRIGGER IF EXISTS trg_whatsapp_mensagem_atualizar_conversa ON whatsapp_mensagens;
CREATE TRIGGER trg_whatsapp_mensagem_atualizar_conversa
  AFTER INSERT OR UPDATE OF contato_id ON whatsapp_mensagens
  FOR EACH ROW EXECUTE FUNCTION whatsapp_mensagem_atualizar_conversa();

-- ── 3. View das conversas ───────────────────────────────────────────────
CREATE OR REPLACE VIEW whatsapp_conversas
WITH (security_invoker = true) AS
SELECT
  w.id, w.empresa_id, w.telefone, w.chave, w.nome_whatsapp, w.status, w.cliente_id,
  c.nome AS cliente_nome,
  w.total_mensagens, w.primeira_em, w.ultima_entrada_em, w.ultima_saida_em, w.lida_em,
  greatest(w.ultima_entrada_em, w.ultima_saida_em) AS ultima_atividade,
  (w.ultima_entrada_em IS NOT NULL AND w.ultima_entrada_em > coalesce(w.ultima_saida_em, '-infinity'::timestamptz)) AS aguardando,
  (w.ultima_entrada_em IS NOT NULL AND w.ultima_entrada_em > coalesce(w.lida_em, '-infinity'::timestamptz)) AS nao_lida
FROM whatsapp_contatos w
LEFT JOIN clientes c ON c.id = w.cliente_id;

REVOKE ALL ON whatsapp_conversas FROM anon;
GRANT SELECT ON whatsapp_conversas TO authenticated;

-- ── 4. Histórico ────────────────────────────────────────────────────────
-- Mensagens que a loja já mandou (orçamento, cupom…) para quem virou contato.
UPDATE whatsapp_mensagens m
   SET contato_id = w.id
  FROM whatsapp_contatos w
 WHERE m.contato_id IS NULL
   AND w.empresa_id = m.empresa_id
   AND w.chave = coalesce(tel_chave(m.telefone), 'x' || regexp_replace(m.telefone, '\D', '', 'g'));

UPDATE whatsapp_contatos w SET
  ultima_entrada_em = (SELECT max(coalesce(m.enviado_em, m.created_at)) FROM whatsapp_mensagens m WHERE m.contato_id = w.id AND m.tipo = 'recebida'),
  ultima_saida_em   = (SELECT max(coalesce(m.enviado_em, m.created_at)) FROM whatsapp_mensagens m WHERE m.contato_id = w.id AND m.tipo <> 'recebida');

-- Conversas antigas começam lidas: "não lida" vale do momento da ativação em diante.
UPDATE whatsapp_contatos SET lida_em = now() WHERE lida_em IS NULL;
