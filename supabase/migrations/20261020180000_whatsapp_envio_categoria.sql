-- MENSAGEM PARA UMA CATEGORIA de clientes (ex.: Eletricistas), com envio
-- ASSISTIDO: uma mensagem por vez, pelo número da loja (Z-API).
--
-- Por que assim: a Z-API não é a API oficial e o número é o mesmo do ERP e
-- da Betina. Disparo em massa é o que mais faz o WhatsApp bloquear número.
-- Então o banco segura o ritmo, não a tela:
--   • no máximo 30 envios por dia por empresa (todos os lotes somados);
--   • pelo menos 45 s entre um envio e o próximo;
--   • só das 8h às 20h (horário de Brasília);
--   • quem pediu para não receber WhatsApp fica de fora (e é conferido de
--     novo na hora de enviar); número da equipe também;
--   • quem recebeu mensagem de lote nos últimos 7 dias fica de fora;
--   • resultado desconhecido (a Z-API não respondeu) fica "incerto" e
--     NUNCA é reenviado sozinho.
--
-- 1. whatsapp_lotes: o texto ({nome}, {loja}), a categoria e o filtro.
-- 2. whatsapp_lote_itens: um por cliente/telefone, com a situação do envio.
-- 3. whatsapp_lote_criar(): monta a fila (quem entra é decidido aqui).
-- 4. whatsapp_lote_reservar(): pega o próximo, se o ritmo deixar.
-- 5. whatsapp_lote_concluir(): grava o resultado (só de "enviando").
-- 6. whatsapp_lote_status(): pausar, retomar ou cancelar.
-- 7. whatsapp_celular(): celular brasileiro no formato do WhatsApp.
--
-- O logado só lê as tabelas; tudo que muda passa pelas funções, que
-- conferem a empresa (mesma regra do RLS). Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS whatsapp_lotes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome            TEXT NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 1 AND 80),
  mensagem        TEXT NOT NULL CHECK (char_length(btrim(mensagem)) BETWEEN 1 AND 1000),
  categoria_id    UUID REFERENCES cliente_categorias(id) ON DELETE SET NULL,
  categoria_nome  TEXT,
  comprou_dias    INT CHECK (comprou_dias IS NULL OR comprou_dias BETWEEN 1 AND 3650),
  status          TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'pausado', 'concluido', 'cancelado')),
  total           INT NOT NULL DEFAULT 0,
  criado_por      UUID DEFAULT auth.uid(),
  criado_por_nome TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_lotes_empresa ON whatsapp_lotes (empresa_id, created_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_lote_itens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id       UUID NOT NULL REFERENCES whatsapp_lotes(id) ON DELETE CASCADE,
  empresa_id    UUID NOT NULL,
  cliente_id    UUID REFERENCES clientes(id) ON DELETE SET NULL,
  nome          TEXT NOT NULL,
  telefone      TEXT NOT NULL,
  ordem         INT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pendente'
                CHECK (status IN ('pendente', 'enviando', 'enviado', 'erro', 'incerto', 'pulado')),
  motivo        TEXT,
  mensagem_id   UUID,
  reservado_em  TIMESTAMPTZ,
  enviado_em    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lote_id, telefone)
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_lote_itens_fila ON whatsapp_lote_itens (lote_id, status, ordem);
CREATE INDEX IF NOT EXISTS idx_whatsapp_lote_itens_ritmo ON whatsapp_lote_itens (empresa_id, reservado_em DESC) WHERE reservado_em IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_lote_itens_cliente ON whatsapp_lote_itens (cliente_id, reservado_em DESC) WHERE cliente_id IS NOT NULL;

COMMENT ON TABLE whatsapp_lotes IS 'Mensagem para uma categoria de clientes, enviada uma por vez (envio assistido).';
COMMENT ON TABLE whatsapp_lote_itens IS 'Fila do lote: um cliente/telefone por linha. incerto = Z-API não respondeu; nunca reenviado sozinho.';

ALTER TABLE whatsapp_lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_lote_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_lotes_ler ON whatsapp_lotes;
CREATE POLICY whatsapp_lotes_ler ON whatsapp_lotes
  FOR SELECT USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin());
DROP POLICY IF EXISTS whatsapp_lote_itens_ler ON whatsapp_lote_itens;
CREATE POLICY whatsapp_lote_itens_ler ON whatsapp_lote_itens
  FOR SELECT USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

-- O Supabase dá tudo a anon e authenticated em tabela nova: tira e devolve só a leitura.
REVOKE ALL ON whatsapp_lotes, whatsapp_lote_itens FROM anon, authenticated;
GRANT SELECT ON whatsapp_lotes, whatsapp_lote_itens TO authenticated;
GRANT ALL ON whatsapp_lotes, whatsapp_lote_itens TO service_role;

-- Resumo por lote para a lista (contagem por situação).
CREATE OR REPLACE VIEW whatsapp_lotes_resumo WITH (security_invoker = true) AS
SELECT l.id, l.empresa_id, l.nome, l.categoria_nome, l.comprou_dias, l.status, l.total, l.criado_por_nome, l.created_at,
       count(i.id) FILTER (WHERE i.status = 'pendente')::int AS pendentes,
       count(i.id) FILTER (WHERE i.status = 'enviado')::int AS enviados,
       count(i.id) FILTER (WHERE i.status IN ('erro', 'incerto'))::int AS problemas,
       count(i.id) FILTER (WHERE i.status = 'pulado')::int AS pulados,
       max(i.enviado_em) AS ultimo_envio
  FROM whatsapp_lotes l
  LEFT JOIN whatsapp_lote_itens i ON i.lote_id = l.id
 GROUP BY l.id;

REVOKE ALL ON whatsapp_lotes_resumo FROM anon, authenticated;
GRANT SELECT ON whatsapp_lotes_resumo TO authenticated;

-- Celular brasileiro para o WhatsApp: 55 + DDD + 9 dígitos começando com 9.
-- Fixo e número sem DDD não entram (não têm WhatsApp, ou não dá para saber).
CREATE OR REPLACE FUNCTION whatsapp_celular(t TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN length(d) = 11 AND substr(d, 3, 1) = '9' AND substr(d, 1, 1) <> '0' THEN '55' || d END
    FROM (SELECT CASE
                   WHEN length(x) IN (12, 13) AND left(x, 2) = '55' THEN substr(x, 3)
                   WHEN length(x) = 12 AND left(x, 1) = '0' THEN substr(x, 2)
                   ELSE x END AS d
            FROM (SELECT regexp_replace(coalesce(t, ''), '\D', '', 'g') AS x) a) b
$$;

-- ── Montar a fila ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION whatsapp_lote_criar(
  p_empresa UUID, p_nome TEXT, p_mensagem TEXT, p_categoria UUID, p_comprou_dias INT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lote UUID;
  v_categoria TEXT;
  v_total INT;
  v_operador TEXT;
BEGIN
  IF NOT (empresa_do_meu_grupo(p_empresa) OR is_system_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa.' USING ERRCODE = '42501';
  END IF;
  SELECT k.nome INTO v_categoria FROM cliente_categorias k WHERE k.id = p_categoria AND k.empresa_id = p_empresa;
  IF v_categoria IS NULL THEN
    RAISE EXCEPTION 'Escolha uma categoria desta empresa.' USING ERRCODE = 'P0001';
  END IF;
  IF p_comprou_dias IS NOT NULL AND p_comprou_dias NOT BETWEEN 1 AND 3650 THEN
    RAISE EXCEPTION 'Período de compra inválido.' USING ERRCODE = 'P0001';
  END IF;
  SELECT nullif(btrim(p.nome), '') INTO v_operador FROM profiles p WHERE p.id = auth.uid();

  INSERT INTO whatsapp_lotes (empresa_id, nome, mensagem, categoria_id, categoria_nome, comprou_dias, criado_por_nome)
  VALUES (p_empresa, left(btrim(coalesce(nullif(btrim(p_nome), ''), v_categoria)), 80), btrim(p_mensagem), p_categoria, v_categoria, p_comprou_dias, v_operador)
  RETURNING id INTO v_lote;

  -- Quem entra: da categoria, ativo, não unificado, quer receber WhatsApp,
  -- tem celular, não é da equipe, não recebeu lote nos últimos 7 dias e
  -- (se pedido) comprou no período. Um por telefone.
  INSERT INTO whatsapp_lote_itens (lote_id, empresa_id, cliente_id, nome, telefone, ordem)
  SELECT v_lote, p_empresa, e.id, e.nome, e.cel, row_number() OVER (ORDER BY e.nome, e.id)
    FROM (
      SELECT DISTINCT ON (x.cel) x.id, x.nome, x.cel
        FROM (
          SELECT c.id, c.nome,
                 coalesce(whatsapp_celular(c.whatsapp), whatsapp_celular(c.telefone_whatsapp), whatsapp_celular(c.telefone)) AS cel
            FROM clientes c
            JOIN cliente_categoria_vinculos v ON v.cliente_id = c.id AND v.categoria_id = p_categoria
           WHERE c.empresa_id = p_empresa
             AND c.mesclado_em IS NULL
             AND coalesce(c.ativo, true)
             AND NOT coalesce(c.opt_out_whatsapp, false)
             AND (p_comprou_dias IS NULL OR EXISTS (
                   SELECT 1 FROM vendas s
                    WHERE s.cliente_id = c.id AND s.empresa_id = p_empresa AND s.status = 'concluida'
                      AND s.created_at >= now() - make_interval(days => p_comprou_dias)))
        ) x
       WHERE x.cel IS NOT NULL
         -- Recebeu lote nos últimos 7 dias (por cliente ou pelo número).
         AND NOT EXISTS (
               SELECT 1 FROM whatsapp_lote_itens i
                WHERE i.empresa_id = p_empresa AND (i.cliente_id = x.id OR i.telefone = x.cel)
                  AND i.status IN ('enviando', 'enviado', 'incerto')
                  AND i.reservado_em >= whatsapp_lote_agora() - interval '7 days')
         AND NOT EXISTS (
               SELECT 1 FROM getulio_config g, jsonb_array_elements(coalesce(g.destinatarios, '[]'::jsonb)) d
                WHERE g.empresa_id = p_empresa AND tel_chave(d->>'numero') = tel_chave(x.cel))
       ORDER BY x.cel, x.nome
       LIMIT 500
    ) e;

  GET DIAGNOSTICS v_total = ROW_COUNT;
  UPDATE whatsapp_lotes SET total = v_total, status = CASE WHEN v_total = 0 THEN 'concluido' ELSE 'ativo' END WHERE id = v_lote;
  RETURN v_lote;
END $$;

-- ── Pegar o próximo (o ritmo é conferido aqui) ──────────────────────────
-- situacao: ok | aguarde (segundos em espera_s) | limite | fora_horario |
--           fim | parado. Com ok, devolve o item já em "enviando".
-- Hora de agora (função à parte só para os testes poderem fixar a hora).
CREATE OR REPLACE FUNCTION whatsapp_lote_agora()
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
AS $$ SELECT now() $$;

CREATE OR REPLACE FUNCTION whatsapp_lote_reservar(p_lote UUID)
RETURNS TABLE (situacao TEXT, espera_s INT, item_id UUID, cliente_id UUID, nome TEXT, telefone TEXT, mensagem TEXT, enviados_hoje INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_limite_dia CONSTANT INT := 30;
  c_intervalo  CONSTANT INTERVAL := interval '45 seconds';
  v_lote whatsapp_lotes%ROWTYPE;
  v_agora TIMESTAMPTZ := whatsapp_lote_agora();
  v_hora INT := extract(hour FROM v_agora AT TIME ZONE 'America/Sao_Paulo');
  v_hoje DATE := (v_agora AT TIME ZONE 'America/Sao_Paulo')::date;
  v_ultimo TIMESTAMPTZ;
  v_qtd INT;
  v_item whatsapp_lote_itens%ROWTYPE;
  v_opt BOOLEAN;
BEGIN
  SELECT * INTO v_lote FROM whatsapp_lotes l WHERE l.id = p_lote;
  IF v_lote.id IS NULL OR NOT (empresa_do_meu_grupo(v_lote.empresa_id) OR is_system_admin()) THEN
    RAISE EXCEPTION 'Lote não encontrado.' USING ERRCODE = '42501';
  END IF;
  IF v_lote.status <> 'ativo' THEN
    RETURN QUERY SELECT 'parado'::text, 0, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text, 0; RETURN;
  END IF;

  -- Um por vez na empresa inteira, mesmo com duas telas abertas.
  PERFORM pg_advisory_xact_lock(hashtext('whatsapp_lote:' || v_lote.empresa_id::text));

  -- Envio que ficou no meio (tela fechada, queda): não se sabe se saiu.
  -- Vira "incerto" e não é reenviado.
  UPDATE whatsapp_lote_itens SET status = 'incerto', motivo = 'Sem resposta do envio (a tela pode ter fechado no meio).'
   WHERE empresa_id = v_lote.empresa_id AND status = 'enviando' AND reservado_em < v_agora - interval '10 minutes';

  SELECT count(*) INTO v_qtd FROM whatsapp_lote_itens i
   WHERE i.empresa_id = v_lote.empresa_id AND i.status IN ('enviando', 'enviado', 'incerto', 'erro')
     AND (i.reservado_em AT TIME ZONE 'America/Sao_Paulo')::date = v_hoje;
  IF v_hora < 8 OR v_hora >= 20 THEN
    RETURN QUERY SELECT 'fora_horario'::text, 0, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text, v_qtd; RETURN;
  END IF;
  IF v_qtd >= c_limite_dia THEN
    RETURN QUERY SELECT 'limite'::text, 0, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text, v_qtd; RETURN;
  END IF;
  SELECT max(i.reservado_em) INTO v_ultimo FROM whatsapp_lote_itens i WHERE i.empresa_id = v_lote.empresa_id AND i.reservado_em IS NOT NULL;
  IF v_ultimo IS NOT NULL AND v_ultimo > v_agora - c_intervalo THEN
    RETURN QUERY SELECT 'aguarde'::text, greatest(1, ceil(extract(epoch FROM (v_ultimo + c_intervalo - v_agora)))::int),
      NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text, v_qtd; RETURN;
  END IF;

  LOOP
    SELECT * INTO v_item FROM whatsapp_lote_itens i
     WHERE i.lote_id = p_lote AND i.status = 'pendente'
     ORDER BY i.ordem LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF v_item.id IS NULL THEN
      UPDATE whatsapp_lotes SET status = 'concluido', updated_at = v_agora
       WHERE id = p_lote AND NOT EXISTS (SELECT 1 FROM whatsapp_lote_itens i WHERE i.lote_id = p_lote AND i.status IN ('pendente', 'enviando'));
      RETURN QUERY SELECT 'fim'::text, 0, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text, v_qtd; RETURN;
    END IF;
    -- Pediu para não receber depois que a fila foi montada: pula.
    SELECT coalesce(c.opt_out_whatsapp, false) INTO v_opt FROM clientes c WHERE c.id = v_item.cliente_id;
    IF coalesce(v_opt, false) THEN
      UPDATE whatsapp_lote_itens SET status = 'pulado', motivo = 'Pediu para não receber WhatsApp' WHERE id = v_item.id;
      CONTINUE;
    END IF;
    EXIT;
  END LOOP;

  UPDATE whatsapp_lote_itens SET status = 'enviando', reservado_em = v_agora WHERE id = v_item.id;
  -- A conversa existe antes da mensagem: a resposta do cliente cai nela.
  BEGIN
    PERFORM whatsapp_abrir_conversa(v_lote.empresa_id, v_item.telefone);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN QUERY SELECT 'ok'::text, 0, v_item.id, v_item.cliente_id, v_item.nome, v_item.telefone, v_lote.mensagem, v_qtd + 1;
END $$;

-- ── Resultado do envio (só sai de "enviando") ───────────────────────────
CREATE OR REPLACE FUNCTION whatsapp_lote_concluir(p_item UUID, p_status TEXT, p_motivo TEXT DEFAULT NULL, p_mensagem UUID DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_empresa UUID;
BEGIN
  IF p_status NOT IN ('enviado', 'erro', 'incerto') THEN
    RAISE EXCEPTION 'Situação inválida.' USING ERRCODE = 'P0001';
  END IF;
  SELECT i.empresa_id INTO v_empresa FROM whatsapp_lote_itens i WHERE i.id = p_item;
  IF v_empresa IS NULL OR NOT (empresa_do_meu_grupo(v_empresa) OR is_system_admin()) THEN
    RAISE EXCEPTION 'Item não encontrado.' USING ERRCODE = '42501';
  END IF;
  UPDATE whatsapp_lote_itens
     SET status = p_status, motivo = left(p_motivo, 300), mensagem_id = p_mensagem,
         enviado_em = CASE WHEN p_status = 'enviado' THEN now() END
   WHERE id = p_item AND status = 'enviando';
END $$;

-- ── Pausar, retomar, cancelar ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION whatsapp_lote_status(p_lote UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_empresa UUID;
BEGIN
  IF p_status NOT IN ('ativo', 'pausado', 'cancelado') THEN
    RAISE EXCEPTION 'Situação inválida.' USING ERRCODE = 'P0001';
  END IF;
  SELECT l.empresa_id INTO v_empresa FROM whatsapp_lotes l WHERE l.id = p_lote;
  IF v_empresa IS NULL OR NOT (empresa_do_meu_grupo(v_empresa) OR is_system_admin()) THEN
    RAISE EXCEPTION 'Lote não encontrado.' USING ERRCODE = '42501';
  END IF;
  UPDATE whatsapp_lotes SET status = p_status, updated_at = now()
   WHERE id = p_lote AND status IN ('ativo', 'pausado');
  IF p_status = 'cancelado' THEN
    UPDATE whatsapp_lote_itens SET status = 'pulado', motivo = 'Lote cancelado' WHERE lote_id = p_lote AND status = 'pendente';
  END IF;
END $$;

REVOKE ALL ON FUNCTION whatsapp_lote_agora() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION whatsapp_lote_agora() TO authenticated, service_role;
REVOKE ALL ON FUNCTION whatsapp_celular(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION whatsapp_celular(TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION whatsapp_lote_criar(UUID, TEXT, TEXT, UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION whatsapp_lote_criar(UUID, TEXT, TEXT, UUID, INT) TO authenticated;
REVOKE ALL ON FUNCTION whatsapp_lote_reservar(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION whatsapp_lote_reservar(UUID) TO authenticated;
REVOKE ALL ON FUNCTION whatsapp_lote_concluir(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION whatsapp_lote_concluir(UUID, TEXT, TEXT, UUID) TO authenticated;
REVOKE ALL ON FUNCTION whatsapp_lote_status(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION whatsapp_lote_status(UUID, TEXT) TO authenticated;
