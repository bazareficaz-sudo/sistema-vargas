# Fase 0.6 — Autenticação segura do PDV externo e preparação para RLS

**Data:** 07/09/2026
**Acesso ao `vargasnexus-pdv`:** **SIM.** Encontrado em
`C:\Users\DELL\Desktop\vargasnexus-pdv`. Auditado nesta fase — é a diferença
em relação à Fase 0.5, que trabalhou às cegas sobre esse repositório.

---

## 0. Estado da Fase 0.5 (item 1)

| Verificação | Estado |
|---|---|
| Commit `38c5b9c` | **presente**, é o HEAD local |
| `origin/main` | `963e715` — o commit da 0.5 **ainda não foi enviado** |
| Árvore de trabalho | limpa, sem alterações posteriores |
| Migrations em produção | `20260907004643_seguranca_financeira_revogar_truncate_e_delete_do_anon` e `20260907005005_seguranca_fechar_escalacao_de_privilegio_system_admins` — **aplicadas**, correspondem ao commit |

**Divergência anotada:** os arquivos no repositório têm carimbo
`20260906233000` / `20260906233500`; o Supabase registrou
`20260907004643` / `20260907005005`. Conteúdo idêntico, nomes diferentes —
o Supabase carimba no momento da aplicação. Também: a migration
`empresa_config_pdv` (05/09) existe em produção mas o arquivo ficou na raiz
do repositório (`supabase-pdv-config-promocao.sql`), fora de
`supabase/migrations/`. Nenhuma das duas é perigosa; ambas atrapalham quem
tentar reconstruir o banco do zero.

**Nada foi perdido, sobrescrito ou rebaseado.**

### Verificação retroativa: a Fase 0.5 quebrou algo?

Com acesso ao PDV, dá para responder o que antes era inferência. A 0.5
revogou `DELETE` de `contas_pagar`, `recebimentos`, `creditos_cliente`,
`credito_utilizacoes`, `renegociacoes`, `cr_auditoria` e `contas_receber`.

O PDV externo tem **exatamente um** `.delete()` em todo o código:
`src/main/api.js:1023` — `from('orcamento_itens').delete()`. Essa tabela
**não estava na lista revogada**.

**Confirmado: a Fase 0.5 não quebrou nada.** Era inferência; agora é fato.

---

## A. Arquitetura atual do PDV

**Stack:** Electron, `pdv-vargas` v1.8.23, "Terminal de Vendas
Offline-First". Main process + renderer + preload. SQLite local via
`better-sqlite3`. `electron-store` para configuração. `electron-updater`
para atualização automática.

### O cliente Supabase — `src/main/supabaseClient.js` (20 linhas, íntegro)

```js
const SUPABASE_URL = 'https://ntwfkmwprjciucydedku.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOi...role":"anon"...';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  realtime: { transport: WebSocket },
});
```

Três fatos, todos verificáveis nessas linhas:

1. Chave `anon` embutida no fonte e no aplicativo distribuído.
2. **`persistSession: false`** — o cliente nunca faz login. Não existe
   sessão, não existe `auth.uid()`, em nenhum momento do ciclo de vida.
3. Um único cliente de módulo, compartilhado por todo o processo principal.

Isto é a prova mecânica do bloqueio da Fase 0.5. Não é configuração
acidental: é o desenho.

### Autenticação do operador — `src/main/api.js:1219`

```js
const senhaHash = crypto.createHash('sha256').update(senha).digest('hex');
const { data: linhas } = await supabase.rpc('autenticar_operador_pdv', {
  p_login: login, p_senha_hash: senhaHash,
});
```

E no banco:

```sql
CREATE FUNCTION autenticar_operador_pdv(p_login text, p_senha_hash text)
RETURNS TABLE(id, nome, cargo, empresa_id, empresa_nome, empresa_fiscal_id,
              empresa_estoque_id, deposito_id, unificar_estoque,
              permissoes, limite_desconto)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT ... FROM usuarios_pdv u
   WHERE lower(u.login) = lower(p_login)
     AND u.senha_hash = p_senha_hash
     AND u.ativo = true;
$$
```

Depois do sucesso, o resultado vai para o disco:

```js
store.set('auth.token', u.id);          // "token" = o UUID do operador
store.set('auth.usuario', usuario);     // empresa_id, permissoes, limite_desconto
store.set('auth.empresa_id', usuario.empresa_id);
```

### Como uma venda é gravada — `src/main/api.js:375`

```js
terminal_id: store.get('config.terminal_id') || 'PDV-001',
operador_nome: usuario.nome || null,
// ... e o insert NÃO carrega `id`
await supabase.from('vendas').insert(montarInsert()).select().single();
```

**Resumo da cadeia atual:** o terminal não é identificado, o operador é
identificado só por nome, a empresa vem de um arquivo local editável, e a
autorização inteira mora no cliente. O banco recebe tudo como `anon` e aceita.

---

## B. Superfície completa de dados

Extraída do código do PDV, não dos logs — o que corrige a lacuna da Fase 0.5,
onde 24h de log deixaram quatro tabelas invisíveis.

| Tabela / RPC | SELECT | INSERT | UPDATE | DELETE | Observação |
|---|:--:|:--:|:--:|:--:|---|
| `vendas` | ✓ | ✓ | | | id gerado pelo servidor |
| `venda_itens` | ✓ | ✓ | | | |
| `produtos` | ✓ | | ✓ | | baixa de estoque |
| `produto_estoque` | ✓ | ✓ | ✓ | | por depósito |
| `estoque_movimentacoes` | | ✓ | | | extrato |
| `clientes` | ✓ | ✓ | ✓ | | |
| `contas_receber` | ✓ | | ✓ | | recebimento de carteira |
| `recebimentos` | | ✓ | | | |
| `creditos_cliente` | ✓ | ✓ | ✓ | | **invisível nos logs de 24h** |
| `credito_utilizacoes` | | ✓ | | | **invisível nos logs de 24h** |
| `orcamentos` | ✓ | ✓ | ✓ | | **invisível nos logs de 24h** |
| `orcamento_itens` | | ✓ | | **✓** | o único DELETE do PDV |
| `faltas` | ✓ | ✓ | ✓ | | **invisível nos logs de 24h** |
| `pdv_impressao` | ✓ | | (upsert) | | |
| `depositos` | ✓ | | | | |
| `config_desconto` | ✓ | | | | |
| `saude_config` | ✓ | | | | |
| `deposito_enderecamento_config` | ✓ | | | | |
| `vendedor_empresas` | ✓ | | | | |
| RPC `autenticar_operador_pdv` | — | — | — | — | login |
| RPC `cancelar_venda_pdv` | — | — | — | — | SECURITY DEFINER |
| RPC `editar_venda_pdv` | — | — | — | — | SECURITY DEFINER |
| RPC `criar_produto_pdv` | — | — | — | — | SECURITY DEFINER, **recebe `p_empresa_id` do cliente** |

**19 tabelas e 4 RPCs.** Fechar RLS só nas quatro financeiras quebraria
estoque, orçamento, crédito e faltas.

**Offline:** existe `sync_queue` no SQLite local (`database.js:200`) — a fila
de operações pendentes. O PDV é **genuinamente offline-first**, não uma
capacidade imaginária.

---

## C. Problemas de segurança

### CRÍTICO

**P1 — A autorização inteira é client-side e editável em disco.**
`store.set('auth.usuario', usuario)` grava `empresa_id`, `permissoes` e
`limite_desconto` num JSON simples do `electron-store`
(`%APPDATA%/pdv-vargas/config.json`, sem criptografia). O PDV lê esse objeto
para decidir o que o operador pode fazer, e envia `empresa_id` dele em cada
escrita. Um operador com acesso ao próprio computador edita o arquivo e:
concede a si qualquer permissão, eleva `limite_desconto`, e **troca de
empresa**. O banco aceita, porque não tem como discordar.

**P2 — `senha_hash` é SHA-256 sem sal, e É a credencial.**
`crypto.createHash('sha256').update(senha)`. Sem sal, sem iterações, sem
bcrypt/argon2. Os 4 operadores em produção têm hash de 64 caracteres hex —
SHA-256 puro, confirmado. Como o RPC compara o hash recebido diretamente,
**possuir o hash é autenticar**: não há como o servidor distinguir quem sabe a
senha de quem tem o hash. E o hash fica em cache local para login offline.

**P3 — `autenticar_operador_pdv` é força-bruta aberta à internet.**
Callable pelo `anon` (chave pública, dentro do app distribuído), sem
limite de tentativas, sem bloqueio, sem registro. Se a senha do balcão for um
PIN numérico — o padrão em PDV —, o espaço inteiro é enumerável em segundos,
de qualquer lugar do mundo. O retorno entrega `empresa_id`, `permissoes` e
`limite_desconto`.

### ALTO

**P4 — `terminal_id` é metadado, não identidade.**
`store.get('config.terminal_id') || 'PDV-001'`. String num arquivo local.
**Resposta direta ao item 5: sim, um atacante simplesmente inventa outro.**
Não há registro de terminais no banco, não há ativação, não há revogação.

**P5 — `criar_produto_pdv(p_empresa_id uuid, ...)` confia na empresa do
cliente.** É `SECURITY DEFINER` — roda com privilégio de dono — e recebe a
empresa como parâmetro. Viola o item 14 diretamente.

**P6 — `auth.token` não é token.** `store.set('auth.token', u.id)` guarda o
UUID do operador. Não é assinado, não expira, não prova nada.

**P7 — Não há revogação de nada.** Terminal roubado continua vendendo.
Desativar operador (`ativo = false`) só impede *novo* login online — o cache
offline permanece válido no terminal.

### MÉDIO

**P8 — Identidade do operador não chega ao banco.** O insert manda
`operador_nome` (texto) e descarta `usuario.id`, que está disponível na
mesma linha. Nome é exibição; id é identidade.

**P9 — Sem chave de idempotência.** O insert de venda não carrega `id`; o
servidor gera. O sistema compensa com o gatilho `bloquear_venda_duplicada`,
uma heurística de "mesma empresa + mesmo número + mesmo total em 2 minutos"
que descarta a segunda gravação **em silêncio**. Uma retentativa da fila
offline depois de 2 minutos duplica a venda; e o descarte silencioso pode
esconder uma venda legítima.

**P10 — Login não é escopado por empresa.**
`WHERE lower(u.login) = lower(p_login)` — sem `empresa_id`. Hoje há 4
operadores numa empresa só, então não colide. Com dois clientes do SaaS
usando "caixa1", colide.

---

## D. Comparação das alternativas

| | A — Supabase Auth por operador | B — Terminal autenticado + operador interno | C — API do Sistema Vargas | D — JWT customizado |
|---|---|---|---|---|
| `auth.uid()` no banco | ✓ nativo | via JWT do terminal | ✗ (servidor usa service role) | ✓ se assinado com o segredo do projeto |
| RLS padrão da casa funciona | ✓ direto | ✓ com claim de empresa | não se aplica | ✓ com claim |
| Troca rápida de operador | ✗ exige signOut/signIn, ~1s cada | ✓ PIN local, instantâneo | ✓ | ✓ |
| **Offline** | ✗ refresh token expira; sem rede não renova | ✓ credencial longa do terminal | ✗ **quebra a fila offline** | ✓ |
| Volume de usuários | 1 por balconista × N lojas | 1 por terminal | 0 | 1 por terminal |
| Revogação | ✓ nativa | ✓ tabela de terminais | ✓ | ✓ com lista de revogação |
| Empresa não confiável do cliente | ✓ | ✓ claim assinado | ✓ | ✓ claim assinado |
| Transação atômica | ✗ | ✗ | ✓ | ✗ |
| Idempotência | ✗ | ✗ | ✓ | ✗ |
| Esforço no PDV | alto (fluxo de sessão) | **baixo (trocar o header)** | **muito alto (reescrever a fila)** | médio |
| Risco para o balcão | alto | **baixo** | alto | médio |

**A é eliminada pelo offline.** O `refresh_token` do Supabase expira; um
terminal que passe o fim de semana sem rede não renova e não vende segunda.
Isso é regressão de uma capacidade real.

**C é a arquitetura certa para o futuro e errada para agora.** Ela resolve
transação e idempotência de uma vez, mas exige reescrever `sync.js` e a fila
offline inteira — 908 linhas — e trocar 19 tabelas por endpoints. É a
mudança de maior risco possível no ponto mais sensível da operação.

**D é B implementado.** Não são alternativas: o JWT é o mecanismo pelo qual o
terminal de B se apresenta ao Postgres.

---

## E. Arquitetura escolhida

# B + D, com C como destino

**Um JWT por terminal, assinado pelo servidor do Sistema Vargas, carregando
empresa e terminal como claims. O operador continua interno.**

Por quê:

1. **Preserva o offline**, que é a razão de o PDV existir. Um token de
   validade longa (30–90 dias), renovado em qualquer contato com a rede,
   sobrevive a dias sem internet. Este é o critério que elimina A e C.
2. **Faz `auth.uid()` e as claims existirem no Postgres.** O JWT é assinado
   com o segredo do projeto Supabase, então o PostgREST o aceita e
   `auth.jwt()` fica disponível dentro das policies. A RLS padrão da casa
   (`empresa_do_meu_grupo(...)`) passa a funcionar com um complemento para o
   caso do terminal.
3. **Custo no PDV é uma linha estrutural.** `supabaseClient.js` tem 20
   linhas; trocar a chave fixa por um token renovável é a menor mudança
   possível no ponto mais frágil.
4. **Separa terminal de operador**, que é o modelo que o negócio já tem
   (item 6). O balconista não vira usuário do Supabase; ele continua sendo
   linha em `usuarios_pdv`, e a identidade dele viaja como dado da operação.
5. **C continua sendo o destino.** Cada escrita que migrar para RPC
   `SECURITY DEFINER` ou rota de servidor ganha transação e idempotência,
   uma de cada vez, sem big bang. O caixa nasce direto em C.

---

## F. Fluxo de autenticação proposto

```
ATIVAÇÃO (uma vez por terminal)
  Painel web → "Autorizar novo PDV" → gera código de 8 dígitos, validade 15min
  PDV        → operador digita o código
  Servidor   → valida, registra o terminal, devolve REFRESH SECRET (único, longo)
  PDV        → guarda o refresh secret no cofre do SO (safeStorage do Electron)

OPERAÇÃO (a cada início e a cada renovação)
  PDV      → POST /api/pdv/token  { refresh_secret }
  Servidor → confere terminal ativo e não revogado
           → assina JWT com o segredo do projeto Supabase:
               role: 'authenticated'
               sub:  <uuid do terminal>
               app_metadata: { empresa_id, terminal_id, tipo: 'pdv' }
               exp:  +30 dias
  PDV      → createClient(URL, ANON_KEY, {
                global: { headers: { Authorization: `Bearer ${jwt}` } } })

OPERADOR (local, como hoje, mas endurecido)
  PDV → PIN → verificação contra hash com sal (bcrypt) no banco, com
        limite de tentativas; a identidade do operador vai como
        `operador_id` em cada escrita, não como nome.
```

**A empresa deixa de vir do cliente.** Ela está no claim assinado; o PDV pode
mandar o que quiser no corpo — a policy compara com `auth.jwt()`.

---

## G. Modelo de terminal

Tabela nova (**não criada nesta fase**), conceitualmente:

```
pdv_terminais
  id                uuid
  empresa_id        uuid      -- a empresa que o terminal pode operar
  nome              text      -- "Balcão 1"
  refresh_secret    text      -- hash do segredo, nunca o segredo
  ativo             boolean
  revogado_em       timestamptz
  ultima_atividade  timestamptz
  versao_pdv        text      -- telemetria do item 16
  ativado_por       uuid
  created_at

pdv_ativacoes
  codigo            text      -- 8 dígitos
  empresa_id        uuid
  expira_em         timestamptz
  usado_em          timestamptz
  terminal_id       uuid
```

Revogação: `ativo = false` faz a próxima renovação falhar. Como o JWT tem
validade, a janela de exposição de um terminal roubado é o tempo restante do
token — daí a validade ser um parâmetro, não uma constante.

---

## H. Modelo de operador

Continua em `usuarios_pdv`, com três correções:

1. **`senha_hash` passa a ser bcrypt com sal**, verificado por RPC que
   recebe a **senha**, não o hash. Migração: aceitar os dois formatos por um
   período (o registro guarda qual algoritmo usou) e re-hashear no login bem
   sucedido.
2. **Limite de tentativas** por login e por terminal, com registro.
3. **`operador_id` viaja em cada escrita**, ao lado do nome.

O operador **não** vira usuário do Supabase. A identidade dele é dado da
operação, autenticado pelo terminal que a envia.

---

## I. Offline — impacto real

O PDV é offline-first de verdade: SQLite local e `sync_queue`.

**A arquitetura escolhida preserva isso**, e é o principal motivo da escolha:

- o JWT do terminal vale 30 dias e é renovado a cada contato com a rede;
- o login do operador continua funcionando pelo cache local;
- a fila continua acumulando e drenando como hoje.

**O que muda:** um terminal que fique mais de 30 dias sem rede precisa de
internet uma vez para renovar. Hoje ele nunca precisa. É uma regressão
pequena e explícita, e o número é ajustável.

**O que NÃO se pode fazer:** a alternativa C (tudo por API) quebraria a fila
offline. Está descartada por isso.

---

## J. Idempotência

**Estratégia:** o PDV passa a gerar o `id` da venda no cliente (UUID v4),
que já é o que a fila offline precisa para não duplicar.

Com isso:
- `INSERT ... ON CONFLICT (id) DO NOTHING` torna a retentativa exata;
- o gatilho heurístico `bloquear_venda_duplicada` pode ser aposentado — ele
  hoje descarta em silêncio e erra nos dois sentidos (não pega retentativa
  depois de 2 minutos, e pode descartar venda legítima).

Mesmo princípio para `recebimentos` e, no futuro, para movimento de caixa.

---

## K. Plano de migração

| Etapa | O quê | Corta algo? | Observável por |
|---|---|---|---|
| **A** | `pdv_terminais` + `pdv_ativacoes` + rota de token + tela "Autorizar PDV" no painel. Nada no PDV ainda. | não | — |
| **B** | PDV v1.9.0: ativa, guarda o secret, usa o JWT. **Mantém o fallback para a chave anon se não houver token.** Envia `versao_pdv` e `operador_id`. | não | telemetria: terminais com token × sem token |
| **C** | Espera. Auto-updater propaga. Acompanhar até **zero** escritas `anon` por 7 dias seguidos. | não | logs por papel |
| **D** | RLS nas 19 tabelas + revogar escrita do `anon`. | **sim** | erro imediato, reversível por `GRANT` |
| **E** | Monitorar 72h com rollback pronto. | — | — |

**A Etapa C não tem prazo — tem critério.** Enquanto um terminal escrever
como `anon`, a Etapa D não acontece. É o item 16, e é o que impede repetir o
incidente de 30/08, quando um REVOKE parou a baixa de estoque em silêncio.

O auto-updater (`electron-updater`, `autoDownload: true`,
`autoInstallOnAppQuit: true`, GitHub Releases público) torna a Etapa C
viável: os terminais se atualizam sozinhos ao fechar o aplicativo.

---

## L. RLS futura

Depois do corte, para as tabelas com `empresa_id` próprio:

```sql
CREATE POLICY <tabela>_empresa ON <tabela>
  FOR ALL TO authenticated
  USING (
    empresa_do_meu_grupo(empresa_id)
    OR (auth.jwt() -> 'app_metadata' ->> 'empresa_id')::uuid = empresa_id
    OR is_system_admin()
  )
  WITH CHECK (mesma expressão);
```

A primeira cláusula atende o painel web (usuário humano); a segunda, o
terminal (JWT com claim). Nenhuma delas é `using (true)`.

Para tabela filha sem `empresa_id` — `venda_itens`, `orcamento_itens` — o
padrão da casa já existe e deve ser seguido (`EXISTS` contra o pai, como
`entrada_itens` e `marketplace_pedido_itens` já fazem).

Índice de `empresa_id` faltando em `cr_auditoria`, `credito_utilizacoes` e
`renegociacoes` — criar junto com a policy delas.

---

## M. Testes

**Nenhum teste novo foi criado nesta fase**, porque nenhum código novo foi
escrito. Estado atual: `npm test` → **543 passando, 0 falhando**;
`tsc --noEmit` limpo.

Os testes do item 23 (terminal válido/inválido/revogado, empresa adulterada,
token expirado, requisição repetida, anon após o corte) **exigem a
implementação e um ambiente onde executá-los**. Sem staging, não há onde
provar comportamento de RLS sem escrever em produção. Ver seção N.

---

## N. Riscos restantes

1. **Não existe staging.** `list_branches` → vazio; um único projeto na
   organização. Uma mudança de autenticação sem ambiente de prova é o maior
   risco desta fase. **Instruções exatas para criar:**
   - Supabase branch: `create_branch` no projeto `ntwfkmwprjciucydedku`
     (cria um Postgres irmão com as migrations aplicadas; **tem custo por
     hora** e por isso é decisão sua);
   - ou local: `supabase init && supabase db start && supabase db reset`,
     que aplica `supabase/migrations/` num Postgres em Docker — de graça,
     mas sem os dados de produção.
   Recomendo o local para os testes de RLS: eles precisam de policies e de
   dois tenants semeados, não de dado real.
2. **O segredo do JWT do projeto Supabase** passa a ser usado pelo servidor
   do Sistema Vargas para assinar. Ele já existe; precisa ir para variável de
   ambiente da Vercel e **nunca** para o Electron.
3. **P2 e P3 continuam abertos** até a Etapa B: hash sem sal e RPC de login
   sem limite de tentativas. São exploráveis hoje, com a chave pública.
4. **Migrar `senha_hash` para bcrypt invalida o cache offline** dos
   terminais no momento da troca. Precisa de período de aceitação dupla.
5. **`vendas.itens` (JSONB) coexiste com `venda_itens`** — o PDV grava as
   duas. Duplicidade que qualquer policy vai ter de acompanhar.
6. **O repositório `vargasnexus-pdv` é público** (o comentário do
   `updater.js` afirma isso para justificar releases sem token). A chave
   `anon` está no fonte — o que é aceitável por desenho —, mas soma-se a P3:
   qualquer pessoa lê o código, vê o RPC de login e sabe que não há
   limite de tentativas.

---

## O. GO / NO-GO

| Pergunta | Resposta |
|---|---|
| 1. Ativar RLS nas tabelas usadas pelo PDV? | ⛔ **NÃO** — nenhum terminal autentica ainda. Pararia o balcão em 19 tabelas. |
| 2. Revogar escrita financeira direta do `anon`? | ⛔ **NÃO** — mesma razão. |
| 3. Iniciar a Fase 1 do Caixa? | ⛔ **NÃO** — o caixa lê `vendas` e `recebimentos`, que qualquer portador da chave pública escreve. |

# NO-GO — mas o bloqueio deixou de ser desconhecido

A Fase 0.5 terminou em NO-GO com uma dependência que **não podia ser
auditada**. Agora ela foi: o PDV está nesta máquina, o código foi lido, e o
caminho está desenhado em cinco etapas com critério objetivo de corte.

**O que mudou de mais importante:** três problemas críticos que a Fase 0.5
não podia ver, porque estão no cliente e não no banco — autorização editável
em disco, hash sem sal como credencial, e login sem limite de tentativas
aberto à internet. **Os três são exploráveis hoje.** P3 em particular não
depende de acesso ao computador da loja: basta a chave pública, que está no
fonte de um repositório público.

**O que destrava o GO:** as Etapas A, B e C. A e B são código; C é espera
observada. Nenhuma delas corta nada, e nenhuma pode quebrar o balcão.

---

## Mudanças necessárias, por repositório

### `sistema-vargas` (este)
- migration: `pdv_terminais`, `pdv_ativacoes`, índices
- migration: `verificar_operador_pdv` (bcrypt + limite de tentativas), com
  aceitação dupla durante a transição
- rota `POST /api/pdv/token` — troca refresh secret por JWT
- rota `POST /api/pdv/ativar` — valida código, registra terminal
- tela: Configurações → PDV → "Autorizar terminal"
- telemetria: painel de terminais com versão e último acesso

### `vargasnexus-pdv`
- `supabaseClient.js`: cliente com `Authorization: Bearer <jwt>` e renovação;
  **manter o fallback anon** durante a transição
- fluxo de ativação na primeira execução
- `safeStorage` do Electron para o refresh secret
- enviar `versao_pdv` e `operador_id`
- gerar o `id` da venda no cliente (idempotência)
- login: enviar a senha, não o hash

### Ordem de deploy
1. migrations + rotas + tela (Sistema Vargas) — inerte sem PDV novo
2. PDV v1.9.0 publicado; auto-update propaga
3. observar telemetria até zero escritas `anon` por 7 dias
4. **só então** RLS + revogação, com rollback pronto
