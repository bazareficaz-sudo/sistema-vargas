-- FINALIZAR ATENDIMENTO: o cliente só tirou uma dúvida — a conversa sai de
-- "Aguardando" sem contar como venda perdida.
--
-- 1. Etapa nova 'finalizado' (a data fica em etapa_em, como nas outras).
-- 2. Reabre sozinha em "Em atendimento":
--    • cliente escreve 1 hora ou mais depois de finalizar (um "obrigado"
--      logo depois não reabre — fica só como não lida);
--    • a loja responde pelo sistema ou manda produto (na hora);
--    • a loja escreve pelo celular 1 hora ou mais depois.
--    Orçamento enviado vai para "Orçamento"; comprovante, para "Comprou".
-- 3. View whatsapp_conversas: conversa finalizada não fica "aguardando".
--
-- Depende de 20261016120000_whatsapp_funil.sql e 20261020120000_cliente_categorias.sql.
-- Aditiva e idempotente.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_contatos_etapa_check'
                  AND pg_get_constraintdef(oid) LIKE '%finalizado%') THEN
    EXECUTE 'ALTER TABLE whatsapp_contatos DROP CONSTRAINT IF EXISTS whatsapp_contatos_etapa_check';
    ALTER TABLE whatsapp_contatos ADD CONSTRAINT whatsapp_contatos_etapa_check
      CHECK (etapa IN ('novo', 'atendimento', 'orcamento', 'comprou', 'perdido', 'finalizado')) NOT VALID;
    ALTER TABLE whatsapp_contatos VALIDATE CONSTRAINT whatsapp_contatos_etapa_check;
  END IF;
END $$;

-- Janela em que mensagem não reabre a conversa finalizada.
CREATE OR REPLACE FUNCTION whatsapp_janela_finalizado()
RETURNS INTERVAL
LANGUAGE sql
IMMUTABLE
AS $$ SELECT interval '1 hour' $$;

-- ── Mensagem enviada → etapa avança (agora também a partir de finalizado) ─
CREATE OR REPLACE FUNCTION whatsapp_mensagem_avancar_etapa()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_quando TIMESTAMPTZ := coalesce(NEW.enviado_em, NEW.created_at, now());
BEGIN
  IF NEW.contato_id IS NULL OR NEW.status IS DISTINCT FROM 'enviado' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'enviado' AND OLD.contato_id IS NOT DISTINCT FROM NEW.contato_id THEN
    RETURN NEW;
  END IF;

  IF NEW.tipo = 'cupom' THEN
    UPDATE whatsapp_contatos SET etapa = 'comprou'
     WHERE id = NEW.contato_id AND etapa IN ('novo', 'atendimento', 'orcamento', 'perdido', 'finalizado');
  ELSIF NEW.tipo = 'orcamento' THEN
    UPDATE whatsapp_contatos SET etapa = 'orcamento'
     WHERE id = NEW.contato_id AND etapa IN ('novo', 'atendimento', 'perdido', 'finalizado');
  ELSIF NEW.tipo IN ('atendimento', 'produto_individual') THEN
    UPDATE whatsapp_contatos SET etapa = 'atendimento'
     WHERE id = NEW.contato_id AND etapa IN ('novo', 'finalizado');
  ELSIF NEW.tipo = 'enviada_celular' THEN
    -- Despedida pelo celular logo depois de finalizar não reabre.
    UPDATE whatsapp_contatos SET etapa = 'atendimento'
     WHERE id = NEW.contato_id
       AND (etapa = 'novo' OR (etapa = 'finalizado' AND v_quando >= coalesce(etapa_em, '-infinity') + whatsapp_janela_finalizado()));
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION whatsapp_mensagem_avancar_etapa() FROM PUBLIC, anon, authenticated;

-- ── Cliente escreveu → reabre a finalizada (passada a janela) ────────────
CREATE OR REPLACE FUNCTION whatsapp_mensagem_reabrir()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_quando TIMESTAMPTZ := coalesce(NEW.enviado_em, NEW.created_at, now());
BEGIN
  IF NEW.contato_id IS NULL OR NEW.tipo IS DISTINCT FROM 'recebida' THEN RETURN NEW; END IF;
  UPDATE whatsapp_contatos SET etapa = 'atendimento'
   WHERE id = NEW.contato_id AND etapa = 'finalizado'
     AND v_quando >= coalesce(etapa_em, '-infinity') + whatsapp_janela_finalizado();
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION whatsapp_mensagem_reabrir() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_whatsapp_mensagem_reabrir') THEN
    CREATE TRIGGER trg_whatsapp_mensagem_reabrir
      AFTER INSERT OR UPDATE OF contato_id ON whatsapp_mensagens
      FOR EACH ROW EXECUTE FUNCTION whatsapp_mensagem_reabrir();
  END IF;
END $$;

-- ── View: finalizada não fica "aguardando" ──────────────────────────────
CREATE OR REPLACE VIEW whatsapp_conversas WITH (security_invoker = true) AS
 SELECT w.id,
    w.empresa_id,
    w.telefone,
    w.chave,
    w.nome_whatsapp,
    w.status,
    w.cliente_id,
    c.nome AS cliente_nome,
    w.total_mensagens,
    w.primeira_em,
    w.ultima_entrada_em,
    w.ultima_saida_em,
    w.lida_em,
    GREATEST(w.ultima_entrada_em, w.ultima_saida_em) AS ultima_atividade,
    w.etapa <> 'finalizado' AND w.ultima_entrada_em IS NOT NULL AND w.ultima_entrada_em > COALESCE(w.ultima_saida_em, '-infinity'::timestamp with time zone) AS aguardando,
    w.ultima_entrada_em IS NOT NULL AND w.ultima_entrada_em > COALESCE(w.lida_em, '-infinity'::timestamp with time zone) AS nao_lida,
    w.etapa,
    w.etapa_em,
    w.retorno_em,
    w.retorno_nota,
    w.retorno_em IS NOT NULL AND w.retorno_em <= (now() AT TIME ZONE 'America/Sao_Paulo'::text)::date AS retorno_vencido,
    w.etapa = 'orcamento'::text AND w.etapa_em < (now() - '3 days'::interval) AND COALESCE(w.ultima_entrada_em, '-infinity'::timestamp with time zone) < w.etapa_em AS orcamento_parado,
    w.origem_codigo,
    w.origem_em,
    w.foto_url,
    w.foto_em,
    w.lid,
    COALESCE((SELECT array_agg(v.categoria_id ORDER BY v.categoria_id)
                FROM cliente_categoria_vinculos v
               WHERE v.cliente_id = w.cliente_id), '{}'::uuid[]) AS categorias
   FROM whatsapp_contatos w
     LEFT JOIN clientes c ON c.id = w.cliente_id;

REVOKE ALL ON whatsapp_conversas FROM anon;
GRANT SELECT ON whatsapp_conversas TO authenticated;
