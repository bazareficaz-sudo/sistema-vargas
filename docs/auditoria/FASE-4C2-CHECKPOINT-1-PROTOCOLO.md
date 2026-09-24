# Fase 4C.2 — Checkpoint 1: auditoria do Electron e desenho do protocolo

**24/09/2026 · auditoria e desenho.** Nenhum arquivo do Electron alterado,
nenhuma migration SQLite escrita, nenhum código de sincronização tocado.
Este documento é o que se revisa antes de autorizar as alterações no SQLite.

---

## PARADA OBRIGATÓRIA — há trabalho não commitado no Electron

O checkout principal `vargasnexus-pdv` está em
`codex/0.6d.3b-venda-v1` (`ea8ad6d`, v1.10.5, 7 commits à frente de
`origin/main`) **com 7 arquivos modificados e 6 novos, não commitados**:

```
 M package.json · package-lock.json
 M src/main/database.js · sync.js · terminal.js · protocoloVenda.js
 M tests/venda-v1-protocolo.test.js
?? docs/FASE-0.6D.3B-CHECKPOINT-LOCAL.md
?? tests/negociacao-protocolo.test.js · contrato-v1-prewrite.test.js
?? tests/helpers/{crash-venda.js, venda-sync.js}
?? AGENTS.md · PROMPT-CORRECOES.md
```

**O que é:** a Fase 0.6D.3B — negociação do protocolo v1 × legado.
Arquivos datados de **21/09**, três dias antes desta fase. Há aqui material
que não é meu: `contrato-v1-prewrite.test.js`, `tests/helpers/` e
`PROMPT-CORRECOES.md` não saíram do meu trabalho.

**Conflita com a 4C.2?** No conteúdo, **não**: o diff de `database.js` não
menciona pagamento em nenhuma linha. No estado, **sim** — não dá para
trabalhar num checkout com alterações pendentes de outra sessão sem risco de
sobrescrever.

**O que proponho:** a 4C.2 roda num **worktree isolado** do Electron, a
partir de um ponto definido por você — `origin/main`, o `ea8ad6d`, ou o
estado com a 0.6D.3B commitada. Não escolho sozinho porque a base muda o que
a 4C.2 herda.

---

## Provenance

| | |
|---|---|
| Web (worktree) | `fase-2/sangria-e-suprimento` · `4fa903e` · = remoto |
| Web `origin/main` | `d901d6a` |
| Electron | `codex/0.6d.3b-venda-v1` · `ea8ad6d` · v1.10.5 · +7 vs `origin/main` |
| Electron `origin/main` | `97312d9` |
| 4C.1 | `4fa903e` |

---

## A auditoria — 20 pontos

### O que já está pronto e ajuda

**O contrato já é versionado.** `payloadVendaV1.js` envia
`schema_version: 1`, e a RPC **valida explicitamente**:

```sql
IF coalesce((p_payload->>'schema_version')::int, 0) <> 1 THEN
  RETURN jsonb_build_object('estado','payload_invalido',
                            'motivo','schema_version deve ser 1');
```

A porta da v2 existe; está fechada e basta abri-la para aceitar `1` **e**
`2`. Não é preciso inventar mecanismo de versionamento.

**As migrations SQLite são idempotentes por construção** — lista de SQL com
`try/catch` silencioso, sem versionamento:

```js
for (const sql of migrations) {
  try { db.exec(sql); } catch { /* coluna já existe */ }
}
```

Já há precedente de `CREATE TABLE IF NOT EXISTS` nessa lista
(`produto_localizacao`). Instalação nova, existente, com vendas antigas ou
após fechamento abrupto: os quatro casos funcionam sem estado extra.

**A identidade já nasce na origem.** `vendas.registrar()` faz
`const id = uuidv4()` no terminal; a venda viaja com o id que nasceu no
SQLite. É o mesmo padrão que os pagamentos vão usar.

**A fronteira transacional já existe**, e é boa: `vendas.registrar()` é uma
`db.transaction` que grava venda, itens, estoque, movimentação e fila — tudo
ou nada. Os pagamentos locais entram nela, sem pipeline novo.

### O que a auditoria encontrou de problema

| # | Achado | Gravidade |
|---|---|---|
| 1 | O fingerprint da RPC inclui `forma_pagamento` mas **não** os pagamentos | **crítico** |
| 2 | A RPC recusa `schema_version ≠ 1` | alto (esperado; precisa abrir) |
| 3 | A fila **desiste após 5 tentativas** e marca como processada | alto |
| 4 | Não existe campo `pagamentos` no SQLite | esperado |

---

## O achado crítico: o fingerprint e a troca de versão

`venda_fingerprint_v1` inclui: `empresa_id`, `total`, `desconto`,
**`forma_pagamento`**, `orcamento_id` e os itens. **Não inclui pagamentos.**

Isso cria uma armadilha real no ponto 17 da auditoria — *atualização de
versão*:

```
1. terminal v1.10.5, offline, cria venda de R$ 150 (forma_pagamento='dinheiro')
2. tenta sincronizar → servidor COMMITA → a resposta se perde
3. terminal atualiza para a versão com pagamentos
4. a fila ainda tem a venda; o payload é remontado AGORA, em v2
5. o adaptador da Etapa D gera 1 pagamento e `forma_pagamento` permanece
   'dinheiro' → fingerprint IGUAL → a RPC devolve `ja_aplicada`
   → OS PAGAMENTOS NUNCA SÃO GRAVADOS, em silêncio
```

E o caso espelhado é pior:

```
se a venda tiver duas formas e `forma_pagamento` virar 'multiplo',
o fingerprint MUDA → `conflito_payload` → a venda trava na fila
```

Nenhum dos dois é hipotético: é o que acontece quando um terminal com fila
pendente é atualizado — exatamente o cenário do rollout.

**Como resolvo isso está na proposta abaixo, e é o ponto que mais quero sua
revisão.**

---

## O desenho proposto

### C — SQLite: uma tabela filha, aditiva

```sql
CREATE TABLE IF NOT EXISTS venda_pagamentos (
  id             TEXT PRIMARY KEY,      -- uuid, nasce aqui
  venda_id       TEXT NOT NULL,
  forma          TEXT NOT NULL,
  valor          REAL NOT NULL,
  valor_entregue REAL,                  -- só dinheiro
  troco          REAL,                  -- só dinheiro
  sequencia      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL
)
```

Entra na lista de migrations como `CREATE TABLE IF NOT EXISTS` — o mesmo
padrão que `produto_localizacao` já usa. Nenhuma coluna de `vendas` muda.

**Sem `empresa_id`, `usuario_id`, `terminal_id`**: são resolvidos no
servidor pelo contexto autenticado e pela venda, como a 4C.1 já faz
derivando a empresa por trigger. Duplicá-los localmente seria criar uma
segunda fonte para dado que o servidor já tem melhor.

**Sem backfill local.** Vendas antigas no SQLite não ganham pagamentos.

### D — O adaptador temporário

A UI não muda nesta fase. `vendas.registrar()` passa a gravar, **dentro da
transação que já existe**, um pagamento derivado do que a UI já produz:

| UI atual | Pagamento gerado |
|---|---|
| `dinheiro`, `valor_pago=50`, `troco=3` | 1 pagamento: `dinheiro`, valor 47, entregue 50, troco 3 |
| `pix`/`credito`/`debito`/`carteira` | 1 pagamento, entregue e troco **nulos** |
| **`misto`** | **nenhum pagamento** |
| `devolucao` | nenhum pagamento (não é pagamento) |

`misto` não gera nada, e a venda continua sincronizando pelo contrato
legado. É o que mantém o Electron atual funcionando até a 4C.3 sem inventar
composição.

> Nota: o valor aplicado do dinheiro é `total`, e o entregue é `valor_pago`.
> Hoje o PDV grava `valor_pago` = o que o cliente deu e `troco` = a
> diferença. O adaptador traduz sem inventar.

### E — Payload v2, aditivo

```jsonc
{
  "schema_version": 2,          // 1 continua aceito
  "venda_id": "…",
  "forma_pagamento": "…",       // mantido
  "valor_pago": 150, "troco": 0,// mantidos
  "pagamentos": [               // presente só quando schema_version = 2
    { "id": "uuid", "forma": "dinheiro", "valor": 47,
      "valor_entregue": 50, "troco": 3, "sequencia": 1 },
    { "id": "uuid", "forma": "credito", "valor": 100, "sequencia": 2 }
  ]
}
```

**A versão é a autoridade, não a presença do array.** `schema_version: 2`
significa "este cliente sabe enumerar pagamentos" — e se o array vier vazio
em v2, isso é informação (a venda é `misto` legado), não ausência de dado.
É o que a Etapa E pede ao dizer "não inferir apenas pela presença".

### F — Ingestão atômica

A RPC `sincronizar_venda_pdv_v1` já é transacional e idempotente. A
alteração é **dentro dela**, não um pipeline novo:

```
aceitar schema_version ∈ {1, 2}
   ↓
v2 com pagamentos → validar soma em centavos → inserir venda_pagamento
                    na MESMA transação da venda e dos itens
   ↓
o trigger de projeção preenche vendas.pagamentos automaticamente
```

Isso resolve o achado 3 de graça: como os pagamentos vão junto da venda, a
fila nunca pode desistir deles separadamente.

### O fingerprint — a proposta que precisa da sua revisão

O fingerprint passa a incluir os pagamentos **somente quando
`schema_version = 2`**:

```
v1 → fingerprint atual, inalterado
v2 → fingerprint atual + os pagamentos (id, forma, valor ordenados)
```

E acrescento um estado novo à RPC: quando a venda já existe com fingerprint
v1, chega em v2, e **os campos comuns batem**, o servidor não devolve
`conflito_payload` — ele **completa** a venda inserindo os pagamentos e
devolve `completada_v2`. É o mesmo desenho que `completada_de_legado` já usa
para vendas parciais, e que a 0.6D.2 provou.

Isso fecha a armadilha nos dois sentidos: a venda não trava e os pagamentos
não somem.

**Alternativa mais conservadora**, se você preferir: manter o fingerprint
como está e aceitar que vendas já sincronizadas em v1 **nunca** ganhem
pagamentos normalizados. É mais simples e não mexe no fingerprint, mas
deixa um conjunto de vendas de transição sem decomposição — na prática,
as que estiverem na fila no momento de cada atualização.

### H — Carteira, decisão (b)

Trigger novo **em `venda_pagamento`**, sem tocar no legado:

```
AFTER INSERT em venda_pagamento, forma = 'carteira'
   ↓
cria contas_receber com a PARCELA (não o total da venda)
   ↓
guarda compartilhada: IF EXISTS (origem_id = venda, origem = 'carteira')
```

A guarda é a **mesma** que `criar_conta_carteira` já usa, e é o que impede
os dois caminhos de gerarem duas contas quando se encontrarem.

**Duas parcelas de carteira na mesma venda:** a guarda por
`(origem_id, origem)` criaria **uma** conta com a primeira parcela e
ignoraria a segunda — o que estaria errado. Proponho que o trigger **some
todas as parcelas de carteira da venda** e crie uma conta só com o total
delas; se a conta já existe, atualiza o valor em vez de ignorar. Isso
precisa da sua confirmação: mexer no valor de uma conta a receber existente
é escrita em documento financeiro.

### I — Marco temporal

Nada de backfill. O marco é contratual, não de data:

> **Pagamentos normalizados existem para vendas ingressadas pelo contrato
> v2.** Tudo anterior permanece legado: 30 com jsonb, 3.779 reconstituíveis
> mas não reconstituídas, 18 devoluções, 12 `misto` indeterminadas para
> sempre.

---

## O que NÃO muda

Estoque, fiscal, UI, fila, estados de venda, ledger do Caixa. `anon` não
ganha nada — a ingestão v2 usa a rota protegida da 0.6D.3, com token de
terminal, e `venda_pagamento` continua sem grant para `anon`.

---

## Riscos

**Crítico**
1. O fingerprint e a troca de versão — descrito acima, com duas saídas
   propostas.

**Alto**
2. Trabalho não commitado no Electron; a base da 4C.2 precisa ser definida.
3. Duas parcelas de carteira na mesma venda — comportamento a confirmar.
4. A fila desiste após 5 tentativas. A ingestão atômica resolve para os
   pagamentos, mas o problema permanece para a venda em si — é
   pré-existente e fora do escopo.

**Médio**
5. `misto` continua sincronizando sem pagamentos. Esperado e desejado, mas
   significa que o Electron produzirá vendas sem decomposição até a 4C.3.
6. O adaptador traduz `valor_pago`/`troco` para `valor`/`entregue`/`troco`.
   A tradução é direta, mas é interpretação de dado existente.

---

## O que preciso de você antes de seguir

1. **Base da 4C.2 no Electron** — worktree a partir de quê? E o que fazer
   com o trabalho não commitado de 21/09?
2. **Fingerprint v2** — completar a venda com `completada_v2`, ou a
   alternativa conservadora?
3. **Duas parcelas de carteira** — somar numa conta só, atualizando se já
   existir?
