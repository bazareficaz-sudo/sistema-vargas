# Fase 2 — Sangria e Suprimento: invariantes obrigatórias

**Status: NÃO IMPLEMENTADA.** Este documento é o contrato que a Fase 2 terá
de cumprir, escrito na Fase 1.1 enquanto o desenho estava fresco e o ledger
ainda vazio. Nada aqui existe em código: `caixa_transferencia` não foi
criada, e não há sangria nem suprimento no sistema.

O que a Fase 1.1 deixou pronto para ela: o ledger com append-only em duas
camadas (grant *e* policy), a empresa ativa resolvida server-side no domínio
do Caixa (`src/lib/caixa/contextoCaixa.ts`), e a migration da Fase 1
reconciliada com o histórico de produção.

---

## O problema que a Fase 2 resolve

Sangria é o operador tirando dinheiro da gaveta do PDV e entregando ao
financeiro. Suprimento é o contrário. Em ambos os casos **um mesmo dinheiro
sai de um lugar e entra em outro** — uma transferência econômica com dois
lados, não dois lançamentos independentes.

O erro a evitar tem nome: sangria que saiu do PDV e não entrou na
tesouraria. O dinheiro some do sistema e reaparece só na conferência física,
dias depois.

---

## As invariantes

### 1. Origem e destino pertencem à mesma empresa

Uma transferência nunca cruza CNPJ. `caixa_origem.empresa_id` tem de ser
igual a `caixa_destino.empresa_id`, e igual à empresa do contexto validado.

**A RLS não garante isso.** As policies do Caixa usam
`empresa_do_meu_grupo()`, que é por **grupo empresarial**: um usuário com
vínculo nas duas empresas enxerga e insere nas duas. Há hoje 2 empresas
reais e 5 vínculos ativos em `usuario_empresas` — o cenário é alcançável,
não teórico.

A checagem tem de ser explícita na função transacional, relendo os dois
caixas do banco. Nunca confiar em `empresa_id` que veio no payload.

### 2. A empresa é a empresa ativa validada server-side

Vem de `contextoCaixa(sb)`, como já vale para as rotas da Fase 1. O
navegador não escolhe empresa: as rotas não têm parâmetro de empresa.

### 3. A transferência é um documento imutável

Separar **documento** de **movimento** é o princípio que sustenta o módulo
desde a Fase 1 — o mesmo que impede gravar saldo em coluna.

```
caixa_transferencia   o documento: nasce uma vez, nunca muda
caixa_movimento       os efeitos: dois, um em cada caixa
```

Os dois movimentos carregam `transferencia_id`. Sem isso, dois pares
idênticos ficam indistinguíveis — `contraparte_caixa_id`, que já existe na
tabela, diz *para onde*, não *qual operação*.

### 4. Os dois movimentos são atômicos

Uma transação, uma função no Postgres. Ou gravam origem **e** destino, ou
não gravam nada. Não existe estado em que só um lado existe.

`UNIQUE (transferencia_id, caixa_id)` impede que um retry parcial produza um
terceiro movimento.

### 5. Retry com o mesmo UUID e o mesmo payload é idempotente

O cliente gera o UUID da transferência **ao abrir o diálogo**, não ao
confirmar — é isso que torna o duplo clique inofensivo.

Mesmo UUID e mesmo payload devolvem a operação existente (`ja_aplicada`),
sem criar movimento novo. Vale para duplo clique, timeout, resposta perdida,
retry e refresh.

Concorrência real exige `pg_advisory_xact_lock` sobre o UUID: a 0.6D.2
provou, no domínio da venda, que `FOR UPDATE` sozinho não serializa duas
chamadas simultâneas com a mesma identidade — a segunda esbarra na PK e
estoura em vez de responder `ja_aplicada`.

### 6. Mesmo UUID com payload diferente é conflito explícito

Nunca "atualiza" e nunca ignora em silêncio: responde `409 conflito_payload`.
Mesma identidade com outro valor significa que alguém reusou o UUID — ou o
cliente montou um payload diferente para a mesma operação. Os dois casos são
defeito, e defeito silencioso em dinheiro é o pior tipo.

### 7. Estorno é do documento inteiro

Nunca de um movimento só. Estornar a transferência gera o **par invertido**,
os dois lados de uma vez, referenciando o documento original.

Um índice único parcial sobre `estorno_de_id` impede estorno duplicado —
mesmo padrão que a Fase 1 já usa em `caixa_movimento`.

### 8. O endpoint antigo de estorno recusa movimento de transferência

`POST /api/caixa/tesouraria/movimentos/[id]/estornar` é da Fase 1 e estorna
**um** movimento. Aplicado a um movimento com `transferencia_id`, estornaria
metade da transferência — o dinheiro sairia do sistema pela porta que a
invariante 4 fechou.

A Fase 2 tem de fazer essa rota recusar explicitamente quando
`transferencia_id` não for nulo, apontando para a rota de estorno de
transferência.

### 9. O ledger continua append-only

Nada de UPDATE ou DELETE. `caixa_transferencia` nasce com o mesmo tratamento
que a Fase 1.1 deu a `caixa_movimento`: policies **separadas por operação**
(`FOR SELECT` e `FOR INSERT`, sem policy de UPDATE nem de DELETE) e grants
correspondentes.

Com RLS ligada, operação sem policy é negada — a ausência da policy *é* a
proibição. Dizer a mesma coisa nas duas camadas obriga qualquer
afrouxamento futuro a ser explícito em dois lugares.

### 10. `anon` continua sem escrita

`anon` não tem nenhum privilégio em `caixa` nem em `caixa_movimento`, e não
terá em `caixa_transferencia`. Este ledger não tem consumidor externo: o PDV
não fala com ele. Nenhuma parte da Fase 2 pode exigir afrouxar isso para
funcionar.

---

## O que a Fase 2 também terá de resolver, e não é invariante

**Não existe nenhum caixa `tipo='pdv'` em produção** — 0 linhas. Sem ele não
há origem para sangria. A Fase 2 precisa criar e listar caixas de PDV,
provavelmente um por terminal ativo e sob demanda, espelhando
`buscarOuCriarTesouraria`.

---

## Permissões

Reusar o mecanismo existente, sem sistema paralelo. A proposta aprovada na
auditoria da Etapa A:

| Ação | Código |
|---|---|
| ver caixa / tesouraria | `tela:/dashboard/caixa` (já existe, liberado por padrão) |
| sangria e suprimento | `gerenciar_financeiro` (já existe) |
| estornar | `estornar_caixa` (**novo**, único código a criar) |
| ver todas as empresas | `ver_dados_grupo` (já existe) |

Um código novo, não seis: separar sangria de suprimento criaria uma matriz
que ninguém configura na prática — o mesmo raciocínio que
`src/lib/auth/permissoes.ts` já aplica a `gerenciar_terminais_pdv`.

---

## Migrations

Enquanto o histórico global de migrations estiver desalinhado (ver
`DIVIDA-TECNICA.md`), **não usar `supabase db push`**. Aplicar pelo
mecanismo controlado do projeto, e depois:

1. ler a `version` que o Supabase registrou;
2. nomear o arquivo local com exatamente essa versão;
3. comparar o `md5` do arquivo com o do SQL aplicado;
4. registrar a prova de que os dois são a mesma migration.

É o procedimento que a Fase 1.1 usou em
`20260922154510_caixa_append_only_por_policy.sql`.
