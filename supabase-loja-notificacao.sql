-- ============================================================
-- LOJA ONLINE — aviso de pedido novo por WhatsApp
--
-- O checkout entrou e o pedido cai em Pedidos, mas ninguém é avisado: alguém
-- precisa lembrar de olhar a tela. Numa loja que recebe pedido fora do
-- horário, isso é a diferença entre atender em minutos e atender no dia
-- seguinte.
--
-- ── Reaproveita, não duplica ────────────────────────────────
--
-- O envio é o `enviarWhatsappAutomacao` que as automações já usam: ele
-- resolve `whatsapp_config`, respeita `opt_out_whatsapp` do cliente, registra
-- em `whatsapp_mensagens` e chama a Z-API. Um segundo caminho de envio seria
-- um segundo lugar para esquecer o opt-out.
--
-- ── Dois avisos, com padrões diferentes de propósito ────────
--
-- `notificar_loja` nasce LIGADO: o destino é o número da própria loja, o
-- aviso é o motivo desta migração existir, e nada é enviado enquanto a Z-API
-- não estiver configurada e ativa — então ligar por padrão não manda mensagem
-- nenhuma para ninguém que não tenha pedido isso.
--
-- `notificar_cliente` nasce DESLIGADO. Esse alcança terceiro, e mandar
-- mensagem em nome da loja para o consumidor é decisão de quem opera, não
-- padrão de migração.
--
-- Depende de supabase-loja-checkout.sql e supabase-whatsapp.sql.
-- Execute no Supabase Dashboard → SQL Editor.
-- ============================================================

ALTER TABLE loja_config
  -- Avisa a loja quando entra pedido.
  ADD COLUMN IF NOT EXISTS notificar_loja BOOLEAN NOT NULL DEFAULT true,

  -- Confirma o pedido para o cliente. Alcança terceiro: nasce desligado.
  ADD COLUMN IF NOT EXISTS notificar_cliente BOOLEAN NOT NULL DEFAULT false,

  -- Para onde vai o aviso da loja. Vazio usa `whatsapp`, que já é o número de
  -- atendimento. Existe separado porque quem atende o cliente nem sempre é
  -- quem separa o pedido.
  ADD COLUMN IF NOT EXISTS notificar_numero TEXT;

COMMENT ON COLUMN loja_config.notificar_loja IS
  'Avisa a loja por WhatsApp quando entra pedido. Inerte enquanto whatsapp_config não estiver ativa.';
COMMENT ON COLUMN loja_config.notificar_cliente IS
  'Confirma o pedido para o cliente por WhatsApp. Nasce desligado: alcança terceiro.';
COMMENT ON COLUMN loja_config.notificar_numero IS
  'Destino do aviso da loja. NULL usa loja_config.whatsapp.';

-- O painel grava estas colunas; sem isto, salvar falha por alguns instantes
-- com "Could not find the column ... in the schema cache".
NOTIFY pgrst, 'reload schema';


-- ============================================================
-- CONFERÊNCIA
--
--   SELECT notificar_loja, notificar_cliente,
--          COALESCE(notificar_numero, whatsapp) AS destino_do_aviso
--     FROM loja_config;
--
--   -- o aviso só sai se a Z-API estiver ativa nesta empresa:
--   SELECT ativo, instance_id IS NOT NULL AS tem_credencial
--     FROM whatsapp_config
--    WHERE empresa_id = (SELECT empresa_id FROM loja_config LIMIT 1);
--
--   -- depois do primeiro pedido, o aviso fica registrado como qualquer
--   -- outra mensagem, e com a referência do pedido:
--   SELECT tipo, telefone, status, erro, enviado_em
--     FROM whatsapp_mensagens
--    WHERE referencia_tipo = 'loja_pedido'
--    ORDER BY created_at DESC LIMIT 10;
-- ============================================================

-- ============================================================
-- COMO DESFAZER
--   UPDATE loja_config SET notificar_loja = false, notificar_cliente = false;
-- e, para remover de vez:
--   ALTER TABLE loja_config
--     DROP COLUMN IF EXISTS notificar_loja,
--     DROP COLUMN IF EXISTS notificar_cliente,
--     DROP COLUMN IF EXISTS notificar_numero;
-- ============================================================
