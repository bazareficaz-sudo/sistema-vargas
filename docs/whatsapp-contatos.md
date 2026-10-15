# Contatos do WhatsApp (pré-cadastro automático)

**Etapa 1 do atendimento pelo WhatsApp.** Quem manda mensagem para a loja vira um contato, sozinho.

## Por quê

Medido em 15/10/2026: desde que o webhook voltou a gravar (08/10), 100 números diferentes mandaram mensagem e só 4 eram clientes cadastrados. Os outros 96 eram só linhas soltas em `whatsapp_mensagens`, com o telefone e nada mais.

## Como funciona

- **Webhook** (`/api/webhooks/zapi`): mensagem recebida de pessoa, com a **chave do endereço conferida** (`?k=`, a mesma da Betina), chama `whatsapp_registrar_contato`. A função:
  - cria ou atualiza o contato (um por número e empresa), com o nome do WhatsApp, a primeira mensagem, a última data e a contagem;
  - procura o cliente pelo telefone, aceitando número com e sem 55 e com e sem o 9 extra (`tel_chave`: DDD + 8 últimos dígitos);
  - ignora os destinatários do Getúlio (dono e equipe).
- **Fica de fora:** grupo, canal, transmissão e mensagem da própria loja. Ver `src/lib/whatsapp/contatos.ts`.
- **Número oculto (`@lid`)**: o WhatsApp esconde o número de parte das pessoas e manda só um código. Em 15/10/2026 eram 22 dos 99 contatos. Eles **entram** como contato, com chave `x` + código, e a tela mostra "Número oculto pelo WhatsApp". Não há link wa.me, e o cadastro de cliente não recebe telefone: o balconista pede o número na conversa.
- **Sem a chave no endereço**, nada muda: a mensagem é gravada como antes e o contato não é criado, porque sem chave qualquer um criaria contatos falsos.
- **Erro na função** (ex.: migração ainda não aplicada): o webhook segue como antes.
- **Cadastro de cliente** (tela de contatos, balcão ou importação) com o mesmo telefone: um gatilho em `clientes` liga o contato e as mensagens recebidas dele ao cliente. Cliente unificado em outro: o contato segue o destino.
- **Tela** CRM / WhatsApp → **Contatos**:
  - lista os novos (sem cadastro), os que já são clientes e os ignorados;
  - "Cadastrar cliente" abre a gaveta de cliente já com nome e telefone;
  - "Ignorar" serve para fornecedor, funcionário ou engano;
  - "Abrir conversa" abre o wa.me.
- **Configuração do WhatsApp:** passa a mostrar o endereço do webhook **com** a chave. Antes mostrava sem, e quem copiasse de lá desligava a Betina.

## Nome do WhatsApp

- **Mensagem nova:** o nome vem do próprio webhook (`senderName` ou `chatName`). Se vier sem nome, o webhook pergunta à Z-API depois de responder 200, pela consulta só de leitura `GET /contacts/{phone}`, campo `notify`: o "~Leilane" do celular.
- **Contatos da carga do histórico:** o histórico nunca guardou o nome. O botão **"Buscar nomes no WhatsApp"** da tela de contatos consulta 40 por vez (`POST /api/whatsapp/contatos/nomes`, empresa da sessão), em até 5 rodadas.
- **Consultado sem nome:** grava `nome_whatsapp = ''` para não perguntar de novo. A próxima mensagem com nome do remetente ainda preenche, pela função do banco.
- **Número oculto (`@lid`):** não é consultado.

## Banco (`supabase/migrations/20261015120000_whatsapp_contatos.sql`)

**Aplicada em 15/10/2026**, a pedido do Silvano, pela conexão do Supabase. Resultado: 99 contatos (96 novos e 3 já ligados a clientes); as 51 mensagens que ficaram sem contato são dos destinatários do Getúlio. Conferido: RLS ligado, `anon` sem leitura, logado sem inserção e função só para `service_role`.


- `tel_chave(text)` e índices por expressão em `clientes` (telefone, whatsapp, telefone_whatsapp).
- `whatsapp_contatos`:
  - RLS ligado; `anon` sem acesso;
  - logado lê os da empresa e muda só `status`;
  - inserir e vincular cliente é só do sistema.
- `whatsapp_mensagens.contato_id`.
- `whatsapp_registrar_contato(...)`: `SECURITY DEFINER`, só `service_role`.
- Gatilho `trg_whatsapp_contatos_vincular_cliente` em `clientes`.
- Carga do histórico: os remetentes de `whatsapp_mensagens` viram contatos, já ligados aos clientes existentes.
- Idempotente: pode rodar duas vezes. Testado em Postgres local com os cenários acima.

## LGPD

Guardar o contato serve para responder quem procurou a loja. **Não é autorização para mandar promoção.** Envio de campanha precisa de consentimento registrado; isso fica para as próximas etapas.

## Caixa de entrada — etapa 2, parte A

Tela **CRM / WhatsApp → Conversas** (`/dashboard/integracoes/whatsapp/conversas`).

- **Lista:** uma linha por contato, a mais recente no topo. Mostra o nome (do cliente ou do WhatsApp), "aguardando há X" quando o cliente escreveu por último e um ponto para "não lida". Filtros: todas, aguardando resposta, não lidas. Tem busca.
- **Conversa aberta:**
  - histórico com tudo o que o cliente mandou e tudo o que a loja enviou pelo sistema (orçamento, cupom, comprovante, automações), com rótulo;
  - abrir marca como lida (`lida_em`);
  - a tela se atualiza a cada 20 s.
- **Responder:** usa a rota que já existia, `/api/whatsapp/enviar`, com `tipo = 'atendimento'`. Ela registra, respeita opt-out e guarda o resultado da Z-API.
- **Número oculto (`@lid`) não pode ser respondido pelo sistema.** A Z-API trataria o código como telefone; a tela orienta responder pelo celular.
- **Resposta dada pelo celular** entra na conversa como `enviada_celular`, mas só se a Z-API estiver avisando as mensagens enviadas (opção "notificar as enviadas por mim" da instância).
  - Só entra conversa com contato, nunca com o dono ou a equipe.
  - Não duplica o que o sistema mandou: confere o mesmo `messageId`, ou o mesmo texto nos últimos 3 min, depois de esperar 5 s.

**Banco** (`supabase/migrations/20261015200000_whatsapp_conversas.sql`):
- gatilho que liga **toda** mensagem ao contato pelo telefone;
- `ultima_entrada_em`, `ultima_saida_em` e `lida_em` em `whatsapp_contatos`; o logado só altera `lida_em`;
- view `whatsapp_conversas` (`security_invoker`, sem `anon`), com `aguardando` e `nao_lida`;
- histórico: as mensagens que a loja já mandou para contatos passam a ser ligadas a eles, e as conversas antigas começam lidas.

Testada em Postgres local.

## Próximas etapas (planejado, não implementado)

1. Caixa de entrada, parte B: ficha do cliente ao lado, respostas rápidas, enviar produto do estoque. Depois: etiquetas/funil e lembretes.
2. IA copiloto (sugere resposta com preço e estoque reais; humano envia) e mensagem fora do horário.
3. Origem do lead (qual post do Vargas Marketing gerou a conversa).
4. Avaliar a API oficial do WhatsApp (Meta) no lugar da Z-API.
