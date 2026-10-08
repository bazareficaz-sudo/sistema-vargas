# Fase 4C.2 — Checkpoint 3, parte A — o servidor entende pagamentos

**Escrita e testada; migration NÃO aplicada.** 08/10/2026.

O SQL está em `docs/auditoria/pendente/venda_pagamentos_v2_protocolo.sql`
(md5 `c02f93deec0697c5d1120a7c2cba8396`) — **fora** de
`supabase/migrations/` de propósito, para não ser confundido com uma
migration que foi aplicada. Entra lá com a `version` registrada, no momento
em que a aplicação for liberada.

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

## Pendente

1. **Aplicação recusada** pelo classificador do modo automático.
2. Sem prova de execução — a máquina de estados está provada por leitura do
   SQL, não por chamada real. Assim que a migration for aplicada, dá para
   exercitá-la em transação revertida, como nas fases anteriores.
3. Parte B (gatilho da carteira em `venda_pagamento`) não começou.
4. Lado Electron (`completada_v2` em `ESTADOS_SUCESSO`,
   `conflito_pagamentos` em `ESTADOS_TERMINAIS`) não começou.

## Sequenciamento

Esta parte é capacidade de servidor para um contrato que nenhum terminal
fala. O passo de maior valor continua sendo **levar a 1.10.7 para a loja** —
ela traz o cliente V1 e a tabela local de pagamentos. Sem isso, o V2 não tem
como ser exercitado ponta a ponta.
