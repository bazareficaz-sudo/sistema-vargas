-- ============================================================
-- WHATSAPP / Z-API — Integração completa
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Configuração por empresa
CREATE TABLE IF NOT EXISTS whatsapp_config (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id               UUID NOT NULL UNIQUE,
  nome                     TEXT NOT NULL DEFAULT 'WhatsApp Principal',
  ativo                    BOOLEAN NOT NULL DEFAULT false,
  instance_id              TEXT,
  token                    TEXT,
  client_token             TEXT,
  url_base                 TEXT NOT NULL DEFAULT 'https://api.z-api.io',
  numero_whatsapp          TEXT,
  nome_exibido             TEXT,
  webhook_url              TEXT,
  status_conexao           TEXT NOT NULL DEFAULT 'desconectado',
  ultima_sincronizacao     TIMESTAMPTZ,
  ultima_mensagem_enviada  TIMESTAMPTZ,
  ambiente                 TEXT NOT NULL DEFAULT 'producao',
  -- Templates padrão
  texto_cupom              TEXT DEFAULT E'Olá {nome_cliente}! 👋\nAqui está o seu cupom de compra na *{nome_empresa}*.\n\n🛍️ *Resumo da compra:*\n{produtos}\n\n💰 *Total:* {valor_total}\n📅 *Data:* {data_pedido}\n\nObrigado pela preferência! 🙏',
  texto_cobranca           TEXT DEFAULT E'Olá {nome_cliente}! 👋\nPassando para lembrar sobre um valor em aberto na *{nome_empresa}*.\n\n💰 *Valor:* {valor_pendente}\n📅 *Vencimento:* {vencimento}\n📄 *Doc:* {numero_pedido}\n\nDúvidas? Entre em contato:\n📞 {telefone_empresa}',
  texto_orcamento          TEXT DEFAULT E'Olá {nome_cliente}! 👋\nSeu orçamento da *{nome_empresa}* está pronto.\n\n📋 *Orçamento nº {numero_pedido}*\n💰 *Total:* {valor_total}\n📅 *Data:* {data_pedido}\n\n{produtos}\n\nQualquer dúvida estamos à disposição!\n📞 {telefone_empresa}',
  texto_confirmacao_pag    TEXT DEFAULT E'Olá {nome_cliente}! ✅\nConfirmamos o recebimento do seu pagamento na *{nome_empresa}*.\n\n💰 *Valor pago:* {valor_pago}\n📅 *Data:* {data_pedido}\n\nObrigado! 🙏',
  texto_lista_produtos     TEXT DEFAULT E'🛍️ *{nome_empresa}* — Lista de Produtos\n\n{produtos}\n\n💬 Para pedidos ou dúvidas:\n📞 {telefone_empresa}',
  texto_lembrete_venc      TEXT DEFAULT E'Olá {nome_cliente}! ⏰\nLembrete: seu pagamento na *{nome_empresa}* vence em *{vencimento}*.\n\n💰 *Valor:* {valor_pendente}\n\nEvite atrasos! Entre em contato:\n📞 {telefone_empresa}',
  texto_pos_venda          TEXT DEFAULT E'Olá {nome_cliente}! 😊\nObrigado pela sua compra na *{nome_empresa}*!\n\nEsperamos que tenha ficado satisfeito. Qualquer dúvida, estamos à disposição.\n📞 {telefone_empresa}',
  assinatura               TEXT,
  saudacao                 TEXT DEFAULT 'Olá {nome_cliente}! 👋',
  rodape                   TEXT,
  horario_atendimento      TEXT,
  observacoes              TEXT,
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE whatsapp_config DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_whatsapp_config_empresa ON whatsapp_config(empresa_id);

-- 2. Modelos de mensagem personalizados
CREATE TABLE IF NOT EXISTS whatsapp_modelos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   UUID NOT NULL,
  nome         TEXT NOT NULL,
  tipo         TEXT NOT NULL,
  conteudo     TEXT NOT NULL,
  ativo        BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE whatsapp_modelos DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_whatsapp_modelos_empresa ON whatsapp_modelos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_modelos_tipo    ON whatsapp_modelos(tipo);

-- 3. Fila e histórico de mensagens
CREATE TABLE IF NOT EXISTS whatsapp_mensagens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL,
  cliente_id      UUID,
  cliente_nome    TEXT,
  telefone        TEXT NOT NULL,
  tipo            TEXT NOT NULL,
  conteudo        TEXT NOT NULL,
  conteudo_pdf_url TEXT,
  referencia_tipo TEXT,
  referencia_id   TEXT,
  status          TEXT NOT NULL DEFAULT 'pendente',
  tentativas      INT  NOT NULL DEFAULT 0,
  erro            TEXT,
  zapi_message_id TEXT,
  status_entrega  TEXT,
  operador_nome   TEXT,
  enviado_em      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE whatsapp_mensagens DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_wpp_msg_empresa  ON whatsapp_mensagens(empresa_id);
CREATE INDEX IF NOT EXISTS idx_wpp_msg_cliente  ON whatsapp_mensagens(cliente_id);
CREATE INDEX IF NOT EXISTS idx_wpp_msg_status   ON whatsapp_mensagens(status);
CREATE INDEX IF NOT EXISTS idx_wpp_msg_created  ON whatsapp_mensagens(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wpp_msg_ref      ON whatsapp_mensagens(referencia_tipo, referencia_id);

-- 4. Campos extras na tabela clientes
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS opt_out_whatsapp  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS telefone_whatsapp TEXT;
