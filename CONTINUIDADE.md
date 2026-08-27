# Continuidade — onde paramos

Anotações para retomar o trabalho numa sessão nova. Não é documentação do
sistema: é o estado de quem estava com a mão na massa.

Última atualização: 26/08/2026

Tudo que está descrito aqui como pronto está **no ar** (último deploy:
`16b3ff0`, com as migrações já rodadas).

O editor de anúncios de marketplace foi promovido para a `main` em 26/08 e
está em produção **sem nunca ter sido exercitado** contra as APIs reais — ver
a seção própria no fim antes de usá-lo no catálogo em geral.

---

## Em andamento

### Loja Online — Fase 1 no ar

Canal de venda novo, com vitrine pública própria. **Está no ar** em
`bazareficaz.sistemavargas.com.br`, e **invisível para o Google** de
propósito (`indexavel = false` → o robots.txt dela devolve `Disallow: /`).
Quem tem o link acessa; buscador não entra.

Auditoria completa em [`docs/loja-online-auditoria.md`](docs/loja-online-auditoria.md)
(o que existia antes, medido no banco) e entrega em
[`docs/loja-online-fase1.md`](docs/loja-online-fase1.md) (o que foi feito, com
os 17 itens que o Silvano pediu). Vale reler os dois antes de mexer aqui.

**A REGRA QUE GOVERNA O PROJETO INTEIRO:** a vitrine pública NÃO recebe chave
de banco nenhuma. Ela renderiza no servidor, consulta só por
`src/lib/commerce/db.ts` com chave de serviço, e lê da view
`loja_vitrine_produtos` — uma lista branca onde `preco_custo`, margem,
fornecedor, fiscal e `produtos.estoque` não existem nem como coluna.
Conferido no HTML servido: zero campos internos, zero tokens JWT.

O motivo está na seção de segurança abaixo, e é sério.

**Arquitetura, em uma linha:**

```
host → src/proxy.ts → loja_config → canal → empresa → grupo → tenant
```

Nada conhece "Bazar Eficaz". Ela é só a primeira linha de `loja_config`. Loja
nova = uma linha na tabela, um registro DNS e um `vercel domains add`.

**12 migrations aditivas**, nenhum `DROP`, nenhum `ALTER` em tabela do ERP,
**zero colunas novas em tabela existente**. Arquivos no repositório:
`supabase-loja-fundacao.sql`, `-estoque.sql`, `-vitrine.sql`, `-publicacao.sql`.

**Estoque — a resposta que não existia.** O sistema não tinha resposta única
para "quanto posso vender". `empresa_config_estoque.reservar_em_pedido` existe
desde sempre **sem nenhum código que o leia**, e
`marketplace_anuncios.estoque_reservado` é o estoque PUBLICADO no canal, não
reserva. Agora `loja_estoque_disponivel()` responde:

```
físico − reservado − segurança = disponível
publicável = min(disponível × percentual, teto)
```

De onde vem o físico é configuração da loja, não constante: depósito único,
selecionados, empresa ou grupo. O modo grupo **reaproveita** a unificação que
já alimenta os marketplaces (`estoque_unificado_participantes` +
`produto_vinculos`) para a loja não inventar um terceiro número — e acrescenta
três travas no banco que a versão de marketplace não fazia: mesmo tenant,
mesmo grupo, empresa ativa. Testado com uma loja temporária na Ouro e Prata
(unificação desligada): zero empresas somadas indevidamente.

`estoque_reservas` existe e nasce VAZIA. A leitura já a subtrai; a escrita é a
Fase 2.

**Busca — não existia nenhuma.** Nem `pg_trgm`, nem `unaccent`, nem
`tsvector`, nem GIN além de `produtos.tags`. Toda busca do sistema era `ilike`
encadeado. Agora há configuração `pt_unaccent` (acento e plural de uma vez, e
continua indexável), `tsvector` com pesos, e trigram para erro de digitação
com limiar **0,45** — medido nos nomes reais deste catálogo: erro legítimo cai
entre 0,50 e 0,67 ("hidralica" 0,50, "torneria" 0,556), ruído dá 0,0. O padrão
do pg_trgm (0,6) cortava metade dos acertos.

O índice fica em `loja_produtos`, **não em `produtos`**, e **não há gatilho em
`produtos`** — é a tabela onde o PDV escreve em toda venda, e pendurar
trabalho ali para servir a vitrine seria cobrar do caixa o custo da loja. O
preço dessa escolha é o cron `/api/cron/loja-manutencao`, a cada 15 min.

**Categorias sem tocar no cadastro.** No ERP categoria é TEXTO, duplicado e
com acento quebrado. `loja_semear_categorias` agrupa pelo texto normalizado e
funde as grafias sozinha: **54 grafias viraram 48 categorias**, sem um único
`UPDATE` em `produtos`. Não adivinha que "Hidráulica" e "MATERIAL HIDRÁULICO"
são a mesma coisa — isso é decisão de quem conhece a loja, e o painel permite.

**Publicação é decisão do usuário.** Nunca exige foto, descrição, marca ou
preço; o sistema mede e mostra o que falta, e não bloqueia. Isso é requisito,
não detalhe: dos 509 publicados, **284 não têm foto**, então cards com e sem
imagem convivem na mesma grade e o vazio é desenhado (bloco tipográfico na
paleta da loja, nunca ícone quebrado).

**Números do catálogo, medidos em 25/08:**

| | |
|---|---:|
| publicados | 509 |
| **prontos** (foto + preço + saldo) | **193** |
| sem foto | 284 |
| sem saldo no depósito que a loja lê | 58 |
| sem categoria | 68 |
| divergem entre as duas fontes de saldo | 198 |

**Armadilha do critério de publicação:** publiquei filtrando por
`produtos.estoque > 0`, mas a loja LÊ `produto_estoque` (depósito Padrão). São
as duas fontes que divergem em 198 produtos. Resultado: **30 produtos com
saldo real no depósito ficaram fora da vitrine** — R$ 12.465 de mercadoria que
a loja não oferece. Pendência do Silvano abaixo.

**Painel:** `/dashboard/loja-online`, oito abas (Visão Geral com Saúde do
Catálogo, Produtos, Categorias, Aparência, Banners/Home, Estoque, Domínio,
Configurações). A aba Banners/Home está simplificada de propósito: a home já
funciona sem configuração nenhuma, e editor de vitrine antes de existir
checkout é esforço na ordem errada. As tabelas já existem.

Na listagem de Produtos do ERP, o selo **LO** (índigo) diz quem está na loja —
no MESMO selo dos marketplaces, e não num indicador separado. Sem contador
(um produto está publicado ou não) e sem clique (a loja se gerencia em Loja
Online → Produtos). Ao lado dele, um botão publica ou atualiza o produto
direto da linha. **O botão de publicar na Shopee saiu dessa tela** — a Shopee
continua em Anúncios, Mapa de Anúncios e Rascunhos, que é o lugar dela.

**Quatro defeitos que os testes acharam, e que valem para o que vier:**

1. Casamento por trigrama recebia `ts_rank` = 0 e empatava com casamento real,
   caindo em ordem alfabética. "lampada led" trazia *ABRACADEIRA PARA LAMPADA*
   antes de *LAMPADA LED BULBO*. Hoje são três faixas de relevância que nunca
   se misturam.
2. "Tem estoque primeiro" valia até com termo de busca, escondendo o item
   procurado só porque acabou. Navegando, saldo manda; buscando, relevância
   manda e o saldo só desempata.
3. `robots.ts` só é reconhecido na RAIZ de `app/` — aninhado não gera rota
   nenhuma. Diferente de `sitemap.ts`, que aceita. Mora em `src/app/robots.ts`
   e decide pelo host.
4. `slugDaLoja()` devolvia o host inteiro como slug quando
   `NEXT_PUBLIC_LOJA_DOMINIO_RAIZ` estava vazia. Em produção sem a variável,
   `www.sistemavargas.com.br` viraria "loja" e o ERP inteiro cairia em 404.
   Hoje **falha fechado**: sem domínio raiz, nenhum host é loja.

**Fase 2 é a reserva de estoque.** Tabela, índices e expiração já existem;
falta o caminho de escrita — reservar ao iniciar o checkout, consumir ao
confirmar, liberar ao cancelar. A decisão consciente que ela exige: hoje o
sistema **absorve** overselling de propósito (ver `src/lib/produtos/estoque.ts`
— deixa o estoque ir negativo porque prender a baixa de pedido de marketplace
já vendido é pior). Para a vitrine isso não serve. Recomendação: reserva para
TODOS os canais, ligada canal a canal e com modo simulação primeiro — o mesmo
padrão de `marketplace_fila`, que já provou funcionar aqui.

### SEGURANÇA — acesso anônimo do Supabase (dívida crítica, aberta)

Plano completo em
[`docs/seguranca-fechar-acesso-anon.md`](docs/seguranca-fechar-acesso-anon.md).

Medido contra a produção com a chave `anon` — a chave pública, que vai dentro
do JavaScript — e **sem nenhum login**: 28.593 produtos COM `preco_custo`, 64
clientes com CPF, 1.863 vendas, 2.886 movimentações, 880 mensagens de WhatsApp
e o **`senha_hash` dos operadores do PDV**.

Não é novidade: está no bloco "AINDA ABERTO" de
`supabase-fechar-acesso-publico-2.sql`. A causa é o PDV externo conectar sem
sessão, e ligar RLS nessas tabelas derruba o caixa.

**O que a Loja Online fez:** não ampliou. Todas as tabelas, views e funções
novas negam tudo para `anon` (conferido: 401 em todas), e a vitrine não recebe
chave. **O que ela não fez, e não podia:** fechar o que já estava aberto.

**Por que virou urgente:** hoje a exposição vive atrás de um sistema que
ninguém divulga. Uma vitrine pública é feita para atrair tráfego. O risco não
sobe por causa do código da loja — sobe por causa da atenção que ela atrai.
**Fechar antes de ligar `indexavel` e divulgar o endereço.**

O primeiro passo é medir o que o PDV externo realmente usa, não sair rodando
`REVOKE` — pular isso foi o que travou as tentativas anteriores.


### Auxiliar de Compras — motor de reposição

Auditoria completa da estrutura em
[`docs/auxiliar-de-compras-auditoria.md`](docs/auxiliar-de-compras-auditoria.md),
medida no banco de produção em 17/08. Vale reler antes de mexer aqui: ela
explica por que o módulo não pode se comportar como um "abaixo do mínimo".

**O número que governa tudo:** 13.284 dos 14.281 produtos ativos estão com
estoque **zero** no cadastro e 586 **negativo**. Só 411 positivos. A loja
tem mercadoria; o sistema não sabe. Enquanto isso não for corrigido
(inventário ou importação do saldo antigo), o Auxiliar vai continuar
dizendo "em ruptura" para item que está na prateleira.

**Fatia 0 — captura da falta (pronto, no ar).** No `vargasnexus-pdv`
(commit `eec126c`): a tela mandava `quantidade` e `cliente_whatsapp`, o
gravador lia `quantidade_solicitada` e `cliente_telefone` — os dois campos
eram descartados em silêncio. As 11 faltas anteriores estão todas com
quantidade 1 e sem contato por causa disso. `usuario_nome` nunca era
enviado. Agora existe `tipo` (falta × encomenda), com prazo prometido e
preço combinado. **O PDV instalado nos terminais precisa ser atualizado
para o conserto valer.**

**Fatia 1 — tela Faltas e Encomendas (pronto, no ar).**
`/dashboard/auxiliar-compras/faltas`. Agrupada por produto, com o estoque
atual do lado. O agrupamento é só na leitura — cada solicitação continua
inteira, senão se perde "5 clientes diferentes desde 03/08".
Marcar "recebido" no painel volta ao balcão pelo sync que já existia.

**Fatia 2 — motor (pronto, no ar).** `reposicao_metricas` +
`reposicao_config`, cron às 6h (`/api/cron/reposicao`) e botão
"Recalcular agora". Rodada real: **1.214 produtos gravados em 4,7s**,
13.066 fora por não haver sinal nenhum de demanda.

Quatro armadilhas que o ensaio sobre os dados reais revelou, e que valem
para qualquer cálculo novo neste módulo:

1. **A loja inteira acelerou 4,42×** (396 vendas em julho → 1.035 em
   agosto: o PDV entrando em uso). Sem dividir por esse fator, TODO
   produto aparece "vendendo 400% mais".
2. **Tendência precisa de piso de volume.** 1 unidade em 15 dias contra 1
   em 90 dá "500% mais" — ruído aritmético.
3. **ABC só pelo acumulado de 80% classifica quase tudo como A** quando a
   venda é espalhada. Precisa exigir também posição no ranking.
4. **799 produtos caem em "crítico"** porque quase todo item que vende tem
   estoque zero/negativo. Score com base alta empata todos perto de 100 —
   o que separa um crítico do outro é o tamanho (volume e dinheiro), em
   escala logarítmica.

**Fatia 3 — fornecedor × produto (pronto, aguardando
`supabase-fornecedor-produto.sql`).** Tabela `fornecedor_produto`
(último custo, custo médio, última compra, prazo real — calculados toda
noite; prazo cadastrado, quantidade mínima, múltiplo de embalagem,
preferencial — só o comprador edita, a rodada nunca sobrescreve).
`fornecedores` ganhou `prazo_entrega_dias`, `pedido_minimo_valor`,
`condicao_pagamento_padrao`. `produtos.fornecedor_padrao_id` resolve os
127 `codigo_fornecedor` soltos.

O motor de reposição (fatia 2) passou a usar o lead time real por produto
em vez do padrão único da empresa — preferência: prazo medido no par
fornecedor×produto > prazo cadastrado nesse par > prazo do fornecedor >
padrão da empresa. Nunca mistura os níveis.

`entradas.pedido_compra_id` e `nfe_entradas.pedido_compra_id` (só entrada
manual tem UI de vínculo por ora — XML fica pendente). Ao confirmar uma
entrada vinculada, `atualizarStatusPedidoAposEntrada` marca o pedido como
recebido ou parcialmente recebido, comparando o que já entrou com o que
foi pedido. É esse vínculo que alimenta o prazo real — antes da primeira
entrada vinculada, `prazo_entrega_real_dias` fica vazio de propósito.

Sugestão de fornecedor (`src/lib/fornecedores/sugestao.ts`) nunca escolhe
sozinha — só ordena e explica; aparece no painel "entender" do Auxiliar de
Compras, carregada sob demanda quando a linha é expandida.

Tela nova: `/dashboard/fornecedores/[id]/produtos`, link "Produtos" na
listagem de fornecedores.

**Fatia 4 — lista de compra → pedido (pronto, aguardando
`supabase-compras-lista.sql`).** `compras_listas` + `compras_lista_itens`:
a bancada entre "o Auxiliar sugeriu" e "o pedido foi para o fornecedor".

No Auxiliar de Compras, seleção múltipla (checkbox) + "Adicionar à Lista
de Compra" — usa a quantidade sugerida por padrão, editável depois. Sem
`listaId`, a rota usa a lista aberta da empresa ou cria uma; item repetido
soma quantidade em vez de duplicar linha.

`/dashboard/compras-lista/[id]` agrupa por fornecedor (resolvido por
`fornecedor_padrao_id` do produto > sugestão do histórico >
`sem fornecedor`, sempre trocável). Cada grupo tem "Gerar pedido deste
fornecedor" — cria um `pedidos_compra` com `origem='auxiliar'` e status
sempre `rascunho`, nunca enviado direto: o comprador ainda revisa em
`/dashboard/pedidos-compra/novo?id=X` antes de mandar pro fornecedor de
verdade. Item sem fornecedor não entra em pedido nenhum, fica esperando.

**Reconciliado com as automações (17/08).** A pendência acima não era
teórica: `executarPedidoAutomatico` (única automação que de fato grava
`pedidos_compra` — as outras três só mandam WhatsApp) criou um rascunho
NOVO todo dia, de 13 a 17/08, para os MESMOS 4 produtos abaixo do mínimo,
sem nunca cancelar ou reaproveitar o anterior: pedidos #000002 a #000006,
cinco rascunhos duplicados acumulados em Pedido ao Fornecedor. Achado
rodando a função contra o banco real, não é hipótese.

Corrigido em `src/lib/automacoes/tipos-reposicao.ts`: antes de criar,
`executarPedidoAutomatico` agora consulta `pedidos_compra_itens` +
`pedidos_compra` (join `!inner`, filtro `not(status, in, ("cancelado",
"recebido"))`) e tira da lista todo produto que já tem pedido aberto —
de qualquer origem, automação ou Auxiliar. O pedido criado agora carrega
`origem='automacao'`. Testado: rodou contra a empresa real e devolveu
`sem_acao`, porque os 4 produtos já estão cobertos pelos rascunhos
existentes.

**Pendência que ficou**: os 5 rascunhos duplicados (#000002–#000006)
continuam no banco — não apaguei sozinho, é decisão do Silvano cancelar
ou consolidar. `SELECT * FROM pedidos_compra WHERE observacoes ILIKE
'%Pedido ao fornecedor%' AND status='rascunho'` acha todos.

**Fatia 5 — IA (pronto, aguardando `supabase-reposicao-ia.sql`).**
`reposicao_ia_sinais` + `reposicao_ia_resumo`, calculados por
`src/lib/reposicao/ia.ts`. Cron às 6h30, depois de fornecedores (5h30) e
reposição (6h) — precisa das métricas frescas antes de escolher os
produtos.

UMA chamada de IA por empresa por dia, não uma por produto: os 40 de
maior score entram todos no mesmo prompt, e a resposta traz o resumo do
comprador (item 37, card "Análise Inteligente" no topo do Auxiliar) e os
sinais por produto na mesma passada. Cinco tipos, só os que a dados de
hoje sustentam: aceleração, queda de demanda, demanda perdida (faltas ou
encomendas com estoque zerado — item 34), mínimo desatualizado, excesso a
liquidar. Sazonalidade e ruptura recorrente ficaram de fora de propósito
— exigem histórico que não existe ainda (fatia 6); o prompt proíbe
explicitamente a IA de inventar padrão sazonal com seis semanas de dado.

`motivos` (regra) e `sinaisIA` (IA) aparecem separados na tela — nunca
misturados —, porque um é conta que dá pra conferir e o outro é
interpretação. A explicabilidade determinística das fatias 2-4 continua
sem IA nenhuma.

**Fatia 6 — memória (pronto, aguardando
`supabase-reposicao-memoria.sql`). Fecha o plano original inteiro.**

Duas coisas que não têm como nascer com histórico — começam vazias no dia
em que entram no ar:

- `reposicao_rupturas`: quanto tempo cada produto ficou com estoque <= 0.
  Detectado dentro do próprio cron noturno (`src/lib/reposicao/rupturas.ts`),
  comparando o estoque de ontem com o de hoje — não instrumenta os vários
  pontos que escrevem `produtos.estoque` (PDV, entrada manual, XML,
  ajuste, marketplace, kit), que seria tocar demais pelo mesmo ganho. Ao
  fechar uma ruptura, conta quantas faltas/encomendas caíram na janela —
  é a medida de demanda perdida do item 34, agora com número em vez de
  impressão.
- `reposicao_decisoes`: o que o motor sugeriu × o que virou pedido de
  verdade, ou foi rejeitado. Instrumentado nas rotas da Lista de Compra
  (adicionar grava `quantidade_sugerida_original`, imutável; gerar-pedidos
  grava `pedido_gerado` com sugerido×decidido; remover item grava
  `removido_sem_comprar`). Não cobre os pedidos criados pela automação
  (esses não passam pela Lista de Compra) nem pedidos manuais do zero.

`classe_abc_margem` — ABC por margem, ao lado do já existente por
faturamento (fatia 2). Produto de giro alto e margem baixa pode ser A num
critério e irrelevante no outro.

Tela nova: `/dashboard/auxiliar-compras/historico`, com aviso explícito
de que os números começam do zero — nada foi reconstruído do passado. Com
poucas amostras (menos de 5 decisões comparáveis) a tela avisa que ainda
é cedo para tirar padrão, em vez de mostrar uma média de duas observações
como se fosse confiável.

**Não faltam mais fatias do plano original.** As seis rodaram, foram
verificadas contra o banco de produção (não só compiladas) e estão no ar.

**A reconciliar:** `automacoes → RegrasReposicao` já cria rascunho de
pedido de compra sozinha, a cada 5 minutos, e já tem noção de curva ABC.
Se ficar como está, vai criar rascunhos concorrentes com o Auxiliar.
E `/dashboard/relatorios/estoque` (Estoque & Giro) calcula cobertura e
giro por conta própria, relendo 14 mil produtos a cada abertura — ou é
absorvida, ou vira link.

### Nuvemshop — módulo de escrita

A Nuvemshop era só leitura (importava catálogo e pedidos, não devolvia nada).
Canal: **LV Eficaz**, loja 1004517, 235 anúncios, **223 mapeados (95%)**.

**Pronto e validado em produção:**
- `src/lib/nuvemshop/write.ts` — `atualizarPrecoEstoque` e `publicarProduto`.
- Ligado em `src/lib/marketplace/envio.ts` (a fila não recusa mais a Nuvemshop).
- Envio de partida executado: **101 atualizados**, **27 zerados** por estoque
  negativo, 81 já corretos, 14 fora por falta de preço.

**Detalhe estrutural que não é óbvio:** na Nuvemshop preço e estoque ficam na
**variante**, não no produto. Todo produto tem pelo menos uma — o que a loja
mostra como "produto simples" é, na API, um produto com uma variante só.
Não existe "pausado": o equivalente é `published: false` (sai da vitrine, o
produto continua existindo com o mesmo id).

**Criar anúncio — pronto e exercitado contra a loja real:**
- `src/lib/nuvemshop/listing.ts` — `criarAnuncio` (POST /products com a
  variante embutida) e `listarCategorias`.
- Rotas `criar-anuncio`, `categorias`, `sync-item` e `ia-gerar-conteudo` em
  `src/app/api/marketplace/nuvemshop/`.
- `CriarAnuncioNuvemshopModal.tsx`, ligado em **duas** telas: no Mapa de
  Anúncios (cobre "+ Criar anúncio", "Replicar" e "Duplicar") e na tela de
  Anúncios do canal, no botão "Publicar na Nuvemshop".

**IA da Nuvemshop é diferente da dos marketplaces:** não há atributo de
categoria para preencher, então ela gera só título e descrição — e a descrição
sai em **HTML simples**, porque a vitrine renderiza HTML (texto puro vira um
bloco corrido). Tags fora de uma lista curta são removidas na volta, junto com
todo atributo (`style`, `class`), senão a IA manda `<h1>` e briga com o tema.

Medido no prompt: sem uma regra explícita, o modelo anunciou uma argamassa em
pó como "pronta para uso". A regra que proíbe afirmar estado de preparo e
desempenho está lá por causa disso — se sair de novo, é ali que se mexe.

Descrição gerada é gravada em `produtos.descricao_marketplace` quando o
cadastro está vazio (nunca por cima do que já existe), então o trabalho serve
para os próximos canais. Produto sem SKU no cadastro (são 12) recebe o id do
produto no sistema, porque é pelo SKU que o pedido da loja acha o produto aqui.

**Lição da primeira tentativa do Silvano:** ele testou no sistema no ar e não
funcionou em tela nenhuma — porque nada tinha sido publicado ainda, e porque a
tela de Anúncios só tinha botão para Shopee e ML. Ligar a plataforma nova numa
tela só não basta: os dois caminhos de publicar precisam existir juntos.

**Teste feito de ponta a ponta (13/08, produto 360760870, criado fora da
vitrine e apagado em seguida — não sobrou nada na loja nem na nossa tabela):**
- `categories: [id]` no POST **funciona** — o produto saiu em "Hidráulica".
- `stock_management: true` é aceito na criação. Sem ele o estoque seria
  infinito e a loja venderia o que acabou, sem erro nenhum aparecer.
- Imagem por URL funciona **mesmo apontando para o CDN da Shopee**: a
  Nuvemshop baixou e rehospedou em 1024×1024 no domínio dela.
- Preço "de": `price` é o riscado e `promotional_price` é o que o cliente
  paga. Mandamos nessa ordem e o sync lê de volta os 27,22 certos.
- `published: false` volta do sync como status `pausado`, como projetado, e o
  produto já nasce com `url_anuncio` da loja.

Campos da variante confirmados: `price / promotional_price / stock /
stock_management / weight / width / height / depth / sku / barcode`.
`/categories` traz `parent`, o que permite montar o caminho
("Ferramentas > Brocas"). A loja tem 15 categorias.

**Detalhe que vale saber:** `categoria_externa` do anúncio junta com " > "
TODAS as categorias do produto, não um caminho. Um produto em "Casa e Jardins"
e "Cozinha" vira uma string que parece caminho e não é. A replicação casa
primeiro o caminho inteiro, depois cada pedaço pelo nome.

**Falta (próxima fase):**
1. **UI de envio manual** — o botão "Preço/estoque" (tela de Anúncios e Mapa)
   ainda não oferece a Nuvemshop: `EnviarPrecoEstoqueModal.tsx` trata tudo que
   não é ML como Shopee, escreve o preço na nossa tabela e chama
   `/api/marketplace/shopee/push`, que não acha o canal. Falta a rota
   `nuvemshop/push` e a plataforma no modal. **É a fatia mais óbvia a pegar.**
2. **Replicar em massa** — `anuncios/replicar-massa` só conhece Shopee e ML.

### Descrição do Mercado Livre — buscada sob demanda

No ML a descrição **não vem no item**: é o endpoint `/items/{id}/description`,
e o sync de catálogo não o chama para não dobrar as chamadas de uma rodada de
7 mil anúncios. O efeito, medido: **0 de 7.693 anúncios do ML tinham
descrição** (Shopee 1.279/1.279, Nuvemshop 223/236). Por isso replicar ou
duplicar do ML sempre vinha com a descrição vazia.

A rota de replicação passou a buscá-la na hora quando falta e gravar de volta
— uma chamada por replicação, e da segunda vez já está no banco. **Os outros
~7.690 continuam sem**, e só se preenchem conforme forem usados. Encher tudo
de uma vez é uma varredura de ~7.700 chamadas (umas duas horas em ritmo
seguro); não é urgente, mas é uma fatia própria se alguém quiser a coluna
cheia.

Cuidado que já mordeu: o sync gravava `descricao: null` explícito, o que
apagaria no sync seguinte tudo que fosse buscado. A coluna saiu da linha do
upsert — **omitir preserva**. Conferido rodando o sync logo depois de gravar.

### Qualidade dos anúncios — tela pronta (17/08)

`supabase-marketplace-qualidade.sql` já tinha sido rodado antes; as colunas
`qualidade_health / _score / _faltas / _em` já existiam e 8.975 dos 9.212
anúncios já estavam avaliados quando a tela foi construída (confirmado ao
vivo no banco antes de mexer em código). O cálculo roda a cada sincronização
(`src/lib/marketplace/qualidade.ts`), continua sem mudança.

**A tela foi construída, as três coisas que faltavam:**

- **Coluna "Qualidade"** em `/dashboard/marketplaces/[canalId]/anuncios`
  (`COLUNAS_LISTAGEM` em page.tsx passou a trazer as 4 colunas — leve, são
  escalares, nada parecido com o peso de `dados_brutos`). Mostra health do
  ML e score do checklist em linhas separadas, sempre — nunca somados numa
  nota única, por causa do achado abaixo.
- **Filtro por falta**: select "Falta: Sem EAN / Menos de 3 fotos / ..."
  populado direto de `FALTAS_CATALOGO` (já exportado por qualidade.ts, não
  duplicado). Mais duas facetas nas já existentes (`qualidade_ruim` score
  ≤40, `qualidade_boa` score >80).
- **Painel por anúncio** (`AnuncioDetalheModal.tsx`): lista cada falta com
  o "porquê" (texto já existia no catálogo) e um botão de ação HONESTO por
  tipo — só promete o que o sistema realmente faz:
  - título/descrição → abre a edição local (`onEditar`, já existia)
  - EAN → vincula/edita o produto (`onMapear`, já existia)
  - fotos/vídeo/atributos/marca → link "Abrir na plataforma ↗", porque
    este sistema não tem (e não fingiu ter) editor desses campos — eles só
    se editam no painel do próprio ML/Shopee.

**Achado importante, medido — não repetir o erro:** o checklist do sistema
**não prevê** o `health` oficial do ML. Anúncios com health ≥0,80 dão score
médio 56; abaixo de 0,80, 54. A tela mostra os dois números em linhas
separadas, cada um rotulado — nunca um como estimativa do outro. Para nota
itemizada de verdade no ML o caminho é o endpoint `/items/{id}/health`
(9.212 chamadas, passada à parte, ainda não feita).

Números por canal: ML Eficaz 4.986 anúncios (health 0,77), ML Ouro 2.025
(0,70), Shp Eficaz 675, Shp Ouro 431.

### Estoque por depósito — 540 produtos para acertar

**A causa já está corrigida; a sujeira acumulada não.**

São duas fontes: `produtos.estoque` (campo do produto) e `produto_estoque`
(tabela por depósito). A tabela por depósito passou a ser alimentada por
DIFERENÇAS quando o sistema já tinha estoque, e o saldo que existia naquele
momento nunca foi copiado para lá. Somar a diferença só chega no número certo
se o depósito já estivesse certo antes.

O sintoma é o pior tipo: o operador conta a prateleira, põe 3, o topo da tela
mostra 3 e o quadro por depósito mostra **-3**. Nenhum dos dois números está
errado por si.

Corrigido: ajuste manual é contagem física, então agora **sobrescreve** o
depósito em vez de incrementar (só quando há UM depósito ativo — com dois ou
mais o total do produto não diz quanto tem em cada um, e a tela avisa). O
modal também mostra quando os dois divergem.

**Medido em 14/08:** de 14.287 produtos ativos, 13.698 batem, **540 divergem**
e 49 não têm linha de depósito nenhuma — 4.146 unidades de diferença, e 9
produtos com depósito negativo e estoque positivo. Daqui em diante cada
produto ajustado pela contagem se acerta sozinho; os 540 antigos **não**.

A correção em massa é segura de escrever (só existe um depósito ativo, o
"Padrão" — o "Principal" está inativo com zero), mas **mexe em dado de
produção e depende de autorização do Silvano**. Não foi feita.

### Categorias — árvore montada, faxina pendente

A tabela `categorias` sempre teve `pai_id`; o cadastro do produto é que
oferecia a lista achatada. Agora tem Categoria → Subcategoria encadeadas, com
criação de subcategoria ali mesmo pelo "+", e a tela de Categorias ganhou a
coluna **"Fica dentro de"**, que move uma categoria para dentro de outra **e
reclassifica os produtos na mesma ação** (`categoria` vira o pai,
`subcategoria` vira quem foi movido).

**O que falta é trabalho de cadastro, não de código.** Medido: 102 categorias,
das quais só 2 eram subcategorias de verdade, e o resto está achatado e
duplicado:

- MATERIAL HIDRÁULICO (1.788) · MATERIAL HIDRAULICO (762) · Material
  Hidráulico · MATERIAL HIDR�ULICO — a mesma coisa quatro vezes, uma delas
  com acento quebrado.
- Mesma história em FERRAGENS/Ferragens, FERRAMENTAS/Ferramentas,
  MATERIAL ELÉTRICO/Material Eletrico/MATERIAL EL�TRICO, PRODUTOS
  QUIMICOS/Produtos Quimicos/Produtos Químicos.
- TORNEIRAS, REGISTROS, RALOS E GRELHAS, CONEXAO SOLDAVEL, MANGUEIRAS são
  partes de MATERIAL HIDRÁULICO. ALICATES, CHAVE FENDA, DISCOS, LIXAS, BROCAS
  são partes de FERRAMENTAS.

A tela mostra quantos produtos cada categoria tem — é assim que as duplicadas
ficam visíveis. **Guardado como TEXTO, não como id**: dezenas de telas,
relatórios e a IA leem `produtos.categoria` por nome. Trocar por chave
estrangeira é outro projeto.

### Celular — fatias feitas, resto pendente

Feito: tag `viewport` (faltava, era a causa raiz do texto minúsculo), menu em
gaveta abaixo de `md`, tela de Produtos (rolagem própria na tabela, cabeçalho
e paginação empilhados), tela de Anúncios em cards para o mapeamento.

**Duas armadilhas que já custaram uma rodada cada:**
- O trilho do menu foi feito para mouse: abre no `onMouseEnter` e o clique
  **fecha**. Sem hover no celular, tocar não fazia nada. Resolvido com
  `alternarPainel`. Se aparecer padrão parecido em outra tela, é o mesmo.
- Painel posicionado em `left-[216px]` com z-index menor que a gaveta ficava
  invisível no celular.

**Falta:** 82 tabelas ainda sem `overflow-x-auto` e ~144 grids de 3+ colunas
sem prefixo responsivo. Priorizar pelas telas que o Silvano usa no celular —
não vale passar por 99 telas.

---

## Pendências do Silvano (não são código)

### Loja Online

- **30 produtos com saldo real ficaram fora da vitrine** — R$ 12.465 de
  mercadoria que a loja não oferece. Causa: publiquei filtrando por
  `produtos.estoque`, e a loja lê `produto_estoque`. Publicar é um comando;
  esperando seu aval.
- **Ligar `indexavel`** em Loja Online → Configurações é o que abre a loja ao
  Google. Recomendo só depois de revisar os 509 publicados **e** de fechar a
  dívida do `anon`.
- **Revisar o que está publicado.** Os 509 são um ponto de partida meu, não
  uma decisão sua. A tela Loja Online → Produtos publica e pausa em massa,
  com filtro por categoria, marca, com/sem foto e com/sem estoque.
- **Loja nova exige DNS manual.** O DNS gerenciado do Registro.br **não
  aceita `*`** no campo Nome — é limitação do serviço deles. Cada loja precisa
  de um registro `A` próprio (`Nome: <subdominio>`, `Valor: 76.76.21.21`) mais
  um `vercel domains add`. Quando isso incomodar (leia-se: quando o SaaS
  abrir), o caminho é mover a HOSPEDAGEM do DNS para um provedor com curinga,
  mantendo o REGISTRO no Registro.br. Move a zona inteira, e-mail incluído —
  merece janela própria.

### Do ERP

- **14 produtos sem preço** no cadastro. Não é problema da Nuvemshop: afeta
  Shopee e ML também.
- **27 produtos com estoque negativo.** A vitrine foi zerada, mas o saldo
  negativo no sistema continua — provavelmente entrada que faltou dar.
- **540 produtos com depósito divergindo** do estoque (ver seção própria).
  Decidir se autoriza a correção em massa.
- **Faxina das categorias**: unificar as duplicadas e montar a árvore com a
  coluna "Fica dentro de" (ver seção própria). É clique, não código.
- **Código do fornecedor em branco**: no pedido #000001, 9 de 14 produtos não
  têm. O pedido por WhatsApp cai no EAN nesses casos — funciona, mas o código
  do catálogo do fornecedor é melhor.
- **Contador**: confirmar se a empresa é contribuinte **substituído** (ST vem
  recolhido do fornecedor). Disso depende a tabela de conversão de CFOP por
  modelo — ver abaixo.

---

## Decidido mas não implementado

### CFOP por modelo de documento (NF-e × NFC-e)

Problema real: 49 produtos com CFOP 5403, que a **NFC-e recusa**. O sistema
hoje **só emite NFC-e** (`ModeloDocumento: 65` fixo); NF-e não existe.

Desenho aprovado: **derivação automática com exceção**, não dois campos para
preencher em 14 mil produtos. Tabela explícita 5403→5405, 5401→5405 para
NFC-e, mais um campo opcional `cfop_nfce` por produto.

**Não implementar antes da resposta do contador** — se a empresa for
substituída, 5405 vale para os dois modelos e basta corrigir os 49.

---

## Consertos recentes que vale conhecer

- **Todo relatório somava 1.000 linhas e chamava aquilo de total** (27/08).
  O Silvano viu "Faturamento do mês R$ 26.614,94" na Visão Geral e perguntou.
  Agosto tinha R$ 45.012,53 em 1.701 vendas: o card mostrava exatamente a soma
  das **1.000 vendas mais antigas** do mês. O PostgREST devolve no máximo
  1.000 linhas por requisição, e quem busca as linhas e soma em JavaScript
  soma o pedaço — sem erro, sem aviso, com status 200.

  Em julho, com 395 vendas, o mesmo código acertava. **É um defeito que só
  aparece quando o movimento cresce**, ou seja, exatamente quando o número
  passa a valer alguma coisa. Estava em oito telas: Visão Geral, Relatórios
  BI (faturamento, ticket, desconto, evolução de 30 dias e capital em estoque
  — este calculado sobre 1.000 dos 14.263 produtos), Alertas, Financeiro,
  Estoque, Produtos, Vendas e Clientes.

  Dois consertos, conforme o caso. Onde a tela quer UM número, a soma foi para
  o banco (`supabase-relatorios-agregados.sql`: `vendas_resumo`,
  `vendas_por_dia`, `produtos_vendidos`, `vendas_por_cliente`,
  `estoque_resumo`). Onde a tela precisa das linhas (curva ABC, venda por hora,
  RFM), entrou `buscarTudo()` em `src/lib/supabase/paginar.ts`, que percorre em
  páginas de 1.000 — **e exige `.order()` por coluna estável**, senão a
  paginação repete e perde linha, que é um erro pior porque é intermitente.

  Achado de brinde, no mesmo caminho: o ranking de produtos pegava os ids das
  vendas e os mandava num `.in('venda_id', [...])`. Com 2.016 vendas isso é uma
  URL de dezenas de kilobytes — não era só truncado, provavelmente nem chegava
  a ser respondido. Agora o join é do banco.

  E os recortes de tempo passaram a ser calculados no fuso de São Paulo
  (`src/lib/datas.ts`). A Vercel roda em UTC: `setHours(0,0,0,0)` no servidor é
  21h de ontem na loja, então "vendas de hoje" começava três horas cedo demais.

  **Nada disso muda o dado, só a leitura dele.** Os números do dia 26 — R$
  126.837,42 acumulados, R$ 75.201,33 em agosto somando PDV e marketplaces —
  vieram de `SELECT` direto no banco e continuam valendo.
- **NFC-e — desconto rateado.** O PDV grava o desconto no cabeçalho da venda,
  e a emissão só lia o desconto por item. Toda venda com desconto era
  rejeitada (Rejeição 865). Corrigido com rateio proporcional, último item
  absorvendo a sobra.
- **WhatsApp — anexo nunca chegava.** Dois defeitos somados: faltava a
  extensão no caminho (`/send-document/pdf`, exigência da Z-API) e o
  resultado do envio era descartado, então a falha era silenciosa.
- **Shopee** — imagem WebP recusada (agora convertida para JPEG) e campo
  `condition` obrigatório que não era enviado.
- **Dashboard** — entradas manuais não entravam em "Compras do mês": a
  consulta filtrava por `data_emissao`, que entrada manual não tem (4 de 31
  preenchidas). Passou a usar a data de entrada quando não há emissão.
- **Busca da entrada manual** — pedia ao banco QUALQUER palavra, cortava em
  300 linhas e só então pontuava. Como só de "bucha" o catálogo tem centenas,
  o produto certo podia nem chegar a ser avaliado. Agora as palavras são
  exigidas no BANCO (cada `.or()` encadeado soma com E). "bucha red 3/4" saiu
  de 50 resultados embaralhados para 8. Palavra de 1–2 caracteres vale só como
  palavra INTEIRA — o "5" de "5 METROS", não o de "4,5 METROS" —, senão o
  número era descartado e vinham as extensões de 10 e 20 metros.
- **Preço por quantidade (atacado)** — três níveis no cadastro, aplicados de
  verdade no PDV: o preço do item é recalculado quando a quantidade muda. Preço
  digitado à mão trava o recálculo. Devolução usa o módulo da quantidade (quem
  devolve 12 pagou o preço de 12; sem isso a loja devolveria a mais). A faixa
  não sobrescreve a promoção — vale o menor dos dois. **Orçamentos ainda não
  aplica as faixas**, só o PDV.
- **Rascunhos** — dá para subir imagem própria e adicionar por endereço (antes
  só existia o que o robô capturou, que é justamente o material de terceiro do
  qual a tela manda desconfiar). E a IA confere as capturadas: marca marca
  d'água, logotipo, telefone e texto promocional, e aponta a melhor capa. Ela
  não marca nem desmarca nada.
- **Pedidos ao fornecedor** — cancelar (mantém a linha, com data e motivo),
  reabrir (volta como RASCUNHO, nunca ao status anterior) e excluir (só
  rascunho ou já cancelado; a trava está na rota, não só no botão). Envio por
  WhatsApp com o telefone do fornecedor preenchido do cadastro, mandando nome
  do produto, código do fornecedor e quantidade — **sem custo e sem total**, de
  propósito: o preço aqui é o que a loja pagou, e mandá-lo é abrir a carta
  antes de o fornecedor cotar. Item com quantidade zero fica de fora (6 dos 14
  do pedido real estavam assim).

---

## Como trabalhar aqui

- **Ler o dado de produção antes de afirmar qualquer coisa.** Vários erros
  desta sessão vieram de deduzir pelo código. Há scripts de consulta rápida
  com `@supabase/supabase-js` + `SUPABASE_SERVICE_ROLE_KEY` do `.env.local`.
  Rodar de dentro de `pdv-vargas-web/`, senão não resolve o módulo.
- **`npx tsx arquivo.ts`** permite chamar as libs reais (foi assim que a
  escrita da Nuvemshop foi testada). Top-level await não funciona: envolver
  em `async function main()`.
- **Não abro a aplicação.** Nenhuma mudança de tela desta sessão foi
  conferida visualmente — a verificação é do Silvano, e foi ela que pegou os
  dois bugs do menu no celular.
- **Migração antes do deploy — e conferir, não perguntar.** Código que lê ou
  grava coluna nova quebra a consulta INTEIRA se o SQL não tiver rodado. Em
  14/08 isso ia derrubar a busca do PDV: bastava um `select` da coluna nova
  para a tela que vende parar. O jeito certo é **checar as colunas no banco
  antes de publicar** (um `select` da coluna em `limit(1)` responde na hora),
  em vez de confiar na memória de quem rodou o SQL. Foi assim que o deploy
  daquele dia foi segurado — e depois liberado.
- **O botão que só aparece no hover é armadilha recorrente.** Já aconteceu no
  menu do celular e no remover-item do pedido de compra. Sem hover no celular,
  o recurso simplesmente não existe para o operador. Se for ação, que seja
  visível.
- **O Next 16 renomeou Middleware para Proxy.** O arquivo é `src/proxy.ts`,
  e ele EXISTE neste projeto desde antes da loja: renova a sessão do Supabase,
  manda o `x-pathname` que o layout do dashboard usa e faz o controle de
  acesso por tela. Procurar por `middleware.ts`, não achar e concluir que não
  há camada de proxy é erro fácil — eu cometi, e sobrescrevi o arquivo. O
  `next build` passou, porque nada disso é erro de tipo.
- **`git status` no fim de cada fatia.** Foi ele que pegou o erro acima: o
  arquivo aparecia como *modificado* em vez de *novo*. O compilador não
  protege contra arquivo sobrescrito.
- **Este arquivo fica desatualizado sozinho.** Atualizar ao terminar cada
  fatia, ou ele vira mentira com aparência de verdade.

---

## Editor de anúncios — no ar, e ainda não exercitado

`editor-anuncios` (`63e873f`) virou `16b3ff0` na `main` em 26/08, a pedido do
Silvano. 10 arquivos, ~2.000 linhas: edição de anúncio de marketplace
(`EditarAnuncioModal`, campo de atributo da Shopee, rota
`anuncios/[id]/editar`) mais lógica compartilhada extraída para
`lib/marketplace/conteudoAnuncio.ts` e `edicao.ts` — daí as 223 remoções nos
arquivos existentes: é refatoração, não exclusão.

O modal antigo tinha sete campos e gravava direto na tabela. O problema não era
o tamanho: `marketplace_anuncios` é um **espelho**, e o sync sobrescreve
título, descrição, fotos e preço a cada rodada. Editar só aqui era escrever na
areia, e a tela não avisava. O editor novo manda a alteração para a plataforma
e relê o resultado.

**O que ainda não aconteceu: um `update_item` de verdade na Shopee e um
`PUT /items` de verdade no ML.** `tsc` limpo e `next build` completo não
provam nada sobre o que a API aceita — a montagem do `attribute_list`, o
reaproveitamento de `image_id` na reordenação e o limite de 9 fotos só serão
testados no primeiro salvamento real.

Primeiro uso recomendado: um anúncio **pausado ou de pouca saída**, mudando
uma coisa de cada vez (só a ordem das fotos; depois só um atributo), conferindo
no painel da plataforma entre uma e outra. O que a plataforma recusar aparece
como aviso na tela, com a mensagem original dela.

Fora do escopo, de propósito e escrito na tela: **trocar a categoria** (zera os
atributos e o ML só permite em condições específicas) e **criar ou remover
variação** (a API pede o conjunto inteiro de uma vez; mexer nisso pelo lado
errado zera o estoque das existentes).

---

## Continuar noutro computador

O repositório é a única coisa que atravessa. `README.md` tem o passo a passo
(clone, `npm install`, `vercel env pull .env.local`) e `.env.example` lista
**todas** as chaves de ambiente — ele estava desatualizado com duas, agora tem
as nove que o código realmente lê.

O que **não** atravessa, e vale conferir antes de trocar de máquina:

- **A sessão do Claude Code é local** (`~/.claude/projects/`). Noutro
  computador se começa do zero — este arquivo e o `docs/` são o repasse.
- **`.env.local` nunca é versionado.** Sem ele a aplicação sobe e não acha
  dado nenhum. É o erro mais provável no primeiro dia da máquina nova.
- **Duas pastas irmãs não estão em git nenhum**, medido em 26/08:
  `extensao-chrome/` (5 arquivos — o leitor de anúncios do ML) e
  `vargas-entrada-agent/` (33 arquivos — o bot de WhatsApp da entrada de
  mercadoria). Existem só neste computador. Trocar de máquina sem versioná-las
  é perdê-las.
- `vargasnexus-pdv/` tem um `PROMPT-CORRECOES.md` sem commit; os outros repos
  da casa (`sistemavargas`, `vargas_app`, `vargasnexus-pdv`) estão em dia com o
  GitHub.
