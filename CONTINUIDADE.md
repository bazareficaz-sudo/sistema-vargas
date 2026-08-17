# Continuidade — onde paramos

Anotações para retomar o trabalho numa sessão nova. Não é documentação do
sistema: é o estado de quem estava com a mão na massa.

Última atualização: 17/08/2026

Tudo que está descrito aqui como pronto está **no ar** (último deploy:
`79c82c8`, com as migrações do dia já rodadas).

---

## Em andamento

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

**Faltam:** fatia 3 (fornecedor × produto: lead time, quantidade mínima,
múltiplo de caixa, vínculo pedido↔entrada), fatia 4 (lista de compra →
agrupar por fornecedor → pedido), fatia 5 (IA sobre o que a regra não vê),
fatia 6 (histórico de ruptura e das decisões do comprador).

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

### Qualidade dos anúncios — parou na metade

`supabase-marketplace-qualidade.sql` **já foi rodado**. As colunas
`qualidade_health / _score / _faltas / _em` existem e os 8.117 anúncios foram
avaliados. O cálculo roda a cada sincronização (`src/lib/marketplace/qualidade.ts`).

**Falta a tela:** coluna Qualidade na listagem de Anúncios, filtro por falta
("mostrar os 3.537 sem EAN") e painel por anúncio com os botões que resolvem
cada pendência.

**Achado importante, medido — não repetir o erro:** o checklist do sistema
**não prevê** o `health` oficial do ML. Anúncios com health ≥0,80 dão score
médio 56; abaixo de 0,80, 54. A tela deve mostrar **o health do ML** como a
nota no Mercado Livre, e usar o checklist só como lista do que falta. Para
nota itemizada de verdade no ML o caminho é o endpoint `/items/{id}/health`
(7.692 chamadas, passada à parte).

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
- **Este arquivo fica desatualizado sozinho.** Atualizar ao terminar cada
  fatia, ou ele vira mentira com aparência de verdade.
