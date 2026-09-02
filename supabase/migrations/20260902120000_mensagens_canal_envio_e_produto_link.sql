-- CONFIGURACAO DE ENVIO DE MENSAGENS.
--
-- Aplicada em producao em 02/09/2026. Reaproveita `whatsapp_config` em vez de
-- criar tabela nova: o sistema ja tinha TRES mecanismos de modelo de mensagem
-- e nenhum funcionando (a tabela `whatsapp_modelos` vazia, as sete colunas
-- `texto_*` lidas so pela tela de config, e a lista de variaveis que nada
-- substituia). Um quarto lugar tornaria pior o problema que se resolve aqui.

-- COMO A MENSAGEM SAI.
--
--   whatsapp_web  wa.me: abre o WhatsApp do proprio vendedor, ele escolhe o
--                 contato, a mensagem sai do numero dele. Nao precisa de
--                 configuracao nenhuma e funciona no celular.
--   zapi          envio pelo servidor com a conta Z-API da empresa: exige
--                 numero de destino digitado, sai do numero da empresa e fica
--                 registrado em `whatsapp_mensagens`.
--
-- O padrao e `whatsapp_web` porque e o unico que funciona sem credencial: uma
-- empresa sem Z-API configurada nao pode ter o botao quebrado por padrao.
alter table whatsapp_config
  add column if not exists canal_envio text not null default 'whatsapp_web';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'whatsapp_config_canal_envio_valido'
  ) then
    alter table whatsapp_config
      add constraint whatsapp_config_canal_envio_valido
      check (canal_envio in ('whatsapp_web', 'zapi'));
  end if;
end $$;

-- O TEXTO DO LINK DE PRODUTO.
--
-- Fica nulo de proposito. Nulo significa "usar o padrao do codigo"
-- (PADRAO_PRODUTO_LINK), e string vazia significa "o gestor apagou o texto de
-- proposito". Se o default fosse gravado aqui, mudar o padrao no codigo nao
-- alcancaria mais ninguem — cada empresa carregaria uma copia congelada do
-- texto que nunca escolheu.
alter table whatsapp_config
  add column if not exists texto_produto_link text;

comment on column whatsapp_config.canal_envio is
  'Como as mensagens saem: whatsapp_web (wa.me, do numero do vendedor) ou zapi (servidor, do numero da empresa).';
comment on column whatsapp_config.texto_produto_link is
  'Modelo da mensagem do link de produto. NULO = usar o padrao do codigo; vazio = o gestor apagou.';
