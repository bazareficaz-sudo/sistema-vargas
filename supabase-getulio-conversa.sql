-- ============================================================
-- AGENTE GETÚLIO — conversa pelo WhatsApp (Fase 3, perguntas). Aplicado em 07/10/2026.
--
--   getulio_config.responder_whatsapp   liga as respostas (padrão: desligado)
--   getulio_conversas                   o que o dono perguntou e o que ele respondeu
--   getulio_vendas_periodo              vendas por canal num período (PDV + marketplaces)
--   getulio_vendas_produto              vendas de um produto por canal num período
-- As funções só rodam com a chave de serviço (webhook e rotas do servidor).
-- ============================================================

ALTER TABLE public.getulio_config ADD COLUMN IF NOT EXISTS responder_whatsapp boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.getulio_conversas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  numero text NOT NULL,
  papel text NOT NULL CHECK (papel IN ('dono', 'getulio')),
  texto text NOT NULL,
  consultas text[] NOT NULL DEFAULT '{}',
  erro text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS getulio_conversas_idx ON public.getulio_conversas (empresa_id, numero, created_at DESC);
ALTER TABLE public.getulio_conversas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS getulio_conversas_do_grupo ON public.getulio_conversas;
CREATE POLICY getulio_conversas_do_grupo ON public.getulio_conversas FOR ALL
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

CREATE OR REPLACE FUNCTION public.getulio_vendas_periodo(p_empresa uuid, p_inicio timestamptz, p_fim timestamptz)
RETURNS TABLE(canal text, plataforma text, faturamento numeric, pedidos bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT 'Loja física (PDV)', 'pdv', COALESCE(SUM(v.total), 0), COUNT(*)
  FROM vendas v
  WHERE v.empresa_id = p_empresa AND v.status = 'concluida' AND v.created_at >= p_inicio AND v.created_at <= p_fim
  UNION ALL
  SELECT c.nome, c.plataforma, COALESCE(SUM(p.valor_total), 0), COUNT(p.id)
  FROM marketplace_canais c
  JOIN marketplace_pedidos p ON p.canal_id = c.id AND p.status <> 'cancelado'
    AND p.data_pedido >= p_inicio AND p.data_pedido <= p_fim
  WHERE c.empresa_id = p_empresa
  GROUP BY c.nome, c.plataforma;
$$;

CREATE OR REPLACE FUNCTION public.getulio_vendas_produto(p_empresa uuid, p_termo text, p_inicio timestamptz, p_fim timestamptz)
RETURNS TABLE(produto text, sku text, canal text, quantidade numeric, faturamento numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH alvo AS (
    SELECT pr.id, pr.nome, pr.sku FROM produtos pr
    WHERE pr.empresa_id = p_empresa
      AND (pr.sku = p_termo OR pr.nome ILIKE '%' || p_termo || '%')
    LIMIT 30
  )
  SELECT a.nome, a.sku, 'Loja física (PDV)', SUM(vi.quantidade), SUM(vi.quantidade * vi.preco_unitario)
  FROM alvo a JOIN venda_itens vi ON vi.produto_id = a.id::text
  JOIN vendas v ON v.id::text = vi.venda_id
  WHERE v.empresa_id = p_empresa AND v.status = 'concluida' AND v.created_at >= p_inicio AND v.created_at <= p_fim
  GROUP BY a.nome, a.sku
  UNION ALL
  SELECT a.nome, a.sku, c.nome, SUM(i.quantidade), SUM(COALESCE(i.subtotal, i.quantidade * i.preco_unitario))
  FROM alvo a JOIN marketplace_pedido_itens i ON i.produto_id = a.id
  JOIN marketplace_pedidos p ON p.id = i.pedido_id
  JOIN marketplace_canais c ON c.id = p.canal_id
  WHERE p.empresa_id = p_empresa AND p.status <> 'cancelado' AND p.data_pedido >= p_inicio AND p.data_pedido <= p_fim
  GROUP BY a.nome, a.sku, c.nome;
$$;

REVOKE ALL ON FUNCTION public.getulio_vendas_periodo(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.getulio_vendas_produto(uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.getulio_vendas_periodo(uuid, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.getulio_vendas_produto(uuid, text, timestamptz, timestamptz) TO service_role;
