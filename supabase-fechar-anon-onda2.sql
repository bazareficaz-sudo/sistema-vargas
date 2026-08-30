-- ============================================================
-- FECHAR O ACESSO ANÔNIMO — ONDA 2: a escrita
--
-- A Onda 1 tirou o pior (a escalada de privilégio em `system_admins` e o
-- `senha_hash`). Sobraram 83 tabelas legíveis, 80 escrevíveis e 71 apagáveis
-- pela chave que vai dentro do JavaScript.
--
-- Esta onda ataca a ESCRITA, e não a leitura, por um motivo de método: a
-- escrita é decidível com o que já foi medido, e a leitura não.
--
-- ── O que a medição permite afirmar, e o que não ────────────
--
-- Em 24h, a chave anônima escreveu em CINCO tabelas: `vendas`, `venda_itens`,
-- `estoque_movimentacoes`, `produto_estoque` e `produtos` — mais o RPC
-- `autenticar_operador_pdv`. Nada além disso.
--
-- Mas a janela foi um FIM DE SEMANA. Numa segunda-feira o balcão faz coisa
-- que não fez no domingo: cria orçamento, lança fiado em `contas_receber`,
-- usa crédito de cliente, registra falta, faz inventário, transfere estoque,
-- separa pedido. Nenhuma dessas apareceu, e nenhuma delas entra aqui.
--
-- Por isso esta onda NÃO é "revogar a escrita de tudo que não apareceu". É
-- uma lista escolhida a dedo, de tabelas que o terminal do balcão não tem
-- como escrever nem numa segunda de pico:
--
--   • maquinário de marketplace, escrito pelos crons com chave de serviço;
--   • caches de precificação, escritos pelo motor de preço;
--   • auxiliar de compras e programa de incentivo, que só existem no painel;
--   • configuração de empresa, que se edita no painel;
--   • uma tabela de backup de 24/08 que ninguém deveria nem ler.
--
-- Ficaram DE FORA, de propósito, e vão para a Onda 3 com logs de dia útil:
-- `orcamentos`, `creditos_cliente`, `credito_utilizacoes`, `recebimentos`,
-- `renegociacoes`, `faltas`, `inventarios`, `inventario_itens`,
-- `transferencias_estoque`, `separacoes`, `entregas`, `enderecos`,
-- `produto_enderecos`, `endereco_movimentacoes`, `cliente_contatos`,
-- `cliente_enderecos_entrega`, `etiqueta_impressoes`, `saude_autorizacoes`,
-- `categorias`, `marcas`, `nfe_*` e `config_fiscal`.
--
-- ── A LEITURA não é tocada aqui ─────────────────────────────
--
-- Nenhum `REVOKE SELECT` nesta onda sobre tabela que o terminal lê. Onde o
-- terminal lê a configuração (`saude_config`, `config_desconto`,
-- `pdv_impressao`, `deposito_enderecamento_config`, `vendedor_empresas`), só
-- a escrita sai — ele lê config, nunca a grava.
--
-- ── Regra de execução ───────────────────────────────────────
--
-- Fora do expediente, e com o bloco COMO DESFAZER à mão. Cada seção é
-- independente. O teste que vale mais que qualquer consulta continua sendo:
-- FAZER UMA VENDA no terminal.
--
-- Execute no Supabase Dashboard → SQL Editor.
-- ============================================================


-- ============================================================
-- 1. Configuração que o terminal LÊ mas nunca GRAVA
--
-- Só a escrita sai; o SELECT fica, porque tirar isso derruba o caixa na
-- inicialização. Essas cinco aparecem nas leituras anônimas de 24h — e em
-- nenhuma escrita.
-- ============================================================

REVOKE INSERT, UPDATE, DELETE ON saude_config                  FROM anon;
REVOKE INSERT, UPDATE, DELETE ON config_desconto               FROM anon;
REVOKE INSERT, UPDATE, DELETE ON pdv_impressao                 FROM anon;
REVOKE INSERT, UPDATE, DELETE ON deposito_enderecamento_config FROM anon;
REVOKE INSERT, UPDATE, DELETE ON vendedor_empresas             FROM anon;


-- ============================================================
-- 2. Maquinário que roda com chave de serviço
--
-- Filas, logs de sincronização e caches. Quem escreve neles são os crons e o
-- servidor do site, nunca o navegador nem o terminal. `REVOKE ALL`: o
-- anônimo também não tem por que ler a fila de anúncios nem o cache de
-- comissão do Mercado Livre.
-- ============================================================

REVOKE ALL ON marketplace_fila                 FROM anon;
REVOKE ALL ON marketplace_fila_config          FROM anon;
REVOKE ALL ON marketplace_fila_simulacao       FROM anon;
REVOKE ALL ON marketplace_sync_log             FROM anon;
REVOKE ALL ON marketplace_pedido_pacotes       FROM anon;
REVOKE ALL ON precificacao_ml_comissao_cache   FROM anon;
REVOKE ALL ON precificacao_ml_frete_cache      FROM anon;
REVOKE ALL ON vendas_duplicidade_bloqueada     FROM anon;


-- ============================================================
-- 3. Auxiliar de compras e programa de incentivo
--
-- Existem só no painel do ERP, com sessão autenticada. O incentivo guarda
-- meta e premiação de vendedor — dado de pessoa, e não há motivo nenhum
-- para o anônimo alcançá-lo.
-- ============================================================

REVOKE ALL ON compras_listas          FROM anon;
REVOKE ALL ON compras_lista_itens     FROM anon;
REVOKE ALL ON reposicao_config        FROM anon;
REVOKE ALL ON reposicao_decisoes      FROM anon;
REVOKE ALL ON reposicao_ia_resumo     FROM anon;
REVOKE ALL ON reposicao_ia_sinais     FROM anon;
REVOKE ALL ON reposicao_metricas      FROM anon;
REVOKE ALL ON reposicao_rupturas      FROM anon;
REVOKE ALL ON incentivo_bonus         FROM anon;
REVOKE ALL ON incentivo_historico     FROM anon;
REVOKE ALL ON incentivo_metas         FROM anon;
REVOKE ALL ON incentivo_participantes FROM anon;
REVOKE ALL ON incentivo_planos        FROM anon;
REVOKE ALL ON incentivo_pontos        FROM anon;
REVOKE ALL ON incentivo_premiacoes    FROM anon;
REVOKE ALL ON incentivo_ranking       FROM anon;
REVOKE ALL ON incentivo_regras        FROM anon;
REVOKE ALL ON incentivo_resultados    FROM anon;


-- ============================================================
-- 4. Configuração de empresa e modelos, editados no painel
--
-- `empresa_config_financeira` e `empresa_config_comercial` guardam política
-- de preço e de crédito da casa. Nada disso é do terminal, e menos ainda do
-- anônimo.
-- ============================================================

REVOKE ALL ON empresa_config_anuncio           FROM anon;
REVOKE ALL ON empresa_config_comercial         FROM anon;
REVOKE ALL ON empresa_config_financeira        FROM anon;
REVOKE ALL ON empresa_config_impressao         FROM anon;
REVOKE ALL ON empresa_compartilhamento_dados   FROM anon;
REVOKE ALL ON estoque_unificado_participantes  FROM anon;
REVOKE ALL ON produto_canal_preferencias       FROM anon;
REVOKE ALL ON whatsapp_modelos                 FROM anon;
REVOKE ALL ON tipos_despesa                    FROM anon;
REVOKE ALL ON endereco_tipos                   FROM anon;
REVOKE ALL ON config_termometro                FROM anon;
REVOKE ALL ON saude_faixas                     FROM anon;


-- ============================================================
-- 5. A tabela de backup
--
-- `_backup_correcao_20260824` é uma cópia de segurança de uma correção de
-- agosto. O anônimo podia lê-la, escrevê-la e APAGÁ-LA — um backup que o
-- público pode apagar não é backup.
-- ============================================================

REVOKE ALL ON _backup_correcao_20260824 FROM anon;


-- ============================================================
-- CONFERÊNCIA
--
--   -- quanto sobrou, antes e depois:
--   SELECT count(*) FILTER (WHERE has_table_privilege('anon', c.oid,'SELECT')) AS le,
--          count(*) FILTER (WHERE has_table_privilege('anon', c.oid,'INSERT')
--                              OR has_table_privilege('anon', c.oid,'UPDATE')
--                              OR has_table_privilege('anon', c.oid,'DELETE')) AS escreve,
--          count(*) FILTER (WHERE has_table_privilege('anon', c.oid,'DELETE')) AS apaga
--     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--    WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity;
--
--   -- o que o terminal PRECISA continuar podendo, e tem de seguir true:
--   SELECT has_table_privilege('anon','produtos','SELECT')              AS le_produtos,
--          has_table_privilege('anon','clientes','SELECT')              AS le_clientes,
--          has_table_privilege('anon','saude_config','SELECT')          AS le_saude,
--          has_table_privilege('anon','config_desconto','SELECT')       AS le_desconto,
--          has_table_privilege('anon','vendas','INSERT')                AS grava_venda,
--          has_table_privilege('anon','venda_itens','INSERT')           AS grava_item,
--          has_table_privilege('anon','estoque_movimentacoes','INSERT') AS grava_movimento,
--          has_table_privilege('anon','produto_estoque','UPDATE')       AS baixa_estoque;
--   -- esperado: TODAS true
-- ============================================================

-- ============================================================
-- COMO DESFAZER — por seção
--
--   -- §1
--   GRANT INSERT, UPDATE, DELETE ON saude_config, config_desconto, pdv_impressao,
--         deposito_enderecamento_config, vendedor_empresas TO anon;
--
--   -- §2 a §5 (devolve tudo o que a seção tirou)
--   GRANT SELECT, INSERT, UPDATE, DELETE ON <tabela> TO anon;
--
-- Nenhuma linha de dado é alterada por este arquivo. Ele mexe só em
-- privilégio, e privilégio volta com um GRANT.
-- ============================================================
