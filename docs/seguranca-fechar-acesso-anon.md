# SEGURANÇA — Fechar o acesso anônimo do Supabase

**Prioridade: crítica. Fase própria, antes de a Loja Online ir ao ar de verdade.**

Registrado em 24/08/2026, durante a Fase 1 da Loja Online. Não é um achado
novo: está documentado desde o bloco "AINDA ABERTO" de
`supabase-fechar-acesso-publico-2.sql`. O que muda agora é o **prazo**.

---

## 1. O que está aberto

Medido contra a produção com a chave `anon` — a chave pública, que vai dentro
do JavaScript de qualquer página — e **sem nenhum login**. Reconferido em
24/08/2026, depois da Fase 1: continua exatamente igual.

| tabela | linhas legíveis | o que vaza |
|---|---:|---|
| `produtos` | 28.593 | **`preco_custo`**, `markup`, `obs_interna`, `codigo_fornecedor` |
| `produto_estoque` | 28.748 | saldo por depósito |
| `clientes` | 64 | **CPF/CNPJ**, telefone, saldo devedor, bloqueios |
| `vendas` / `venda_itens` | 1.863 / 3.265 | histórico comercial inteiro |
| `usuarios_pdv` | 4 | **`senha_hash` dos operadores** |
| `estoque_movimentacoes` | 2.886 | toda a movimentação |
| `contas_receber` | 170 | quem deve o quê |
| `whatsapp_mensagens` | 880 | conteúdo e telefone de clientes |
| `produto_vinculos` | 14.109 | mapa de produtos entre empresas |
| `fornecedor_produto` | 437 | custo por fornecedor |
| `vendedores`, `depositos`, `orcamentos`, `kit_itens`, `faltas` | todas | — |

A **escrita** anônima já foi podada (`supabase-fechar-escrita-anonima.sql`):
sem DELETE em lugar nenhum, sem UPDATE em `vendas`. O que resta aberto é
leitura — e `senha_hash` é o item mais grave da lista.

## 2. Por que ainda está aberto

O **PDV externo** (o terminal do balcão) conecta no banco com a chave pública,
sem sessão de usuário. Ligar RLS em qualquer uma dessas tabelas derruba o
caixa no meio do expediente.

Não é desleixo: é uma dependência que não se resolve só pelo banco.

## 3. O que a Loja Online fez a respeito — e o que NÃO fez

**Fez:** a vitrine pública não recebe chave de banco nenhuma. Renderiza no
servidor, consulta por `src/lib/commerce/db.ts` com chave de serviço, e lê de
views de lista branca onde custo e margem não existem nem como coluna. Todas
as tabelas, views e funções novas da loja negam tudo para `anon` (conferido:
401 em todas).

**Não fez, e não podia fazer:** nada disso fecha o buraco existente. A loja
apenas não o amplia.

**O que muda com a loja no ar:** hoje a exposição vive atrás de um sistema
administrativo que ninguém divulga. Uma vitrine pública é o oposto — feita
para atrair tráfego, ser indexada e ser compartilhada no WhatsApp. Mais gente
olhando o domínio significa mais chance de alguém extrair a chave `anon` de
algum bundle e varrer o banco. **O risco não sobe por causa do código da loja;
sobe por causa da atenção que a loja atrai.**

## 3b. MEDIÇÃO — feita em 30/08/2026, e o que ela corrigiu

O passo 1 abaixo foi executado: 24h de `edge_logs`, separando por
`request.sb.jwt.authorization.payload.role`.

**A superfície anônima real é pequena.** 887 requisições em 24h, 8 IPs, 21
caminhos — contra 197 mil do `service_role` e 4,8 mil do `authenticated`.
Quem usa a chave pública: o terminal (`node`, lê 14 tabelas em ciclo e
escreve em 5), o app (`Dart/3.12`, lê `vendas` e `venda_itens`) e o site
público (`blog_posts`).

**Duas coisas que este documento afirmava e a medição desmentiu:**

1. **O passo 3 abaixo derrubaria o caixa.** O terminal pede `select=*` em
   `produtos`, `clientes`, `contas_receber` e `creditos_cliente`. Quando uma
   coluna é revogada, o PostgREST recusa o `select=*` INTEIRO com 403 — não
   devolve o resultado sem a coluna. "Tirar coluna, não tabela" só é seguro
   onde o cliente nomeia as colunas, e aqui ele não nomeia.

2. **A escrita anônima NÃO foi podada.** `anon` tinha
   INSERT/UPDATE/DELETE em dezenas de tabelas com RLS desligada. Em uma
   delas isso era escalada de privilégio — ver abaixo.

**O achado mais grave, e ele não estava neste plano:** `system_admins` tinha
RLS DESLIGADA (suas 3 políticas eram decoração) e `anon` tinha INSERT. Como
`is_system_admin()` lê essa tabela por `auth.uid()`, e aparece como
`OR is_system_admin()` nas políticas de RLS de todo o sistema, inserir a
própria conta ali abriria todos os tenants. Fechado na Onda 1.

**Detalhe que decide caso a caso:** `Prefer: return=representation` num
POST/PATCH exige SELECT na tabela. `produtos`, `produto_estoque` e `vendas`
usam esse cabeçalho — nelas leitura e escrita andam juntas e não dá para
separar. `estoque_movimentacoes` não usa, e por isso foi possível tirar o
SELECT dela mantendo o INSERT.

## 3c. ONDA 1 — executada em 30/08/2026

Arquivo: [`../supabase-fechar-anon-onda1.sql`](../supabase-fechar-anon-onda1.sql).
Só tabelas com ZERO leitura anônima na janela medida.

| | |
|---|---|
| `system_admins` | `REVOKE ALL` — fecha a escalada de privilégio |
| `usuarios_pdv` | `senha_hash` fora do alcance; as outras 18 colunas ficam |
| `whatsapp_mensagens`, `fornecedor_produto`, `produto_vinculos`, `cr_auditoria`, `vendedor_auditoria`, `cobranca_historico` | `REVOKE ALL` |
| `estoque_movimentacoes` | só o SELECT sai; o INSERT fica |

Conferido depois: `has_column_privilege('anon','usuarios_pdv','senha_hash')`
= false, e `autenticar_operador_pdv` continua executável pelo anônimo.

**RLS em `system_admins` ficou de fora de propósito.** A política
`system_admins_superadmin_write` faz `EXISTS (SELECT 1 FROM system_admins…)`
dentro da política da própria tabela; ligar RLS assim dispara *infinite
recursion detected in policy for relation system_admins*. Reescrevê-la para
uma função `SECURITY DEFINER` é passo próprio, com teste.

**O que resta, medido depois da Onda 1:** 83 tabelas ainda legíveis pelo
anônimo com RLS desligada, 80 delas ainda escrevíveis e 71 ainda apagáveis.
Outras 63 já estão protegidas por RLS. O buraco continua grande — a Onda 1
tirou o pior, não o todo.

## 4. Caminho de correção (não implementar sem planejar)

A base já existe. `autenticar_operador_pdv()` foi criada na rodada 1 do
fechamento: confere a senha dentro do banco e nunca devolve o hash. E o padrão
de RPC `SECURITY DEFINER` estreita já está em uso para o terminal
(`cancelar_venda_pdv`, `editar_venda_pdv`, `criar_produto_pdv`).

Ordem sugerida, do mais barato ao mais caro:

1. **Medir o que o PDV externo realmente usa.** Não deduzir do código do PDV
   web — instrumentar, ou ler os logs do PostgREST. Esta é a etapa que
   determina todo o resto, e pular é como as tentativas anteriores travaram.
2. **`REVOKE SELECT (senha_hash) ON usuarios_pdv FROM anon`** assim que o
   terminal passar a usar `autenticar_operador_pdv()`. É a linha de maior
   ganho por menor esforço, e já está escrita, comentada e pronta no final de
   `supabase-fechar-escrita-anonima.sql`, esperando só o terminal.
3. **Tirar coluna, não tabela.** `REVOKE SELECT (preco_custo, markup,
   obs_interna, codigo_fornecedor) ON produtos FROM anon` fecha o pior de
   `produtos` sem tocar na leitura do catálogo, que é o que o balcão precisa.
   Mesma ideia para `clientes` (CPF, saldo devedor).
4. **Tabelas que o terminal comprovadamente não lê** (a lista sai do passo 1):
   RLS ligada direto.
5. **O terminal autenticar de verdade** — sessão real em vez de chave pública.
   É a correção definitiva, e a mais cara.

## 5. Regras para quem for executar

- **Nunca rodar em horário de expediente.** Um `REVOKE` errado para o caixa
  no meio de uma venda.
- **Um passo por vez, com conferência entre eles.** O arquivo
  `supabase-fechar-escrita-anonima.sql` já traz o modelo: consulta de
  verificação e bloco "COMO DESFAZER" para cada mudança.
- **Testar em um terminal só, fora do pico**, antes de valer para todos.
- **Não misturar com a Loja Online.** São dois trabalhos com riscos
  diferentes; juntar faz um esconder o outro.

## 6. Como conferir o estado atual

```bash
# Roda de dentro de pdv-vargas-web/, lê a chave do .env.local.
# Devolve, por tabela, quantas linhas o anônimo enxerga.
node -e "
const fs=require('fs');const env=fs.readFileSync('.env.local','utf8');
const g=k=>(env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1].trim();
(async()=>{const u=g('NEXT_PUBLIC_SUPABASE_URL'),a=g('NEXT_PUBLIC_SUPABASE_ANON_KEY');
for (const t of ['produtos','clientes','vendas','usuarios_pdv','contas_receber','whatsapp_mensagens']) {
  const r=await fetch(u+'/rest/v1/'+t+'?select=id&limit=1',{headers:{apikey:a,Authorization:'Bearer '+a,Prefer:'count=exact'}});
  console.log(t.padEnd(22), (r.headers.get('content-range')||'?').split('/')[1]);
}})()"
```

Resultado desejado ao fim desta fase: **0** em todas.

Mais rápido, e sem depender de `.env.local`, é perguntar ao próprio banco:

```sql
SELECT c.relname, has_table_privilege('anon', c.oid,'SELECT') AS le
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity
   AND has_table_privilege('anon', c.oid,'SELECT')
 ORDER BY 1;
```

E, para saber o que o anônimo REALMENTE usa antes de revogar (o passo 1, que
é o que decide todo o resto), a consulta de log:

```sql
select log_attributes['request.path'], log_attributes['request.method'],
       log_attributes['request.headers.prefer'], count(*)
  from logs
 where source='edge_logs'
   and log_attributes['request.sb.jwt.authorization.payload.role']='anon'
 group by 1,2,3 order by 4 desc
```
