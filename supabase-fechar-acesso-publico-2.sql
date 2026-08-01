-- ============================================================
-- URGENTE — Rodada 2 do fechamento de acesso público
--
-- A rodada 1 fechou 5 tabelas de credencial. Uma varredura completa agora,
-- feita contra a PRODUÇÃO com a chave pública e SEM LOGIN, mostrou que o
-- buraco era muito maior do que aquelas 5 tabelas. Dois achados novos:
--
-- 1) `sistema_integracoes` estava legível — e ela guarda a `partner_key` da
--    Shopee e o `app_secret` do Mercado Livre. Não é o token de UMA loja
--    (esse já foi fechado): é a credencial MESTRA da plataforma, a que
--    assina as chamadas de todas as lojas conectadas, de todos os clientes.
--
-- 2) Não era só leitura. Com a mesma chave pública e sem login, foi possível
--    executar UPDATE em `produtos`, DELETE em `vendas` e INSERT em
--    `clientes` (o registro de teste foi criado e removido na hora). Ou
--    seja: qualquer pessoa podia apagar o histórico de vendas.
--
-- Este arquivo fecha tudo que o painel web usa de ponta a ponta. O que o
-- PDV externo pode estar usando fica de fora de propósito — ver o bloco
-- "AINDA ABERTO" no final, que é honesto sobre o que continua exposto e
-- por quê.
--
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

-- ── 1. Credencial mestra da plataforma ──────────────────────
--
-- Nem o dono da loja precisa (ou deve) enxergar este valor: é do operador
-- da plataforma. Fechada para TODA sessão de usuário; o código do servidor
-- passou a ler com a chave de serviço, que não passa por RLS.
--
-- ATENÇÃO: rodar este bloco ANTES do deploy do código correspondente
-- derruba as telas de marketplace até o deploy subir. Rode os dois juntos.

ALTER TABLE sistema_integracoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "integracoes_admin" ON sistema_integracoes;
CREATE POLICY "integracoes_admin" ON sistema_integracoes
  FOR ALL TO authenticated
  USING (is_system_admin()) WITH CHECK (is_system_admin());

-- ── 2. Marketplace ──────────────────────────────────────────
-- Nada aqui é usado pelo PDV externo: é tudo tela de painel e rotina de
-- servidor (que usa chave de serviço).

ALTER TABLE marketplace_anuncios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anuncios_do_grupo" ON marketplace_anuncios;
CREATE POLICY "anuncios_do_grupo" ON marketplace_anuncios
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

ALTER TABLE marketplace_anuncio_variacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "variacoes_do_grupo" ON marketplace_anuncio_variacoes;
CREATE POLICY "variacoes_do_grupo" ON marketplace_anuncio_variacoes
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

ALTER TABLE marketplace_pedidos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pedidos_mkt_do_grupo" ON marketplace_pedidos;
CREATE POLICY "pedidos_mkt_do_grupo" ON marketplace_pedidos
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

-- Itens não têm empresa_id: o escopo vem do pedido dono.
ALTER TABLE marketplace_pedido_itens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "itens_pedido_mkt_do_grupo" ON marketplace_pedido_itens;
CREATE POLICY "itens_pedido_mkt_do_grupo" ON marketplace_pedido_itens
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM marketplace_pedidos p
                  WHERE p.id = pedido_id AND (empresa_do_meu_grupo(p.empresa_id) OR is_system_admin())))
  WITH CHECK (EXISTS (SELECT 1 FROM marketplace_pedidos p
                  WHERE p.id = pedido_id AND (empresa_do_meu_grupo(p.empresa_id) OR is_system_admin())));

ALTER TABLE marketplace_mapeamentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mapeamentos_do_grupo" ON marketplace_mapeamentos;
CREATE POLICY "mapeamentos_do_grupo" ON marketplace_mapeamentos
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

ALTER TABLE marketplace_regras_preco ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "regras_preco_do_grupo" ON marketplace_regras_preco;
CREATE POLICY "regras_preco_do_grupo" ON marketplace_regras_preco
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

ALTER TABLE marketplace_categoria_sugestao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "categoria_sugestao_do_grupo" ON marketplace_categoria_sugestao;
CREATE POLICY "categoria_sugestao_do_grupo" ON marketplace_categoria_sugestao
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

-- ── 3. Pedidos: linha do tempo ──────────────────────────────
-- Criada na Fase 2 dos Pedidos com RLS desligada de propósito. Era dívida
-- assumida; está sendo paga agora.

ALTER TABLE pedido_eventos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "eventos_do_grupo" ON pedido_eventos;
CREATE POLICY "eventos_do_grupo" ON pedido_eventos
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

-- ── 4. Precificação ─────────────────────────────────────────
-- Taxas, margens e histórico de preço: é a estrutura de custo do negócio.

ALTER TABLE precificacao_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "precificacao_config_do_grupo" ON precificacao_config;
CREATE POLICY "precificacao_config_do_grupo" ON precificacao_config
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

ALTER TABLE precificacao_regra ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "precificacao_regra_do_grupo" ON precificacao_regra;
CREATE POLICY "precificacao_regra_do_grupo" ON precificacao_regra
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

ALTER TABLE precificacao_historico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "precificacao_historico_do_grupo" ON precificacao_historico;
CREATE POLICY "precificacao_historico_do_grupo" ON precificacao_historico
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

ALTER TABLE historico_precos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "historico_precos_do_grupo" ON historico_precos;
CREATE POLICY "historico_precos_do_grupo" ON historico_precos
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

-- ── 5. Compras e entrada de mercadoria ──────────────────────

ALTER TABLE entradas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "entradas_do_grupo" ON entradas;
CREATE POLICY "entradas_do_grupo" ON entradas
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

ALTER TABLE entrada_itens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "entrada_itens_do_grupo" ON entrada_itens;
CREATE POLICY "entrada_itens_do_grupo" ON entrada_itens
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM entradas e
                  WHERE e.id = entrada_id AND (empresa_do_meu_grupo(e.empresa_id) OR is_system_admin())))
  WITH CHECK (EXISTS (SELECT 1 FROM entradas e
                  WHERE e.id = entrada_id AND (empresa_do_meu_grupo(e.empresa_id) OR is_system_admin())));

ALTER TABLE nfe_mapeamentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "nfe_mapeamentos_do_grupo" ON nfe_mapeamentos;
CREATE POLICY "nfe_mapeamentos_do_grupo" ON nfe_mapeamentos
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

-- ── 6. Automações e auditoria ───────────────────────────────

ALTER TABLE automacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "automacoes_do_grupo" ON automacoes;
CREATE POLICY "automacoes_do_grupo" ON automacoes
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

ALTER TABLE empresa_auditoria ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auditoria_do_grupo" ON empresa_auditoria;
CREATE POLICY "auditoria_do_grupo" ON empresa_auditoria
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

-- Exceções de permissão por usuário: quem lê é o próprio guarda de
-- permissão, com a sessão do usuário. Escrita só pela rota admin.
ALTER TABLE usuario_permissoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "permissoes_do_grupo" ON usuario_permissoes;
CREATE POLICY "permissoes_do_grupo" ON usuario_permissoes
  FOR SELECT TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

-- ── 7. Estrutura da conta ───────────────────────────────────

ALTER TABLE empresa_config_estoque ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "config_estoque_do_grupo" ON empresa_config_estoque;
CREATE POLICY "config_estoque_do_grupo" ON empresa_config_estoque
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

ALTER TABLE empresa_parcerias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "parcerias_do_tenant" ON empresa_parcerias;
CREATE POLICY "parcerias_do_tenant" ON empresa_parcerias
  FOR ALL TO authenticated
  USING (tenant_id = meu_tenant_id() OR is_system_admin())
  WITH CHECK (tenant_id = meu_tenant_id() OR is_system_admin());

ALTER TABLE grupos_empresariais ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "grupos_do_tenant" ON grupos_empresariais;
CREATE POLICY "grupos_do_tenant" ON grupos_empresariais
  FOR ALL TO authenticated
  USING (tenant_id = meu_tenant_id() OR is_system_admin())
  WITH CHECK (tenant_id = meu_tenant_id() OR is_system_admin());

-- `tenants` é a conta do cliente na plataforma: o próprio id é o escopo.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "meu_tenant" ON tenants;
CREATE POLICY "meu_tenant" ON tenants
  FOR ALL TO authenticated
  USING (id = meu_tenant_id() OR is_system_admin())
  WITH CHECK (is_system_admin());

-- ============================================================
-- AINDA ABERTO — e por quê
--
-- Continuam legíveis e GRAVÁVEIS sem login:
--
--   produtos, produto_imagens, produto_estoque, kit_itens, clientes,
--   vendas, venda_itens, usuarios_pdv, vendedores, depositos,
--   estoque_movimentacoes, contas_receber, orcamentos
--
-- Todas por um motivo só: o PDV externo (o terminal do balcão) conecta no
-- banco com a chave pública, sem sessão de usuário. Ligar RLS em qualquer
-- uma delas derruba o caixa no meio do expediente.
--
-- Não é uma exposição menor que as outras — `usuarios_pdv` ainda entrega o
-- `senha_hash` dos operadores, e `vendas` ainda aceita DELETE de qualquer
-- um. É uma exposição que não dá para fechar só pelo banco.
--
-- A correção depende do PDV externo passar a autenticar de verdade. A base
-- já existe: `autenticar_operador_pdv()`, criada na rodada 1, confere a
-- senha dentro do banco e nunca devolve o hash. Enquanto o terminal não for
-- atualizado para usá-la (e para entrar com uma sessão real), estas 13
-- tabelas ficam como estão — e isso precisa estar claro, não escondido.
--
-- Tabelas hoje vazias (produto_canal_preferencias, produto_vinculos,
-- inventarios, inventario_itens, pedidos_compra, pedidos_compra_itens,
-- faltas, usuario_empresas) ficaram fora só porque não deu para conferir a
-- estrutura sem dados. Entram na próxima rodada.
-- ============================================================

-- ============================================================
-- COMO DESFAZER, se alguma tela ficar em branco:
--
--   ALTER TABLE <tabela> DISABLE ROW LEVEL SECURITY;
--
-- Nenhum dado é alterado por este arquivo — ele só restringe quem lê e
-- quem grava.
-- ============================================================
