# FASE 0.6B-PILOTO — Rollout controlado

**Data:** 07/09/2026
**Resultado:** deploy feito e saudável. **Piloto NÃO executado** — dois bloqueios, um meu e um físico.
**Achado da fase:** o piloto teria falhado na primeira requisição, por um motivo que nenhum teste local pegaria.

---

## A. Estado dos repositórios

Ambos limpos, ambos sincronizados com `origin/main` ao final.

**`sistema-vargas`** — push `963e715..521716e`, depois `521716e..e0e6b79`:

| Commit | O quê |
|---|---|
| `38c5b9c` | Fase 0.5 — RLS financeira e permissões |
| `5ff18c9` | Fase 0.6 — auditoria do PDV externo |
| `04af1cf` | Fase 0.6A — identidade do terminal |
| `521716e` | Fase 0.6B — rota protegida |
| `e0e6b79` | **novo** — correção dos comentários da 0.5 (item 28) |

**`vargasnexus-pdv`** — push `60b8aa0..70600ff`:

| Commit | O quê |
|---|---|
| `31c54a6` | Fase 0.6A — identidade própria do terminal |
| `638b1ba` | Fase 0.6B — primeira escrita pela rota autenticada |
| `70600ff` | **novo** — v1.9.0, correção do host (seção O) |

Nenhum commit anterior foi perdido ou reescrito.

## B. Migrations — banco × repositório

| Versão no banco | Nome | Arquivo no repositório | Equivalente? | Status |
|---|---|---|---|---|
| `20260907115332` | `pdv_operacoes_protegidas` | `20260907120000_…` | sim | OK |
| `20260907012145` | `pdv_identidade_do_terminal` | `20260907004700_…` | sim | OK |
| `20260907005005` | `…system_admins` | `20260906233500_…` | sim | OK |
| `20260907004643` | `…revogar_truncate_e_delete_do_anon` | `20260906233000_…` | sim | OK |
| `20260906220200` | `empresa_config_pdv_promocao_por_forma_pagamento` | **ausente** de `supabase/migrations/` | conteúdo está em `supabase-pdv-config-promocao.sql`, na raiz | **drift** |

Os timestamps do arquivo e do banco divergem (o nome do arquivo foi escolhido
antes de aplicar), mas o conteúdo é o mesmo. Nada foi reaplicado.

Efeito verificado direto no banco, não pelo arquivo:

```
pdv_terminais   RLS=on  1 policy  anon S/I/U/T = false/false/false/false  auth DEL/TRUNC = false/false
pdv_ativacoes   RLS=on  1 policy  anon = false/false/false/false          auth = false/false
pdv_operacoes   RLS=on  1 policy  anon = false/false/false/false          auth = false/false
pdv_impressao   RLS=off 0 policy  anon = true/false/false/FALSE           ← TRUNCATE revogado na 0.6B
```

**Drift maior, pré-existente e fora do escopo:** o repositório tem ~160
arquivos `supabase-*.sql` soltos na raiz e só 8 em `supabase/migrations/`.
Historicamente o SQL foi rodado à mão no dashboard. Não mexi nisso — é um
trabalho próprio, não um item de rollout.

## C. Variável de ambiente

**`PDV_TOKEN_SECRET` NÃO existe em produção.** Não pude criá-la, por duas
razões independentes:

1. o conector da Vercel não expõe gerenciamento de variáveis de ambiente —
   ele lista projetos, deployments e logs, e não tem onde gravar;
2. digitar um segredo num formulário web é exatamente o tipo de coisa que eu
   não faço, mesmo tendo navegador disponível.

**É sua ação, e é a primeira da lista.** Gere e cole em
Vercel → sistema-vargas → Settings → Environment Variables → **Production**:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`PDV_TOKEN_SECRET_ANTERIOR` não existe e não deve ser criada agora — ela só
entra em cena numa rotação futura.

### A prova booleana (item 4)

Não precisei de acesso ao valor para provar a ausência. `segredoDeAssinatura()`
lança quando a variável falta, e essa exceção acontece **antes** da consulta ao
banco — então a resposta muda de 401 para 500. Sondando produção:

```
POST /api/pdv/impressao  + Bearer inválido   → 500     (segredo ausente)
                                              → seria 401 token_invalido se existisse
```

E o log de runtime confirma, sem vazar nada:

```
14:55:20 POST /api/pdv/impressao 500
Error: PDV_TOKEN_SECRET ausente ou curto demais.
```

| Prova | Resultado |
|---|---|
| `PDV_TOKEN_SECRET` configurada | **NÃO** |
| exposta como `NEXT_PUBLIC_*` | NÃO |
| presente no bundle do navegador | NÃO — teste `segredo-nao-vaza.test.ts` varre `src/` e falha se um componente cliente importar `pdv/segredo` |
| presente no Electron | NÃO — o PDV recebe JWT assinado, nunca a chave |
| em Git | NÃO — `.env*` ignorado, nenhum `.env` no histórico |
| aparece em log | NÃO — o log traz a mensagem de erro, não o valor |

O valor não foi gerado, exibido nem gravado em lugar nenhum.

## D. Deploy web/API

`dpl_33tzR7KwCmEujEKnfHGvZfHamt48` · commit `521716e` · target production ·
**READY** · região gru1 · aliases incluindo `sistemavargas.com.br` e
`www.sistemavargas.com.br`.

O commit `e0e6b79` (só comentários) disparou um deploy seguinte, igualmente
inofensivo.

Rotas presentes no build: `/api/pdv/auth/ativar`, `/api/pdv/auth/token`,
`/api/pdv/impressao`, `/api/pdv/terminais`, `/api/pdv/terminais/[id]/revogar`.

### Saúde (item 7) — evidência positiva, não ausência de erro

| Rota | Status |
|---|---|
| `/` · `/seguranca` · `/privacidade` | 200 |
| `/login` | 200 |
| `/dashboard`, `/dashboard/vendas`, contas a pagar, contas a receber, `/pdv`, `/dashboard/configuracoes/terminais-pdv` | 307 → `/login` |
| `GET /api/pdv/terminais` sem sessão | 401 `Não autenticado` |
| `GET /api/pdv/config` sem sessão | 401 |
| `POST /api/pdv/auth/token` corpo vazio | 401 `Credencial inválida.` |
| `POST /api/pdv/auth/ativar` código inexistente | 401 `Código de ativação inválido ou expirado.` |
| `POST /api/pdv/impressao` sem header | 401 `sem_token` |

40 min de runtime pós-deploy: **492 respostas 200**, 8 401 e 2 500 — os 401 e
os 500 são exatamente as minhas sondagens. Nenhum dado comercial foi criado.

## E. Release Electron

**Preparada, não publicada.**

Versão anterior **1.8.23** → versão piloto **1.9.0**, commit `70600ff`. Subiu o
minor porque é capacidade nova, e o número é o que o auto-updater e a
telemetria (`versao_pdv`) usam.

Ferramentas disponíveis e conferidas: `GH_TOKEN` presente no ambiente,
`electron-builder` instalado, `npm run publish` configurado para GitHub
Releases (`owner: bazareficaz-sudo`, `releaseType: release`).

### Sobre rollout segmentado (item 10)

O mecanismo **não suporta**. `updater.js` tem `autoDownload = true` e
`autoInstallOnAppQuit = true`, e checa 15 s depois de abrir. Publicar significa
todos os terminais baixarem e instalarem ao fechar. Não há canal nem
percentual.

Suas quatro condições para aceitar isso são todas verdadeiras por construção:

| Condição | Por quê é verdade |
|---|---|
| legado continua padrão | `usar_rotas_novas` tem default `false` |
| flag nova desligada | 0 terminais com a flag ligada |
| ninguém obrigado a ativar | ativação é manual, em Configurações |
| venda continua igual | nenhum caminho de venda foi tocado |

**Mesmo assim não publiquei**, por uma razão de ordem: enquanto
`PDV_TOKEN_SECRET` não existir, quem tentar ativar recebe erro. Publicar antes
convida alguém a tropeçar. Publique depois do passo 1 — e me diga, que eu
rodo `npm run publish`.

## F. Terminal piloto

**Não selecionado, não ativado.** `pdv_terminais` tem 0 linhas.

Além do segredo, há um bloqueio que nenhuma credencial resolve: as seções 12,
15, 16, 19 e 20 pedem alguém **fisicamente no terminal** — digitar o código de
ativação, fechar e reabrir o Electron, reiniciar o túnel Cloudflare, derrubar a
internet. Nada disso é executável daqui.

## G. Teste de empresa

**Parcialmente provado.** O que exige token válido ficou pendente; o que não
exige foi provado contra produção:

- sem token → 401 `sem_token`
- token forjado → recusado antes de qualquer consulta

A regra "token da empresa A + body da empresa B = 403" está provada por teste
automatizado (`acesso-terminal.test.ts`), e a garantia é estrutural: a empresa
usada vem da linha do banco, e `decidirToken` não aceita empresa como
parâmetro. **Falta a prova em produção com token real.**

## H. Primeira operação protegida

**Não executada.** `pdv_operacoes` tem 0 linhas.

`pdv_impressao` continua com a linha de **28/08**, 10 dias parada — o bug
descrito na 0.6B segue exatamente como estava.

## I / J / K / L. Renovação · Revogação · Restart · Offline

Nenhum executado. Todos dependem de F.

Renovação e revogação têm cobertura automatizada (token expirado rejeitado, no
instante exato da expiração inclusive; terminal revogado não renova). Restart e
offline **não têm cobertura nenhuma** — são comportamento de `safeStorage` e de
rede real, e só o terminal físico prova.

## M. Telemetria real

```
terminal piloto:        nenhum
versão:                 1.9.0 preparada, não distribuída
ativações:              0   (medido: pdv_ativacoes vazia)
tokens emitidos:        0   (medido: nenhuma linha com ultima_autenticacao_em)
renovações:             0   (medido)
requests protegidos:    2   (as minhas sondagens, ambas recusadas)
sucessos:               0   (medido: pdv_operacoes vazia)
falhas:                 2   (500 por segredo ausente — não é falha de terminal)
fallbacks:              NÃO MEDIDO — o fallback acontece dentro do Electron,
                        que não está distribuído; nada o registra ainda
empresa divergente:     0   (medido: pdv_operacoes vazia)
revogações:             0   (medido)
```

Os zeros acima são medidos, exceto `fallbacks`, que é declaradamente não medido.

## N. Comportamento legado

Vivo e sem arranhão. Escritas `anon` no período, com a última às **14:56:34**,
minutos depois do deploy:

| Tabela | Método | OK | Erro |
|---|---|---|---|
| `produto_estoque` | PATCH | 79 | 0 |
| `produtos` | PATCH | 79 | 0 |
| `estoque_movimentacoes` | POST | 79 | 0 |
| `vendas` | POST | 46 | 0 |
| `venda_itens` | POST | 46 | 0 |
| `faltas` | POST | 3 | 0 |
| `rpc/autenticar_operador_pdv` | POST | 4 | 0 |

Zero 4xx nas escritas comerciais. O balcão continuou vendendo durante todo o
deploy.

## O. Problemas encontrados

### 1. O host errado fazia o token evaporar — **corrigido**

O achado da fase, e ele só aparece contra produção.

`terminal.js` apontava para `https://sistemavargas.com.br`, que responde **308**
para `www.sistemavargas.com.br`. O `fetch` **remove o cabeçalho
`Authorization`** ao seguir redirecionamento para outra origem. Medido com o
mesmo runtime que o PDV usa:

```
POST https://sistemavargas.com.br/api/pdv/impressao      + Bearer → 401 sem_token
POST https://www.sistemavargas.com.br/api/pdv/impressao  + Bearer → 500 (chegou)
redirect:'manual'                                                 → 308 Location: www…
```

O piloto teria falhado na primeira requisição, com a mensagem **"Credencial
ausente"** — mandando quem investigasse olhar para a credencial, que estaria
perfeita, em vez de para a URL. Um teste local com `localhost` nunca pegaria
isto: não há redirecionamento.

Corrigido em `70600ff`, de duas formas: host canônico por padrão, e
`redirect: 'manual'` nas duas chamadas, com erro nomeando o destino. Um
redirecionamento em rota autenticada passa a ser erro alto, nunca desvio calado.

### 2. `PDV_TOKEN_SECRET` ausente — pendente, é sua ação (seção C)

### 3. Comentários da 0.5 corrigidos — item 28, feito

`fila.ts` e `travados/route.ts` afirmavam que anúncios com `empresa_id` nulo ou
divergente causavam os 157 `sem_anuncio` de 04/09. Os 157 foram reais; a causa,
não. Reconferido hoje: **9285 anúncios · 0 com `empresa_id` nulo · 0
divergentes do canal**. A mudança para `canal_id` continua valendo pelo
argumento que não depende daquela causa. Só comentário, sem mudança de
comportamento.

### 4. Dívidas registradas, não tocadas

- **Senha `123456`** em 1 dos 4 operadores ativos (item 26). Risco crítico,
  pendente da fase de autenticação do operador. Não identifiquei a pessoa e não
  alterei nada.
- `security@sistemavargas.com.br` publicado em `/seguranca` e inexistente
  (item 27). `/seguranca` responde 200 em produção, com essa afirmação no ar.
- `/seguranca` afirma repositório privado; o GitHub confirma
  `githubRepoVisibility: public`.
- MFA ausente em 7 contas administrativas.
- `supabase-pdv-config-promocao.sql` e `diagnostico-fila-58267446668.sql` na
  raiz.

## P. GO / NO-GO

### Identidade do terminal — **NO-GO ainda**, e não por defeito

A infraestrutura está no ar e responde certo a todas as recusas testáveis sem
credencial. Mas o critério da seção 29 é comportamental — identidade, empresa,
token, renovação, revogação, persistência, operação, telemetria — e **nenhum
desses oito foi exercido em produção**. Declarar GO agora seria trocar
"funciona" por "compila", que é exatamente o que esta fase existia para não
fazer.

**Prova parcialmente concluída.** O que falta é mecânico, não arquitetural.

### Próxima operação `faltas` — **NO-GO**

Depende da anterior. `faltas` faz 3 escritas/dia e continua sendo a candidata.

### Login do operador — **precisa de fase própria**, como você previu

Com uma urgência a mais: a senha `123456` é real e explorável hoje.

### Vendas — **NO-GO** · RLS — **NO-GO** · Caixa — **NO-GO**

Sem mudança. 46 vendas e 79 movimentações de estoque pelo `anon` no período
medido; ligar RLS hoje derruba o caixa.

## Q. Próximo passo recomendado

1. **Criar `PDV_TOKEN_SECRET`** em Production (seção C). Depois disso, abra
   Terminais de PDV: o aviso vermelho some quando estiver certo. É a
   confirmação, sem precisar acreditar em mim.
2. **Me avisar** — eu publico a release 1.9.0 (`npm run publish`).
3. **Escolher o terminal piloto** e ativá-lo: gerar o código no painel, digitar
   no PDV, ligar a flag só nele.
4. **Reiniciar o túnel de impressão** desse terminal. É o que dispara a
   primeira operação protegida de verdade — e a prova de que o bug de 10 dias
   foi consertado.
5. **Me trazer o resultado**, que eu leio `pdv_operacoes`, os logs e fecho as
   seções F a L com dado real.

Os passos 3 e 4 precisam de alguém no balcão. É o único trecho desta fase que
nenhuma automação cobre.
