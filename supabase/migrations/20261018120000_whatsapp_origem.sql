-- ORIGEM DO CONTATO (parte 2): de qual publicação do Vargas Marketing veio a
-- conversa.
--
-- O Marketing põe um código curto em cada publicação (ex.: T7K2 — letra,
-- dígito, letra, dígito, sem I, O, 0 e 1). Quando o cliente escreve com o
-- código (o link do post já traz escrito), o webhook grava a origem no
-- contato. Só a primeira origem vale. Regra em src/lib/whatsapp/origem.ts.
--
-- 1. whatsapp_contatos: origem_codigo e origem_em (o logado só lê).
-- 2. View whatsapp_conversas: as duas colunas no fim.
-- 3. marketing_origens(): contagem por código para a API de leitura do
--    Marketing — conversas, quem recebeu orçamento e quem comprou. Só números,
--    nada de cliente. Só a chave de serviço executa.
--
-- Depende de 20261016120000_whatsapp_funil.sql. Aditiva e idempotente.

ALTER TABLE whatsapp_contatos ADD COLUMN IF NOT EXISTS origem_codigo TEXT;
ALTER TABLE whatsapp_contatos ADD COLUMN IF NOT EXISTS origem_em TIMESTAMPTZ;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_contatos_origem_codigo_check') THEN
    ALTER TABLE whatsapp_contatos ADD CONSTRAINT whatsapp_contatos_origem_codigo_check
      CHECK (origem_codigo IS NULL OR origem_codigo ~ '^[A-HJ-NP-Z][2-9][A-HJ-NP-Z][2-9]$');
  END IF;
END $$;

COMMENT ON COLUMN whatsapp_contatos.origem_codigo IS 'Código da publicação do Vargas Marketing que trouxe o contato (primeira mensagem com código).';

CREATE INDEX IF NOT EXISTS idx_whatsapp_contatos_origem
  ON whatsapp_contatos (empresa_id, origem_em) WHERE origem_codigo IS NOT NULL;

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
    AND coalesce(w.ultima_entrada_em, '-infinity'::timestamptz) < w.etapa_em) AS orcamento_parado,
  w.origem_codigo, w.origem_em
FROM whatsapp_contatos w
LEFT JOIN clientes c ON c.id = w.cliente_id;

REVOKE ALL ON whatsapp_conversas FROM anon;
GRANT SELECT ON whatsapp_conversas TO authenticated;

-- ── Contagem por código (API de leitura do Marketing) ────────────────────
-- Conversas: contatos cuja origem foi gravada no período. Orçamento: desses,
-- quem recebeu orçamento enviado depois de chegar. Compra: quem está em
-- "Comprou" (comprovante enviado, orçamento convertido ou marcado na tela).
CREATE OR REPLACE FUNCTION marketing_origens(p_empresa UUID, p_inicio TIMESTAMPTZ, p_fim TIMESTAMPTZ)
RETURNS TABLE (codigo TEXT, conversas INT, orcamentos INT, compras INT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT w.origem_codigo,
         count(*)::int,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM whatsapp_mensagens m
            WHERE m.contato_id = w.id AND m.tipo = 'orcamento' AND m.status = 'enviado'
              AND coalesce(m.enviado_em, m.created_at) >= w.origem_em))::int,
         count(*) FILTER (WHERE w.etapa = 'comprou')::int
    FROM whatsapp_contatos w
   WHERE w.empresa_id = p_empresa
     AND w.origem_codigo IS NOT NULL
     AND w.status <> 'ignorado'
     AND w.origem_em >= p_inicio AND w.origem_em < p_fim
   GROUP BY w.origem_codigo
   ORDER BY w.origem_codigo
$$;

REVOKE ALL ON FUNCTION marketing_origens(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION marketing_origens(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
