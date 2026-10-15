-- RESPOSTA AUTOMÁTICA FORA DO HORÁRIO no WhatsApp.
--
-- Quem escreve com a loja fechada recebe uma mensagem curta com o horário.
-- Uma por contato por dia, só para quem procurou a loja (nunca dono/equipe),
-- e DESLIGADA até a loja ligar. A regra fica em src/lib/whatsapp/foraHorario.ts.
--
-- 1. whatsapp_config: liga/desliga, texto e o horário por dia da semana
--    (horario_semana: {"0": null, "1": {"abre": "08:00", "fecha": "18:00"}, …},
--    0 = domingo; null = fechado).
-- 2. whatsapp_contatos.fora_horario_dia: uma resposta por contato por dia.
-- 3. A resposta automática NÃO conta como resposta da loja: a conversa continua
--    "aguardando" até alguém responder de verdade (ultima_saida_em não muda).
--
-- Depende de 20261015200000_whatsapp_conversas.sql. Aditiva e idempotente.

ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS fora_horario_ativo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS fora_horario_mensagem TEXT;
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS horario_semana JSONB;

COMMENT ON COLUMN whatsapp_config.fora_horario_ativo IS 'Resposta automática para quem escreve com a loja fechada (uma por contato por dia).';
COMMENT ON COLUMN whatsapp_config.horario_semana IS 'Horário por dia da semana: {"0": null, "1": {"abre": "08:00", "fecha": "18:00"}, …}; 0 = domingo, null = fechado.';

-- Dia (da loja) em que o contato já recebeu a resposta automática. A marca é
-- gravada ANTES de enviar, num UPDATE condicional: duas mensagens seguidas do
-- cliente nunca geram duas respostas. Só o servidor (chave de serviço) grava.
ALTER TABLE whatsapp_contatos ADD COLUMN IF NOT EXISTS fora_horario_dia DATE;

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
  -- Resposta automática fora do horário não é atendimento: não tira a
  -- conversa de "aguardando".
  ELSIF NEW.tipo <> 'automacao_fora_horario' THEN
    UPDATE whatsapp_contatos SET ultima_saida_em = greatest(coalesce(ultima_saida_em, v_quando), v_quando)
     WHERE id = NEW.contato_id;
  END IF;
  RETURN NEW;
END $$;
