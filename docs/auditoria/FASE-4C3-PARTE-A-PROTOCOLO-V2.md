# Fase 4C.2 — Checkpoint 3, parte A — o servidor entende pagamentos

**APLICADA E PROVADA.** 09/10/2026.

| | |
|---|---|
| arquivo | `supabase/migrations/20261009003002_venda_pagamentos_v2_protocolo.sql` |
| version registrada | `20261009003002` |
| name | `venda_pagamentos_v2_protocolo` |
| md5 do arquivo | `c02f93deec0697c5d1120a7c2cba8396` |
| md5 sem o newline final | `5e0daa8296559ea9bf9f6709765282a9` |

**Equivalência de md5 não verificada**: a leitura de
`supabase_migrations.schema_migrations` foi recusada pelo classificador
nesta sessão. Nas migrations anteriores o md5 armazenado batia com o do
arquivo sem o newline final; aqui isso é expectativa, não prova. Sem
`db push`.

## Contexto medido

| | |
|---|---|
| `pdv_venda_sync` | **0 linhas** — a rota V1 nunca aplicou venda em produção |
| `venda_pagamento` | 0 |
| frota (5 terminais) | 1.10.6 — **sem cliente V1** |
| YOGA | 1.10.5, flag V1 ligada, parado desde 24/09 |

A loja inteira sincroniza pelo caminho legado. Nada em produção chama esta
RPC hoje, e por isso a mudança é inerte até o terminal evoluir.

## O que a migration faz

1. `venda_pagamentos_fingerprint_v2(jsonb)` — sha256 sobre **apenas**
   `pagamentos[]`, ordenado por `id`.
2. `pdv_venda_sync.fingerprint_pagamentos TEXT` **nullable**.
3. `sincronizar_venda_pdv_v1` aceita `schema_version IN (1,2)`.

`venda_fingerprint_v1` **não muda uma vírgula**. É o ponto central: se os
pagamentos entrassem no fingerprint-base, toda venda já aplicada em v1
viraria `conflito_payload` ao ganhar composição.

## A máquina de estados

Linha encontrada e **fingerprint-base igual**:

| `fingerprint_pagamentos` gravado | payload traz pagamentos | resultado |
|---|---|---|
| NULL | não | `ja_aplicada` (comportamento de sempre) |
| NULL | sim | **`completada_v2`** |
| igual | sim | `ja_aplicada` — retry idempotente |
| diferente | sim | **`conflito_pagamentos`** |

Base diferente ⇒ `conflito_payload`, antes de tudo, sem flexibilização.

## O que `completada_v2` pode tocar

Só `INSERT INTO venda_pagamento`, e `UPDATE pdv_venda_sync` em **duas
colunas** (`fingerprint_pagamentos`, `schema_version`). Teste prova a
ausência de `UPDATE vendas`, `INSERT INTO venda_itens`, qualquer escrita de
estoque e qualquer `INSERT` novo em `pdv_venda_sync`.

Identidade do pagamento: **nunca** `ON CONFLICT DO NOTHING`. Id repetido com
conteúdo diferente, ou pertencente a outra venda, devolve
`conflito_pagamentos`.

## ⚠️ Carteira recusada de propósito

`criar_conta_carteira` dispara no INSERT da venda lendo `NEW.pagamentos`. Em
v2 os pagamentos chegam **depois**, então a conta a receber não nasceria —
venda em carteira sem obrigação registrada, perda financeira silenciosa.

Enquanto o gatilho próprio (parte B) não existe, um payload v2 com parcela
`carteira` é recusado com `payload_invalido` e motivo explícito. O Electron
já trata `payload_invalido` como conflito terminal, então não entra em
retry infinito.

Recusar alto é melhor que aceitar e perder a conta.

## Testes

`tests/vendas/protocolo-v2.test.ts`, **22 testes**, todos passando.
`npm test` 1138/1138 · `tsc --noEmit` limpo.

Inclui uma guarda contra teste vazio: o recorte do ramo `completada_v2` é
verificado por tamanho, porque um recorte vazio faria as asserções de
ausência passarem sem olhar nada — foi exatamente o que aconteceu na
primeira versão destes testes.

## Máquina de estados — provada contra a RPC real

Transação revertida, 11 cenários:

| cenário | resultado |
|---|---|
| v1 nova | `aplicada` |
| v1 repetida | `ja_aplicada` |
| **v2 sobre venda já aplicada em v1** | **`completada_v2`**, 2 pagamentos |
| v2 repetido | `ja_aplicada` — continuam **2** pagamentos, não 4 |
| composição diferente | **`conflito_pagamentos`** |
| base comercial diferente | `conflito_payload` — inalterado |
| venda nova direto em v2 | `aplicada`, 1 pagamento |
| **carteira em v2** | `payload_invalido` com motivo explícito |
| soma não fecha | `payload_invalido` |
| v1 com pagamentos | `payload_invalido` |
| `schema_version` 3 | `payload_invalido` |

Após a reversão: `venda_pagamento` 0, `pdv_venda_sync` 0, nenhuma venda nos
últimos 10 minutos, `caixa_movimento` 13. Nada persistiu.

A linha 4 é a que importa mais: o retry do mesmo payload v2 devolve
`ja_aplicada` e a venda continua com exatamente 2 pagamentos. A
idempotência por id do pagamento funciona.

## Pendente
---

# Parte B — a carteira passa pelo pagamento

**APLICADA E PROVADA.** 09/10/2026.

| migration | version |
|---|---|
| `20261009003826_venda_pagamento_carteira_trigger.sql` | gatilho em `venda_pagamento` |
| `20261009004028_venda_pagamentos_v2_carteira_liberada.sql` | RPC deixa de recusar carteira |

## O problema

`criar_conta_carteira` dispara AFTER INSERT em `vendas`, lendo
`NEW.pagamentos`. Em v2 os pagamentos chegam **depois** da venda, então ele
não vê nada e a conta a receber não nasceria. A parte A recusava carteira em
v2 justamente por isso.

## A regra

O gatilho `z_trg_venda_pagamento_carteira`, AFTER INSERT em
`venda_pagamento`:

- **uma venda, uma conta**, pelo valor **agregado** — R$ 50 + R$ 30 são uma
  obrigação de R$ 80, não duas;
- o valor é **recalculado** da soma autoritativa em `venda_pagamento`, com
  estornos descontados. Nunca `valor_existente + novo_pagamento` — foi o
  incremento cego que a 4C.1.1 extirpou;
- conta **já movimentada** (qualquer recebimento, quitada ou cancelada) não
  é reescrita, nem vira parcela 2;
- **`clientes.saldo_devedor` não é escrito aqui.** Continua sendo projeção
  mantida por `z_trg_sincronizar_saldo_devedor`.

## Por que a RPC verifica antes

Se só o gatilho barrasse, ele abortaria a transação com erro — e o terminal
leria erro como **pendente**, tentando para sempre. A RPC verifica antes e
devolve `conflito_pagamentos`, estado que o cliente já conhece como
**terminal**. Um estado novo seria lido como desconhecido, com o mesmo
retry infinito.

## Provas em transação revertida

**O gatilho, isolado** (8 cenários): venda `multiplo` sem pagamento não cria
conta; carteira 50 cria conta de 50; + carteira 30 → **uma** conta de 80;
`saldo_devedor` 80 e igual ao autoritativo; pix 20 não altera a conta; conta
com recebimento **recusa** e o valor fica intacto em 80; conta cancelada
**recusa**; duas vendas → duas contas, uma cada.

**A RPC, ponta a ponta** (7 cenários):

| cenário | resultado |
|---|---|
| v2 com carteira 50 + dinheiro 30 (venda de 80) | `aplicada`, **1 conta de 50** |
| `saldo_devedor` | **50**, não os 80 da venda |
| retry idêntico | `ja_aplicada`, continua 1 conta |
| venda nova em carteira | `aplicada` |
| conta já movimentada | **`conflito_pagamentos`**, valor intacto |
| soma que não fecha · `schema_version` 3 | `payload_invalido` |

A primeira linha é a invariante central: **o total da venda não é a
dívida**. Só a parcela de carteira vira obrigação.

Após as reversões: `venda_pagamento` 0, `pdv_venda_sync` 0, `contas_receber`
313 (inalterado), 0 clientes de teste, `caixa_movimento` 13, **0 clientes
com saldo divergente**.

## Testes

`tests/vendas/carteira-v2.test.ts`, 16 testes.
