# Foto do cliente

Migração `supabase/migrations/20261021120000_cliente_foto.sql`; regras em `src/lib/clientes/foto.ts`.

- **Banco:** `clientes.foto_path` (arquivo), `foto_origem` (`whatsapp` ou `manual`), `foto_em`. O caminho tem de ser `<empresa>/<cliente>/…` do próprio cliente (CHECK).
- **Arquivo:** bucket **privado** `clientes-fotos` (até 5 MB; JPG, PNG, WEBP). O logado lê, envia e apaga só na pasta da própria empresa (mesma regra das mídias do WhatsApp). A tela mostra com link assinado de 1 h.
- **Do WhatsApp, sozinha** (só se o cliente ainda não tem foto):
  - quando o cliente cadastrado escreve e a Z-API manda a foto do perfil (webhook);
  - quando a conversa é aberta e a foto do perfil é buscada;
  - logo depois de cadastrar o cliente pela conversa ou pela tela de Contatos.
- **No cadastro** (gaveta, aba Dados): **Enviar foto**, **Usar foto do WhatsApp** (pede a foto de novo à Z-API se o link estiver velho) e **Tirar**. Grava na hora.
- **Onde aparece:** lista de clientes e página do cliente.
- A foto enviada pela loja (`manual`) nunca é trocada sozinha pela do WhatsApp; só pelo botão, com confirmação.
- O servidor só baixa imagem de `whatsapp.net`, `whatsapp.com` ou `z-api.io`, em https, sem redirecionamento, até 5 MB.
- Sem foto no WhatsApp (ou foto visível só para os contatos do cliente): a tela avisa e nada muda.
