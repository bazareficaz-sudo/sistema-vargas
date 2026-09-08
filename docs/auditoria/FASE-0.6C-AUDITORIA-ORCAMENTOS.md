# Auditoria read-only — `orcamentos` / `orcamento_itens`

**Data:** 08/09/2026
**Escopo:** entender o comportamento atual antes de decidir se `orcamentos` é a
segunda operação a sair do `anon`. **Nada foi alterado.**
**Recomendação:** **GO — com uma condição que muda o desenho.**

---

## 1. O fluxo atual

### Criação

```
db.orcamentos.criar()          id local (uuid), enfileira {orcamento_id} como 'create'
  → sync_queue
  → se !orc.remote_id: api.sincronizarOrcamento(payload)
      insert orcamentos … .select().single()      ← id E numero vêm do SERVIDOR
      insert orcamento_itens                       ← erro vira console.warn
      return { id, numero }                        ← sempre "sucesso"
  → db.orcamentos.atualizarRemoteId()
  → fila marca processado
```

### Edição / conversão

A fila faz **duas chamadas HTTP independentes** para uma única intenção:

```
api.atualizarStatusOrcamento(remoteId, status)    ← lança em erro
api.atualizarOrcamento(remoteId, { …, itens })
    update orcamentos                              ← lança em erro
    delete orcamento_itens where orcamento_id=…    ← erro NÃO verificado
    insert orcamento_itens                          ← erro NÃO verificado
    return { ok: true }                             ← sempre
```

`marcarConvertido()` (orçamento → venda) usa exatamente esse caminho: muda o
status local e enfileira um `update`.

## 2. Os quatro defeitos

### D1 — Cabeçalho sem itens, reportado como sucesso

```js
if (errItens) console.warn('[ORC] Erro ao inserir orcamento_itens:', errItens.message);
```

Não lança. A função retorna `{ id, numero }`, o `remote_id` é gravado, a fila
marca processado — e o orçamento fica na nuvem **com zero itens, para sempre**.

**Esta é a resposta à pergunta central da auditoria.** Se o servidor salva o
cabeçalho e falha nos itens, o estado atual não é "parcial e detectável": é
parcial e **relatado como completo**. Nada no sistema volta a olhar para ele.

### D2 — A janela do `DELETE → INSERT`

Entre as duas chamadas o orçamento existe com zero itens. Se o `insert` falhar,
ou o processo morrer no meio, a perda é permanente — e a função devolve
`{ ok: true }` de qualquer forma, porque nenhum dos dois erros é verificado.

Não é hipótese remota: é o caminho percorrido **em toda conversão para venda**.

### D3 — Sem idempotência na criação

O `id` e o `numero` nascem no servidor (`numero` é
`nextval('orcamentos_numero_seq')`). Resposta perdida ⇒ `remote_id` não é
salvo ⇒ o guard `!orc.remote_id` não protege ⇒ retry cria **um segundo
orçamento, com número novo queimado da sequência**.

É o mesmo defeito de `faltas`, com um agravante: aqui o artefato duplicado é um
documento numerado que o cliente pode ter recebido.

### D4 — Status e conteúdo podem divergir

Duas chamadas, sem transação entre elas. Se a primeira passa e a segunda falha,
o orçamento fica marcado `convertido` com o conteúdo anterior.

## 3. Medição — latente, não manifesto

```
orcamentos no total .................... 55
sem nenhum item ........................  0
com total > 0 e sem item ...............  0
números duplicados .....................  0
criados nos últimos 30 dias ............ 33
```

**Nenhum dos quatro defeitos se materializou até hoje.** Vale registrar isso com
a mesma clareza com que registro o risco: o código é perigoso, o estrago não
aconteceu. O volume é baixo (~1/dia) e a janela é curta.

O que faz a exposição crescer não é o volume de criação, e sim o de **edição e
conversão** — porque é lá que mora o `DELETE → INSERT`.

## 4. Offline, retry, conflito, reabertura

| Aspecto | Comportamento atual |
|---|---|
| Offline | O orçamento nasce no SQLite e fica na fila. Correto. |
| Retry | A fila reprocessa; após 5 falhas marca processado e **desiste em silêncio** (mesmo `sync.js` de `faltas`). |
| Fechar/reabrir | O item pendente sobrevive — a fila é tabela SQLite. |
| Conflito | Não existe controle. O último `update` a chegar vence, sem versão nem carimbo. |
| Duplicidade | Possível em D3. Nada no servidor a impede. |
| Operação parcial | Possível em D1 e D2, sem sinal. |
| Cabeçalho ↔ itens | Relação sem integridade transacional: são requisições separadas. |

## 5. Pode ser uma operação única, transacional e idempotente?

**Sim, e é o caso mais adequado que existe hoje para o padrão.**

```
POST /api/pdv/orcamentos        UMA intenção: cabeçalho + itens juntos
  idempotency_key = id local     já existe, já persistido antes do envio
  → operacaoProtegida            auth, empresa server-side, idempotência
  → rpc('salvar_orcamento_pdv')  SECURITY DEFINER, uma transação:
        cabeçalho + itens + número        ou nada
```

Três propriedades que só aparecem com essa forma:

- **O número sai da sequência dentro da transação.** Retry não queima número,
  porque a idempotência devolve o resultado anterior em vez de reexecutar.
- **A edição deixa de ser `DELETE → INSERT` sujeito a morrer no meio.** Vira
  substituição atômica do conjunto de itens.
- **Status e conteúdo viajam juntos**, então D4 desaparece por construção.

### O que NÃO fazer

Migrar o `DELETE → INSERT` para um endpoint autenticado seria **autenticar um
defeito**. O ganho de segurança viria acompanhado da mesma perda silenciosa de
dados, agora com token. Se `orcamentos` for a segunda operação, ela precisa ser
redesenhada como comando, não transportada como CRUD.

## 6. Serve de ensaio para `vendas`?

Sim — e é o melhor ensaio disponível.

| | orçamento | venda |
|---|---|---|
| Forma | cabeçalho + linhas filhas | idêntica |
| Precisa de atomicidade | sim | sim |
| Número de documento | sim | sim |
| Estoque | **não** | sim |
| Dinheiro | **não** | sim |
| NFC-e | **não** | sim |

É a mesma arquitetura com metade das consequências. Se o comando transacional
funcionar em orçamentos, `vendas` passa a ser o mesmo desenho com efeitos
colaterais a mais — e não um salto às cegas.

`registrarVenda` hoje faz três ou mais chamadas independentes e tem exatamente
os mesmos buracos; a diferença é que lá eles custam estoque e dinheiro.

## 7. Recomendação

**GO para `orcamentos` como segunda operação**, com a condição do item 5: ela
entra como **comando de negócio transacional e idempotente**, nunca como o CRUD
atual autenticado.

Riscos a tratar no desenho, quando autorizado:

1. a RPC precisa de `search_path` fixo e não pode ser concedida ao `anon`;
2. orçamentos já existentes na fila no momento da migração precisam de regra
   explícita — drenar pelo caminho antigo ou reenviar pelo novo;
3. `atualizarStatusOrcamento` some como chamada separada, e isso muda um
   caminho que a conversão para venda usa — merece teste próprio;
4. a rota de leitura (`sincronizarOrcamentos`) continua no `anon` e não faz
   parte desta migração.

**Nada implementado. Nada alterado.**
