# Sistema Vargas — ERP, PDV, marketplaces e Loja Online

Aplicação Next.js (App Router) sobre Supabase, publicada na Vercel. Um único
repositório atende quatro frentes:

- **ERP** (`/dashboard`) — produtos, estoque, vendas, compras, financeiro, fiscal.
- **PDV** (`/pdv`) — frente de caixa.
- **Marketplaces** — Shopee, Mercado Livre e Nuvemshop: catálogo, anúncios,
  pedidos, preço e estoque nos dois sentidos.
- **Loja Online** (`/loja`, servida por subdomínio) — vitrine própria, lendo o
  mesmo catálogo, sem duplicar produto nem saldo.

Onde o trabalho parou, e por quê, fica em [`CONTINUIDADE.md`](CONTINUIDADE.md).
Auditorias e decisões de arquitetura ficam em [`docs/`](docs).

---

## Rodar numa máquina nova

Requisitos: **Node 20+** e Git. Nada mais precisa ser instalado globalmente.

```bash
git clone https://github.com/bazareficaz-sudo/sistema-vargas.git
cd sistema-vargas
npm install
```

(Neste computador a pasta se chama `pdv-vargas-web` e mora ao lado dos outros
projetos da casa; o clone cria uma pasta com o nome do repositório. É a mesma
coisa — a raiz do repositório é onde está o `package.json`.)

Depois as variáveis de ambiente. Com a CLI da Vercel logada no projeto, o
caminho curto traz tudo já preenchido:

```bash
npx vercel link
npx vercel env pull .env.local
```

Sem acesso à Vercel, copie [`.env.example`](.env.example) para `.env.local` e
preencha à mão — o arquivo diz para que serve cada chave. **`.env.local` nunca
é versionado**, então ele não vem no clone: é sempre o primeiro passo numa
máquina nova, e é o motivo mais comum de a aplicação subir e não achar dado
nenhum.

```bash
npm run dev     # http://localhost:3000
npm run build   # o mesmo build que a Vercel roda
npx tsc --noEmit
```

`localhost` nunca é tratado como loja: o proxy só reconhece uma vitrine quando
`NEXT_PUBLIC_LOJA_DOMINIO_RAIZ` está preenchida, e falha fechado quando não
está. Em desenvolvimento, a loja abre em `/loja`.

## Banco

Projeto Supabase `ntwfkmwprjciucydedku` (o id não é segredo; as chaves são).
As migrações são arquivos `supabase-*.sql` na raiz, executados **à mão** no SQL
Editor do Supabase, em ordem de necessidade — não há `migrate` automático. Cada
arquivo abre dizendo o que faz e termina dizendo como desfazer.

Regra que já custou caro: **rodar o SQL antes de publicar o código que lê a
coluna nova.** Um `select` de coluna inexistente derruba a consulta inteira, e
com ela a tela.

## Deploy

Push na `main` publica em produção pela Vercel. Não há ambiente de homologação:
o que entra na `main` vai ao ar. Trabalho que ainda não deve ir ao ar vive numa
branch própria.

## Antes de escrever código

Leia [`AGENTS.md`](AGENTS.md). Este Next tem mudanças de contratos em relação ao
que se costuma assumir — a mais traiçoeira: *Middleware* virou **Proxy**, o
arquivo é `src/proxy.ts` e ele já existe.
