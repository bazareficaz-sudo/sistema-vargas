# Fase 0.6C.6A — Gate: vínculo orçamento↔venda e idempotência

**Data:** 11/09/2026 · **Auditoria apenas. Nada alterado.**
Sem código, migration, banco, flag, RLS, grant, release, deploy ou push.

---

## 1. Como nasce o `id` da venda — e ele NÃO é preservado

```js
// database.js, vendas.registrar
const id = uuidv4();                    // nasce local
```

```js
// api.js, registrarVenda → montarInsert()
const montarInsert = () => ({
  empresa_id, empresa_fiscal_id, deposito_id, numero, cliente_id, …
});                                      // ← NÃO inclui `id`
```

O servidor gera o seu próprio `gen_random_uuid()`, e o local guarda a resposta em
`remote_id`. **As duas identidades são diferentes e o servidor nunca vê a local.**

É o mesmo defeito que os orçamentos tinham antes da 0.6C, e a consequência é a
mesma: **o servidor não tem como saber que duas inserções são a mesma venda.**

### Prova em produção

Quatro pares de vendas duplicadas nos últimos 30 dias — mesmo terminal, mesmo
número, mesmo total, mesmos itens:

| nº | terminal | total | intervalo entre as duas |
|---|---|---|---|
| 201389 | PDV-002 | R$ 22,50 | **mesmo segundo** |
| 201400 | PDV-002 | R$ 34,00 | 45 s |
| 301697 | PDV-003 | R$ 8,00 | 1 s |
| 301743 | PDV-003 | R$ 5,70 | **13 horas** |

O de 13 horas é a assinatura do retry: venda presa na fila, reenviada na manhã
seguinte, e o servidor a tratou como venda nova.

### E cada duplicata duplicou o estoque

```
201389  →  2 movimentações, 3 unidades cada
201400  →  2 movimentações, 1 unidade cada
301697  →  2 movimentações, 2 unidades cada
301743  →  4 movimentações, 4 unidades cada
```

`contas_receber` = 0 em todas — **por sorte**, nenhuma era carteira. O efeito
financeiro não duplicou porque a forma de pagamento não o acionou, não porque
algo o impediu.

`vendas_duplicidade_bloqueada` continua com **0 linhas**: o trigger de 2 minutos
foi criado depois destas, ou não as pegou.

## 2. Onde o vínculo pode ser gravado dentro da transação existente

`db.vendas.registrar` **já é** um `db.transaction` e já contém tudo o que
importa: venda, itens, baixa de estoque, movimentação, crédito e fila.

Gravar o vínculo ali é acrescentar duas coisas dentro do mesmo `BEGIN`:

```
INSERT INTO vendas (…, orcamento_id)          ← o vínculo nasce com a venda
UPDATE orcamentos SET status='convertido',
                      venda_id = <id local>   ← e o orçamento fecha junto
```

Isso elimina `window._orcamentoParaConverter` — a variável de memória do
renderer que hoje é o único lugar onde o vínculo existe, e que some num F5.

**O que falta no caminho:** o renderer precisa passar o orçamento **dentro do
objeto `venda`**, e não numa global. É mudança em `pdv.js`, não em `database.js`.

## 3. Duplo clique no mesmo terminal

| | Hoje | Com `UNIQUE` só no Postgres | Com `UNIQUE` local também |
|---|---|---|---|
| onde é barrado | em lugar nenhum¹ | no servidor, minutos depois | **no COMMIT local, na hora** |
| estoque local | baixa duas vezes | **baixa duas vezes** | baixa uma vez |
| o operador vê | nada | nada | erro imediato |

¹ a proteção seria `bloquear_venda_duplicada`, mas os pares de 1 s e de mesmo
segundo existem no banco — ou seja, não protegeu.

**Conclusão:** o `UNIQUE` remoto sozinho **não resolve o duplo clique**, porque
ele arbitra tarde demais — as duas vendas já commitaram localmente com estoque
baixado duas vezes. O `UNIQUE` precisa existir **nos dois lados**.

## 4. Como o servidor distingue retry de segunda venda concorrente

**Hoje: não distingue.** Só existe a heurística de 2 minutos por
`(empresa_id, numero, total)`, que descarta em silêncio e nunca disparou.

Com `orcamento_id` + `UNIQUE`:

| Caso | O servidor consegue distinguir? |
|---|---|
| retry da mesma venda **originada de orçamento** | sim — o `UNIQUE` bate e a resposta pode dizer qual venda já existe |
| segunda venda concorrente do mesmo orçamento | sim — mesmo mecanismo |
| retry de venda **sem orçamento** | **não** — continua sem chave. É `registrarVenda`, fora de escopo |

Ou seja, a 0.6C.6A resolve a idempotência **da conversão**, não a da venda em
geral. O par duplicado 301743 (13 h) continuaria possível se não viesse de
orçamento.

## 5. A e B convertem o mesmo orçamento OFFLINE — estado exato

### Enquanto offline

Os dois terminais são independentes e **nenhum sabe do outro**:

| | Terminal A | Terminal B |
|---|---|---|
| venda local | criada, `id` A | criada, `id` B |
| itens | gravados | gravados |
| estoque local | **baixado** | **baixado** |
| movimentação local | gravada | gravada |
| orçamento local | convertido | convertido |
| fila | 1 item | 1 item |

Nada disso é errado: é o modelo offline-first funcionando. O erro aparece na
volta.

### Ao sincronizar

```
A sobe primeiro  →  INSERT vendas (orcamento_id = X)  →  OK
B sobe depois    →  INSERT vendas (orcamento_id = X)  →  UNIQUE viola
```

**E aqui está o problema que a fase precisa resolver.** Com a fila de hoje:

```
_sincronizarVendaCreate lança  →  marcarErro  →  retry
retry  →  mesma violação  →  retry … 5 vezes
depois de 5  →  marcarProcessado  →  A FILA ESQUECE
```

Resultado final de B:

- venda local **existe**, `status = 'concluida'`, sem `remote_id`;
- aparece como "Pendente" na lista, indistinguível de uma venda que só não subiu
  por falta de internet;
- estoque local já baixado (o down-sync de produtos sobrescreve `estoque` na
  próxima passada, então o **saldo** se corrige sozinho — mas a **movimentação**
  local permanece, registrando uma saída que o servidor nunca viu);
- o orçamento local de B está `convertido`, apontando para uma venda que o
  servidor não conhece.

**Isso viola a regra que você não negocia**: a venda perdedora fica como venda
normal, em silêncio, com efeitos locais já aplicados e sem nada que a distinga.

### O que 0.6C.6A precisa acrescentar por causa disso

1. **A violação de `UNIQUE(orcamento_id)` não é erro transitório.** A fila tem de
   reconhecê-la como desfecho terminal — nada de 5 retries.
2. **Estado explícito na venda perdedora.** Algo como
   `sync_status = 'conflito_conversao'`, com o `remote_id` da venda vencedora
   quando o servidor o devolver, para o operador conseguir ir ver qual venda
   ficou valendo.
3. **A venda perdedora não pode ser apagada automaticamente.** Ela tem efeitos
   locais já aplicados e é decisão comercial, não técnica. Fica visível e
   recuperável.
4. **O orçamento de B precisa ser reconciliado**, porque ele aponta para uma
   venda que não existe no servidor.

## 6. Achados laterais que não são desta fase

- `vendas.terminal_id` é **text** e guarda o identificador legado
  (`PDV-001`…`PDV-004`, `Caixa`, e nulos), não o UUID do terminal. A telemetria
  de venda por terminal está presa à identidade antiga — a mesma do `PDV-001`
  duplicado.
- `venda_itens.venda_id` é **text** enquanto `vendas.id` é **uuid**: o join só
  funciona com cast explícito.
- `venda_itens` no servidor é inserido por chamada separada e o erro só vira
  `console.warn`. Uma venda pode existir sem itens e ninguém saber.

## 7. O que a 0.6C.6A precisaria tocar

| Onde | O quê |
|---|---|
| Postgres | `vendas.orcamento_id` + índice `UNIQUE` parcial; `orcamentos.venda_id` |
| **SQLite** | **`vendas.orcamento_id` + `UNIQUE` local**; `orcamentos.venda_id`; estado de conflito |
| `database.js` | vínculo dentro da transação de `vendas.registrar` |
| `sync.js` | violação de UNIQUE vira desfecho terminal, não retry |
| `pdv.js` | passar o orçamento no objeto `venda`, não em global |
| `main.js` / `orcamentoComando` | `marcarConvertido` sai do `anon`, entra na fila, vira `orcamentos.converter` |

**Isto toca a tabela `vendas` local.** Ela está na lista de proibições desde a
0.6C. A alteração é aditiva — coluna nova, nula nas 6 vendas locais e nas 3.003
remotas — mas é a tabela de vendas, e a autorização precisa ser explícita.

## 8. Riscos

1. **`UNIQUE` local muda o comportamento de uma transação que hoje nunca falha.**
   `vendas.registrar` passaria a poder lançar. Todo chamador precisa tratar.
2. **A venda perdedora precisa de uma tela.** Estado novo sem lugar onde ser
   visto é estado escondido — exatamente o que a fase combate.
3. **As 3.003 vendas históricas ficam com vínculo `NULL`**, e as conversões
   passadas são irrecuperáveis. Concordo integralmente em não inferir por
   horário/valor/cliente: criaria falsa certeza pior que a ausência.
4. **A idempotência da venda em geral continua aberta** — os duplicados de 13 h
   seguem possíveis para venda sem orçamento.
5. **Volume:** 1.871 vendas em 30 dias, ~62/dia, contra ~1,4 orçamentos/dia.
   Qualquer defeito aqui aparece 45× mais rápido.

## 9. Decisão

**PRONTO PARA IMPLEMENTAR 0.6C.6A** — com uma ressalva que precisa da sua
autorização explícita.

As cinco perguntas estão respondidas e o desenho está determinado. Mas a
auditoria mostrou que **o `UNIQUE` remoto sozinho não basta**: sem o `UNIQUE`
local, o duplo clique e a corrida offline continuam baixando estoque duas vezes
antes de qualquer arbitragem. E a regra que você não negocia — a perdedora não
pode ficar silenciosa — exige estado explícito na tabela `vendas` local.

Ou seja: **a menor correção segura toca a tabela `vendas`**, que está fenceada
desde a 0.6C. Não vou fazer isso por conta própria.

Se a autorização não vier, a alternativa é 0.6C.6A ficar só com o lado remoto —
o que eu **não recomendo**, porque entregaria a aparência de proteção enquanto o
estoque continua duplicando localmente.
