# FASE 0.6C.6A.1 — A ARBITRAGEM É PRECONDIÇÃO DA VENDA

**Veredito: PRONTO PARA PILOTO 0.6C.6A.1.** Nada publicado, nada empurrado.

O número que decide a fase:

| | vendas remotas | com vínculo a X | outras vendas remotas | itens delas | movimentações delas |
|---|---|---|---|---|---|
| **ANTES** (código da 0.6C.6A) | **2** | 0 | 1 | 1 | 1 |
| **DEPOIS** (0.6C.6A.1) | **1** | 1 | **0** | **0** | **0** |
| DEPOIS, fila na ordem errada | **1** | 1 | **0** | **0** | **0** |
| Só o banco (portão neutralizado) | **1** | 1 | **0** | **0** | **0** |

Dois terminais offline, dois arquivos SQLite, processos separados, ambos
convertendo o mesmo orçamento. **2 → 1.**

---

## 1. A causa, e o diff conceitual do portão

A 0.6C.6A criou a arbitragem e pôs um item `orcamento_converter` na fila. A
fila, porém, entrega `venda/create` primeiro — e não por acidente de
`created_at`, estava escrito:

```sql
ORDER BY CASE entidade WHEN 'cliente' THEN 0 WHEN 'venda' THEN 1 ELSE 2 END
```

Então o terminal perdedor subia a venda e só DEPOIS descobria que havia
perdido. O vínculo ficava certo; a duplicidade de estoque remoto — a razão de a
fase existir — continuava.

A correção não é a ordem. A ordem é otimização; a proteção é um portão:

```
ANTES                               DEPOIS
─────                               ──────
1. venda sobe                       1. PORTÃO: arbitra X → V no servidor
2. itens sobem                      2. confirmou que X é DESTA venda?
3. estoque remoto baixa                 sim  → venda, itens, estoque
4. arbitra X → V                        não  → conflito, e NADA sobe
5. ah, perdi                            não sei → espera, e NADA sobe
```

`_sincronizarVendaCreate` é o ponto único por onde passam a fila automática, o
retry manual (`retentarVendaManual`) e `recuperarVendasPendentes`. O portão
mora lá, antes de `api.registrarCliente` inclusive — o cliente também é efeito
remoto derivado desta venda.

A regra de decisão está isolada em [`arbitragemVenda.js`](../../../vargasnexus-pdv/src/main/arbitragemVenda.js),
pura e testada sozinha. `sync.js` obedece. Três desfechos:

| resposta do servidor | ação | por quê |
|---|---|---|
| `convertido` / `ja_convertido` **com `venda_id` == esta venda** | **enviar** | confirmado, e confirmado NOMINALMENTE |
| `ja_convertido` com outra venda · `conflito_conversao` · `conflito_versao` · `recusado_cancelado` · `nao_encontrado` | **conflito** | terminal: zero retry, zero efeito remoto, estado explícito |
| erro de rede · 5xx · rota desligada · orçamento sem identidade remota · resposta sem vencedora | **esperar** | a venda fica pendente e tenta depois. Nada sobe |

`esperar` existe porque *não consegui confirmar* não é *perdi*. Tratar
indisponibilidade como conflito marcaria como perdida uma venda que só estava
sem internet — e conflito não tem volta. O caso `rota_desligada` é o mais
importante dessa coluna: um rollout incompleto não pode destruir venda boa.

## 2. id vs remote_id — o que vai para o Postgres

`orcamentos.id` no SQLite é local. Medido no banco real do Escritório
(cópia só-leitura, 58 documentos):

```
id == remote_id ....... 56
id != remote_id ....... 2     ex.: nº59 local d87547a7… / remoto ee29e3b9…
sem remote_id ......... 0
```

Mandar o id local nesses dois faria a RPC responder `nao_encontrado` → a venda
legítima seria marcada como perdida por um id que nunca existiu no servidor.

A resolução, em `vendas.getById`, junto de cliente e produto, que já seguem a
mesma disciplina:

```sql
LEFT JOIN orcamentos o ON o.id = v.orcamento_id
...
o.remote_id as orcamento_remote_id
```

`o.remote_id` **puro, sem `COALESCE` para o id local** — e há teste que falha se
alguém acrescentar o COALESCE. Nulo ali significa "o servidor não conhece este
orçamento", e esse caso tem tratamento próprio: **espera**, não conflito, não
número como substituto. Há teste explícito de que o número nunca vira
identidade, nem como último recurso.

`montarInsert` manda `orcamento_id: venda.orcamento_remote_id || null`. Venda
comum vai com `NULL`. Valor não-UUID nunca entra: a coluna local `remote_id` de
um documento Base44 não-UUID continua fora de qualquer parâmetro UUID — o
campo só é preenchido a partir de `remote_id`, e quando ele não é identidade
remota válida o resultado é `nao_encontrado`/espera, nunca um `orcamento_id`
inventado.

## 3. Schema em produção

```
vendas.orcamento_id   uuid   NULL   (sem FK — ver abaixo)
índice: vendas_orcamento_unico
        CREATE UNIQUE INDEX vendas_orcamento_unico
          ON public.vendas (orcamento_id) WHERE (orcamento_id IS NOT NULL)
```

Zero backfill, verificado depois da migration:

```
vendas total ......................... 3.022
vendas com vínculo ................... 0
vendas históricas (antes de hoje) .... 2.996
históricas com vínculo ............... 0
orcamentos ........................... 58
orcamentos.venda_id preenchidos ...... 0
nº60: revisao ........................ 3   (intacto)
```

**`orcamentos.venda_id` continua sendo a AUTORIDADE da arbitragem.**
`vendas.orcamento_id` é vínculo derivado: rastreabilidade e guardrail.

Sem FK para `orcamentos`, de propósito: o gatilho abaixo já exige existência E
posse, que é estritamente mais forte que integridade referencial; e com
`orcamentos.venda_id` apontando de volta, FK nos dois sentidos amarraria as
duas tabelas a uma ordem de inserção para sempre.

## 4. O guardrail do servidor, e a ordem dos gatilhos

Isto é o que transforma "o cliente promete arbitrar primeiro" em invariante do
servidor.

```sql
CREATE TRIGGER b_trg_venda_exige_arbitragem
  BEFORE INSERT OR UPDATE OF orcamento_id ON public.vendas
  FOR EACH ROW EXECUTE FUNCTION public.exigir_arbitragem_do_orcamento();
```

`orcamento_id IS NULL` → `RETURN NEW` imediato: é o caminho de 3.022 das 3.022
vendas existentes, e ele não muda. Com vínculo, quatro recusas, cada uma com
`ERRCODE 23000` e uma dica estruturada:

| dica | quando |
|---|---|
| `arbitragem_orcamento:inexistente` | o orçamento declarado não existe |
| `arbitragem_orcamento:empresa_divergente` | venda e orçamento de empresas diferentes |
| `arbitragem_orcamento:sem_arbitragem` | `orcamentos.venda_id IS NULL` — ninguém ganhou ainda |
| `arbitragem_orcamento:outra_venda_venceu` | `orcamentos.venda_id <> NEW.id` |

**`RAISE`, não `RETURN NULL`.** Descartar em silêncio é o defeito do gatilho
antigo, e aqui o cliente PRECISA saber que perdeu para poder marcar o conflito.

### A ordem efetiva, medida

Gatilhos do mesmo tipo disparam em **ordem alfabética do nome** — é a regra do
PostgreSQL, e é só dela que a ordem depende. Por isso o nome começa com `b_`.
Consultado em produção:

```
ordem  nome                            quando  evento         função
  1    a_trg_redirecionar_cliente      BEFORE  INSERT         redirecionar_cliente_mesclado
  2    b_trg_venda_exige_arbitragem    BEFORE  INSERT UPDATE  exigir_arbitragem_do_orcamento
  3    trg_bloquear_venda_duplicada    BEFORE  INSERT         bloquear_venda_duplicada   ← RETURN NULL
  4    trg_venda_carteira              AFTER   INSERT         criar_conta_carteira
```

O #1 só reescreve `cliente_id` e não interfere. O #3 é o que devolve `NULL` e
engole o INSERT em silêncio; o guardrail roda **antes** dele.

### Provas em transação desfeita (produção)

Fixtures com `numero` próprio em cada insert, justamente para que a janela de 2
minutos de `trg_bloquear_venda_duplicada` não fosse a causa de nenhum
resultado. `venda_id` de fixture é UUID que não existe em `vendas` —
`orcamentos.venda_id` não tem FK, então nenhuma venda comercial fictícia foi
criada.

```
1. venda comum (orcamento_id NULL) ..... ENTROU
2. orcamento inexistente ............... RECUSADA  arbitragem_orcamento:inexistente
3. orcamento de outra empresa .......... RECUSADA  arbitragem_orcamento:empresa_divergente
4. orcamento sem arbitragem ............ RECUSADA  arbitragem_orcamento:sem_arbitragem
5. arbitrada (convertido) -> venda A ... ENTROU
6. venda B (perdedora) ................. RECUSADA  arbitragem_orcamento:outra_venda_venceu [23000]
6b. perdedora na janela de 2 min ....... RECUSADA  arbitragem_orcamento:outra_venda_venceu
    engolida em silencio pelo 2 min? ... NAO (linhas novas em vendas_duplicidade_bloqueada: 0)
7. UPDATE amarrando venda comum a X .... RECUSADO  arbitragem_orcamento:outra_venda_venceu
8. trigger OFF, 2a venda no mesmo X .... BARRADA 23505 por vendas_orcamento_unico
9. vendas vinculadas ao orcamento X .... 1
   perdedoras existentes no servidor ... 0
   itens remotos das perdedoras ........ 0
   movimentacoes remotas das perdedoras  0
   orcamentos.venda_id = A? ............ t
10. vendas REAIS com vinculo ........... 0
```

A linha **6b** é a que o Gate pedia: a perdedora com o MESMO número e total da
vencedora, dentro da janela de 2 minutos. O gatilho antigo a engoliria e o
cliente veria "sincronizou". Resultado: erro explícito, e **zero** linhas novas
em `vendas_duplicidade_bloqueada`.

A linha **8** prova que a segunda camada é camada de verdade: com o gatilho
desligado, o índice único ainda barra.

Do lado do cliente, `23000` + dica não pode chegar como erro transitório —
senão a fila repetiria para sempre uma venda que jamais vai entrar. `api.js`
repassa a causa em `e.arbitragem`; `sync.js` marca `conflito_orcamento`
(ou `invariante_banco:<causa>` quando não é disputa) e **não reenvia**.

## 5. A prova A/B — dois SQLite, dois processos

Bancada: `database.js` e `sync.js` **reais**, dois diretórios `userData`
distintos, um processo por fase (Electron como node, pela ABI do
`better-sqlite3`). O terminal B tem **id local do orçamento diferente do
remoto**, para exercitar a resolução de identidade.

O **servidor** é um substituto em JSON que implementa as mesmas regras já
provadas contra produção na seção 4 — porque dois terminais offline precisam de
um servidor alcançável por dois processos, e criar venda comercial em produção
está proibido. O que a bancada prova é o **cliente**: a sequência, o portão, o
estado da perdedora. O que o servidor faz está provado na seção 4, contra o
Postgres real.

### OFFLINE — os dois conseguem commit, como esperado

```
[terminalA] venda de orcamento criada 46be28e8 | estoque 100 → 95
[terminalB] venda de orcamento criada 5f027914 | estoque 100 → 95
```

### ONLINE — A primeiro

```
[CONV] Orcamento nº900077 arbitrado para a venda eb741ee0 (convertido) — agora ela pode subir.
venda eb741ee0  remote_id=eb741ee0  sync_status=synced
chamadas: conv, venda
```

### ONLINE — B depois

```
venda f6bd7e57  remote_id=NULL  sync_status=conflito_orcamento
chamadas: conv, conv        ← nenhuma chamada de venda. Ela PAROU no portão.
```

### Contagem no servidor

```
vendas remotas (total) ............... 1
vendas remotas COM o orcamento X ..... 1
orcamentos.venda_id .................. eb741ee0   (= A)
revisao do orcamento ................. 1          (não avançou duas vezes)
venda eb741ee0 (vencedora) itens=1 movimentacoes=1
vendas remotas que NAO sao a vencedora 0
itens remotos dessas .................. 0
movimentacoes remotas dessas .......... 0
```

Como as movimentações foram atribuídas: por `referencia_id = <uuid da venda>`
com `referencia_tipo = 'venda'`, que é a chave que o fluxo atual grava. A
perdedora não existe no servidor, então não há ambiguidade a resolver — são
zero porque a venda inteira não entrou.

### Fila entregue de propósito na ORDEM ERRADA

`getPendentes` foi sobrescrito para devolver `venda/create` antes de
`orcamento_converter` — a ordem antiga:

```
[terminalA] fila FORCADA na ordem errada: venda -> orcamento_converter
[CONV] Venda 8be1a2d5 ja sincronizada — arbitragem ja confirmada.
[terminalB] fila FORCADA na ordem errada: venda -> orcamento_converter
[terminalB] venda b15a6a64 remote_id=NULL sync_status=conflito_orcamento
chamadas: conv venda | conv conv
```

Mesmo com a fila errada, B fez `conv` e **não** `venda`. A segurança não depende
do `ORDER BY`.

### `orcamento_converter` quando chega depois

Em A, na ordem errada, o item encontrou a venda já sincronizada e encerrou sem
repetir nada. No caminho normal, a arbitragem do item dá `convertido` e a do
portão dá `ja_convertido` — `revisao` fica em **1** nos dois casos. O item não
tem mais lógica própria: delega para o mesmo portão, com a identidade remota e
o UUID local. Não conflita consigo mesmo.

## 6. Estado da perdedora, e restart

```
venda do orcamento: {"id":"f6bd7e57","remote_id":null,"sync_status":"conflito_orcamento",
                     "orcamento_id":"0a0a0a0a"}
conflito: {"tipo":"conflito_conversao","vencedora":"eb741ee0","numero_orcamento":900077}
itens locais ............ 1
movimentacoes locais ..... 1
estoque local ............ 95     (NÃO compensado — é decisão comercial)
fila pendente ............ []
pode reenfileirar? ....... false
```

Restart, processo novo, banco reaberto:

```
fila pendente: 0 -> 0   (recuperarVendasPendentes NÃO reenfileirou)
chamadas ao servidor: 5 -> 5   (zero HTTP novo da venda B)
sync_status ainda conflito_orcamento, vencedora ainda eb741ee0
```

Duas camadas, de propósito: o filtro em `recuperarVendasPendentes`
(`sync_status != 'conflito_orcamento'`) é higiene; se alguém reenfileirar
amanhã por bug, o portão continua barrando o envio.

## 7. Retry da vencedora, com o mesmo UUID

`remote_id` apagado localmente — exatamente o que o cliente teria se a resposta
do create se perdesse — e reenvio pelo retry manual:

```
remote_id apagado (resposta perdida). reenviando o MESMO uuid e4a0693c
retry manual: {"ok":true,"remoteId":"e4a0693c-…"}
→ servidor: vendas remotas 1 | itens 1 | movimentacoes 1 | revisao 1
```

**Duas propriedades separadas, e só a primeira está provada aqui:**

1. **A identidade da linha `vendas` está protegida pela PK.** O UUID é do
   cliente, o reenvio bate na chave primária e `api.js` confere por id — não por
   `numero + total + janela`. Uma venda, não duas.
2. **Os efeitos dependentes não são plenamente idempotentes no fluxo legado.**
   `api.js` retorna cedo quando reconhece a venda pelo id, então o reenvio não
   duplica itens — mas se a primeira tentativa gravou a venda e morreu antes dos
   itens, o reenvio retorna cedo e os itens continuam faltando. Isso é
   `registrarVenda`, é a 0.6C.6B, e não está resolvido aqui. Não atribuo a esta
   fase uma garantia que ela não tem.

## 8. Regressão da venda comum

```
venda COMUM criada ee483ab3 | estoque 100 → 95
fila: venda
→ servidor: vendas remotas 1 | com orcamento_id 0 | itens 1 | movimentacoes 1
            chamadas a orcamentos.converter: 0
```

O portão sai na primeira linha para venda sem orçamento. E em produção, depois
da migration, **26 vendas reais** entraram hoje pelos PDV-001/003/004, todas com
`orcamento_id = NULL` — a operação não sentiu a mudança.

## 9. Testes

| suíte | testes |
|---|---|
| `vargasnexus-pdv` | **146** (119 + 27 novos) |
| `sistema-vargas` | **755** |

Regressões 0.6C, arquivo por arquivo:

```
orcamento-numero-oficial (0.6C.2) ... 23/23
orcamento-downsync (0.6C.3) ......... 18/18
orcamento-cancelamento (0.6C.4) ..... 28/28
orcamento-alheio (0.6C.5) ........... 15/15
orcamento-propriedade (0.6C.5.1) .... 12/12
conversao-orcamento-venda (0.6C.6A) .. 6/6
arbitragem-venda (0.6C.6A.1) ........ 27/27
```

Entre os 27 novos, os que existem para não deixar a regra voltar: o portão vem
antes de `api.registrarVenda` **e** de `api.registrarCliente`; o retry manual
entra pela mesma porta; a fila ordena orçamento antes de venda; `montarInsert`
manda `orcamento_remote_id` e nunca o local; `getById` não tem COALESCE;
número nunca é identidade; nenhuma espera libera a venda.

## 10. Arquivos, migrations, commits

**`vargasnexus-pdv`** (1.10.0 → **1.10.1**; construída não, publicada não):
- `src/main/arbitragemVenda.js` — **novo**: a decisão, pura;
- `src/main/sync.js` — `_arbitrarAntesDeSubir`, o portão em
  `_sincronizarVendaCreate`, `catch` de `e.arbitragem`, `orcamento_converter`
  delegando ao portão, filtro em `recuperarVendasPendentes`, dois internos
  exportados para a prova;
- `src/main/database.js` — ordem da fila, `getById` com `orcamento_remote_id`;
- `src/main/api.js` — `orcamento_id` no `montarInsert`, propagação de `23000` +
  dica;
- `tests/arbitragem-venda.test.js` — **novo**, 27 testes.

**`sistema-vargas`**:
- migration `vendas_orcamento_id_e_guardrail_de_arbitragem` (aplicada);
- `tests/pdv/conversao-rota.test.ts` e o gate das Etapas 1 e 2 (commit
  `603f952`, ainda não empurrado).

## 11. Riscos residuais

1. **Terminal com 1.10.1 e sem a flag `orcamentos` segura a venda de
   orçamento.** `rota_desligada` é `esperar`, então a venda fica pendente até a
   flag ser ligada. Contido porque só o Escritório recebe 1.10.1 e só ele tem a
   flag — mas é a razão pela qual nenhum Balcão pode receber esta versão sem a
   flag.
2. **Orçamento criado offline e nunca sincronizado segura a venda.** Sem
   identidade remota não há arbitragem possível, e a regra não abre exceção. A
   fila agora sincroniza o orçamento antes, o que resolve o caso normal; um
   orçamento cuja sincronização esteja quebrada mantém a venda pendente.
3. **`venda_itens` e estoque remotos não são idempotentes** — seção 7, item 2.
   É a 0.6C.6B.
4. **A bancada A/B usa servidor substituto.** As regras dele foram provadas
   contra produção (seção 4); a sequência do cliente foi provada com o código
   real. A costura entre as duas só será exercitada de ponta a ponta na primeira
   conversão legítima do piloto.
5. **`trg_bloquear_venda_duplicada` continua descartando em silêncio** para
   venda comum com mesmo número e total dentro de 2 minutos. Fora do escopo
   desta fase, por decisão; medido que ele NÃO alcança a venda de orçamento,
   porque o guardrail roda antes.
6. **`pdv_operacoes` ainda não tem nenhuma linha `orcamentos.converter`** — 0,
   como esperado: nenhum terminal roda 1.10.1.

---

**PRONTO PARA PILOTO 0.6C.6A.1.** Não publiquei, não empurrei, não atualizei
terminal, não toquei em flags, não iniciei 0.6C.6B nem `registrarVenda`.
