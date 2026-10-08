-- ============================================================
-- AGENTE GETÚLIO — Fase 1
--
-- O sistema olhando o negócio no lugar do dono: vigias que detectam o que
-- merece atenção (anúncio travado, venda caindo, dinheiro parado, pedido
-- atrasado, integração caída) e um resumo diário no WhatsApp.
--
--   getulio_config     uma linha por empresa: ligado, horário, quem recebe
--   getulio_sinais     o que os vigias acharam. `chave` identifica o fato
--                      (ex.: "anuncio:bloqueado:<id>"): achado de novo só
--                      atualiza; sumiu da varredura, é resolvido. É isso
--                      que impede o Getúlio de repetir o mesmo aviso.
--   getulio_mensagens  o que foi gerado/enviado, para a Central mostrar.
--
-- As duas funções de leitura juntam PDV (vendas) e marketplaces
-- (marketplace_pedidos) — `produtos_vendidos` conta só o PDV. Só o servidor
-- as executa (cron e rotas com a chave de serviço).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.getulio_config (
  empresa_id uuid PRIMARY KEY REFERENCES public.empresas(id) ON DELETE CASCADE,
  ativo boolean NOT NULL DEFAULT false,
  horario_resumo text NOT NULL DEFAULT '07:30',
  -- [{ "nome": "Silvano", "numero": "5588999999999" }]
  destinatarios jsonb NOT NULL DEFAULT '[]'::jsonb,
  vigias_desligados text[] NOT NULL DEFAULT '{}',
  ultima_varredura timestamptz,
  ultimo_resumo_dia date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.getulio_sinais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  vigia text NOT NULL,
  chave text NOT NULL,
  gravidade text NOT NULL CHECK (gravidade IN ('urgente', 'atencao', 'oportunidade', 'info')),
  titulo text NOT NULL,
  detalhe text,
  valor numeric,
  link text,
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  detectado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  resolvido_em timestamptz,
  avisado_em timestamptz,
  -- O dono disse "não me avise disto". Volta só se o fato for resolvido e
  -- reaparecer.
  dispensado_em timestamptz,
  UNIQUE (empresa_id, chave)
);
CREATE INDEX IF NOT EXISTS getulio_sinais_abertos_idx
  ON public.getulio_sinais (empresa_id, gravidade) WHERE resolvido_em IS NULL;

CREATE TABLE IF NOT EXISTS public.getulio_mensagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tipo text NOT NULL,              -- resumo_diario | envio_manual | previa
  texto text NOT NULL,
  gerado_por text NOT NULL,        -- ia | modelo
  sinais uuid[] NOT NULL DEFAULT '{}',
  destinatarios jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL,            -- enviado | parcial | erro | previa
  erro text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS getulio_mensagens_empresa_idx ON public.getulio_mensagens (empresa_id, created_at DESC);

ALTER TABLE public.getulio_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.getulio_sinais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.getulio_mensagens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS getulio_config_do_grupo ON public.getulio_config;
CREATE POLICY getulio_config_do_grupo ON public.getulio_config FOR ALL
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());
DROP POLICY IF EXISTS getulio_sinais_do_grupo ON public.getulio_sinais;
CREATE POLICY getulio_sinais_do_grupo ON public.getulio_sinais FOR ALL
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());
DROP POLICY IF EXISTS getulio_mensagens_do_grupo ON public.getulio_mensagens;
CREATE POLICY getulio_mensagens_do_grupo ON public.getulio_mensagens FOR ALL
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());


-- ── Vendas por canal: últimos 7 dias × os 28 anteriores ─────────────────
-- PDV e cada canal de marketplace, sem cancelados. O "normal" é a média
-- semanal dos 28 dias ANTERIORES à semana medida — a semana atual não entra
-- na própria comparação.
CREATE OR REPLACE FUNCTION public.getulio_vendas_canais(p_empresa uuid, p_agora timestamptz DEFAULT now())
RETURNS TABLE(canal_id uuid, canal text, plataforma text, ult7_valor numeric, ult7_qtd bigint, ant28_valor numeric, ant28_qtd bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT NULL::uuid, 'Loja física (PDV)', 'pdv',
         COALESCE(SUM(v.total) FILTER (WHERE v.created_at >= p_agora - interval '7 days'), 0),
         COUNT(*) FILTER (WHERE v.created_at >= p_agora - interval '7 days'),
         COALESCE(SUM(v.total) FILTER (WHERE v.created_at < p_agora - interval '7 days'), 0),
         COUNT(*) FILTER (WHERE v.created_at < p_agora - interval '7 days')
  FROM vendas v
  WHERE v.empresa_id = p_empresa AND v.status = 'concluida'
    AND v.created_at >= p_agora - interval '35 days' AND v.created_at < p_agora
  UNION ALL
  SELECT c.id, c.nome, c.plataforma,
         COALESCE(SUM(p.valor_total) FILTER (WHERE p.data_pedido >= p_agora - interval '7 days'), 0),
         COUNT(p.id) FILTER (WHERE p.data_pedido >= p_agora - interval '7 days'),
         COALESCE(SUM(p.valor_total) FILTER (WHERE p.data_pedido < p_agora - interval '7 days'), 0),
         COUNT(p.id) FILTER (WHERE p.data_pedido < p_agora - interval '7 days')
  FROM marketplace_canais c
  LEFT JOIN marketplace_pedidos p ON p.canal_id = c.id AND p.status <> 'cancelado'
    AND p.data_pedido >= p_agora - interval '35 days' AND p.data_pedido < p_agora
  WHERE c.empresa_id = p_empresa
  GROUP BY c.id, c.nome, c.plataforma;
$$;

-- ── Giro por produto: PDV + marketplaces ────────────────────────────────
-- Só o que interessa aos vigias: produto ativo com estoque, ou que vendeu
-- nos últimos 35 dias. `ultima_venda` olha um ano para trás.
CREATE OR REPLACE FUNCTION public.getulio_giro_produtos(p_empresa uuid, p_agora timestamptz DEFAULT now())
RETURNS TABLE(produto_id uuid, nome text, sku text, estoque numeric, custo numeric, vend7 numeric, vend28ant numeric, ultima_venda timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH saidas AS (
    SELECT vi.produto_id::uuid AS produto_id, vi.quantidade::numeric AS qtd, v.created_at AS em
    FROM venda_itens vi JOIN vendas v ON v.id::text = vi.venda_id
    WHERE v.empresa_id = p_empresa AND v.status = 'concluida'
      AND v.created_at >= p_agora - interval '365 days' AND v.created_at < p_agora
      AND vi.produto_id ~ '^[0-9a-f-]{36}$'
    UNION ALL
    SELECT i.produto_id, i.quantidade::numeric, p.data_pedido
    FROM marketplace_pedido_itens i JOIN marketplace_pedidos p ON p.id = i.pedido_id
    WHERE p.empresa_id = p_empresa AND p.status <> 'cancelado' AND i.produto_id IS NOT NULL
      AND p.data_pedido >= p_agora - interval '365 days' AND p.data_pedido < p_agora
  ),
  agg AS (
    SELECT s.produto_id,
           COALESCE(SUM(s.qtd) FILTER (WHERE s.em >= p_agora - interval '7 days'), 0) AS vend7,
           COALESCE(SUM(s.qtd) FILTER (WHERE s.em < p_agora - interval '7 days' AND s.em >= p_agora - interval '35 days'), 0) AS vend28ant,
           MAX(s.em) AS ultima_venda
    FROM saidas s GROUP BY s.produto_id
  )
  SELECT pr.id, pr.nome, pr.sku, COALESCE(pr.estoque, 0), COALESCE(pr.preco_custo, 0),
         COALESCE(a.vend7, 0), COALESCE(a.vend28ant, 0), a.ultima_venda
  FROM produtos pr LEFT JOIN agg a ON a.produto_id = pr.id
  WHERE pr.empresa_id = p_empresa AND pr.ativo
    AND (COALESCE(pr.estoque, 0) > 0 OR a.ultima_venda >= p_agora - interval '35 days');
$$;

REVOKE ALL ON FUNCTION public.getulio_vendas_canais(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.getulio_giro_produtos(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.getulio_vendas_canais(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.getulio_giro_produtos(uuid, timestamptz) TO service_role;
