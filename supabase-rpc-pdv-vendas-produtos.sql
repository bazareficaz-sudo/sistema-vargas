-- ═══════════════════════════════════════════════════════════════════════
-- Restaura, via funções SECURITY DEFINER estreitas, três operações do
-- terminal PDV quebradas pelo bloqueio de privilégios de 02/08/2026
-- (revogação de UPDATE em vendas/venda_itens e de INSERT em produtos).
--
-- Confirmado ao vivo, contra produção, antes de escrever este arquivo:
--   - cancelarVenda: reverte o estoque, mas quebra em "permission denied
--     for table vendas" ao tentar marcar status='cancelada' — o estoque já
--     revertido fica órfão de uma venda que continua 'concluida'. Se o
--     operador tentar cancelar de novo, o estoque reverteria uma SEGUNDA
--     vez (a função abaixo também fecha essa brecha: só reverte se a
--     função confirmar que a venda estava mesmo 'concluida').
--   - editarVenda: quebra no primeiro UPDATE em vendas, antes de chegar a
--     mexer em venda_itens.
--   - criarProdutoRemoto (cadastro de produto no balcão): quebra com
--     "permission denied for table produtos" no INSERT.
--
-- Em vez de reabrir UPDATE em vendas/venda_itens ou INSERT em produtos de
-- forma ampla (reintroduziria exatamente a superfície que o bloqueio quis
-- fechar), cada função abaixo faz SÓ a operação exata que o terminal
-- precisa, com SECURITY DEFINER — mesmo padrão já usado em
-- autenticar_operador_pdv (supabase-autenticar-operador-pdv.sql).
--
-- Tipos confirmados via introspecção real do PostgREST (OpenAPI spec),
-- não por leitura de migration — vendas.id e produtos.id são UUID, mas
-- venda_itens.venda_id e venda_itens.produto_id são TEXT (não UUID).
-- ═══════════════════════════════════════════════════════════════════════

-- ── cancelar_venda_pdv ───────────────────────────────────────────────
-- Só marca 'cancelada' se ainda estiver 'concluida' — devolve 0 linhas se
-- a venda já tiver sido cancelada antes (ou não existir), o que o terminal
-- usa como sinal pra NÃO reverter o estoque de novo.
CREATE OR REPLACE FUNCTION cancelar_venda_pdv(p_venda_id UUID, p_motivo TEXT)
RETURNS TABLE (id UUID, deposito_id UUID)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE vendas
  SET status = 'cancelada', motivo_cancelamento = p_motivo
  WHERE vendas.id = p_venda_id AND vendas.status = 'concluida'
  RETURNING vendas.id, vendas.deposito_id;
$$;

GRANT EXECUTE ON FUNCTION cancelar_venda_pdv(UUID, TEXT) TO anon;

-- ── editar_venda_pdv ─────────────────────────────────────────────────
-- Atualiza os totais/forma de pagamento da venda (incluindo o resumo
-- itens JSONB que vendas também guarda) e substitui as linhas de
-- venda_itens pelas novas — mesma operação de "delete + insert" que o
-- terminal já fazia, só que agora dentro da função (DELETE em venda_itens
-- também foi revogado do anon).
CREATE OR REPLACE FUNCTION editar_venda_pdv(
  p_venda_id UUID,
  p_subtotal NUMERIC, p_desconto NUMERIC, p_total NUMERIC,
  p_forma_pagamento TEXT, p_valor_pago NUMERIC, p_troco NUMERIC,
  p_itens JSONB
)
RETURNS TABLE (id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE vendas SET
    subtotal = p_subtotal, desconto = p_desconto, desconto_total = p_desconto,
    total = p_total, forma_pagamento = p_forma_pagamento,
    valor_pago = p_valor_pago, valor_recebido = p_valor_pago, troco = p_troco,
    itens = p_itens
  WHERE vendas.id = p_venda_id;

  DELETE FROM venda_itens WHERE venda_itens.venda_id = p_venda_id::text;

  INSERT INTO venda_itens (venda_id, produto_id, produto_nome, produto_sku, quantidade, preco_unitario, desconto, total, tipo)
  SELECT p_venda_id::text,
         item->>'produto_id',
         item->>'produto_nome',
         item->>'produto_sku',
         (item->>'quantidade')::NUMERIC,
         (item->>'preco_unitario')::NUMERIC,
         COALESCE((item->>'desconto')::NUMERIC, 0),
         (item->>'total')::NUMERIC,
         'venda'
  FROM jsonb_array_elements(p_itens) AS item;

  RETURN QUERY SELECT p_venda_id;
END;
$$;

GRANT EXECUTE ON FUNCTION editar_venda_pdv(UUID, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, JSONB) TO anon;

-- ── criar_produto_pdv ────────────────────────────────────────────────
-- Cadastro de produto feito no balcão (tela "Novo Produto" do terminal),
-- que precisa existir no Supabase pra qualquer venda dele sincronizar
-- corretamente depois. Só os campos que o terminal realmente preenche.
CREATE OR REPLACE FUNCTION criar_produto_pdv(
  p_empresa_id UUID, p_nome TEXT, p_sku TEXT, p_ean TEXT,
  p_preco_venda NUMERIC, p_preco_custo NUMERIC, p_unidade TEXT,
  p_categoria TEXT, p_marca TEXT, p_foto_url TEXT,
  p_ativo BOOLEAN, p_permite_fracao BOOLEAN, p_estoque NUMERIC
)
RETURNS TABLE (id UUID)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO produtos (
    empresa_id, nome, sku, ean, preco_venda, preco_custo, unidade,
    categoria, marca, foto_url, ativo, disponivel_pdv, permite_fracao, estoque
  ) VALUES (
    p_empresa_id, p_nome, p_sku, p_ean, p_preco_venda, p_preco_custo, p_unidade,
    p_categoria, p_marca, p_foto_url, p_ativo, true, p_permite_fracao, p_estoque
  )
  RETURNING produtos.id;
$$;

GRANT EXECUTE ON FUNCTION criar_produto_pdv(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, NUMERIC) TO anon;

-- ── Para desfazer ──────────────────────────────────────────────────────
-- REVOKE EXECUTE ON FUNCTION cancelar_venda_pdv(UUID, TEXT) FROM anon;
-- REVOKE EXECUTE ON FUNCTION editar_venda_pdv(UUID, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, JSONB) FROM anon;
-- REVOKE EXECUTE ON FUNCTION criar_produto_pdv(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, NUMERIC) FROM anon;
-- DROP FUNCTION IF EXISTS cancelar_venda_pdv(UUID, TEXT);
-- DROP FUNCTION IF EXISTS editar_venda_pdv(UUID, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, JSONB);
-- DROP FUNCTION IF EXISTS criar_produto_pdv(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, NUMERIC);
