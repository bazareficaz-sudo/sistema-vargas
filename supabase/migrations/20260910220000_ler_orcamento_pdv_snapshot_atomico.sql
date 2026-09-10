-- FASE 0.6C.5 — leitura de snapshot para ação cruzada online.
-- Aplicada em produção em 10/09/2026 como `ler_orcamento_pdv_snapshot_atomico`.
--
-- O PDV precisa agir sobre um orçamento criado noutro terminal SEM manter uma
-- réplica local dele. Para isso precisa ler cabeçalho + itens + revisão num
-- estado lógico único.
--
-- ── POR QUE UMA ÚNICA INSTRUÇÃO ─────────────────────────────────────────
--
-- `revisao` não nomeia o cabeçalho: nomeia o PAR cabeçalho+itens, que
-- `salvar_orcamento_pdv` grava na mesma transação. Ler os dois em DUAS
-- instruções — mesmo dentro desta função — daria dois snapshots sob READ
-- COMMITTED, e uma gravação poderia cair no meio. O cliente receberia o
-- cabeçalho da revisão 4 com os itens da 3, e a próxima edição dele
-- sobrescreveria em silêncio itens que ele nunca viu.
--
-- Por isso os itens vêm numa subconsulta correlacionada DENTRO do mesmo
-- SELECT: uma instrução, um snapshot, o par coerente. É também por isso que a
-- função é `LANGUAGE sql` e não `plpgsql` — em plpgsql seria fácil demais
-- alguém "melhorar" isto para dois SELECTs e reintroduzir a fratura.
--
-- ── POR QUE A EMPRESA É PARÂMETRO ───────────────────────────────────────
--
-- Ela entra no WHERE, dentro da função, e não numa cláusula que a rota possa
-- esquecer. Orçamento de outra empresa devolve `nao_encontrado` — nunca
-- 'proibido': confirmar que o id existe já seria vazar a existência dele.
-- Medido: outra empresa e id inexistente devolvem a MESMA resposta.
--
-- SECURITY INVOKER, como a RPC de escrita. GRANT só para service_role;
-- REVOKE explícito de PUBLIC, anon e authenticated.
-- Verificado após aplicar: anon_pode=false, auth_pode=false, service_pode=true.

CREATE OR REPLACE FUNCTION public.ler_orcamento_pdv(
  p_empresa_id   uuid,
  p_orcamento_id uuid
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
        'estado',        'encontrado',
        'orcamento_id',  o.id,
        'numero',        o.numero,
        'status',        o.status,
        'revisao',       o.revisao,
        'empresa_id',    o.empresa_id,
        'terminal_id',   o.terminal_id,
        'cliente_id',    o.cliente_id,
        'cliente_nome',  o.cliente_nome,
        'operador_nome', o.operador_nome,
        'subtotal',      o.subtotal,
        'desconto',      o.desconto,
        'total',         o.total,
        'observacao',    o.observacao,
        'validade',      o.validade,
        'created_at',    o.created_at,
        'updated_at',    o.updated_at,
        'itens', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
                   'id',             i.id,
                   'produto_id',     i.produto_id,
                   'produto_nome',   i.produto_nome,
                   'produto_sku',    i.produto_sku,
                   'quantidade',     i.quantidade,
                   'preco_unitario', i.preco_unitario,
                   'desconto',       i.desconto,
                   'total',          i.total
                 ) ORDER BY i.created_at, i.id)
            FROM orcamento_itens i
           WHERE i.orcamento_id = o.id
        ), '[]'::jsonb)
      )
       FROM orcamentos o
      WHERE o.id = p_orcamento_id
        AND o.empresa_id = p_empresa_id),
    jsonb_build_object('estado', 'nao_encontrado')
  );
$$;

REVOKE ALL ON FUNCTION public.ler_orcamento_pdv(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ler_orcamento_pdv(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.ler_orcamento_pdv(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ler_orcamento_pdv(uuid, uuid) TO service_role;
