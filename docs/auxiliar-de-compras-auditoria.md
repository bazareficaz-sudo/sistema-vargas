# Auxiliar de Compras — auditoria da estrutura atual

Levantamento feito em 17/08/2026, direto no banco de produção e no código dos
dois PDVs. Números reais, não estimativa.

O objetivo desta etapa é responder uma coisa só: **o que já existe, e sobre o
que dá para construir um motor de reposição sem inventar dado que o sistema
não tem.**

---

## Resumo em uma página

O módulo é viável e boa parte da fundação já está no sistema — pedido de
compra, histórico de custo por fornecedor, cobertura em dias, giro, e uma
tabela de faltas que o PDV do balcão já alimenta.

Mas três fundações estão quebradas ou vazias, e um motor de reposição rodando
sobre elas hoje produziria recomendações confiantes e erradas:

1. **O sistema acha que a loja está vazia.** 13.284 dos 14.281 produtos ativos
   estão com estoque exatamente zero; 586 com estoque negativo; só 411 com
   estoque positivo. Toda conta de cobertura, ruptura e ponto de reposição
   parte do estoque atual.
2. **A falta anotada pelo vendedor chega truncada.** Três bugs no caminho entre
   a tela do PDV e o banco fazem a quantidade sempre virar 1, o telefone do
   cliente sempre virar nulo, e o vendedor nunca ser identificado. E não existe
   campo que separe falta de encomenda — o modal se chama "Anotar Falta /
   Encomenda" e grava as duas coisas igual.
3. **O histórico de vendas tem seis semanas.** 1.455 vendas no total, das quais
   1.035 são de agosto. 1.112 produtos distintos já venderam alguma vez — 92%
   do catálogo nunca vendeu dentro deste sistema.

Nenhum desses três problemas impede o módulo. Todos os três mudam o que ele
deve dizer no primeiro semestre de vida: menos "compre 62 unidades", mais
"este produto está sendo procurado e o sistema não sabe seu estoque".

---

## 1. Onde estão hoje as faltas e encomendas do PDV

### A tabela

`faltas` — existe, sem RLS (`ALTER TABLE faltas DISABLE ROW LEVEL SECURITY`).

| coluna | tipo |
| --- | --- |
| id, empresa_id, produto_id | uuid |
| produto_nome, produto_sku | text |
| cliente_nome, cliente_telefone | text |
| quantidade_solicitada | numeric |
| observacao, status, origem, usuario_nome | text |
| created_at, updated_at | timestamptz |

**11 registros**, todos `origem = 'pdv'`, todos `status = 'pendente'`, de
02/08 a 16/08. Todos com `quantidade_solicitada = 1`, `cliente_nome` nulo,
`cliente_telefone` nulo, `usuario_nome` nulo.

### Quem escreve e quem lê

- **Escreve:** só o PDV externo (`vargasnexus-pdv`).
  - Tela: `src/renderer/pages/pdv.js:445` — modal "📋 Anotar Falta / Encomenda"
  - Local (SQLite): `src/main/database.js:1537`
  - Sobe para o Supabase: `src/main/sync.js:534` → `src/main/api.js:668`
- **Lê de volta:** o próprio PDV, a cada sync (`sync.js:338` →
  `api.js:695`), filtrando `status in ('pendente','notificado','comprado')`.
- **Painel web:** nenhuma linha de código toca em `faltas`. Zero telas.
- **PDV interno** (`PDVClient.tsx`): não registra falta. O botão não existe.

Isso é uma boa notícia para o item 30 do pedido (retorno para o vendedor): **o
canal de volta já está pronto**. Se o painel mudar o `status` da falta, o PDV
do balcão puxa a mudança sozinho no próximo sync. O vocabulário atual
(`pendente`, `notificado`, `comprado`) é curto, mas o caminho existe.

### Os quatro problemas na captura

Comparando a tela com o gravador:

| a tela manda (`pdv.js:490`) | o banco grava (`database.js:1548`) | resultado |
| --- | --- | --- |
| `quantidade: qty` | `falta.quantidade_solicitada \|\| 1` | **sempre 1** |
| `cliente_whatsapp: wa` | `falta.cliente_telefone` | **sempre nulo** |
| — | `falta.usuario_nome` | **nunca enviado** |
| — | não existe coluna `tipo` | falta e encomenda indistinguíveis |

Também não há campo de observação, prazo desejado nem preço negociado na tela.

Os itens 1, 2 e 30 do pedido dependem inteiramente desses quatro consertos. Sem
eles, "9 unidades solicitadas por 5 clientes" não tem de onde sair — o sistema
só saberia dizer "7 vezes, 1 unidade cada, cliente desconhecido".

---

## 2. Estoque

### O número que trava tudo

Produtos ativos: **14.281**

| situação | quantidade |
| --- | --- |
| estoque = 0 | 13.284 |
| estoque < 0 | 586 |
| estoque > 0 | **411** |

Dos 295 produtos vendidos nos últimos 30 dias que puderam ser cruzados com o
cadastro, **185 estão com estoque negativo**. O padrão é claro: o produto sai
na venda, o saldo desce, e o saldo nunca tinha sido carregado. A loja tem
mercadoria na prateleira; o sistema não sabe.

Não existe inventário registrado (`inventario_itens` = 0 linhas).

**Consequência direta para o módulo:** cobertura em dias, previsão de ruptura,
ponto de reposição, estoque de segurança e excesso de estoque (itens 5, 6, 8,
9, 10, 16) são todos função do estoque atual. Rodando hoje, o Auxiliar diria
"comprar" para 13.870 produtos.

### Duas tabelas, dois números

- `produtos.estoque` — campo único, é a fonte de verdade dos fluxos (venda,
  entrada, ajuste).
- `produto_estoque` — saldo por depósito, 28.697 linhas. É um espelho, e
  divergiu.

Amostras medidas hoje:

| produto | `produtos.estoque` | `produto_estoque` |
| --- | --- | --- |
| VASSOURA PIAÇAVA N.0 | 9 | 12 |
| PARAF MAD 4,8 × 40 | 336 | 362 |
| BUCHA TRIFIX 10 | 394 | 464 |

Em `produto_estoque`: 350 linhas positivas e **383 negativas**. Isso já está
documentado em `src/lib/produtos/depositoPrincipal.ts` — o espelho passou a ser
alimentado por diferenças quando o sistema já tinha saldo, e o saldo daquele
momento nunca foi copiado para lá.

O módulo deve ler **`produtos.estoque`**, não o espelho.

### Depósitos

| depósito | empresa | ativo | linhas | qtd > 0 |
| --- | --- | --- | --- | --- |
| Padrão | Bazar Eficaz | sim | 14.368 | 350 |
| Principal | Bazar Eficaz | **não** | 14.329 | 0 |
| Depósito Principal | Ouro e Prata | sim | 0 | 0 |

`transferencias_estoque`: **0 registros**.

**Item 17 (consultar outro depósito antes de comprar) não tem onde acontecer
hoje.** Existe um depósito operante. A estrutura precisa nascer preparada, mas
a funcionalidade fica inerte até existir um segundo depósito com saldo.

### Estoque mínimo

`produtos.estoque_minimo > 0`: **20 produtos** de 14.281.
`produto_estoque.estoque_minimo > 0`: **0**.
`estoque_maximo`: **0** em toda a base.

O item 3 (abaixo do mínimo) enxerga hoje 20 produtos. É exatamente por isso que
o pedido está certo em não querer "apenas uma lista de produtos abaixo do
mínimo" — essa lista praticamente não existe. O item 15 (o mínimo cadastrado
ainda faz sentido?) vira, na prática, **"sugerir um mínimo onde não há
nenhum"**, que é mais útil.

---

## 3. Vendas — a base de demanda

### Volume e alcance

| mês | vendas |
| --- | --- |
| 2026-05 | 3 |
| 2026-06 | 21 |
| 2026-07 | 396 |
| 2026-08 | 1.035 |

Total 1.455, todas `status = 'concluida'`. **História real: cerca de seis
semanas.**

Produtos distintos com alguma venda registrada: **1.112** — 7,7% do catálogo.

Isso condena, por enquanto, as janelas de 90 e 180 dias e a sazonalidade (itens
4 e 11). Média de 7/15/30 dias é sustentável. O módulo precisa marcar
explicitamente o que é "histórico insuficiente" (item 33 do pedido, que já
prevê isso) — e isso vai valer para a grande maioria do catálogo no começo.

### Dois lugares guardam o item da venda

- `vendas.itens` (jsonb): 1.351 vendas com itens, **2.400 itens**, desde 08/05.
- `venda_itens` (tabela): **2.513 linhas**, mas só desde **08/07**.

Nenhum dos dois é completo sozinho. 104 vendas não têm item em lugar nenhum.
O motor precisa unir as duas origens — igual ao que
`/api/pedidos-compra/historico-fornecedor` já faz com entrada manual e XML.

Atenção: o relatório atual `/dashboard/relatorios/estoque` lê **só**
`venda_itens`, então ele está subestimando a demanda de maio a julho.

### Ids antigos do Base44

471 linhas de `venda_itens` (28/07 a 31/07) têm `produto_id` no formato antigo
(`6a0319b4c53a128870a943a2`), que não casa com `produtos.id` (uuid). O mesmo
aparece em 501 itens do jsonb. O cruzamento precisa cair para `produto_sku`
quando o id não for uuid.

### Marketplace é uma segunda fonte de demanda do mesmo tamanho

| | |
| --- | --- |
| `marketplace_pedidos` últimos 90 dias | 1.272 |
| últimos 30 dias | 1.053 |
| `marketplace_pedido_itens` | 1.274 |
| **com `produto_id` preenchido** | **458** |

Metade da saída de mercadoria da empresa é marketplace, e **64% desses itens
não estão amarrados a um produto do cadastro**. Ignorar essa fonte faz o motor
subestimar a demanda pela metade nos produtos anunciados. Considerar essa fonte
exige melhorar o mapeamento — trabalho já iniciado no módulo de anúncios.

---

## 4. Fornecedores

`fornecedores`: **16 cadastrados**. Campos: razão social, fantasia, CNPJ, IE,
telefone, e-mail, contato, endereço, ativo.

**Não existe:** prazo de entrega, pedido mínimo, condição de pagamento padrão,
confiabilidade.

**`produtos` não tem `fornecedor_id`.** Só `codigo_fornecedor` (texto),
preenchido em **127 de 14.471** produtos. Não existe quantidade mínima nem
múltiplo de embalagem em lugar nenhum.

Portanto os itens 7, 19, 20 e 21 precisam de estrutura nova — não há o que
reaproveitar.

### O que já existe e é bom

O histórico de compra por fornecedor **já está calculado e correto**, unindo as
duas origens de compra:

- `src/app/api/pedidos-compra/historico-fornecedor/route.ts`
- `src/app/api/pedidos-compra/produtos-fornecedor/route.ts`

Ambos leem `entradas + entrada_itens` (manual) **e** `nfe_entradas + nfe_itens`
(XML), e produzem último custo, custo médio, última compra e última quantidade
por produto/fornecedor. É exatamente o item 19 do pedido, pronto.

Volume disponível: 38 entradas manuais / 214 itens; 15 notas por XML / 170
itens. Pouco, mas é histórico real.

### Lead time real (item 7)

Precisa da diferença entre data do pedido e data da entrada. Hoje **entradas
não referenciam pedidos de compra** — não há coluna de vínculo em nenhuma das
duas. E há 6 pedidos de compra no total, sendo 1 enviado.

Ou seja: o prazo médio real só começa a existir meses depois de o vínculo ser
criado. O módulo deve nascer com prazo **cadastrado à mão** por fornecedor, e o
cálculo automático entra quando houver amostra.

---

## 5. Pedidos de compra

`pedidos_compra` (6 registros: 1 enviado, 5 rascunhos) + `pedidos_compra_itens`
(28). Numeração automática por empresa via trigger. Cancelamento, envio por
WhatsApp e listagem já implementados.

Código: `src/components/pedidos-compra/` (NovoPedidoClient 1.471 linhas,
PedidosCompraListClient, EnviarPedidoWhatsappModal) e
`src/app/api/pedidos-compra/`.

**O item 27 (Lista de Compra) já é quase o rascunho de pedido.** A diferença
real é uma só: a lista nasce **sem fornecedor** e com produtos de vários
fornecedores misturados, e só depois é quebrada por fornecedor (item 28). Um
`pedidos_compra` em rascunho exige um fornecedor por pedido.

Por isso a lista intermediária se justifica — mas leve, e descartável assim que
vira pedido.

Falta hoje, para os itens 18 e 29:
- nenhum jeito de saber o que já está pedido: não há vínculo pedido → entrada,
  nem status de recebimento parcial;
- `pedidos_compra` não tem de onde veio (manual × sugerido pelo Auxiliar).

---

## 6. Multiempresa

O choke point já existe e é usado em todo endpoint novo:

- `src/lib/auth/empresaAtiva.ts` — `perfilDaSessao()`, `empresasDoUsuario()`,
  cookie `empresa_ativa` validado no servidor contra `usuario_empresas`
- `empresa_do_meu_grupo()` no banco consulta `usuario_empresas`
- `SeletorEmpresa` na barra lateral

Situação real: **2 empresas, mesmo grupo e mesmo tenant.** Bazar Eficaz tem
14.470 produtos e 1.455 vendas; **Ouro e Prata tem 0 produtos, 0 vendas, 0
estoque**. `estoque_unificado_participantes` liga o Bazar ao depósito da Ouro e
Prata, mas `estoque_unificado_ativo` está ligado só de um lado.

Conclusão prática: o isolamento entra na arquitetura desde a primeira linha
(toda consulta filtra por `empresa_id` vindo de `perfilDaSessao`), mas não há
como testar compartilhamento de verdade hoje.

Uma pendência de segurança a resolver junto: **`faltas` está sem RLS**.

---

## 7. O que já existe e NÃO deve ser duplicado

### `/dashboard/relatorios/estoque` — "Estoque & Giro"

`src/app/dashboard/relatorios/estoque/page.tsx` + `EstoqueBIClient.tsx`.

Já calcula: cobertura em dias, giro 30 dias, capital investido, vendido 30
dias, capital por categoria. Já tem abas Críticos / Parados / Sem estoque e
faixas de cobertura coloridas.

É o embrião do Auxiliar de Compras. **E é exatamente o modelo de arquitetura
que o item 40 do pedido proíbe**: lê os 14.281 produtos e recalcula tudo a cada
abertura de tela.

Decisão a tomar: o Auxiliar absorve essa tela, ou ela vira um link para dentro
dele. Manter as duas com contas diferentes é garantir que um dia mostrem
números diferentes para a mesma pergunta.

### `automacoes` → Regras de Reposição

`src/components/automacoes/RegrasReposicao.tsx`, rodando no cron
`/api/cron/automacoes` a cada 5 minutos. Quatro tipos de regra já existentes:

- alerta de estoque mínimo
- **pedido de compra automático (rascunho)**
- reposição por giro (curva ABC)
- produtos parados

Ou seja: **já existe um mecanismo que cria rascunho de pedido de compra
sozinho, e já existe uma noção de curva ABC**. Se o Auxiliar nascer sem
reconciliar com isso, os dois vão criar rascunhos concorrentes para o mesmo
produto.

### Outros reaproveitáveis

- `src/lib/ia/claude.ts` — `perguntarJSON()`, haiku por padrão,
  `MODELO_FORTE = 'claude-sonnet-5'`
- `src/lib/produtos/promocao.ts`, `depositoPrincipal.ts`, `estoqueUnificado.ts`
- `zapiSendText` (WhatsApp) e `EnviarPedidoWhatsappModal`
- Cron da Vercel: 5 entradas já configuradas em `vercel.json`

---

## 8. Estruturas que precisam ser criadas

### Tabelas novas

| tabela | para que | itens do pedido |
| --- | --- | --- |
| `fornecedor_produto` | fornecedor × produto: lead time, qtd mínima, múltiplo de caixa, custo, preferencial | 7, 19, 20, 21 |
| `reposicao_metricas` | materialização por produto/empresa: vendas 7/15/30/60/90/180, média diária, tendência, cobertura, previsão de ruptura, score, classe ABC, motivos | 4, 5, 6, 10, 12, 13, 14, 40 |
| `reposicao_config` | regras por empresa (cobertura alvo, faixas, pesos, o que considerar) | 39 |
| `reposicao_decisoes` | sugerido × aceito × alterado × comprado × recebido | 31, 32 |
| `reposicao_rupturas` | períodos com saldo zero, dias parado, solicitações durante a ruptura | 34, 35 |
| `compras_lista` + `compras_lista_itens` | lista intermediária multi-fornecedor antes do pedido | 26, 27, 28 |

Observação sobre o item 1 ("não criar diversas linhas para o mesmo produto"): a
agregação deve ser **na leitura, não na gravação**. Cada solicitação é um
evento com data, cliente e vendedor — juntar na hora de gravar perderia
"5 clientes diferentes" e "primeira solicitação em 03/08". A tela agrupa por
produto e mostra o consolidado.

### Alterações em tabelas existentes

| tabela | alteração |
| --- | --- |
| `faltas` | `tipo` (falta \| encomenda), `deposito_id`, `vendedor_id`, `prazo_desejado`, `preco_negociado`, `quantidade_atendida`, `pedido_compra_id`, **RLS**, índices |
| `fornecedores` | `prazo_entrega_dias`, `pedido_minimo_valor`, `condicao_pagamento_padrao` |
| `produtos` | `fornecedor_padrao_id` (resolve os 127 `codigo_fornecedor` soltos) |
| `pedidos_compra` | `origem` ('manual' \| 'auxiliar'), `lista_id` |
| `entradas` e `nfe_entradas` | `pedido_compra_id` — destrava lead time real (7) e "já tem pedido em aberto" (18) |

### Índices necessários

```
faltas            (empresa_id, status, produto_id), (empresa_id, created_at)
venda_itens       (produto_id, created_at), (venda_id)
vendas            (empresa_id, status, created_at)
produtos          (empresa_id, ativo), (empresa_id, sku)
reposicao_metricas (empresa_id, score DESC), (empresa_id, prioridade), (produto_id)
pedidos_compra_itens (produto_id)
entrada_itens     (produto_id)
fornecedor_produto (empresa_id, produto_id), (fornecedor_id)
```

---

## 9. Como atualizar os indicadores sem derrubar o sistema

O item 40 do pedido está certo, e o relatório de estoque atual é a prova: 14
mil produtos recalculados a cada abertura de tela.

Proposta:

```
venda / entrada / ajuste / falta   →  marca o produto como "sujo"
                                       (fila leve ou estoque_movimentacoes do dia)
cron curto (a cada 15 min)         →  recalcula só os produtos sujos
cron noturno (1x por dia)          →  recalcula tudo, em lotes de 500
                                   →  fotografa quem está zerado (rupturas)
                                   →  recalcula classe ABC
tela                               →  só LÊ reposicao_metricas, com paginação
```

Limites da Vercel: função com `maxDuration` alto e processamento em lote, no
mesmo padrão de `/api/cron/automacoes` e da fila de anúncios.

**IA (item 11 e 37): nunca sobre 14 mil produtos.** Uma rodada por dia, sobre
os 30–50 produtos de maior score, com o resultado gravado em
`reposicao_metricas`. O "Entender sugestão" (item 10) e o "Por que este produto
apareceu aqui" (item 38) devem ser **texto montado por regra**, sem IA — são
fatos, e fatos não precisam de modelo. A IA entra para o que a regra não vê:
aceleração, queda, sazonalidade, mínimo inadequado, ruptura recorrente.

---

## 10. Ordem de implementação proposta

**Fatia 0 — pré-requisitos (decisão sua, não código meu)**

1. Consertar a captura da falta no PDV externo: quantidade, telefone, vendedor,
   e o campo que separa falta de encomenda.
2. Decidir o que fazer com o estoque zerado de 13.870 produtos — inventário,
   importação do saldo do sistema antigo, ou aceitar que o módulo comece
   trabalhando só com os ~1.100 produtos que já têm movimento.

Sem o item 2, o Auxiliar de Compras funciona, mas fala sobre um estoque que não
é o da loja.

**Fatia 1 — Faltas e Encomendas no painel**
Tela lendo `faltas`, agrupada por produto (7 solicitações, 5 clientes, 9
unidades, primeira em 03/08). Status muda no painel e volta para o PDV pelo
sync que já existe. RLS na tabela. Zero dependência de métrica — entrega valor
na primeira semana, com dado que já está sendo coletado há 15 dias.

**Fatia 2 — Motor de reposição, sem IA**
`reposicao_metricas` + `reposicao_config` + crons + tela principal: KPIs,
lista, filtros, visões rápidas, prioridade, score, cobertura, previsão de
ruptura, explicabilidade por regra. Absorve o relatório Estoque & Giro e
reconcilia com as Regras de Reposição das automações.

**Fatia 3 — Fornecedor**
`fornecedor_produto`, lead time cadastrado e real, quantidade mínima, múltiplo
de caixa, sugestão de fornecedor, vínculo pedido ↔ entrada.

**Fatia 4 — Lista de compra → pedido**
Seleção em massa, lista intermediária, agrupamento por fornecedor, geração do
pedido no módulo que já existe.

**Fatia 5 — IA**
Resumo do comprador, sinais que a regra não enxerga, leitura das faltas como
demanda perdida (item 34).

**Fatia 6 — Memória**
Histórico de ruptura, decisões do comprador, ABC por margem e lucro,
aprendizado.

---

## Números de referência (17/08/2026)

```
empresas                    2      (1 operante)
depósitos                   3      (1 operante, 1 inativo, 1 vazio)
produtos                    14.471 (14.281 ativos)
  estoque > 0                  411
  estoque = 0               13.284
  estoque < 0                  586
  estoque_minimo > 0            20
  preco_custo > 0           13.953
  codigo_fornecedor            127
produto_estoque             28.697 linhas (350 positivas, 383 negativas)
vendas                      1.455  (mai 3, jun 21, jul 396, ago 1.035)
venda_itens                 2.513  (desde 08/07)
vendas.itens (jsonb)        2.400  (desde 08/05)
produtos com alguma venda   1.112
marketplace_pedidos         1.272 em 90d  (1.053 em 30d)
marketplace_pedido_itens    1.274  (458 com produto_id)
estoque_movimentacoes       1.688  (desde 24/07)
entradas / itens            38 / 214
nfe_entradas / itens        15 / 170
fornecedores                16
pedidos_compra              6      (1 enviado, 5 rascunho)
faltas                      11     (todas pendentes, todas qtd 1)
transferências de estoque   0
inventários                 0
anúncios em marketplace     9.212
```
