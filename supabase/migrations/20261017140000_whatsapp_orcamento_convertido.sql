-- ORÇAMENTO DA CONVERSA VIROU VENDA → conversa em "Comprou".
--
-- O orçamento montado (ou enviado) na conversa do WhatsApp é fechado pelo
-- PDV, que o marca como 'convertido' (converter_orcamento_pdv). Este gatilho
-- leva as conversas ligadas a ele para a etapa "comprou":
--   - quem recebeu o orçamento pelo WhatsApp (mensagem com referencia_id);
--   - o contato do mesmo cliente, se estava em "Orçamento enviado".
-- Nunca mexe em conversa ignorada. Depende de 20261016120000_whatsapp_funil.sql.
--
-- Aditiva e idempotente.

CREATE OR REPLACE FUNCTION whatsapp_orcamento_convertido()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'convertido' AND OLD.status IS DISTINCT FROM 'convertido' THEN
    UPDATE whatsapp_contatos w SET etapa = 'comprou'
     WHERE w.empresa_id = NEW.empresa_id
       AND w.etapa <> 'comprou'
       AND w.status <> 'ignorado'
       AND (
         w.id IN (SELECT m.contato_id FROM whatsapp_mensagens m
                   WHERE m.empresa_id = NEW.empresa_id AND m.referencia_tipo = 'orcamento'
                     AND m.referencia_id = NEW.id::text AND m.contato_id IS NOT NULL)
         OR (NEW.cliente_id IS NOT NULL AND w.cliente_id = NEW.cliente_id AND w.etapa = 'orcamento')
       );
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION whatsapp_orcamento_convertido() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_whatsapp_orcamento_convertido ON orcamentos;
CREATE TRIGGER trg_whatsapp_orcamento_convertido
  AFTER UPDATE OF status ON orcamentos
  FOR EACH ROW EXECUTE FUNCTION whatsapp_orcamento_convertido();

CREATE INDEX IF NOT EXISTS idx_whatsapp_mensagens_referencia
  ON whatsapp_mensagens (empresa_id, referencia_tipo, referencia_id) WHERE referencia_id IS NOT NULL;
