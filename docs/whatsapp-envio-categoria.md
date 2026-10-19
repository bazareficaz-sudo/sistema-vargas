# Envio por categoria (envio assistido)

Mensagem para uma categoria de clientes (ex.: Eletricistas), enviada **uma por vez** pelo WhatsApp da loja (Z-API). Tela: **Integrações → Envio por categoria** (`/dashboard/integracoes/whatsapp/envios`).

## Por que "assistido"

A Z-API não é a API oficial e o número é o mesmo do ERP e da Betina. Disparo em massa é o que mais faz o WhatsApp bloquear número. O ritmo é imposto pelo **banco** (`whatsapp_lote_reservar`), não pela tela:

- até **30 envios por dia** por empresa (todos os envios somados);
- pelo menos **45 s** entre um envio e o próximo (com bloqueio por empresa: duas telas abertas não aceleram);
- só das **8h às 20h** (Brasília);
- fica de fora: quem marcou "não quer receber WhatsApp" (conferido de novo na hora de enviar), número da equipe (destinatários da Betina), fixo ou sem DDD, cadastro unificado, e quem recebeu envio nos últimos 7 dias (pelo cliente ou pelo número);
- um por número; no máximo 500 por fila;
- **sem confirmação da Z-API = "Sem confirmação" (`incerto`) e nunca reenviado**; envio que ficou no meio por mais de 10 min também vira `incerto`.

## Como funciona

1. **Novo envio:** categoria, "quem" (todos ou quem comprou nos últimos 30/90/180/365 dias), nome e texto com `{nome}` e `{loja}`. Prévia de como chega. **Montar fila** não envia nada (`whatsapp_lote_criar`).
2. **Enviar:** botão "Enviar para Fulano" (um) ou **Envio automático** (um a cada 60–120 s, sorteado, só com a tela aberta). O automático para no limite do dia, fora do horário, no fim da fila, em erro de conexão e em qualquer envio sem confirmação.
3. Toda mensagem leva o rodapé "Para não receber mais mensagens como esta, responda SAIR." Se o cliente responder só SAIR/PARAR/STOP/"não quero receber" em até 30 dias de um envio, o webhook marca o cadastro como "não quer receber WhatsApp".
4. A mensagem entra na conversa do cliente (rótulo "Envio por categoria"); a conversa é aberta antes do envio, então a resposta cai nela.
5. Pausar, retomar e cancelar (`whatsapp_lote_status`). Cancelar tira da fila quem ainda não recebeu.

## Banco (`supabase/migrations/20261020180000_whatsapp_envio_categoria.sql`)

- `whatsapp_lotes` e `whatsapp_lote_itens`: o logado **só lê** (RLS da empresa); tudo que muda passa pelas funções `SECURITY DEFINER`, que conferem a empresa.
- `whatsapp_lotes_resumo` (view): contagem por situação para a lista.
- `whatsapp_celular()`: celular brasileiro (55 + DDD + 9…), fixo fica de fora.
- `whatsapp_lote_agora()`: a hora usada pelo ritmo (função à parte só para os testes fixarem a hora).

Rota de envio: `POST /api/whatsapp/lotes/proximo` — reserva no banco, registra em `whatsapp_mensagens` (tipo `envio_categoria`), envia pela Z-API e grava o resultado. Regras de texto em `src/lib/whatsapp/envioCategoria.ts`.

## Planejado, não implementado

- Foto junto da mensagem.
- Limite por dia configurável pela tela (hoje é fixo em 30 no banco).
- Campanhas grandes: só pela API oficial do WhatsApp (Meta), com modelos aprovados.
