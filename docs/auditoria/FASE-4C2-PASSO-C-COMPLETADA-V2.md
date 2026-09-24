# Fase 4C.2 — Passo C — Desenho de `completada_v2`

**Desenho. Nenhum DDL, nenhuma alteração de código.** 24/09/2026.

Decisão aprovada: `completada_v2`. Ela **não reaplica a venda** — é uma
complementação idempotente que só acrescenta pagamentos.

## O cenário, medido e não suposto

A 0.6D.3B (commit `ceeae82` no Electron) **congela o payload no primeiro
envio**: `sync_payload_v1` é gravado no mesmo UPDATE que faz
`NULL → negociando_v1`, e todo retry lê exclusivamente esse snapshot.

Isso estreita muito o problema que você levantou. Uma venda em voo no momento
da atualização do terminal **reenvia o snapshot v1 congelado**, com
`schema_version: 1`. A atualização de versão não pode transformá-la em v2, e
portanto **não pode mudar o `forma_pagamento` que entra no fingerprint-base**.
O medo de "travar com `conflito_payload` porque virou `multiplo`" não se
concretiza por esse caminho.

Existe **uma venda exatamente nesse estado** no terminal YOGA agora:
`78dc3e07-…`, `sync_protocolo='v1'`, `remote_id` nulo, snapshot íntegro de
848 bytes, `schema_version: 1`, `forma_pagamento: "dinheiro"`, aceita por
`lerPayloadPersistido`, 1 item na fila. Ela retornará `ja_aplicada` ou
`aplicada`, e seus pagamentos continuam deriváveis por `derivarDoLegado`.

Então `completada_v2` **não** serve para "venda v1 em voo". Ela serve para o
caso restante: **a venda-base já está aplicada no servidor e não tem
pagamentos; um payload v2 com pagamentos chega depois.**

## Os dois fingerprints

### fingerprint-base — `venda_fingerprint_v1`, INALTERADO

Campos, exatamente como hoje: `'v1'`, `empresa_id`, `total`, `desconto`,
**`forma_pagamento`**, `orcamento_id`, e por item `id`, `produto_id`,
`quantidade`, `preco_unitario`, `desconto`.

Não muda uma vírgula. É ele que prova que a venda-base é a mesma, e a
comparação segue idêntica: diferente ⇒ `conflito_payload`. **Nada em
`conflito_payload` é enfraquecido.**

Para que ele continue estável, o payload v2 preenche `forma_pagamento` com
o mesmo valor que o v1 preencheria: a forma única quando há só uma, e
`multiplo` **somente** quando há duas ou mais formas distintas. Uma venda com
duas formas não pode existir em v1, então nunca colide com uma base v1.

### fingerprint-pagamentos — novo, separado

Função nova `venda_pagamentos_fingerprint_v2(p_payload)`, sha256 sobre
**apenas** `p_payload->'pagamentos'`: prefixo `'pg2'` e, por pagamento
ordenado por `id`, os campos `id`, `forma`, `valor`, `valor_entregue`,
`troco`, `sequencia` — mesma normalização numérica do fingerprint-base.

Guardado em coluna nova e **nullable** `pdv_venda_sync.fingerprint_pagamentos`.
Nullable é o que distingue "venda aplicada antes de pagamentos existirem"
de "venda aplicada com pagamentos".

Separar os dois é o ponto central: **ganhar pagamentos não pode alterar o
fingerprint-base**, senão toda venda v1 já aplicada viraria conflito.

## As seis definições pedidas

| Pergunta | Resposta |
|---|---|
| Campos do fingerprint-base | os sete acima, inalterados |
| Campos do fingerprint-v2 | só `pagamentos[]`: id, forma, valor, valor_entregue, troco, sequencia |
| Como provar que a venda-base é a mesma | `pdv_venda_sync.fingerprint = venda_fingerprint_v1(payload)`, comparação de hoje |
| Como provar que os pagamentos são os mesmos num retry | `fingerprint_pagamentos` gravado = recalculado ⇒ `ja_aplicada` |
| Mesmo `pagamento_id` com payload diferente | `conflito_pagamentos`, estado terminal **novo** |
| Como impedir que um v2 altere a venda já aplicada | a ramificação só executa `INSERT INTO venda_pagamento` |

## A máquina de estados

Com `pdv_venda_sync` encontrado e **fingerprint-base igual**:

| `fingerprint_pagamentos` gravado | payload traz pagamentos | resultado |
|---|---|---|
| NULL | não | `ja_aplicada` (comportamento de hoje) |
| NULL | sim | **`completada_v2`** — insere só os pagamentos |
| igual ao recebido | sim | `ja_aplicada` — retry idempotente, nada escrito |
| diferente do recebido | sim | **`conflito_pagamentos`** — terminal, nada escrito |
| presente | não | `conflito_pagamentos` — v2 não pode regredir para v1 |

Fingerprint-base diferente ⇒ `conflito_payload`, como hoje, antes de tudo.

## O que `completada_v2` pode tocar

**Só isto:**
- `INSERT INTO venda_pagamento` (append-only, id vindo da origem);
- `UPDATE pdv_venda_sync SET fingerprint_pagamentos = …, schema_version = 2`
  **apenas essas duas colunas**, na linha que já existe.

**Proibido, e cada um precisa de teste que prove a ausência:**
- `UPDATE vendas` de qualquer campo comercial;
- `INSERT INTO venda_itens`;
- qualquer escrita em `produtos`, `produto_estoque` ou `estoque_movimentacoes`;
- `INSERT` de nova linha em `pdv_venda_sync`;
- alterar `fingerprint`, `itens`, `estoque_aplicado` ou `aplicado_em`.

`vendas.pagamentos` **é** reescrita — mas pelo gatilho `venda_pagamento_projeta`,
a partir das linhas de pagamento, nunca do payload. É projeção derivada, não
escrita do payload na venda. É a única mutação de `vendas`, e é o que mantém
a NFC-e e o trigger legado da carteira funcionando.

## Identidade do pagamento, em detalhe

Antes de inserir, cada `pagamento.id` recebido é verificado:

- não existe ⇒ insere;
- existe, mesma venda, mesmo conteúdo ⇒ idempotente, não insere de novo;
- existe, mesma venda, conteúdo diferente ⇒ `conflito_pagamentos`;
- existe em **outra** venda ⇒ `conflito_pagamentos`.

Nunca `ON CONFLICT (id) DO NOTHING` puro: ele aceitaria em silêncio um
pagamento com o mesmo id e valor diferente, que é exatamente o caso que
precisa falhar alto.

## Mudanças de contrato necessárias

1. `sincronizar_venda_pdv_v1`: aceitar `schema_version IN (1,2)`. Terminal
   antigo mandando `1` continua funcionando sem alteração — é o guardrail de
   retrocompatibilidade da Fase 4.
2. `pdv_venda_sync`: coluna `fingerprint_pagamentos TEXT NULL`.
3. Função nova `venda_pagamentos_fingerprint_v2`.
4. Electron: `completada_v2` entra em `ESTADOS_SUCESSO` com telemetria
   própria, como `completada_de_legado` já tem; `conflito_pagamentos` entra
   em `ESTADOS_TERMINAIS`.

Nenhuma delas altera o comportamento de um payload v1.

## O que este desenho não resolve

- **Backfill** das vendas históricas sem `venda_pagamento` — você já decidiu
  não fazer agora. `completada_v2` não o faz por acidente: exige payload v2
  chegando do terminal.
- **Concorrência real de Postgres** continua sem prova empírica (o MCP
  serializa as chamadas). O `pg_advisory_xact_lock` por `venda_id` já cobre
  a ramificação nova, por estar dentro da mesma RPC.
- **A parcela `carteira`** depende do Passo B, que está bloqueado.
