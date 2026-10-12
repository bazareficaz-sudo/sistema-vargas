-- FALTAS: qualquer volta ao estoque conta + aviso ao cliente por WhatsApp.
--
-- 1. VOLTA AO ESTOQUE. Até aqui só a nota de entrada (entrada_compra /
--    entrada_nfe) mexia na falta. Ajuste manual ("achamos o produto no
--    fundo do depósito"), inventário e transferência que deixam o saldo
--    acima de zero também são o produto voltando para a prateleira — e
--    passam a valer igual: sem cliente → 'atendido'; com cliente →
--    'recebido' ("Chegou — avisar cliente").
--
--    Para ajuste/inventário/transferência a condição é o saldo DEPOIS do
--    movimento ser positivo e MAIOR que antes: um inventário que corrige 5
--    para 3 não é mercadoria chegando.
--
-- 2. AVISO POR WHATSAPP. A automação 'whatsapp_aviso_falta_chegou' (tela
--    Automações › WhatsApp) avisa o cliente cuja falta virou 'recebido'.
--    O banco só registra QUANDO chegou (chegou_em) e o resultado do aviso;
--    quem envia é o cron das automações, pela Z-API da empresa.
--      · uma vez por falta (aviso_whatsapp_em);
--      · até 3 tentativas se a Z-API falhar (aviso_whatsapp_tentativas);
--      · só o que chegou DEPOIS de a regra existir — ligar a regra não
--        dispara mensagem para falta antiga.

ALTER TABLE faltas ADD COLUMN IF NOT EXISTS chegou_em TIMESTAMPTZ;
ALTER TABLE faltas ADD COLUMN IF NOT EXISTS aviso_whatsapp_em TIMESTAMPTZ;
ALTER TABLE faltas ADD COLUMN IF NOT EXISTS aviso_whatsapp_tentativas INT NOT NULL DEFAULT 0;
ALTER TABLE faltas ADD COLUMN IF NOT EXISTS aviso_whatsapp_erro TEXT;

ALTER TABLE automacoes ADD COLUMN IF NOT EXISTS mensagem_modelo TEXT;

COMMENT ON COLUMN faltas.chegou_em IS 'Quando a falta virou recebido (mercadoria chegou). Base do aviso por WhatsApp.';
COMMENT ON COLUMN faltas.aviso_whatsapp_em IS 'Quando o cliente foi avisado por WhatsApp que o produto chegou.';
COMMENT ON COLUMN automacoes.mensagem_modelo IS 'Texto da mensagem com marcadores ({nome}, {produto}, {loja}). Hoje: aviso de falta que chegou.';

-- Fila do aviso: chegou, ainda não avisado.
CREATE INDEX IF NOT EXISTS idx_faltas_aviso_pendente
  ON faltas (empresa_id, chegou_em)
  WHERE status = 'recebido' AND aviso_whatsapp_em IS NULL;


-- ── 1. Volta ao estoque ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION faltas_baixa_por_entrada()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.produto_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.tipo IN ('entrada_nfe', 'entrada_compra') THEN
    IF coalesce(NEW.quantidade, 0) <= 0 THEN RETURN NEW; END IF;
  ELSIF NEW.tipo IN ('ajuste_entrada', 'inventario', 'transferencia_entrada') THEN
    IF coalesce(NEW.estoque_novo, 0) <= 0
       OR coalesce(NEW.estoque_novo, 0) <= coalesce(NEW.estoque_anterior, 0) THEN
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  BEGIN
    UPDATE faltas f SET
      status = CASE WHEN falta_tem_cliente(f.cliente_nome, f.cliente_telefone) THEN 'recebido' ELSE 'atendido' END,
      resolvido_em = CASE WHEN falta_tem_cliente(f.cliente_nome, f.cliente_telefone) THEN f.resolvido_em ELSE now() END,
      resolvido_por = CASE WHEN falta_tem_cliente(f.cliente_nome, f.cliente_telefone) THEN f.resolvido_por
                           WHEN NEW.tipo IN ('entrada_nfe', 'entrada_compra') THEN 'Automático — entrada de mercadoria'
                           ELSE 'Automático — produto voltou ao estoque (ajuste/inventário)' END
    WHERE f.empresa_id = NEW.empresa_id
      AND f.produto_id = NEW.produto_id
      AND f.status IN ('pendente', 'em_analise', 'em_compra', 'pedido', 'notificado', 'comprado')
      AND f.created_at < coalesce(NEW.created_at, now());
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'faltas_baixa_por_entrada: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;


-- ── Mudança de status: "Chegou" ─────────────────────────────────────────
-- Sem cliente: vira 'atendido' (não há quem avisar). Com cliente: guarda
-- quando chegou, que é o que a automação do aviso procura.
CREATE OR REPLACE FUNCTION faltas_chegou_sem_cliente()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'recebido' AND OLD.status IS DISTINCT FROM 'recebido' THEN
    IF NOT falta_tem_cliente(NEW.cliente_nome, NEW.cliente_telefone) THEN
      NEW.status := 'atendido';
      NEW.resolvido_em := coalesce(NEW.resolvido_em, now());
      NEW.resolvido_por := coalesce(NEW.resolvido_por, 'Automático — chegou, sem cliente para avisar');
    ELSE
      NEW.chegou_em := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


-- ── Regra de automação, já ligada ───────────────────────────────────────
-- Uma por empresa com WhatsApp configurado. Desliga em Automações › WhatsApp.
INSERT INTO automacoes (empresa_id, nome, tipo, ativa, timing, mensagem_modelo)
SELECT wc.empresa_id, 'Avisar cliente quando a falta chegar', 'whatsapp_aviso_falta_chegou', true, 'imediato',
       'Olá, {nome}! O produto {produto} que você procurou na {loja} já chegou. Estamos te esperando! 😊'
FROM whatsapp_config wc
WHERE wc.ativo
  AND NOT EXISTS (SELECT 1 FROM automacoes a WHERE a.empresa_id = wc.empresa_id AND a.tipo = 'whatsapp_aviso_falta_chegou');
