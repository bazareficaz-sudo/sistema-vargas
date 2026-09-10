# Fase 0.6C.4 — propagação segura de cancelamento de orçamentos

**Data:** 10/09/2026 · **Escopo:** só a propagação de cancelamento na descida.
**Não toca:** registrarVenda, vendas, venda_itens, recebimentos, contas_receber,
Caixa/Tesouraria, sangria, suprimento, RLS, grants, `anon`, terminal auth,
`faltas`, idempotência, upload autenticado, número oficial, sincronização de
itens, conversão em venda. Nenhuma flag alterada.

---

## 1. Auditoria do comportamento atual

### Como o cancelamento é gravado no servidor

Tabela `orcamentos`. Coluna `status`, valores presentes hoje:

```
aberto ....... 57
cancelado .....  1
```

Colunas relevantes: `status`, `updated_at`, `revisao`, `terminal_id`. **Não
existe** `cancelado_em` nem tabela de auditoria.

Dois caminhos gravam o cancelamento:

| Caminho | O que faz | Revisão | Itens |
|---|---|---|---|
| legado `atualizarStatusOrcamento` | `update({ status })` pelo `anon` | não mexe | não mexe |
| rota autenticada `orcamentos.cancelar` | RPC `salvar_orcamento_pdv` | **avança** | substitui |

`updated_at` se move nos dois casos — o legado escreve só `status` e mesmo assim
o `updated_at` do nº7 mudou, o que prova um gatilho no banco. Dez dos 58
documentos têm `updated_at ≠ created_at`.

O único cancelado hoje, o **nº7**, tem `revisao = 0` e `terminal_id = null`: foi
cancelado pelo legado, 2h33 depois de criado, em 02/08/2026.

### Como o PDV representa status local

```
aberto ....... 54    ← nasceram do cloud
pendente ......  3    ← criados aqui
```

`aberto` **não pertence** ao vocabulário local: `registrar()` grava `pendente`,
`cancelar()` grava `cancelado`, `marcarConvertido()` grava `convertido`. O
`aberto` só entra por linha inserida pela descida.

Regras de ação no renderer — **três lugares, três formas**:

| Onde | Regra |
|---|---|
| botões da lista (editar/converter) | `status === 'pendente' \|\| status === 'aprovado'` |
| botão da lista (cancelar) | `status !== 'cancelado' && status !== 'convertido'` |
| modal de detalhe (`podeAcionar`) | `status !== 'cancelado' && status !== 'convertido'` |
| guarda de `abrirEdicao` / `converterEmVenda` | `status !== 'cancelado' && status !== 'convertido'` |
| guarda de `cancelar()` | **não existia** |

As três concordam no que importa aqui — cancelado bloqueia — mas `cancelar()`
só era protegido pelo botão escondido. Botão escondido não é regra.

### Descida atual

```js
supabase.from('orcamentos').select('*')
  .in('status', ['aberto'])              // ← a lacuna
  .order('created_at', {ascending:false}).limit(200)
```

`_mapOrcamentoRemoto` devolve `status` sempre `'aberto'` (por construção da
consulta) e `cliente_telefone` sempre `null`. `reconciliarDoCloud` escreve
`numero`, `cliente_nome`, `total`, `synced_at` — e **deliberadamente não escreve
`status`** desde a 0.6C.3, justamente porque a coluna não carregava informação.

### Dados reais

```
servidor ......... 58 (57 aberto + 1 cancelado)
local ............ 58
divergências servidor=cancelado / local=ativo ....... 0
remotos ausentes daqui .............................. 1  (o nº7)
```

**Não há vítima hoje neste terminal.** A lacuna é real, mas não está
instanciada aqui: o nº7 foi cancelado antes de este terminal baixá-lo.

### Cenário nº7

```
servidor:  87c64fa6-b768-4f99-b3fc-0c75895a29d5  cancelado  R$ 529,99
           criado 02/08 18:06 · cancelado 02/08 20:39 · revisao 0 · 1 item
local:     NÃO EXISTE
```

Corrijo aqui uma afirmação minha da fase anterior: eu disse que o nº7 "chegou
aqui em algum momento anterior e continua com o registro local dele". Está
errado — ele nunca chegou. A 58ª linha local é o resquício Base44 (`fe3fd121…`
/ `6a481d1dc98da82e12921a85`, nº1, R$ 2,18), que o servidor não tem.

## 2. Causa da divergência

A consulta de descida filtra `status IN ('aberto')`. Cancelar remove o
documento do conjunto sincronizado, então o cancelamento é **invisível** para
quem já tinha o documento. Não é falha de escrita: é ausência de canal.

## 3 e 4. Desenho escolhido, e por quê

Dois fluxos conceituais, como pedido:

```
A) ativos      → intocado, exatamente como validado na 0.6C.3
B) tombstones  → "quais dos documentos QUE EU CONHEÇO você já cancelou?"
```

```sql
-- antes: não existia
-- depois:
select id, numero, status from orcamentos
 where status = 'cancelado'
   and id in (<identidades locais, em lotes de 100>)
   and empresa_id = <empresa>
```

Descartei as alternativas:

| Opção | Por que não |
|---|---|
| `status IN ('aberto','cancelado')` na consulta A | cancelados passariam a consumir o `limit 200`, crescendo sem limite; e obrigaria a mexer no fluxo A, que acabou de ser validado |
| baixar todo cancelado que existe | cresce com o histórico, indefinidamente |
| cursor incremental por `updated_at` | exige estado persistido novo e tem partida a frio; ganho nulo diante da opção escolhida |

Perguntar só pelas identidades locais tem três propriedades que as outras não
têm: o custo é limitado **pela tabela local** (já capada em 200) e não pelo
histórico; **nunca volta tombstone que teria de ser descartado** — o que é
coerente com a regra de que cancelamento não cria documento; e o fluxo A não é
tocado.

**O filtro de UUID não é decoração.** Este terminal tem o resquício Base44, e
mandar `6a481d1dc98da82e12921a85` numa coluna `uuid` derruba a consulta inteira:

```
400 {"code":"22P02","message":"invalid input syntax for type uuid: \"6a481d1dc98da82e12921a85\""}
```

Medido antes de escrever o código. Um id de outra era não pode cegar a
sincronização de todos os demais. Na cópia real: 58 identidades, 57 uuids, 1
descartada.

## 5. O que o tombstone escreve

`status` e `synced_at`. Só.

Mesma regra da 0.6C.3 — **não se escreve coluna que o payload não consegue
expressar**. O tombstone diz uma coisa: "este documento foi cancelado".

| Preservado | |
|---|---|
| `id`, `remote_id` | identidade nunca é reescrita |
| `numero` | referência comercial |
| `total`, `subtotal`, `cliente_nome`, `created_at` | não vêm no tombstone |
| itens | não são tocados |
| `revisao_base` | **não avança** |
| fila | não é tocada |

`revisao_base` merece a explicação: a descida traz só o **cabeçalho**. Adotar a
revisão do servidor sem os itens correspondentes deixaria este terminal declarar
que partiu de um estado que ele não tem, e sobrescrever os itens de outro
terminal na próxima edição. É a perda silenciosa que esta fase inteira existe
para remover.

### Vocabulário

```js
const STATUS_REMOTO_PARA_LOCAL = { cancelado: 'cancelado' };
```

Tradução explícita e mínima. `aberto` remoto corresponde a `pendente` local —
confundir os dois foi o que fez a 0.6C.3 parar de escrever `status` na descida
A. `cancelado` é a **única** palavra que as duas pontas usam com o mesmo
sentido, e é a única que o mapa cobre.

## 6. Conflito: operação local pendente

Servidor cancelado + operação local ainda na fila **não se resolve sozinho**.

| | |
|---|---|
| status local | não é sobrescrito |
| `sync_status` | intacto |
| `op_chave` | **sobrevive** — é ela que impede um segundo efeito quando a operação subir |
| fila | não é apagada nem marcada |
| `conflito_em` | marcado **uma vez**, para o conflito existir no dado e não só no log |

`conflito_em` é estrutura que já existia (`marcarConflito`) e que ninguém lê —
usá-la sozinha, sem mexer em `sync_status`, é o uso mais fiel: "olhe este
documento". Reusar `marcarConflito` seria errado, porque ele limpa `op_chave`.

```
[SYNC] Orçamento nº60: cancelamento remoto não aplicado —
       existe operação local pendente (pending, com chave de operação viva).
```

## 7. Identidade ambígua

Mesma disciplina da 0.6C.3, sem `LIMIT 1`:

```
0 correspondências  → NÃO cria documento (seria inventar histórico)
1 correspondência   → aplica
2 ou mais           → nada é alterado, vai inteiro para o log
```

```
[SYNC] Orçamentos cancelados: identidade_ambigua — cloud X (nº99)
       casa com ids locais [A, X] remote_ids [X, null] — nada alterado
```

## 8. Renderer

`lib/acoesOrcamento.js` passa a ser o único lugar onde as regras vivem, e
`cancelar()` ganha a guarda que não tinha. **Nenhuma regra foi afrouxada nem
alargada** — a assimetria entre o `aberto` do cloud e o `pendente` local
continua como estava, é dívida de outra fase. O único comportamento novo é
`cancelar()` recusar o que já acabou.

Isto importa agora porque, a partir desta fase, `cancelado` chega **sozinho**,
vindo de outro terminal, sem ninguém clicar em nada aqui.

## 9. Testes

**86 no total, 13 falham no comportamento anterior.**

Os 20 cenários pedidos estão cobertos. O teste de isolamento usa de propósito
uma falha que **não** é a ambiguidade nem o desconhecido — um `id` que o SQLite
não consegue ligar: o isolamento não pode depender de eu ter previsto o defeito.

Abre a suíte um teste chamado *"O DEFEITO"*, que documenta a lacuna: com só o
fluxo A, a linha local de um documento cancelado permanece ativa.

## 10. Prova contra cópia do banco real

`VACUUM INTO`; o banco vivo só aberto em `readonly`.

**Cenário A — a cópia como está hoje**

```
ciclo 1:  58 identidades (57 uuid, 1 descartada) | 0 túmulos → nada
ciclo 2:  idem
diferenças: (nenhuma)
```

**Cenário B — semeando na CÓPIA o nº7 real, como se tivesse sido baixado antes
do cancelamento**

```
ciclo 1:  1 túmulo → aplicados=1  ja_cancelados=0  conflitos=0  falhas=0
ciclo 2:  1 túmulo → aplicados=0  ja_cancelados=1
ciclo 3:  1 túmulo → aplicados=0  ja_cancelados=1

diferenças em relação ao semeado:   pendente: 4 → 3  ·  cancelado: 0 → 1

nº7 local   id=87c64fa6 remote=87c64fa6 nº7 cancelado/synced rev=0 R$529,99
            1 item preservado · conflito_em null
nº60        rev 3, R$ 276,30, pendente          ← intacto
nº59        id=d87547a7 remote=ee29e3b9         ← id ≠ remote preservado
fila 52 / 0 pendentes · itens 5 · identidades 59 = linhas 59 · integridade ok
```

Duas linhas mudaram de coluna: nenhuma outra.

## 11. Riscos residuais

1. **Só cancelamento propaga.** `convertido` e `aprovado` continuam sem canal —
   a consulta de ativos ainda filtra `aberto`. Não foi ampliado de propósito.
2. **A janela ainda existe para quem nunca baixou.** Um documento cancelado
   antes de este terminal conhecê-lo permanece desconhecido, e é isso que
   deve acontecer — mas significa que a lista deste terminal não é o histórico
   completo da empresa.
3. **Uma requisição a mais por ciclo.** Pequena (`select id,numero,status` com
   filtro), limitada a 200 identidades em lotes de 100.
4. **Os 54 orçamentos com `status='aberto'` local** seguem fora do vocabulário
   local e sem botões de editar/converter. Dívida separada, não tocada.
5. **Não rodou no app real.** A prova é contra cópia; a 1.9.7 está construída e
   **não publicada**, e os outros terminais seguem sem esta correção.
6. **`pdv_operacoes` e `pdv_terminais` seguem sem leitura** nesta sessão.

## 12. Entrega

| Arquivo | |
|---|---|
| `src/main/orcamentoSql.js` | `STATUS_REMOTO_PARA_LOCAL`, `SQL_MARCAR_CANCELADO`, `SQL_MARCAR_CONFLITO_DE_CANCELAMENTO`, `aplicarCancelamentosDoCloud`; `SQL_LOCALIZAR_DO_CLOUD` passa a trazer `status` e `op_chave` |
| `src/main/api.js` | `orcamentosCanceladosNoServidor` (filtro de UUID, lotes de 100) |
| `src/main/database.js` | `identidadesConhecidas`, `aplicarCancelamentos` |
| `src/main/sync.js` | `syncDownCancelamentosOrcamentos` + telemetria |
| `src/renderer/lib/acoesOrcamento.js` | **novo** — as regras de ação num lugar só |
| `src/renderer/pages/orcamentos.js` | usa as regras; `cancelar()` ganha guarda |
| `src/renderer/index.html` | carrega o módulo |
| `tests/orcamento-cancelamento.test.js` | **novo** — 28 testes |

`vargasnexus-pdv` — commit `7279b1a`, versão **1.9.7**, instalador
`dist/VargasNexus PDV Setup 1.9.7.exe`.
**Não publicado. Sem push. Nenhuma flag alterada.**
