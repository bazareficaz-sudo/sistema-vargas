# Fase 0.6C.2 — o número oficial do orçamento é do servidor

**Data:** 10/09/2026 · **Escopo:** reconciliação do número no cliente.
**Não toca:** servidor, RPC, idempotência, `pdv_operacoes`, auth do terminal,
RLS, `anon`, flags, vendas, recebimentos, Caixa/Tesouraria, conversão em venda,
`faltas`, e o defeito de `UNIQUE` do nº58 no down-sync.

---

## 1. O que foi observado

Primeiro orçamento real do repiloto, criado no **Escritorio Silvano** em
09/09/2026 23:27 UTC. A tela mostrou **duas linhas**:

```
#60  aberto    R$ 194,50   "outro terminal"
#59  Pendente  R$ 194,50
```

O banco não tinha duplicidade nenhuma:

| | |
|---|---|
| PostgreSQL | 1 orçamento (`1a4ca66e`, nº60, revisão 1, 1 item) |
| SQLite local | 1 linha (`1a4ca66e`, nº59, `revisao_base` 1, 1 item) |
| `pdv_operacoes` | 1 operação (log: `[ORC] salvar nº 60 rev 1 pela rota autenticada`) |

O que duplicava era a **leitura**.

## 2. Causa — duas, ambas no cliente

**(a) O número oficial era descartado.** `confirmarSincronizacao` gravava
`remote_id` e `revisao_base` e ignorava o `numero` que o servidor devolve. O
palpite local — `SELECT MAX(numero)+1 FROM orcamentos` — ficava valendo para
sempre.

O número oficial nasce de `nextval('orcamentos_numero_seq')` e a sequência
**aceita buracos por desenho** (decisão registrada em
`FASE-0.6C-DESENHO-ORCAMENTO-TRANSACIONAL.md` §6: *"um buraco na numeração é
visível e inofensivo; um número duplicado não"*). Um `nextval` consumido por
insert revertido não volta. Foi o que aconteceu com o **58**: o servidor não
tem nº58, e a partir dali o palpite local ficou permanentemente um atrás.

Isso é **anterior à rota autenticada**: o nº58 local ↔ nº59 do servidor nasceu
pelo caminho **legado**, em 08/09.

**(b) A tela juntava local e cloud pelo `numero`.**

```js
for (const o of cloud)  mapa.set(String(o.numero), ...)
for (const o of locais) mapa.set(String(o.numero), ...)
```

O número é referência **comercial**, não identidade. Duas consequências:

1. mesmo documento com números diferentes ⇒ aparece duas vezes;
2. documentos diferentes com o mesmo número ⇒ **um esconde o outro**.

## 3. A colisão do caso (2) existe nos dados reais

Medido em 09/09/2026 sobre 57 documentos locais e 57 no cloud:

```
COLISAO numero 59: local 1a4ca66e (o novo)  vs  cloud ee29e3b9 (o de ontem)

chave = numero .............. 59 linhas para 58 documentos, 1 duplicado
chave = remote_id ?? id ..... 58 linhas para 58 documentos, 0 duplicados
```

Nenhum documento sumiu — mas só porque o escondido tinha uma segunda linha
local sob outro número. Sorte não é garantia.

## 4. O que mudou

| Onde | Antes | Depois |
|---|---|---|
| `confirmarSincronizacao` | grava `remote_id`, `revisao_base` | grava também `numero`, com COALESCE |
| rota autenticada | descartava `r.dados.numero` | reconcilia |
| caminho legado | descartava `res.numero` | reconcilia igual |
| `upsertBatch` (down-sync) | `DO UPDATE` sem `numero` | alinha `numero`, preserva identidade |
| lista da tela | chave = `numero` | chave = `remote_id ?? id`; número exibido é o do servidor |

**Validação do número.** `numeroOficial()` aceita só inteiro positivo. O resto
vira `null`, e `COALESCE` preserva o que estava gravado. Motivo explícito:
`Number(null) === 0` já custou uma validação frouxa nesta mesma fase.

**Autoridade na leitura.** Quando as duas origens têm o mesmo documento, a
linha local vence (é ela que tem itens, telefone, forma de pagamento) **menos
no número**, que é do servidor. É a mesma regra da gravação, aplicada na
leitura — e é o que cura o nº58 na tela sem depender do down-sync.

## 5. Por que o SQL saiu de `database.js`

`database.js` só carrega dentro do Electron (better-sqlite3 é compilado para o
ABI dele). Consequência: **nenhum teste jamais executou este SQL** — e foi
exatamente ali que o número se perdia.

`src/main/orcamentoSql.js` guarda as duas instruções e os construtores de
parâmetros. Os testes executam a **mesma string** contra SQLite real
(`node:sqlite`), e ela foi conferida também sob better-sqlite3, o motor do app.

## 6. Testes

**40 testes, 10 falham no código anterior.** Os que falham:

| Prova | |
|---|---|
| provisório 59 → oficial 60, mesma linha, mesmo `id`, mesmo `remote_id` | ✱ |
| a tela mostra um orçamento, não dois | ✱ |
| reabrir o arquivo mantém o nº60 | ✱ |
| o caminho legado reconcilia igual | ✱ |
| orçamento nascido no legado segue localizado por `remote_id` | ✱ |
| down-sync alinha número preservando id/remote_id/created_at/revisão/itens | ✱ |
| legado `id ≠ remote_id` casa com o cloud e exibe o número oficial | ✱ |
| documentos diferentes com o mesmo número continuam dois | ✱ |
| a chave nunca é o número | ✱ |
| os 3 documentos de 09/09 rendem 3 linhas, não 4 | ✱ |

Mais as regressões: número ausente/null/0/texto/fracionário não apagam o
número local; edição não renumera; conflito e erro de rede não mexem no
número; linha com edição local pendente não é atropelada pelo down-sync.

## 7. Riscos residuais

1. **O nº58 continua quebrando o down-sync.** `UNIQUE(orcamentos.remote_id)`
   falha a cada ciclo (576 ocorrências em 09/09, cadência de 2 min). A
   transação inteira aborta, então o down-sync **não corrige status nem
   número de ninguém**. Dívida separada, deliberadamente não tocada. O merge
   por identidade contorna o sintoma visual; não cura o down-sync.
2. **Terminais em 1.9.4 ou anterior continuam divergindo.** A reconciliação é
   do cliente. Só o terminal atualizado passa a gravar o número oficial.
3. **A busca por número na lista local** filtra pelo número gravado. Enquanto
   um orçamento antigo não for reconciliado, buscar pelo número oficial não o
   encontra pelo lado local (encontra pelo cloud).
4. **A tela não foi exercitada com o app rodando.** O PDV desta máquina está
   em produção e não foi reiniciado. O que foi exercitado: a função de merge
   empacotada, contra os dados reais de produção — 59 linhas viram 58, 58
   documentos, zero duplicados.

## 8. Entrega

`vargasnexus-pdv` — commit `de16a8e`, versão **1.9.5**, instalador
`dist/VargasNexus PDV Setup 1.9.5.exe`. **Não publicado. Nenhuma flag alterada.**
