# Loja Online — Fase 0: auditoria e proposta de arquitetura

Levantamento feito em 23/08/2026 contra o **banco de produção**, não por
leitura de migration nem por dedução do código. Onde há número, ele foi
medido; onde não deu para medir, está dito.

Este documento para antes de qualquer alteração estrutural, de propósito.

> **A Fase 1 foi executada em 24/08/2026.** O que foi entregue, o que os
> testes acharam e o que ficou pendente está em
> [`loja-online-fase1.md`](loja-online-fase1.md). Três pontos deste documento
> mudaram na prática: as páginas da loja são **dinâmicas com cache de dado**,
> e não ISR (o hostname obriga); o *Middleware* do Next 16 chama-se **Proxy**
> (`src/proxy.ts`); e `robots.ts` só funciona na raiz de `app/`.

> **Decisões tomadas em 24/08/2026** — as seis perguntas em aberto da §12
> foram respondidas. Estão consolidadas na §12 e já refletidas nas §5.1,
> §6 (R3), §7.4 e §8. Em resumo: piloto na **Bazar Eficaz**, acesso por
> **subdomínio**, estoque com **seção própria de configuração** (depósito
> padrão, depósito específico ou soma do grupo), comportamento de item sem
> estoque **configurável**, publicação **100% curada pelo usuário — com ou
> sem foto**, e retirada na loja na **Fase 3**.

---

## 1. O que encontrei

### 1.1 Stack e infraestrutura

| Item | Estado |
|---|---|
| Framework | Next.js **16.2.9**, App Router, React 19.2.4 |
| Linguagem | TypeScript 5, ESLint 9 |
| Estilo | Tailwind **v4** (`@tailwindcss/postcss`), tema no `globals.css` |
| Banco/Auth | Supabase (`@supabase/ssr` 0.12, `supabase-js` 2.110) |
| Hospedagem | Vercel, região `gru1`, 8 crons declarados em `vercel.json` |
| Outros | `@anthropic-ai/sdk`, `@react-pdf/renderer`, `sharp`, `recharts`, `jsbarcode`, `qrcode` |

> **Correção (24/08):** a frase original desta seção dizia que não existia
> camada de proxy. Estava **errada** — eu procurei por `src/middleware.ts`, que
> de fato não existe, e não por `src/proxy.ts`, que existe e é essencial:
> renova a sessão do Supabase, envia o `x-pathname` que o layout do dashboard
> usa e faz o controle de acesso por tela. O erro foi pego ao ver o arquivo
> marcado como *modificado* no git durante a Fase 1.

Existe uma camada de proxy em `src/proxy.ts` (o que o Next 15 chamava de
middleware), com `matcher` estreito: `/dashboard`, `/pdv`, `/saas-admin` e
`/login`. Não existem testes. `cacheComponents` está
**desligado** e praticamente toda tela do dashboard declara
`export const dynamic = 'force-dynamic'` — ou seja, hoje o sistema é
100% dinâmico e não usa cache do Next em lugar nenhum.

Cabeçalhos de segurança já configurados em `next.config.ts` (HSTS, nosniff,
X-Frame-Options, Referrer-Policy, Permissions-Policy). CSP deliberadamente
ausente, com justificativa escrita no arquivo.

### 1.2 Banco

**139 tabelas e views** no schema `public`.

**Hierarquia multiempresa** (existe e funciona):

```
tenants (2)
  └── grupos_empresariais (2)
        └── empresas (2)
              └── usuario_empresas  (vínculo usuário × empresa, com perfil)
```

- Tenant `Grupo Vargas` (`b0000000-…-0001`), plano profissional.
- Tenant `Bazar Ouro e Prata` (`9d377b33-…`), plano essencial — **sem empresa
  vinculada**: as duas empresas (`Bazar Eficaz` e `BAZAR OURO E PRATA`)
  apontam para o tenant Grupo Vargas e para o mesmo grupo. As duas também
  estão marcadas `empresa_principal = true`. É inconsistência de dado, não
  de modelo — vale corrigir antes de a loja usar tenant como chave.

**Resolução de empresa ativa:** `src/lib/auth/empresaAtiva.ts`. Cookie
`empresa_ativa` conferido no servidor contra `usuario_empresas` a cada
requisição; cookie forjado é ignorado em silêncio. Ponto único de decisão,
bem feito — a loja deve usar o mesmo padrão.

**Funções de RLS** (SECURITY DEFINER, já existentes):
`minha_empresa_id()`, `empresa_do_meu_grupo(uuid)`, `meu_tenant_id()`,
`is_system_admin()`.

**Permissões:** papéis fixos (`admin | gerente | financeiro | estoque |
vendas | leitura`) em `src/lib/auth/permissoes.ts`, exceções por usuário em
`usuario_permissoes`, e **módulos por plano** (`plans` / `plan_modules`,
registry em `src/lib/plans/modules.ts`). Já existe a máquina de ligar/desligar
um módulo por assinatura — é aí que o módulo "Loja Online" entra.

### 1.3 Catálogo — os números que governam o projeto

| Medida | Bazar Eficaz | Ouro e Prata |
|---|---:|---:|
| produtos (total) | 14.482 | 14.110 |
| ativos | 14.252 | 14.110 |
| ativos com preço > 0 | 12.697 | 12.573 |
| **ativos com estoque > 0** | **518** | **0** |
| ativos com `foto_url` | 1.881 | 0 |
| ativos com `descricao_marketplace` | 21 | 0 |
| ativos com EAN | 14.104 | 14.002 |
| ativos com marca | 13.687 | 13.550 |
| ativos com categoria | 13.949 | 13.821 |
| ativos com **subcategoria** | 96 | 59 |
| em promoção | 157 | 77 |
| categorias | 99 | 101 |
| marcas | 720 | 0 |
| linhas em `produto_imagens` | 277 | 0 |
| clientes | 64 | 0 |

**O número que decide o escopo da primeira entrega:**

- ativo + preço > 0 + estoque > 0 ................ **507**
- ativo + preço > 0 + estoque > 0 + foto ......... **185**
- ativo + preço > 0 + foto (sem exigir estoque) .. **1.738**

Uma loja que esconda produto sem estoque abre com ~500 itens; exigindo foto,
com 185. Isso não é defeito da loja — é o mesmo problema já registrado no
`CONTINUIDADE.md`: a loja tem mercadoria, o sistema não sabe. **A qualidade
do catálogo é o gargalo real deste projeto, não o código.**

**Estrutura do produto** — `produtos` tem 56 colunas e mistura, na mesma
linha, dado público e dado interno: `preco_custo`, `markup`, `obs_interna`,
`codigo_fornecedor`, `fornecedor_padrao_id` convivem com `nome` e
`preco_venda`. Qualquer exposição precisa ser por lista branca de colunas,
nunca por `select('*')`.

- **Categoria e subcategoria são TEXTO** (o nome), não chave estrangeira.
  A tabela `categorias` existe, tem `pai_id` e 200 linhas, mas o produto
  guarda o nome. Há duplicatas e acentos quebrados (documentado).
  Trocar por FK é outro projeto — a loja tem de conviver com texto.
- **Imagens:** `produtos.foto_url` (a principal, 1.881 ativos) mais
  `produto_imagens` (277 linhas). Dessas, **apenas 68 estão no bucket
  próprio** (`produto-imagens`, público, 5 MB, jpeg/png/webp/gif). O resto
  são *hotlinks* de CDN de terceiro: `cf.shopee.com.br`,
  `dcdn-us.mitiendanube.com`, `cdn.awsli.com.br`, site de fornecedor.
  Isso é risco de vitrine: link de terceiro quebra sem aviso.
- **Preço:** `preco_venda`, `preco_promocional` + `promocao_inicio/fim` +
  `promocao_ativa`, `precos_quantidade` (jsonb, três faixas de atacado, já
  aplicadas no PDV). Não existe preço PIX no produto (existe na precificação
  de marketplace).
- **Sem campo de descrição para consumidor.** `descricao_marketplace` tem 21
  produtos preenchidos e nasceu para os canais.

### 1.4 Estoque

Duas fontes que não batem:

- `produtos.estoque` — escalar por produto.
- `produto_estoque` — por depósito (28.748 linhas).

**540 produtos divergem** entre as duas (medido em 14/08, registrado no
`CONTINUIDADE.md`, correção em massa não autorizada).

Depósitos: 3 no total, **2 ativos** (`Padrão` da Eficaz, `Depósito Principal`
da Ouro e Prata). O `Principal` da Eficaz está inativo e zerado.

`empresa_config_estoque` da Bazar Eficaz:
`reservar_em_pedido: true`, `reservar_em_orcamento: false`,
`baixar_estoque_em: 'pedido'`, `permite_estoque_negativo: false`,
`estoque_unificado_ativo: true`.

**Achado importante: esses três campos não são lidos por código nenhum.**
`grep` em todo o `src/` só os encontra no wizard de cadastro de empresa —
são toggles que gravam e nunca são consultados.

**Não existe reserva de estoque em lugar nenhum do sistema.** O campo
`marketplace_anuncios.estoque_reservado` tem nome enganoso: é o estoque
*publicado no canal*, não reserva.

O que existe hoje, em `src/lib/produtos/estoque.ts`, é baixa com
compare-and-swap e reivindicação por `baixou_estoque = false`, e o comentário
declara a escolha explícita: **deixa o estoque ir negativo de propósito**,
porque prender a baixa esperando saldo é pior para pedido de marketplace já
vendido. Isto é: o sistema hoje **absorve** overselling em vez de preveni-lo.
Para a Loja Online — onde o cliente escolhe na vitrine — essa escolha não
serve, e é a fatia estrutural mais delicada de toda a Fase 1.

Existe `estoque_movimentacoes` (2.886 linhas) como trilha, com logger
compartilhado (`src/lib/produtos/movimentacao.ts`) e tipos padronizados.

### 1.5 Canais de venda

`marketplace_canais` — **5 canais, todos da Bazar Eficaz**:

| nome | plataforma | anúncios | mapeados | com descrição | ativos |
|---|---|---:|---:|---:|---:|
| ML Eficaz | mercadolivre | 5.471 | 229 | 0 | 298 |
| Shp Eficaz | shopee | 795 | 120 | 795 | 545 |
| Shp Ouro | shopee | 486 | 139 | 486 | 405 |
| ML Ouro | mercadolivre | 2.228 | 218 | 1 | 293 |
| LV Eficaz | nuvemshop | 237 | 226 | 224 | 237 |

A tabela tem tudo que um canal precisa: credenciais, `deposito_id`,
`markup_canal`, `sincronizar_estoque/preco`, `debitar_estoque_vendas`,
`atualizar_estoque_canal`, cursor de varredura. **É o lugar natural da Loja
Online** — `plataforma = 'loja_online'`.

Atenção: `vendas.canal` é uma coluna de **texto livre** e independente disso
— só tem `'PDV'` (992) e `'APP'` (8). Os dois conceitos de "canal" convivem
hoje sem se falarem.

`marketplace_regras_preco` já modela preço e estoque por canal
(`modo_preco`, `valor_preco`, `arredondamento`, `modo_estoque`,
`valor_estoque`, `deposito_id`, `estoque_complementar`, `estoque_risco`,
`considerar_subsidio_pix`). É reutilizável quase inteiro.

`produto_canal_preferencias` (`nao_anunciar` por produto × canal) já existe e
está vazia — é metade da regra de publicação da loja.

### 1.6 Pedidos / OMS

O mesmo conceito vive em duas tabelas:

- `vendas` (1.863) — PDV e app.
- `marketplace_pedidos` (1.430) + `marketplace_pedido_itens` (com
  `produto_id`, `baixou_estoque`, `status_mapeamento`) + `..._pacotes`.

Unificadas **só na leitura** por `src/lib/pedidos/unificado.ts`
(`PedidoUnificado`, `calcularIndicadores`).

Ciclo de vida próprio, já implantado e no ar
(`supabase-pedidos-ciclo-vida.sql`):

```
novo → separando → embalado → despachado → concluido
                                   (+ cancelado a qualquer momento)
```

em `etapa_operacional` nas **duas** tabelas, com transições validadas em
`src/lib/pedidos/etapas.ts` e linha do tempo append-only em `pedido_eventos`
(369 eventos). A etapa avança sozinha quando o canal informa envio/entrega e
**nunca retrocede**.

Existe também `/dashboard/pedidos-ecommerce` (tela dedicada a pedidos de
canal), `entregas` (entrega de venda de balcão, com endereço, turno e status)
e `separacoes`.

**Conclusão: o OMS já existe e está pronto para receber mais um canal.** Não
há nada a construir aqui — há a reutilizar.

### 1.7 Clientes

`clientes` (64) + `cliente_enderecos_entrega` + `cliente_contatos`.
Já traz CPF/CNPJ, telefone, whatsapp, e-mail, endereço, crédito, fiado,
`opt_out_whatsapp`, `alerta_pedido_whatsapp`, e mesclagem
(`mesclado_em`, com redirecionamento de lançamentos).

**Nenhum cliente tem usuário em `auth.users`.** Cliente do ERP é um cadastro,
não uma identidade autenticável. "Minha conta" na loja é, portanto, coisa
nova — mas o *cadastro* não deve ser duplicado.

### 1.8 Filas, webhooks e integrações

- `marketplace_fila` — fila por *dirty flag* de produto, com `prioridade`,
  `tentativas`, `ultimo_erro`, teto por rodada, **modo simulação** e
  desistência após 5 falhas (`src/lib/marketplace/fila.ts`). Padrão maduro,
  já testado em produção.
- Crons Vercel (8): sync de anúncios (20 min), pedidos (10 min), fila
  (5 min), automações (5 min), Shopee (4h), fornecedores (5h30), reposição
  (6h), reposição IA (6h30). Todos autenticados por
  `Authorization: Bearer ${CRON_SECRET}`.
- Webhooks de entrada: `/api/marketplace/{shopee,mercadolivre,nuvemshop}/notificacoes`
  e `/push`.
- WhatsApp: **Z-API**, com `whatsapp_config` (por empresa), `whatsapp_modelos`,
  `whatsapp_mensagens` (880 enviadas, com status de entrega e retries),
  `src/lib/zapi.ts` e edge function `enviar-whatsapp-pdv`. Já envia alerta de
  pedido por cliente. **Não duplicar nada disto.**
- IA: `@anthropic-ai/sdk` já em uso (`src/lib/ia/claude.ts`) para gerar
  título/descrição de anúncio, sugerir categoria e analisar imagens.

### 1.9 Fiscal e financeiro

Só **NFC-e (modelo 65)**, provedores BrasilNFe/FocusNFe. NF-e não existe.
49 produtos com CFOP 5403, que a NFC-e recusa — decisão de conversão tomada e
não implementada, à espera do contador. Financeiro completo
(`contas_receber` 170, `contas_pagar` 128, `creditos_cliente`,
`renegociacoes`, `recebimentos`). Mercado Pago só para assinatura do SaaS
(`/api/mercadopago/criar-assinatura`), **não** para checkout de cliente final.

### 1.10 Frontend — o que existe hoje

**Não existe design system.** `src/components/ui/` contém **um** arquivo:
`botao.ts`, um helper de classes Tailwind com variantes e altura fixa. Não há
componente compartilhado de input, card, modal, badge, skeleton, estado vazio
ou toast. Nenhuma biblioteca de UI. O tema em `globals.css` é de ERP: fundo
`#f1f5f9`, sidebar `#0f172a`.

Rotas públicas existentes: `/` (landing do SaaS), `/blog`, `/blog/[slug]`
(única rota com `generateMetadata` do projeto inteiro), `/privacidade`.

Mobile: viewport corrigido, menu em gaveta abaixo de `md`. Pendência
registrada: 82 tabelas sem `overflow-x-auto` e ~144 grids sem prefixo
responsivo.

---

## 2. Segurança — o achado que governa este projeto

Medido **agora**, contra produção, com a chave `anon` pública (a que vai
dentro do JavaScript de qualquer página) e **sem login**:

| tabela | linhas legíveis por anônimo | o que vaza |
|---|---:|---|
| `produtos` | 28.593 | **`preco_custo`**, `markup`, `obs_interna`, `codigo_fornecedor` |
| `produto_estoque` | 28.748 | saldo por depósito |
| `produto_imagens` | 277 | — |
| `clientes` | 64 | CPF/CNPJ, telefone, saldo devedor, bloqueios |
| `vendas` / `venda_itens` | 1.863 / 3.265 | histórico comercial inteiro |
| `usuarios_pdv` | 4 | **`senha_hash` dos operadores** |
| `estoque_movimentacoes` | 2.886 | — |
| `contas_receber` | 170 | — |
| `whatsapp_mensagens` | 880 | conteúdo e telefone de clientes |
| `produto_vinculos` | 14.109 | — |
| `fornecedor_produto` | 437 | custo por fornecedor |
| `vendedores`, `depositos`, `orcamentos`, `kit_itens`, `faltas` | todas | — |

RLS **está** ligada e funcionando em: `empresas`, `tenants`,
`grupos_empresariais`, `profiles`, `marketplace_*`, `precificacao_*`,
`fornecedores`, `sistema_integracoes`, `whatsapp_config`, `pedido_eventos`,
`contas_pagar`, `historico_precos`, `pedidos_compra`, `entregas`,
`separacoes`, `cliente_enderecos_entrega`, `cliente_contatos`.

Isto **não é novidade nem descuido escondido**: está documentado no bloco
"AINDA ABERTO" de `supabase-fechar-acesso-publico-2.sql`, com a causa
declarada — o PDV externo conecta no banco com a chave pública, sem sessão, e
ligar RLS nessas tabelas derruba o caixa. A escrita anônima já foi podada
(`supabase-fechar-escrita-anonima.sql`: sem DELETE, sem UPDATE em `vendas`),
e há RPCs `SECURITY DEFINER` estreitas dando ao terminal só o que ele precisa
(`cancelar_venda_pdv`, `editar_venda_pdv`, `criar_produto_pdv`,
`autenticar_operador_pdv`). O que resta aberto é **leitura**.

**Por que isso decide a arquitetura da loja:** hoje essa exposição existe
atrás de um sistema administrativo que ninguém divulga. Uma Loja Online é o
oposto: é feita para atrair tráfego, ser indexada pelo Google e compartilhada
no WhatsApp. Publicar a chave `anon` num site público multiplica por muito a
chance de alguém extrair a chave do bundle e varrer o banco.

**Regra inegociável da Loja Online: a vitrine não recebe a chave `anon`.**
Nenhuma chamada do navegador do consumidor vai ao Supabase. Tudo passa pelo
servidor.

Isso é bom por dois motivos: resolve o problema hoje, sem esperar o PDV
externo ser reescrito; e ainda que o PDV seja corrigido amanhã, a vitrine
continua sem chave — que é o desenho certo de qualquer jeito.

---

## 3. O que pode ser reutilizado (não recriar)

| Domínio | O que já existe | Como a loja usa |
|---|---|---|
| **Canal de venda** | `marketplace_canais` | Uma linha com `plataforma = 'loja_online'` |
| **Pedido / OMS** | `marketplace_pedidos` + `_itens` + `etapa_operacional` + `pedido_eventos` | Pedido da loja nasce aqui — zero código novo de OMS |
| **Etapas** | `src/lib/pedidos/etapas.ts` (transições, regressão proibida) | Igual, sem alteração |
| **Leitura unificada** | `src/lib/pedidos/unificado.ts` | Ganha `origem: 'loja'` |
| **Tela de pedidos de canal** | `/dashboard/pedidos-ecommerce` | Passa a listar a loja também |
| **Regras de preço/estoque por canal** | `marketplace_regras_preco` | Base do preço publicado |
| **Bloqueio por produto/canal** | `produto_canal_preferencias` (vazia) | Metade da regra de publicação |
| **Fila** | `marketplace_fila` + `src/lib/marketplace/fila.ts` | Padrão a copiar para invalidar cache da loja |
| **Cron autenticado** | `CRON_SECRET` + `vercel.json` | Expiração de reservas, sitemap, projeções |
| **Clientes** | `clientes`, `cliente_enderecos_entrega`, `cliente_contatos`, mesclagem | Cadastro único; loja não cria paralelo |
| **WhatsApp** | Z-API, `whatsapp_config/modelos/mensagens`, `src/lib/zapi.ts`, opt-out | Avisos de pedido — só chamar |
| **Estoque unificado entre empresas** | `estoque_unificado_participantes`, `src/lib/produtos/estoqueUnificado.ts` | Saldo consolidado do grupo |
| **Kit** | `kit_itens`, `src/lib/produtos/kit.ts` (`calcularKit`) | Disponibilidade de kit na vitrine |
| **Trilha de estoque** | `estoque_movimentacoes` + `registrarMovimentoEstoque` | Baixa da loja entra na mesma trilha |
| **Multiempresa** | `empresaAtiva.ts`, `empresa_do_meu_grupo()`, `usuario_empresas` | Painel da loja no ERP |
| **Módulo por plano** | `plans`/`plan_modules`/`SYSTEM_MODULES` | Módulo `loja_online` — porta do SaaS |
| **Imagens** | bucket `produto-imagens` (público), `src/lib/imagens/converter.ts`, `sharp` | Vitrine |
| **RPC estreita p/ anônimo** | padrão `SECURITY DEFINER` + `GRANT EXECUTE ... TO anon` | Se algum dia a loja precisar falar direto com o banco |
| **Conteúdo comercial pronto** | 1.505 anúncios Shopee/Nuvemshop **com descrição e imagens** | Semente do conteúdo de vitrine |

Esse último item merece destaque: Shopee e Nuvemshop já têm título,
descrição e galeria curados para consumidor final em 1.505 anúncios, dos
quais 485 já estão mapeados a produto. É a forma mais barata de a loja
nascer com conteúdo de verdade em vez de nome de ERP em caixa alta
(`TUBO SOLDAVEL  20MM   6 METROS`).

---

## 4. O que precisa ser adaptado

1. **`marketplace_pedidos` ganha colunas** (aditivas, sem migração
   destrutiva): `cliente_id` (FK `clientes`), `modalidade_entrega`
   (`entrega | retirada`), `deposito_retirada_id`, `pagamento_metodo`,
   `pagamento_status`, `carrinho_id`. Hoje a tabela guarda o cliente como
   texto solto — pedido de loja precisa apontar para o cadastro.
2. **`unificado.ts`** ganha `'loja'` em `OrigemPedido`, rótulo e cor.
3. **`marketplace_canais`** aceita `plataforma = 'loja_online'`; o código
   que hoje trata "tudo que não é ML é Shopee" precisa reconhecer o canal
   novo e **recusar** operações de marketplace nele (a loja não tem
   `access_token` nem sync).
4. **`produto_canal_preferencias`** passa a valer também para a loja.
5. **`categorias`**: a loja precisa da árvore, mas o produto guarda o nome.
   A camada de comércio resolve nome → nó da árvore; não trocar por FK agora.
6. **Imagens hotlinkadas**: rotina para copiar para o bucket próprio as
   imagens de produto publicado. Vitrine não pode depender de CDN de
   terceiro.
7. **`estoque_movimentacoes`**: novo tipo `venda_loja`.
8. **Cabeçalhos**: a loja precisa de CSP própria e `Permissions-Policy` com
   `payment=()` revisto quando houver pagamento. O `next.config.ts` hoje
   aplica um bloco único a `/:path*`.

---

## 5. O que precisa ser criado

### 5.1 Tabelas novas (todas `empresa_id` + RLS desde o primeiro dia)

| Tabela | Papel |
|---|---|
| `loja_config` | Uma linha por canal-loja. Identidade (nome, logo, favicon, descrição, contato, WhatsApp, endereço, redes), `subdominio`, tema (cores dentro de uma paleta controlada) e a **seção Estoque** detalhada em §5.4. |
| `loja_estoque_depositos` | Quais depósitos participam quando o modo é `depositos_selecionados`. Uma linha por depósito, com ordem de preferência (serve depois para decidir de onde separar). |
| `loja_produtos` | Publicação por produto × loja. **Não duplica o catálogo** — guarda só o que é do canal: `status` (`nao_publicado / rascunho / publicado / pausado`), `slug`, `nome_comercial`, `descricao_curta`, `descricao_completa`, `caracteristicas` (jsonb), `especificacoes` (jsonb), `palavras_chave`, `seo_title`, `meta_description`, `imagem_principal_url`, `ordem`, `preco_loja` (opcional), `preco_pix`, `promo_inicio/fim`. Preço e estoque continuam vindo do ERP. |
| `loja_produto_imagens` | Galeria específica da loja, com ordem e alt. |
| `loja_categorias` | Vitrine da árvore: nó publicado, imagem, slug, ordem, destaque. Aponta para `categorias.id`. |
| `loja_banners` | Hero e banners intermediários, com janela de vigência e posição. |
| `loja_blocos_home` | Blocos configuráveis (mais vendidos / ofertas / novidades / seleção manual), com ordem e ativação. |
| `estoque_reservas` | **A peça estrutural que não existe.** `produto_id`, `empresa_id`, `deposito_id`, `canal_id`, `quantidade`, `referencia_tipo/id`, `status` (`ativa / consumida / expirada / cancelada`), `expira_em`. Genérica de propósito: serve loja, PDV, orçamento e marketplace. |
| `loja_carrinhos` + `loja_carrinho_itens` | Carrinho persistente. Visitante por token anônimo em cookie httpOnly; cliente autenticado por `cliente_id`. |
| `loja_eventos` | Analytics próprio, sem PII: visualização, busca, ver produto, adicionar ao carrinho, iniciar checkout, comprar. Alimenta recomendação e IA depois. |
| `loja_clientes_acesso` | Ponte entre `auth.users` e `clientes` para "Minha conta" — **sem** duplicar o cadastro. |

### 5.2 Banco — funções e índices

- `estoque_disponivel(produto_id, deposito_ids[])` — função única:
  `físico − reservado − segurança`. Passa a ser a **única** resposta para
  "quanto posso vender", para todos os canais.
- `reservar_estoque(...)` / `liberar_reserva(...)` / `consumir_reserva(...)`
  em `SECURITY DEFINER`, com trava de linha, para não repetir o
  compare-and-swap em JavaScript.
- **Busca**: hoje não existe infraestrutura nenhuma — nem `pg_trgm`, nem
  `unaccent`, nem `tsvector`, nem índice GIN além de `produtos.tags`. A busca
  atual é encadeamento de `ilike`. Criar: extensões `unaccent` + `pg_trgm`,
  coluna gerada `busca tsvector` (nome + SKU + EAN + marca + categoria +
  palavras-chave, com pesos), índice GIN, índice trigram no nome para tolerar
  erro de digitação, e RPC `loja_buscar(loja_id, termo, filtros, ordem,
  pagina)` que devolve já paginado e sem coluna interna.
- Views `loja_vitrine_produtos` / `loja_vitrine_produto` — **lista branca de
  colunas em nível de banco**, para que custo e margem sejam impossíveis de
  vazar mesmo por erro de programação.

### 5.3 Aplicação

- `src/lib/commerce/**` — **a única porta entre a loja e o banco.** Nenhum
  componente da vitrine importa `@/lib/supabase/*` diretamente.
- `src/app/(loja)/**` — route group da vitrine, layout e tema próprios.
- `src/app/dashboard/loja-online/**` — painel de configuração no ERP.
- `src/components/loja/ds/**` — design system da loja (ver §11).

### 5.4 Seção "Estoque" da configuração da loja

Decisão de 24/08: o comportamento de estoque não é regra fixa no código, é
**configuração da loja**. Campos de `loja_config`:

| Campo | Valores | Padrão no piloto | Observação |
|---|---|---|---|
| `estoque_modo` | `deposito_padrao` · `depositos_selecionados` · `grupo_unificado` | `deposito_padrao` | `grupo_unificado` **reutiliza** o que já existe: `empresa_config_estoque.estoque_unificado_ativo`, `estoque_unificado_participantes` e `src/lib/produtos/estoqueUnificado.ts`. Não é motor novo. |
| `estoque_deposito_id` | FK `depositos` | `Padrão` (`7a9ad817…`) | Usado quando o modo é `deposito_padrao`. |
| `estoque_fonte` | `produto_estoque` · `produtos` | `produto_estoque` | Enquanto os 540 divergirem (R4), a escolha importa. Fica visível na tela, com o número da divergência do dia ao lado — em vez de ser decisão escondida. |
| `estoque_seguranca` | inteiro ≥ 0 | `0` | Retido de toda venda online. Override por produto em `loja_produtos.estoque_seguranca`. |
| `permitir_venda_sem_estoque` | bool | `false` | |
| `sem_estoque_comportamento` | `ocultar` · `mostrar_indisponivel` | `mostrar_indisponivel` | Decisão de 24/08. Vale para listagem e busca; a página do produto **sempre** existe (senão quebra link compartilhado e SEO — ver §5.5). |
| `limite_maximo_por_compra` | inteiro ou nulo | nulo | Override por produto. |

Com `estoque_modo = grupo_unificado`, a soma respeita
`estoque_unificado_participantes` da empresa — nunca varre o grupo por conta
própria. É o mesmo saldo que o resto do sistema já enxerga; a loja não pode
inventar um terceiro número.

`estoque_disponivel()` recebe a configuração resolvida, não o `deposito_id`
solto:

```
estoque_disponivel(loja_id, produto_id)
  = saldo(conforme estoque_modo/fonte)
  − reservas ativas (estoque_reservas)
  − estoque_seguranca (do produto, ou o da loja)
```

### 5.5 Publicação curada, inclusive sem foto

Decisão de 24/08: quem escolhe o que sobe é o usuário, produto a produto —
com ou sem foto. Isso tem duas consequências que não são detalhe de tela.

**A vitrine precisa de um estado "sem foto" que não pareça defeito.**
Nada de ícone de imagem quebrada nem de "placeholder.png" cinza. O card sem
foto usa um bloco tipográfico com a marca e o nome curto do produto, na
paleta da loja. Fica discreto e legível ao lado de um card com foto — porque
vão conviver na mesma grade desde o primeiro dia.

**O painel precisa mostrar prontidão, não bloquear.** Cada produto na tela de
publicação exibe o que falta (foto · descrição · preço · estoque · EAN) como
informação, e a publicação acontece do mesmo jeito se o usuário quiser. O
sistema avisa; não decide. É o mesmo princípio da tela de Qualidade dos
Anúncios, que já lista faltas sem impedir nada.

Publicação individual, em massa, e por seleção de categoria, subcategoria ou
marca. Estado por produto: `nao_publicado · rascunho · publicado · pausado`.

---

## 6. Riscos encontrados

| # | Risco | Gravidade | Mitigação proposta |
|---|---|---|---|
| R1 | Chave `anon` lê `produtos.preco_custo`, `clientes`, `vendas` e `usuarios_pdv.senha_hash` sem login | **Crítico** | Vitrine **nunca** recebe chave Supabase. Todo acesso via servidor, por lista branca de colunas + views. Não depende de consertar o PDV externo. |
| R2 | Não existe reserva de estoque; o sistema absorve overselling de propósito | **Alto** | `estoque_reservas` + `estoque_disponivel()` como fatia própria da Fase 1, antes de qualquer checkout. |
| R3 | Só 518 produtos com estoque > 0 e 185 com foto | **Alto** (produto, não código) | **Resolvido por decisão (24/08):** publicação é curada pelo usuário, item a item, com ou sem foto. O tamanho da loja passa a ser escolha, não consequência. Exige o estado "sem foto" bem desenhado (§5.5). Inventário continua sendo decisão do Silvano. |
| R4 | 540 produtos com `produtos.estoque` ≠ `produto_estoque` | Alto | A loja lê **uma** fonte, definida em `loja_config`. Não introduzir terceira leitura. |
| R5 | Imagens hotlinkadas de CDN de terceiro (209 de 277) | Médio | Copiar para o bucket ao publicar. |
| R6 | Categoria/subcategoria como texto duplicado e com acento quebrado | Médio | Vitrine navega por `loja_categorias` (curada), não pelo texto cru. |
| R7 | `cacheComponents` desligado e ~100 telas `force-dynamic` | Médio | **Não** ligar `cacheComponents` globalmente — quebraria o ERP. Usar `revalidate` por segmento + `unstable_cache`/`revalidateTag`, que o Next 16 mantém para quem não usa Cache Components. |
| R8 | Fiscal só emite NFC-e; venda com entrega para outro estado pede NF-e | Médio | Fase 1 não emite nota. Retirada e entrega local primeiro. Decidir com o contador. |
| R9 | Dois `empresa_principal = true` no mesmo grupo; tenant "Ouro e Prata" sem empresa | Médio | Corrigir o dado antes de a loja usar tenant como chave de isolamento. |
| R10 | Pico de tráfego público sobre o mesmo Supabase do PDV | Médio | Cache agressivo + ISR; a vitrine quase não toca o banco em regime. |
| R11 | LGPD: carrinho e checkout criam dado de pessoa física novo | Médio | Sem PII em log e em `loja_eventos`; política de privacidade da loja; reaproveitar `opt_out_whatsapp`. |
| R12 | Nenhum design system; risco de a loja "parecer ERP" | Médio | DS da loja antes das telas (§11), tokens próprios, sem herdar `globals.css` do ERP. |
| R13 | O acesso por subdomínio exige alargar o `matcher` do `src/proxy.ts` existente, que hoje só cobre as rotas do ERP | Médio | Introduzir com `matcher` restrito e **saída antecipada por host**: requisição que não vem de subdomínio de loja retorna antes de qualquer trabalho. O ERP não pode pagar latência por isso. Ver §7.4. |

---

## 7. Arquitetura proposta

### 7.1 Princípio

Três camadas, com **uma única porta** entre a vitrine e o ERP.

```
┌──────────────────────────────────────────────────────────────┐
│  CONSUMIDOR — navegador / WhatsApp / Google                   │
│  Não recebe chave de banco. Nenhuma. Nunca.                   │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTML (SSR/ISR) + JSON de rotas próprias
┌───────────────────────────▼──────────────────────────────────┐
│  VITRINE — src/app/(loja)/**   [Next 16, Vercel gru1]         │
│  Layout, tema e design system próprios. Server Components.    │
│  Proibido importar @/lib/supabase/* e @/components/** do ERP. │
└───────────────────────────┬──────────────────────────────────┘
                            │ só chamadas de servidor
┌───────────────────────────▼──────────────────────────────────┐
│  CAMADA DE COMÉRCIO — src/lib/commerce/**                     │
│  catalogo · busca · preco · disponibilidade · carrinho ·      │
│  checkout · pedido · cliente · loja(config/tema)              │
│  Lista branca de colunas. Cache por tag. Resolve a loja pelo  │
│  domínio/slug — nunca por id fixo de empresa.                 │
└───────────────────────────┬──────────────────────────────────┘
                            │ service role (servidor) + RPC SECURITY DEFINER
┌───────────────────────────▼──────────────────────────────────┐
│  SUPABASE                                                     │
│  views loja_vitrine_*  ·  RPC loja_buscar / estoque_*         │
│  loja_config · loja_produtos · estoque_reservas · carrinhos   │
│                     ↕ (referência, nunca cópia)               │
│  ERP: produtos · produto_estoque · categorias · marcas ·      │
│       clientes · marketplace_canais · marketplace_pedidos     │
└──────────────────────────────────────────────────────────────┘
                            ▲
┌───────────────────────────┴──────────────────────────────────┐
│  PAINEL LOJA ONLINE — /dashboard/loja-online                  │
│  Sessão do ERP, RLS de sempre, módulo por plano.              │
└──────────────────────────────────────────────────────────────┘
```

### 7.2 Fluxo do pedido — reusando o OMS que já existe

```
Cliente na vitrine
   ↓  carrinho (loja_carrinhos)
Início de checkout
   ↓  estoque_reservas  (reserva temporária, expira por cron)
Pedido confirmado
   ↓
marketplace_pedidos (canal plataforma='loja_online')
   ↓  entra automaticamente em /dashboard/pedidos-ecommerce
   ↓  e em /dashboard/pedidos pela leitura unificada
etapa_operacional: novo → separando → embalado → despachado → concluido
   ↓  consumir_reserva() → baixa em estoque_movimentacoes (tipo venda_loja)
   ↓  WhatsApp por etapa (Z-API existente)
   ↓  Fiscal (fase posterior)
Entrega ou Retirada
```

O ganho: **nada de OMS novo.** O pedido da loja aparece nas telas de pedidos
no mesmo dia em que a primeira venda acontecer.

### 7.3 Por que no mesmo repositório

Avaliei separar em outro projeto Vercel. Recomendo **mesmo repositório, route
group isolado**:

- reaproveita `lib/` (WhatsApp, etapas, kit, estoque unificado, imagens) sem
  publicar pacote nem duplicar código;
- um deploy, um conjunto de crons, um `CRON_SECRET`;
- o isolamento que importa é o de **dados e de chave**, e esse é garantido
  pela camada de comércio, não pela separação de repositório.

O que precisa ser regra escrita, não confiança: **a vitrine não importa nada
de `src/components/**` nem de `@/lib/supabase/*`.** Vale um teste de lint que
falhe o build se isso acontecer.

### 7.4 Multiempresa, subdomínio e SaaS — sem hardcode

A loja **nunca** recebe `empresaId` fixo. A cadeia é sempre:

```
host (subdomínio)  →  loja_config  →  canal_id  →  empresa_id  →  grupo  →  tenant
```

Toda função de `src/lib/commerce/**` recebe `lojaId` como primeiro argumento.
Cada loja isolada por `empresa_id` + RLS. Módulo `loja_online` em
`SYSTEM_MODULES` e `plan_modules` — é assim que a loja vira item de plano
quando o SaaS abrir para clientes.

**Roteamento por subdomínio (decisão de 24/08).** Piloto em
`bazareficaz.<domínio>`; a mesma mecânica atende qualquer cliente do SaaS
depois, sem código novo — basta uma linha em `loja_config`.

> **Atenção — mudança do Next 16:** *Middleware* passou a se chamar **Proxy**.
> O arquivo é `src/proxy.ts` (não `middleware.ts`), com `export function proxy`
> ou default export. A funcionalidade é a mesma. Confirmado em
> `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`.

O `proxy.ts` faz **uma coisa só**: lê o `host`, e se for subdomínio de loja,
reescreve para `/(loja)/…` injetando o slug. Três cuidados que não são
opcionais:

1. **Saída antecipada.** Host do ERP (apex e `www`) retorna `NextResponse.next()`
   na primeira linha. O painel não pode ficar mais lento por causa da loja.
2. **`matcher` restrito**, excluindo `/_next`, `/api`, `/dashboard`, `/pdv` e
   arquivos estáticos.
3. **Sem consulta ao banco no proxy.** A documentação é explícita: proxy não
   serve para busca lenta de dados, e `fetch` com cache não tem efeito ali. O
   slug é passado adiante por cabeçalho reescrito; quem resolve
   `slug → loja_config` é a camada de comércio, com cache.

Na Vercel, um domínio curinga (`*.<domínio>`) cobre todas as lojas sem
cadastro por loja. Certificado é emitido automaticamente.

### 7.5 Cache e performance

`cacheComponents` **fica desligado** (ligar quebraria as telas `force-dynamic`
do ERP). O Next 16 mantém o modelo anterior, que é o que vamos usar:

| Conteúdo | Estratégia | Invalidação |
|---|---|---|
| Home, categorias, marcas | ISR, `export const revalidate = 300` | `revalidatePath` ao salvar no painel |
| Página de produto | ISR + `generateStaticParams` dos mais vistos | tag `loja:{id}:produto:{slug}` |
| Preço e disponibilidade | `unstable_cache` curto (30–60 s), em `<Suspense>` dentro da página cacheada | tag `loja:{id}:estoque:{produtoId}` |
| Busca e listagem filtrada | dinâmico, RPC paginada, debounce 300 ms no cliente | — |
| Carrinho e checkout | sempre dinâmico | — |

Invalidação por fila, copiando `marketplace_fila`: quem mexe em preço ou
estoque marca o produto sujo; um cron chama `revalidateTag`. Não invalidar
síncrono no meio de uma venda de PDV.

Imagens: `next/image` + bucket próprio + AVIF/WebP + `sizes` correto +
`priority` só na primeira dobra. Nada de servir 1024×1024 para card de 160 px
no celular.

---

## 8. Frontend — estrutura proposta

```
src/app/(loja)/
  layout.tsx                    tema da loja, fontes, metadata base
  page.tsx                      Home
  buscar/page.tsx               resultados
  c/[...caminho]/page.tsx       categoria e subcategoria
  produto/[slug]/page.tsx       página do produto
  carrinho/page.tsx
  sitemap.ts  robots.ts  opengraph-image.tsx
  _componentes/                 Header, Busca, CardProduto, Galeria, ...

src/components/loja/ds/         design system da loja
src/lib/commerce/               catalogo, busca, preco, disponibilidade,
                                carrinho, pedido, cliente, loja
src/app/dashboard/loja-online/  painel no ERP
```

Mobile first de verdade: a folha de estilo base é a do celular; `sm:`/`md:`/
`lg:` **acrescentam**. Nada de desktop que encolhe.

---

## 9. Fases

| Fase | Conteúdo | Resultado |
|---|---|---|
| **0** | Este documento | Arquitetura validada |
| **1** | Fundação: `loja_config`, `loja_produtos`, camada `src/lib/commerce`, busca no banco, publicação no ERP, DS + Home/Categoria/Produto/Busca/Carrinho com dado real | **Loja navegável** |
| **2** | `estoque_reservas` + `estoque_disponivel()` para **todos** os canais | Fim do overselling |
| **3** | Checkout: identificação, endereço, entrega/retirada, pedido em `marketplace_pedidos` | Pedido de ponta a ponta, pagamento na retirada/entrega |
| **4** | Pagamento online (PIX primeiro), conciliação | Loja transacional |
| **5** | Conta do cliente, histórico, carrinho sincronizado, WhatsApp por etapa | Recorrência |
| **6** | Frete calculado, transportadoras, rastreio | Alcance |
| **7** | Recomendação e assistente de compras sobre `loja_eventos` | Diferencial |

---

## 10. Fase 1 — exatamente o que pretendo alterar

**Migrations (todas aditivas; nenhum `DROP`, nenhum `UPDATE` em dado
existente):**

1. `supabase-loja-fundacao.sql` — `loja_config` (com a seção Estoque da §5.4),
   `loja_estoque_depositos`, `loja_produtos`, `loja_produto_imagens`,
   `loja_categorias`, `loja_banners`, `loja_blocos_home`, com RLS por
   `empresa_do_meu_grupo()` desde a criação.
2. `supabase-loja-busca.sql` — extensões `unaccent` e `pg_trgm`, coluna de
   busca, índices GIN/trigram, RPC `loja_buscar(...)`.
3. `supabase-loja-vitrine-views.sql` — views de lista branca.
4. `marketplace_canais` — aceitar `plataforma = 'loja_online'` (a coluna é
   `text`; a mudança é de validação na aplicação, não de schema).

**Código novo:** `src/lib/commerce/**`, `src/app/(loja)/**`,
`src/components/loja/ds/**`, `src/app/dashboard/loja-online/**` e
`src/proxy.ts` (roteamento por subdomínio — arquivo novo, o projeto não tem
nenhum hoje; ver §7.4 quanto ao nome).

**Código existente tocado (mínimo, e listado):**

- `src/lib/pedidos/unificado.ts` — acrescentar `'loja'` a `OrigemPedido`,
  `ORIGEM_ROTULO` e `ORIGEM_COR`. Aditivo.
- `src/lib/plans/modules.ts` — registrar o módulo `loja_online`.
- `src/lib/marketplace/envio.ts` / `fila.ts` — `canalAceitaEnvio()` deve
  **recusar** `loja_online` explicitamente, para a fila não tentar enviar
  anúncio para uma loja que não tem API.
- `next.config.ts` — bloco de cabeçalhos específico para as rotas da loja
  (o atual vale para `/:path*`).
- Menu do dashboard — item "Loja Online".

**O que a Fase 1 NÃO faz** (por decisão, não por esquecimento): gateway de
pagamento, transportadora, IA generativa, avaliações, fidelidade, construtor
de temas, páginas institucionais, emissão fiscal do pedido de loja, e
qualquer alteração em PDV, app ou integrações de marketplace.

**Entrega visual da Fase 1:** Home, Busca, Categorias, Listagem, Página do
Produto e Carrinho — navegáveis, com dado real da Bazar Eficaz, servidos pela
camada segura. Checkout fica para a Fase 3.

---

## 11. Design system — antes das telas

Definir uma vez, em `src/components/loja/ds/`, e só então montar páginas:
tokens de cor (poucas, com contraste AA verificado), escala tipográfica,
espaçamento em grade de 4 px, container, raio, duas sombras, botão, input,
select, card de produto, badge, modal/drawer, skeleton, estado vazio, estado
de erro, toast.

Estados obrigatórios, desenhados junto com o *happy path*: carregando,
produto inexistente, indisponível, estoque insuficiente, busca sem resultado,
categoria vazia, carrinho vazio, erro de conexão, preço alterado durante o
checkout, estoque alterado durante o checkout, sessão expirada.

Acessibilidade não é acabamento: HTML semântico, `alt` real, foco visível,
navegação por teclado, alvo de toque ≥ 44 px, contraste medido.

---

## 12. Decisões (24/08/2026)

| # | Pergunta | Decisão | O que muda no projeto |
|---|---|---|---|
| 1 | Empresa piloto | **Bazar Eficaz** | Nenhuma simplificação: a resolução continua por `loja_config`, sem id fixo. Ouro e Prata entra depois sem código novo. |
| 2 | Endereço | **Subdomínio com o nome da empresa** (`bazareficaz.<domínio>`) | Entra `src/proxy.ts` e domínio curinga na Vercel (§7.4). É também o desenho multi-loja definitivo — não é gambiarra de piloto. |
| 3 | Estoque | **Depósito padrão da empresa, com seção própria de configuração** (depósito específico, seleção de depósitos ou soma do grupo) | Vira a §5.4. `grupo_unificado` reaproveita `estoque_unificado_participantes` e `estoqueUnificado.ts` — sem motor novo. |
| 4 | Item sem estoque | **Configurável**: ocultar ou mostrar indisponível | Campo `sem_estoque_comportamento`. Padrão do piloto: mostrar indisponível. A página do produto sempre existe, para não quebrar link e SEO. |
| 5 | Fotos | **Curadoria do usuário — sobe com ou sem foto** | Vira a §5.5. Exige estado "sem foto" bem desenhado no DS e medidor de prontidão no painel. Sem bloqueio. |
| 6 | Retirada na loja | **Fase 3**, junto com o checkout | Confirma o plano da §9. `loja_config` já nasce com o campo, desligado. |

### Consequências que valem registrar

- **A decisão 5 muda o design, não só a regra.** Se a loja pudesse exigir
  foto, o "sem foto" seria caso de borda. Como não pode, cards com e sem
  imagem convivem na mesma grade desde o primeiro dia — e o card sem foto
  precisa ser desenhado com o mesmo cuidado do outro, senão a vitrine
  inteira parece quebrada. É requisito de DS, não acabamento.
- **A decisão 3 aumenta o escopo do painel, não o do código de leitura.**
  `estoque_disponivel()` continua sendo uma função só; o que cresce é a tela
  que a configura. É o lado certo para o escopo crescer.
- **A decisão 2 tira o `proxy.ts` de "risco baixo".** É arquivo novo num
  projeto que nunca teve um, e roda em **toda** requisição. Por isso a saída
  antecipada por host e o `matcher` restrito são requisito, não recomendação.

### Ainda em aberto (não bloqueia a Fase 1)

- Nome exato do domínio e quem administra o DNS.
- `estoque_fonte` no piloto: `produto_estoque` (depósito Padrão) é o padrão
  proposto, mas os 540 produtos divergentes continuam divergentes. A tela vai
  mostrar o número; a correção em massa segue dependendo de autorização.
