# Loja Online — Fase 1: o que foi entregue

24/08/2026. Continuação de [`loja-online-auditoria.md`](loja-online-auditoria.md)
(Fase 0). Tudo aqui foi aplicado e conferido contra o **banco de produção** e
contra a aplicação rodando — não é plano.

---

## 1. Migrations realizadas

Onze migrations, todas **aditivas**. Nenhum `DROP`, nenhum `ALTER` em tabela
do ERP, nenhum `UPDATE` em dado existente.

| # | Migration | O que faz |
|---|---|---|
| 1 | `loja_fundacao_tabelas` | 14 tabelas novas + `loja_slugify` + gatilhos de `updated_at` |
| 2 | `loja_fundacao_rls` | RLS em todas, e `REVOKE ALL ... FROM anon` tabela por tabela |
| 3 | `loja_estoque_politica` | `loja_estoque_fontes`, `_diagnostico`, `_disponivel`, `loja_expirar_reservas` |
| 4 | `loja_vitrine_busca_infra` | extensões, configuração `pt_unaccent`, índices, gatilho de indexação |
| 5 | `loja_vitrine_view_e_busca` | view de lista branca, `loja_buscar`, `loja_sugerir`, `loja_saude_catalogo` |
| 6 | `loja_publicacao_e_categorias` | `loja_semear_categorias`, `loja_publicar_produtos` |
| 7 | `loja_busca_corrigir_search_path` | conserto: operador `<%` mora em `extensions` |
| 8 | `loja_busca_relevancia` | conserto: casamento por trigrama não pode empatar com casamento real |
| 9 | `loja_busca_ordem_termo_vs_navegacao` | conserto: buscando, relevância manda; navegando, saldo manda |
| 10 | `loja_divergencia_estoque` | conta os produtos que divergem entre as duas fontes de saldo |
| 11 | `loja_imagem_vitrine_espelho` | materializa a imagem — busca de 115 ms para 34 ms |

Os arquivos correspondentes estão no repositório e **batem com o banco**:
`supabase-loja-fundacao.sql`, `-estoque.sql`, `-vitrine.sql`, `-publicacao.sql`.

## 2. Tabelas criadas

`loja_config` · `loja_estoque_depositos` · `loja_categorias` ·
`loja_categoria_origens` · `loja_produtos` · `loja_produto_categorias` ·
`loja_produto_imagens` · `loja_banners` · `loja_blocos_home` ·
`estoque_reservas` · `loja_carrinhos` · `loja_carrinho_itens` ·
`loja_eventos` · `loja_clientes_acesso`

**Nenhuma delas duplica catálogo.** `loja_produtos` é uma linha por
publicação: guarda estado, slug, texto comercial e SEO. Preço e estoque
continuam vindo de `produtos` e `produto_estoque`.

## 3. Campos criados

Só em tabelas novas. Destaques:

- **`loja_config`** — a seção Estoque inteira: `estoque_modo`,
  `estoque_deposito_id`, `estoque_fonte`, `estoque_seguranca`,
  `estoque_percentual_publicado`, `estoque_maximo_publicado`,
  `permitir_venda_sem_estoque`, `sem_estoque_comportamento`,
  `limite_maximo_por_compra`, `reserva_minutos`, `entrega_ativa`,
  `retirada_ativa`. Mais identidade, endereço, redes, SEO, cores e
  `subdominio`/`dominio_proprio`.
- **`loja_produtos`** — conteúdo comercial (`nome_comercial`,
  `descricao_curta`, `descricao_completa`, `caracteristicas`,
  `especificacoes`, `aplicacoes`, `palavras_chave`), SEO, preços do canal
  (`preco_loja`, `preco_pix`, `preco_de`), sobrescritas de política por
  produto, e os espelhos de leitura: `busca`, `busca_texto`, `preco_vitrine`,
  `marca_vitrine`, `imagem_vitrine`, `estoque_disponivel`,
  `estoque_publicavel`, `estoque_cache_em`, `loja_categoria_id`.

**Zero colunas novas em tabelas do ERP.**

## 4. Índices criados

Todos em tabelas novas.

- `idx_loja_produtos_busca` — **GIN sobre `tsvector`**. Confirmado em uso:
  `Bitmap Index Scan`, 2,2 ms.
- `idx_loja_produtos_busca_trgm` — GIN trigram, para tolerar erro de digitação.
- `idx_loja_produtos_vitrine` / `_categoria` / `_preco` / `_disponivel` /
  `_destaque` — parciais, só sobre `status = 'publicado'`.
- `idx_estoque_reservas_ativas` / `_expiracao` — parciais: reserva encerrada
  não ocupa índice.
- `idx_loja_config_subdominio` / `_dominio` — **únicos**, é o que garante que
  dois lojistas não reivindiquem o mesmo endereço.
- Mais os de chave estrangeira e ordenação de categorias, banners e blocos.

## 5. Views e RPCs

**View:** `loja_vitrine_produtos` — a lista branca. O que ela **não** tem é o
ponto: `preco_custo`, `markup`, `obs_interna`, `codigo_fornecedor`,
`fornecedor_padrao_id`, `estoque`, `estoque_minimo`, NCM, CFOP, CST, CSOSN,
alíquotas. Custo não vaza porque não existe como coluna no caminho.

**Funções** (11): `loja_slugify`, `loja_estoque_fontes`,
`loja_estoque_diagnostico`, `loja_estoque_disponivel`, `loja_expirar_reservas`,
`loja_divergencia_estoque`, `loja_produtos_indexar`, `loja_reindexar`,
`loja_atualizar_estoque_cache`, `loja_buscar`, `loja_sugerir`,
`loja_saude_catalogo`, `loja_semear_categorias`, `loja_publicar_produtos`.

Todas `SECURITY DEFINER` com `search_path` fixo, todas **negadas ao `anon`**.

## 6. Arquivos novos

```
src/lib/commerce/db.ts                    a única porta para o banco
src/lib/commerce/tipos.ts                 o que a vitrine enxerga
src/lib/commerce/loja.ts                  hostname → loja
src/lib/commerce/catalogo.ts              busca, produto, categorias, home
src/lib/commerce/carrinho.ts              conferência de preço e saldo
src/lib/commerce/admin.ts                 ponte painel ↔ loja
src/lib/marketplace/canais.ts             guarda: loja não é marketplace

src/app/loja/{layout,page,loja.css,not-found,sitemap}.ts(x)
src/app/loja/{buscar,carrinho}/page.tsx
src/app/loja/c/[[...caminho]]/page.tsx
src/app/loja/produto/[slug]/page.tsx
src/app/robots.ts

src/components/loja/ds/index.tsx          design system
src/components/loja/{CardProduto,Listagem,Cabecalho,Rodape,Galeria}.tsx
src/components/loja/{CarrinhoContexto,CarrinhoCliente,ComprarProduto}.tsx

src/app/dashboard/loja-online/{layout,page}.tsx
src/app/dashboard/loja-online/{produtos,categorias,aparencia,home,estoque,dominio,configuracoes}/page.tsx
src/components/loja-admin/{ProdutosLojaClient,CategoriasLojaClient,FormularioLoja,CriarLoja}.tsx

src/app/api/loja/{sugerir,conferir}/route.ts
src/app/api/loja-admin/{publicar,config,categorias,criar}/route.ts
src/app/api/cron/loja-manutencao/route.ts

docs/loja-online-fase1.md
docs/seguranca-fechar-acesso-anon.md
```

## 7. Arquivos existentes modificados

Sete, todos de forma aditiva:

| Arquivo | Mudança | Por quê |
|---|---|---|
| `src/proxy.ts` | roteamento por subdomínio **antes** do guarda do ERP, que ficou intacto (112 inserções, 0 remoções) | a vitrine resolve por host; o ERP continua igual |
| `src/lib/pedidos/unificado.ts` | `'loja'` em `OrigemPedido`, rótulo, cor, e reconhecimento de `plataforma='loja_online'` | pedido da loja aparecer nas telas de Pedidos na Fase 3 |
| `src/lib/plans/modules.ts` | módulo `loja_online` | ligar/desligar por plano |
| `src/components/nav-config.ts` | grupo "Loja Online" com 8 itens | menu |
| `src/lib/marketplace/envio.ts` | `canalAceitaEnvio` recusa quem não é marketplace | **impedia regressão real** (§13) |
| `src/app/dashboard/marketplaces/page.tsx` | `.neq('plataforma','loja_online')` | idem |
| `src/app/dashboard/marketplaces/anuncios/page.tsx` | `.neq('plataforma','loja_online')` | idem |
| `vercel.json` | cron `/api/cron/loja-manutencao` a cada 15 min | expirar reservas e atualizar cache |

## 8. Resolução por domínio

```
host → src/proxy.ts → cabeçalho x-loja-slug → loja_config → canal → empresa → grupo → tenant
```

**Atenção — mudança do Next 16:** o que era *Middleware* virou **Proxy**. O
arquivo é `src/proxy.ts`, não `middleware.ts`. Confirmado na documentação
embarcada.

O proxy faz uma coisa só e sai cedo:

1. lê o `host`; se não for subdomínio de loja, `NextResponse.next()` na
   primeira linha útil — o painel não paga latência pela loja;
2. `matcher` exclui `/api`, `/_next`, `/_vercel`, `favicon.ico`,
   `robots.txt` e arquivos estáticos;
3. **não consulta o banco.** A documentação é explícita: proxy não serve para
   busca lenta, e `fetch` com cache não tem efeito ali. Quem resolve
   `slug → loja_config` é a camada de comércio, com cache de 5 minutos.

Subdomínio de loja **não serve o ERP**: `/dashboard`, `/pdv`, `/login` e
`/saas-admin` redirecionam para `/` (verificado: 307).

Reservados: `www`, `app`, `admin`, `api`, `painel`, `sistema`, `suporte`,
`loja`. Domínio próprio já resolve pela mesma cadeia.

**Falta configurar** (não é código): domínio curinga `*.<domínio>` na Vercel e
a variável `NEXT_PUBLIC_LOJA_DOMINIO_RAIZ`.

## 9. Política de estoque

Configurável por loja, como pedido. Quatro modos:

| modo | de onde soma |
|---|---|
| `deposito_unico` | um depósito escolhido |
| `depositos_selecionados` | soma de `loja_estoque_depositos` |
| `empresa_consolidado` | todos os depósitos ativos da empresa |
| `grupo_consolidado` | soma do grupo, **respeitando as regras existentes** |

O modo grupo **não inventa regra nova**: reaproveita
`empresa_config_estoque.estoque_unificado_ativo`,
`estoque_unificado_participantes` e `produto_vinculos` — os mesmos que já
alimentam os anúncios de marketplace, para a loja não mostrar um terceiro
número. E acrescenta três travas que a versão de marketplace não fazia no
banco: **mesmo tenant, mesmo grupo empresarial, empresa ativa**.

A conta, e ela é aberta na tela:

```
físico − reservado − segurança = disponível
publicável = min(disponível × percentual, máximo publicado)
```

**Duas velocidades, de propósito:** a listagem usa cache
(`estoque_publicavel`, atualizado na publicação e pelo cron); a página do
produto, o carrinho e o checkout usam `loja_estoque_disponivel()` ao vivo. A
lista pode estar minutos velha; o momento da decisão de compra, nunca.

## 10. Publicação

Individual ou em massa, com busca e filtros (estado, com/sem foto, com/sem
estoque). Estados: `nao_publicado · rascunho · publicado · pausado`.

**Nunca exige foto, descrição, marca ou preço.** O sistema mede e mostra o que
falta — na barra de seleção ("na seleção: 12 sem foto e 3 sem preço"), na
coluna "Falta" de cada linha, e na Visão Geral. **Não bloqueia.** A decisão é
do usuário, como definido.

A trava que existe é outra: `loja_publicar_produtos` só aceita produto cuja
`empresa_id` é a da loja. Id de outra empresa passado na requisição não entra.

Categorias comerciais: `loja_semear_categorias` agrupa pelo texto
**normalizado** do ERP e funde as grafias duplicadas sozinha. Medido:
**54 grafias → 48 categorias**, sem um único `UPDATE` em `produtos`.

## 11. Cache

`cacheComponents` **continua desligado** — ligá-lo quebraria as ~100 telas
`force-dynamic` do ERP.

Uma correção honesta em relação ao plano da Fase 0: **as páginas da loja são
dinâmicas, não ISR.** Foi o build que mostrou — a loja é resolvida pelo
hostname, `headers()` entra na renderização, e o Next serve sob demanda. O
`export const revalidate` da página, sozinho, não guardava nada.

Então o cache é de **dado**, com `unstable_cache` + tags:

| dado | validade | tag |
|---|---|---|
| `loja_config` | 5 min | `loja-config` |
| categorias | 5 min | `loja:{id}:categorias` |
| banners, blocos da home | 5 min | `loja:{id}` |
| marcas | 10 min | `loja:{id}` |
| busca, produto, carrinho | sem cache | — |

Invalidação: `invalidarVitrine()` em todo salvamento do painel, e o cron.
`revalidateTag(tag, 'max')` — a forma de um argumento está **depreciada** no
Next 16.

Sugestões de busca: `s-maxage=60` na borda. Carrinho: `no-store, private`.

## 12. Busca

Não existia nada antes: nem `pg_trgm`, nem `unaccent`, nem `tsvector`, nem
índice GIN além de `produtos.tags`. A busca do sistema era `ilike` encadeado.

- Configuração `pt_unaccent` (`portuguese` + dicionário `unaccent`): resolve
  **acento e plural** de uma vez, e continua indexável.
- `tsvector` com pesos: A nome/SKU/EAN, B marca e palavras-chave,
  C categoria e resumo, D descrição.
- `websearch_to_tsquery`: espaço vale **E**. "tubo soldavel" exige as duas.
- Trigram para erro de digitação, com limiar **0,45** — medido nos nomes reais
  deste catálogo: erro legítimo cai entre 0,50 e 0,67 ("hidralica" 0,50,
  "torneria" 0,556), e o ruído dá 0,0. O padrão (0,6) cortava metade dos
  acertos.
- Código de barras e SKU exatos ganham prioridade absoluta.
- Índice **na tabela da loja, não em `produtos`** — e **sem gatilho em
  `produtos`**, que é a tabela onde o PDV escreve em toda venda. O preço dessa
  escolha é o cron de reindexação, e é o preço certo.

Resultados reais: `tubo soldavel` → 13 · `torneira` → 11 · `torneria` (com
erro) → 11 · `hidraulica` (sem acento) → 24 · `abraçadeira` → 14 ·
`tubos` (plural) → 19 · `xyzabc` → 0.

## 13. Segurança

**A regra central:** a vitrine pública **não recebe chave de banco nenhuma**.
Renderiza no servidor, consulta por `src/lib/commerce/db.ts` com chave de
serviço, e lê da view de lista branca.

Verificado no HTML servido de `/`, `/buscar`, `/produto/...`, `/c/...` e
`/carrinho`:

- **zero** ocorrências de `preco_custo`, `markup`, `obs_interna`,
  `codigo_fornecedor`, `senha_hash`, `cpf_cnpj`, `saldo_devedor`, `ncm`,
  `csosn`, `estoque_minimo`, `fornecedor_padrao_id`;
- **zero** tokens JWT — nenhuma chave Supabase chega ao navegador.

Verificado com a chave `anon` contra as tabelas novas: **401 em todas**
(`loja_config`, `loja_produtos`, `loja_categorias`, `estoque_reservas`,
`loja_carrinhos`, `loja_eventos`), na view e na RPC `loja_buscar`. O Supabase
concede `ALL` a `anon` em tabela nova por padrão — foi assim que o buraco
atual nasceu —, e por isso cada tabela leva um `REVOKE` explícito.

Outras camadas:

- `limpar()` em `db.ts` — rede de segurança que estoura em desenvolvimento se
  um campo interno escapar.
- Posse conferida **na rota**, não só na tela: `lojaDaSessao()` antes de toda
  escrita. RLS sozinha barraria em silêncio, e "0 linhas afetadas" é
  indistinguível de sucesso.
- Lista branca de campos na rota de configuração: um `PATCH` com
  `empresa_id` de outra empresa é descartado.
- Entrada do navegador validada item a item (UUID, quantidade, teto de 100
  itens). `precoVisto` serve para **comparar e avisar**, nunca para cobrar.
- Sem PII em log: só id da loja e mensagem de erro.
- Isolamento entre lojas testado com uma segunda loja temporária.

**O que NÃO foi fechado, e é a dívida mais séria do projeto:** o vazamento
pré-existente pela chave `anon` (28.593 produtos com custo, 64 clientes com
CPF, 1.863 vendas, `senha_hash` dos operadores). Está intocado de propósito —
mexer nisso exige tocar no PDV externo. Documentado com plano de correção em
[`seguranca-fechar-acesso-anon.md`](seguranca-fechar-acesso-anon.md).

## 14. Telas criadas

**Vitrine** (mobile first: a folha base é a do celular, `sm:`/`lg:`
acrescentam):

- **Home** — abertura, categorias, blocos configuráveis, marcas.
- **Busca** — filtros, cinco ordenações, paginação por link (indexável e
  compatível com o botão voltar).
- **Categoria** `/c/...` — trilha de navegação, subcategorias, mesma listagem.
- **Produto** — galeria, preço com riscado, disponibilidade ao vivo,
  quantidade com teto, comprar/adicionar, descrição, características,
  especificações, relacionados, JSON-LD e Open Graph.
- **Carrinho** — reconferido no servidor, com avisos de preço alterado,
  quantidade ajustada e item indisponível.
- **404** próprio.

**Design system** (`src/components/loja/ds/`): tokens escopados em `.loja`
(o `globals.css` do ERP continua carregado e é de painel), botão, preço, selo
de disponibilidade, esqueletos, estado vazio, título de seção, e o
`ImagemProduto` com o estado "sem foto".

Esse último não é detalhe: **284 dos 508 publicados não têm foto**. Cards com
e sem imagem convivem na mesma grade, então o vazio é desenhado — bloco
tipográfico com a inicial e "Foto em breve", na paleta da loja — e não um
ícone quebrado.

Grade de **dois cards por linha no celular**, não um: card de largura total
obriga a rolar demais para comparar preço, que é o que o cliente está fazendo.

**Painel** — oito abas: Visão Geral (com Saúde do Catálogo), Produtos,
Categorias, Aparência, Banners/Home, Estoque (com o diagnóstico de onde o
saldo vem), Domínio, Configurações.

## 15. Testes manuais realizados

Contra o banco de produção e a aplicação rodando:

**Busca** — acento, plural, "E" entre palavras, erro de digitação, termo
inexistente. Índice GIN confirmado em uso (`Bitmap Index Scan`, 2,2 ms).

**Estoque** — conta aberta conferida produto a produto: 1000 físicos − 5
reservados − 2 de segurança = 993 disponíveis, publicável = min(695, teto 10)
= **10**. Reserva ativa, reserva vencida e `loja_expirar_reservas` exercitadas.

**Modo grupo** — resolve Bazar Eficaz (Padrão) + Ouro e Prata (Principal). E,
com uma **segunda loja temporária** criada na Ouro e Prata (que tem a
unificação desligada): **zero** empresas somadas indevidamente, com o motivo
em português na tela. Loja temporária removida.

**Carrinho** (`/api/loja/conferir`) — quantidade normal; preço divergente →
`precoMudou`; 9999 unidades → ajustado para 1 com `quantidadeAjustada`;
entrada hostil (UUID inválido, quantidade negativa) → descartada sem erro;
`Cache-Control: no-store, private`.

**Vazamento** — cinco páginas públicas varridas: zero campos internos, zero
JWT. Tabelas, view e RPC novas: 401 para `anon`.

**Sem regressão** — ERP: landing 200, blog 200, `/dashboard` → `/login`,
`/loja` no domínio do ERP → 404. Marketplaces: as telas continuam vendo os
5 canais e não o da loja. Crons: `pedidos-sync`, `anuncios-sync`,
`mercadolivre-sync` e `shopee-sync` conferidos um a um — nenhum enxerga o
canal novo (filtram por plataforma ou exigem `access_token`, que a loja não
tem).

**Build** — `tsc --noEmit` limpo, `next build` compila, 121 páginas geradas.

### Um erro meu, e como foi pego

**Eu sobrescrevi o `src/proxy.ts` que já existia.** Na Fase 0 procurei por
`src/middleware.ts`, não achei, e escrevi na auditoria que o projeto não tinha
camada de proxy. Estava errado: `src/proxy.ts` existia e é essencial — renova a
sessão do Supabase, envia o `x-pathname` que o layout do dashboard usa para o
controle de acesso por tela, e protege `/dashboard`, `/pdv` e `/saas-admin`.

O `next build` passou mesmo assim, porque nada disso é erro de tipo. O que
pegou foi o `git status` mostrando o arquivo como **modificado** em vez de
novo, na hora de listar as mudanças para este relatório.

Corrigido mesclando: a lógica original voltou byte a byte (`git diff` do
arquivo: **112 inserções, 0 remoções**), o roteamento da loja entrou antes
dela e sai cedo, e o `matcher` ganhou a entrada da vitrine sem perder as
quatro do ERP. Reverificado: `/dashboard` sem sessão redireciona para
`/login`, landing e blog seguem 200 e não pagam consulta de autenticação.

**A lição, e vale para as próximas fases:** o build não é rede de segurança
para arquivo apagado. Antes de escrever num caminho, conferir se ele já existe
— e `git status` no fim de cada fatia pega o que o compilador não pega.

### Um defeito que só apareceu ao explicar o endereço

Perguntado qual era o endereço do catálogo, refiz o caminho do host e achei
isto: **`slugDaLoja()` devolvia o host inteiro como slug quando
`NEXT_PUBLIC_LOJA_DOMINIO_RAIZ` estava vazia** — que é exatamente o estado de
hoje.

Em produção, sem a variável configurada, `www.sistemavargas.com.br` seria
tratado como domínio próprio de uma loja: o proxy reescreveria o ERP inteiro
para `/loja/...`, `loja_config` não acharia nada, e o site cairia em **404 —
dashboard incluído**.

Nenhum teste local pegaria: `localhost` tem guarda explícita no ramo anterior,
então tudo passava.

Corrigido para **falhar fechado**: sem domínio raiz configurado, nenhum host é
loja. Conferido numa matriz de 12 casos — apex, `www`, subdomínio real,
reservado, segundo nível, domínio próprio de cliente, `.vercel.app` e
localhost.

| `DOMINIO_RAIZ` | host | vira loja? |
|---|---|---|
| (vazia) | qualquer um | **não** |
| `sistemavargas.com.br` | `www.` e apex | não |
| `sistemavargas.com.br` | `bazareficaz.` | sim |
| `sistemavargas.com.br` | `app.` (reservado) | não |
| `sistemavargas.com.br` | `a.b.` (2º nível) | não |
| `sistemavargas.com.br` | `loja.outrocliente.com.br` | sim (domínio próprio) |
| `sistemavargas.com.br` | `*.vercel.app` | não |

### Quatro defeitos achados pelos testes, e corrigidos

1. **Busca ordenava por nome quando o casamento vinha do trigrama.** `ts_rank`
   devolve 0 nesse caso. Medido: "lampada led" trazia *ABRACADEIRA PARA
   LAMPADA* antes de *LAMPADA LED BULBO*. Corrigido com três faixas de
   relevância que não se misturam.
2. **"Tem estoque primeiro" valia até quando havia termo de busca.** Isso
   escondia o item procurado só porque acabou. Agora: navegando, saldo manda;
   buscando, relevância manda e o saldo só desempata.
3. **`robots.txt` não gerava rota.** O Next só reconhece `robots.ts` na raiz
   de `app/` — diferente de `sitemap.ts`, que aceita aninhamento. Movido para
   `src/app/robots.ts`, agora consciente do host.
4. **"Últimas 1 unidades".** Concordância — é o tipo de detalhe que faz a loja
   parecer gerada por máquina.

E uma otimização que veio da medição: a view resolvia a imagem com duas
subconsultas correlacionadas por linha candidata. Materializada em
`imagem_vitrine`: **115 ms → 34 ms**.

## 16. Pontos pendentes

**Precisa de você (não é código):**

1. **DNS — é a única coisa que falta para a loja ter endereço.** Medido em
   24/08 com `vercel domains inspect`:

   | item | estado |
   |---|---|
   | `NEXT_PUBLIC_LOJA_DOMINIO_RAIZ` (produção, preview, dev) | ✅ `sistemavargas.com.br` |
   | `*.sistemavargas.com.br` atribuído ao projeto | ✅ já estava |
   | `bazareficaz.sistemavargas.com.br` atribuído ao projeto | ✅ acrescentado |
   | Nameservers do domínio | `a.sec.dns.br`, `b.sec.dns.br` — **Registro.br** |
   | Registro DNS apontando para a Vercel | ❌ falta criar |

   **O DNS do Registro.br não aceita `*` no campo Nome.** É limitação
   conhecida do serviço gerenciado deles, não erro de preenchimento — o
   curinga simplesmente não existe ali.

   Para o piloto isso não importa: uma loja precisa de um subdomínio, não de
   um curinga. No painel do Registro.br, em **DNS → Editar zona**:

   ```
   Tipo: A     Nome: bazareficaz     Valor: 76.76.21.21
   ```

   O campo Nome é relativo à zona — só `bazareficaz`, sem o domínio no fim.
   É o mesmo caminho que o apex e o `www` já usam. Propagação: de minutos a
   algumas horas.

   **Cada loja nova = mais um registro A** e mais um `vercel domains add`.
   Funciona bem para um punhado de lojas e não tem risco nenhum.

   **Quando o SaaS abrir**, aí o curinga passa a valer a pena, e o caminho é
   mover a HOSPEDAGEM do DNS para um provedor que o suporte (Cloudflare,
   Vercel), mantendo o REGISTRO no Registro.br — que permite apontar
   nameservers externos. É troca de zona inteira, e-mail incluído: exige
   planejamento próprio e não deve ser feita junto com o lançamento da loja.

2. **A loja está `ativo=true`, `em_manutencao=false` e `indexavel=false`** —
   no ar para quem souber o endereço, invisível para o Google. Ligar
   `indexavel` é decisão sua, e só depois de revisar o catálogo.
3. **Revisar os 508 publicados.** Publiquei os ativos com preço e saldo como
   ponto de partida; a tela de Produtos publica e despublica em massa.

**Números do catálogo, medidos agora:**

- 508 publicados · **191 prontos** (foto + preço + saldo) · 284 sem foto ·
  493 sem descrição · 57 sem saldo · 68 sem categoria.
- **198 dos 508 divergem** entre `produtos.estoque` e `produto_estoque`, e 17
  não têm linha de depósito. A loja usa a fonte configurada; os dois números
  existem no sistema e nenhum está errado por si.

**Fica para depois (código):**

4. Editor visual de banners e blocos da home (tabelas prontas, falta a tela).
5. Copiar para o bucket próprio as imagens hotlinkadas de CDN de terceiro.
6. Importar título/descrição/galeria dos 1.505 anúncios de Shopee e Nuvemshop
   — a arquitetura está pronta (`conteudo_origem` em `loja_produtos`).
7. `initcap` perde acento quando a grafia mais frequente do ERP não o tem
   ("Produtos Quimicos"). Renomear na aba Categorias resolve caso a caso.
8. Busca em 34 ms com 508 publicados. Com alguns milhares, vale medir de novo:
   o `OR` do trigrama amplia o conjunto avaliado antes do `LIMIT`.

## 17. Recomendação para a Fase 2

**Antes de qualquer coisa: a dívida de segurança.** A Fase 1 garantiu que a
loja não amplia o vazamento, mas ele continua lá — e a loja existe para atrair
tráfego. O plano está em
[`seguranca-fechar-acesso-anon.md`](seguranca-fechar-acesso-anon.md), começando
por medir o que o PDV externo realmente usa. **Antes de ligar `indexavel` e
divulgar o endereço.**

**Depois, a Fase 2 como planejada: reserva de estoque.** A tabela
`estoque_reservas` existe, os índices existem, a expiração existe, e
`loja_estoque_disponivel()` já subtrai as reservas. Falta só o **caminho de
escrita** — reservar ao iniciar o checkout, consumir ao confirmar, liberar ao
cancelar.

O ponto que merece decisão consciente: hoje o sistema **absorve** overselling
de propósito — `src/lib/produtos/estoque.ts` deixa o estoque ir negativo
porque prender a baixa de um pedido de marketplace já vendido é pior. Para a
vitrine, onde o cliente escolhe na hora, essa escolha não serve. A Fase 2
precisa decidir se a reserva vale **só para a loja** (mais simples, e resolve o
problema imediato) ou **para todos os canais** (resolve o overselling entre
PDV, loja e marketplaces — que é o problema real, e é mais trabalho).

Minha recomendação: **para todos os canais**, mas ligada canal a canal, com
modo simulação primeiro — exatamente o padrão que `marketplace_fila` já usa e
que já provou funcionar neste sistema.
