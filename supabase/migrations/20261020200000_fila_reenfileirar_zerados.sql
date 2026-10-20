-- ZERADO NO SISTEMA E À VENDA NO CANAL: volta para a fila.
--
-- A fila só trabalha produto "sujo" — que mudou de estoque ou de vínculo NO
-- SISTEMA. Se o estoque do canal muda POR FORA (alguém altera no Seller
-- Centre, a plataforma repõe sozinha), o produto parado no sistema nunca
-- volta para a fila, e o anúncio segue vendendo o que não tem. Medido em
-- 20/10/2026: "Durepoxi Branco 50g", produto com 0 desde antes de 06/10,
-- com 10 na Shopee e a regra "Estoque Real" ativa — 19 anúncios assim.
--
-- Esta função, chamada a cada rodada da fila, marca como sujo o produto de
-- anúncio ativo, sem variação, com regra de estoque pelo produto (ou pelo
-- depósito) e sem estoque complementar, quando o sistema diz 0 e o canal
-- (`estoque_externo`, que a sincronização grava com o número da plataforma)
-- diz mais que 0. Depois do envio o espelho vai a 0 e o produto para de
-- ser marcado — não fica girando.

CREATE OR REPLACE FUNCTION reenfileirar_zerados_a_venda(p_empresa UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_prod UUID; v_n INTEGER := 0;
BEGIN
  FOR v_prod IN
    SELECT DISTINCT a.produto_id
    FROM marketplace_anuncios a
    JOIN marketplace_canais c ON c.id = a.canal_id AND c.ativo AND coalesce(c.sincronizar_estoque, true)
    JOIN marketplace_regras_preco r ON r.id = a.regra_id AND r.ativo
      AND r.modo_estoque IN ('produto', 'deposito') AND coalesce(r.estoque_complementar, 0) = 0
    JOIN produtos p ON p.id = a.produto_id AND p.controlar_estoque AND p.tipo IS DISTINCT FROM 'kit'
    LEFT JOIN produto_estoque pe ON r.modo_estoque = 'deposito' AND pe.produto_id = p.id AND pe.deposito_id = r.deposito_id
    LEFT JOIN marketplace_fila f ON f.produto_id = a.produto_id
    WHERE a.empresa_id = p_empresa
      AND a.status = 'ativo' AND NOT coalesce(a.tem_variacao, false)
      AND coalesce(a.estoque_externo, 0) > 0
      AND CASE WHEN r.modo_estoque = 'deposito' THEN coalesce(pe.quantidade, 0) ELSE coalesce(p.estoque, 0) END <= 0
      -- Já está na fila esperando: não mexe.
      AND NOT (f.produto_id IS NOT NULL AND f.sujo_em > coalesce(f.enviado_em, '-infinity'))
  LOOP
    PERFORM enfileirar_produto(p_empresa, v_prod, 'zerado no sistema e à venda no canal', 1::smallint);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION reenfileirar_zerados_a_venda(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reenfileirar_zerados_a_venda(UUID) TO service_role;
