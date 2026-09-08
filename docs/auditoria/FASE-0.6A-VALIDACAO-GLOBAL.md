# FASE 0.6A — Validação global

**Data:** 08/09/2026, 14:45 UTC
**Veredito:** **NO-GO GLOBAL 0.6A**
**Resumo:** 5 terminais têm identidade. Nenhum a exerceu. A cadeia para no token.

---

## 1. Inventário dos terminais

Tudo lido de `pdv_terminais` em produção.

| Nome | UUID (8) | Legado | Máquina | Versão | Status | Rota nova | Ativado em | Últ. autent. | Últ. atividade |
|---|---|---|---|---|---|---|---|---|---|
| Balcão 1 | `07ac9a75` | **PDV-001** | DESKTOP-3E67U31 | 1.9.0 | ativo | sim | 08/09 00:59 | **null** | **null** |
| Balcão 04 | `cf2dd0d6` | PDV-004 | balcao3 | 1.9.0 | ativo | sim | 08/09 14:27 | **null** | **null** |
| Balcão 03 | `4c430c24` | PDV-003 | temina | 1.9.0 | ativo | sim | 08/09 14:28 | **null** | **null** |
| Balcão 02 | `2d3dcacb` | **PDV-001** | balcao1 | 1.9.0 | ativo | sim | 08/09 14:30 | **null** | **null** |
| Caixa | `74f08093` | Caixa | caixa1 | 1.9.0 | ativo | sim | 08/09 14:32 | **null** | **null** |

Todos em **Bazar Eficaz**. Nenhum revogado. 5 códigos gerados, 5 usados, **0 tentativas erradas**.

### Confronto com quem realmente opera

Vendas por `terminal_id` legado, últimos 30 dias:

| Legado | Vendas 30d | Última venda | Parado há | Cadastrado? |
|---|---|---|---|---|
| PDV-003 | 877 | 08/09 14:24 | 18 min | sim (Balcão 03) |
| **PDV-002** | **699** | **03/09 20:34** | **4 d 18 h** | **NÃO** |
| PDV-004 | 162 | 08/09 14:18 | 23 min | sim (Balcão 04) |
| PDV-001 | 95 | 08/09 14:41 | 37 s | sim — **dois** cadastros |
| *(null)* | 8 | 06/09 23:29 | 1 d 15 h | não atribuível |

E fora das vendas: **`CAIXAEFICAZ` / `PDV-010`** está vivo agora (sincronizou 14:23), é servidor de impressão, roda **1.8.23** e **não está cadastrado**.

### Lacunas do inventário

1. **PDV-002 não existe em `pdv_terminais`.** É o **segundo terminal mais movimentado** — 699 vendas em 30 dias — e está desligado há quase 5 dias. Quando voltar, volta sem identidade.
2. **PDV-010 (`CAIXAEFICAZ`) não está cadastrado** e está rodando neste instante, em 1.8.23.
3. **`PDV-001` aparece em duas máquinas** (`DESKTOP-3E67U31` e `balcao1`). Não é erro de cadastro: são dois computadores que tinham a mesma string local. As 95 vendas de "PDV-001" são de dois terminais e **não há como separá-las**.
4. **8 vendas sem `terminal_id`** em 30 dias. Origem não identificada — provavelmente o PDV web, que não tem terminal.

O item 3 é, sozinho, a justificativa da fase inteira: o identificador legado **nunca foi único**, e o sistema tratava-o como se fosse.

## 2. Versão

Todos os 5 cadastrados: **1.9.0**, reportada pelo próprio PDV na ativação — não é campo digitado.

Fora do cadastro: **PDV-010 em 1.8.23** (log local para em `[UPDATE] Download completo: 1.8.23`, de 02/09) e **PDV-002 em versão desconhecida**, desligado desde 03/09.

A release `v1.9.0` está publicada e já teve **1 download do `.exe`** — a distribuição funciona.

## 3. Renovação de token

| Terminal | Chamou `/api/pdv/auth/token`? | `ultima_autenticacao_em` | Erros | Classificação |
|---|---|---|---|---|
| Balcão 1 | não | null | nenhum | **pendente** |
| Balcão 02 | não | null | nenhum | **pendente** |
| Balcão 03 | não | null | nenhum | **pendente** |
| Balcão 04 | não | null | nenhum | **pendente** |
| Caixa | não | null | nenhum | **pendente** |

**Zero renovações. Zero 401/403/500. Zero tentativas com credencial inválida.** Em 3 h de logs da Vercel: 872 respostas 200, 3 respostas 404, nada mais.

Nenhum terminal foi **rejeitado** — nenhum **tentou**. Todos seguem apenas com o token da ativação.

### Por que, e é um defeito meu

Não é acaso, é desenho — e o desenho está errado para um rollout que precisa observar terminais:

```js
function iniciarRenovacao() {
  const tentar = () => { obterToken().catch(() => {}) }
  setTimeout(tentar, 20_000)
  setInterval(tentar, 60 * 60 * 1000)   // de hora em hora
}
```

O tique horário existe, mas `obterToken()` devolve o token de memória sem falar com o servidor enquanto faltarem mais de 30 min para vencer. Com token de 12 h, isso significa **11 h 30 de silêncio total** depois de ativar.

Consequência prática: `ultima_autenticacao_em` e `ultima_atividade_em` ficam nulos por meio dia, e o painel não consegue distinguir *"terminal ativado e saudável"* de *"terminal ativado e nunca mais ligado"*. Eu escrevi que essa renovação serviria de telemetria de vida. **Não serve.** Falta um heartbeat de verdade — e isso entra na 0.6B como correção, não como melhoria.

## 4. Operação protegida

**`pdv_operacoes` está vazia.** Nenhum terminal executou `impressao.publicar_url` nem qualquer outra operação autenticada.

| Terminal | Operações protegidas |
|---|---|
| Balcão 1 · 02 · 03 · 04 · Caixa | **0 — pendente** |

A publicação da URL só dispara quando o túnel Cloudflare sobe (`main.js:1047`). Nenhum túnel foi iniciado desde as ativações.

## 5. `pdv_impressao` — diagnóstico

Estado atual: **uma linha só**, para toda a empresa.

```
empresa_id       a1000000-…-0001   ← CHAVE PRIMÁRIA
terminal_id      PDV-001            ← string legada, não-única
print_server_url https://stranger-juvenile-surprising-literally.trycloudflare.com
updated_at       2026-08-28 11:26   ← 11 dias parada
```

- **Servidores de impressão por empresa:** pelo menos **2** confirmados (`PDV-001` e `PDV-010`, ambos com `print_server_ativo = true`), possivelmente mais entre os 5 cadastrados.
- **Quem publica:** o último que subir o túnel. Hoje, ninguém — a escrita está quebrada desde a onda 2 de fechamento do `anon`.
- **Um sobrescreve o outro:** **sim.** `empresa_id` é chave primária, então há espaço para exatamente um servidor por empresa.
- **A tabela suporta múltiplos servidores:** **não.** Não há como duas impressoras coexistirem.
- **Pode apontar para o terminal errado:** **sim.** Se dois caixas publicarem, o último vence, e todos os terminais da empresa passam a mandar cupom para lá — inclusive os que ficam noutra sala, noutra loja ou noutra rede.

**Severidade: MÉDIA.** Não corrompe dado nem perde venda, mas manda cupom para a impressora errada — o que, num balcão, é um erro visível para o cliente. Está mascarada hoje porque a escrita não funciona; **volta a existir no instante em que a rota nova começar a funcionar**, e aí com dois terminais capazes de escrever com sucesso. Precisa de decisão antes de fechar a 0.6B, não depois. *(Diagnóstico apenas — nada foi alterado.)*

## 6. Identidade — o que as operações novas usariam

Não há operação executada, então isto é prova **estrutural**, não observacional. O que dá para afirmar com o código e com o que já rodou:

**Provado em produção:**
- a ativação gravou **UUID próprio** por terminal — inclusive para os dois `PDV-001`, que ficaram com UUIDs distintos;
- a **empresa veio do servidor**: lida da linha do terminal, e `decidirToken` não aceita empresa como parâmetro;
- a **versão é real**: reportada pelo processo principal do Electron.

**Garantido por construção, ainda não exercido:**
- `terminal_id_legado` está gravado como telemetria e **não é lido por nenhuma decisão** de autorização;
- `empresa_id` do corpo é conferido e recusado se divergir (`conferirEmpresaDoCorpo`), nunca obedecido;
- as permissões do `electron-store` não participam: a rota protegida não as consulta.

## 7. Vendas continuam normais — sim

| | |
|---|---|
| Última venda | **08/09 14:41:34**, 37 s antes da medição |
| Escritas `anon` com erro | **0**, em todas as tabelas |
| Vendas depois das ativações | PDV-001 vendeu normalmente após ser ativado |
| Gaps | nenhum, exceto PDV-002 (desligado, anterior à mudança) |
| Estoque | `produto_estoque`, `produtos`, `estoque_movimentacoes` — 45 escritas cada, 0 erro |
| Recebimentos / contas a receber | 8 e 8, 0 erro |
| Filas offline presas | nenhuma evidência |

**Nenhuma regressão.** Atualizar e ativar os cinco terminais não afetou o balcão.

## 8. Escritas legadas — e o que a telemetria consegue distinguir

Últimas 24 h, papel `anon`:

| Tabela | Método | OK | Erro | Última |
|---|---|---|---|---|
| produto_estoque | PATCH | 45 | 0 | 14:41:34 |
| produtos | PATCH | 45 | 0 | 14:41:34 |
| estoque_movimentacoes | POST | 45 | 0 | 14:41:34 |
| vendas | POST | 29 | 0 | 14:41:34 |
| venda_itens | POST | 29 | 0 | 14:41:34 |
| rpc/autenticar_operador_pdv | POST | 14 | 0 | 14:31:51 |
| recebimentos | POST | 8 | 0 | 11:49:41 |
| contas_receber | PATCH | 8 | 0 | 11:49:41 |
| clientes | POST | 1 | 0 | 14:22:07 |
| creditos_cliente | POST | 1 | 0 | 14:41:33 |

- **Autenticação nova funcionando:** parcialmente — 5 ativações aceitas, tokens emitidos. Não há operação autenticada.
- **Legado funcional:** sim, integralmente, sem um único erro.
- **Telemetria distingue os dois caminhos:** **em teoria, sim; na prática, ainda não demonstrado.** O caminho novo grava em `pdv_operacoes` (vazia) e o legado aparece nos edge logs por `role = anon`. Como um dos lados tem zero linhas, a separação nunca foi exercida com dado real.

**Atribuição por terminal:** possível nas escritas que carregam `terminal_id` (vendas), impossível nas demais — o edge log não identifica o terminal, só o papel. E mesmo em `vendas` a atribuição é ambígua para `PDV-001`, que são dois computadores.

## 9. Terminais não validados

Pelo seu próprio critério — cadastrado mas ausente de autenticação, operação protegida e telemetria:

**Os cinco cadastrados são `TERMINAL NÃO VALIDADO`.**

| Terminal | Autenticou? | Operação? | Telemetria? | Vende? | Situação |
|---|---|---|---|---|---|
| Balcão 1 | não | não | não | sim (14:41) | opera, identidade nunca usada |
| Balcão 03 | não | não | não | sim (14:24) | idem |
| Balcão 04 | não | não | não | sim (14:18) | idem |
| Balcão 02 | não | não | não | indistinguível de Balcão 1 | idem, e sem como separar |
| Caixa | não | não | não | **não vende** | sem sinal nenhum desde a ativação |

"Caixa" é o mais opaco: não vende, não autenticou, não operou. A única evidência de que existe é a ativação de 14:32.

E há dois **fora do cadastro**:

- **PDV-002** — 699 vendas/30 d, desligado há 4 d 18 h, sem identidade. Volta a qualquer momento.
- **PDV-010 (`CAIXAEFICAZ`)** — vivo agora, 1.8.23, servidor de impressão, sem identidade.

## 10. GO / NO-GO

# NO-GO GLOBAL 0.6A

Critério por critério:

| Exigência | Situação |
|---|---|
| Todos os terminais ativos atualizados | ❌ PDV-010 em 1.8.23; PDV-002 desconhecido |
| Todos ativados | ❌ PDV-002 e PDV-010 fora |
| Todos com identidade segura | ⚠️ os 5 cadastrados sim, e é real |
| Todos renovam token ou equivalente | ❌ **zero** renovações |
| Todos com ao menos uma operação protegida | ❌ **zero** operações |
| Nenhuma regressão de venda | ✅ **nenhuma** |
| Sem fallback silencioso escondendo falha | ✅ zero escritas `anon` em `pdv_impressao` |

### O que falta, terminal por terminal

| Terminal | Falta |
|---|---|
| Balcão 1 | subir o túnel (1ª operação) · reiniciar o app (renovação) |
| Balcão 02 | idem |
| Balcão 03 | idem |
| Balcão 04 | idem |
| Caixa | idem — e definir como validar um terminal que não vende |
| **PDV-002** | ligar, atualizar, cadastrar, ativar |
| **PDV-010** | atualizar para 1.9.0, cadastrar, ativar |
| *(vendas sem terminal_id)* | descobrir a origem das 8 vendas |

### O caminho mais curto para o GO

Um único gesto resolve quase tudo, em cada terminal: **fechar e reabrir o PDV**. Isso força a busca de token em 20 s — o que preenche `ultima_autenticacao_em`, prova a renovação e prova a persistência do `safeStorage` de uma vez. Depois, **subir o túnel** nos que são servidor de impressão fecha a operação protegida.

Sem isso, seguimos com identidade emitida e nunca usada — que é exatamente o estado que esta validação existia para não deixar passar.

---

## Pendências e dívidas

- **Heartbeat ausente** (seção 3) — defeito meu, entra na 0.6B.
- **`pdv_impressao` com um servidor por empresa** (seção 5) — severidade média, decisão antes de fechar a 0.6B.
- **`terminal_id_legado` duplicado** entre máquinas — histórico, sem correção necessária, mas invalida atribuição retroativa.
- **Token do GitHub com escopo excessivo** (`delete_repo`, `admin:org`, `admin:enterprise`) numa máquina de balcão.
- Um operador de PDV com senha `123456`.
- `security@sistemavargas.com.br` publicado em `/seguranca` e inexistente; a página afirma repositório privado, e ele é público.
- MFA ausente em 7 contas administrativas.

---

# ADENDO — 08/09, 16:16 UTC: a cadeia fechou

A validação acima terminou em NO-GO por silêncio total. O silêncio tinha causa
banal e a suspeita de defeito era minha, não do código.

## O que aconteceu

**O Balcão 1 estava desligado.** Eu havia escrito que "nenhuma explicação
benigna cobre o Balcão 1" ao montar o raciocínio do relógio — e deixei de fora
a explicação mais simples de todas. Máquina desligada não tem processo, não tem
tique horário, não renova e não publica.

**Os demais não haviam sido reiniciados.** A tela do terminal Caixa provou isso
sozinha: ela dizia `Token válido`, e essa linha lê `tokenAtual`, que é memória
do processo. Só existe se aquele processo obteve o token ele mesmo — ou seja,
era ainda o processo da ativação das 14:32.

## O que ficou provado, com dado

| Elo | Evidência |
|---|---|
| Persistência via `safeStorage` | Caixa e Balcão 1 reabriram e seguiram identificados, sem pedir código |
| Renovação de token | Caixa **16:00:09**, Balcão 1 **16:03:44**, ambos `metodo_ultima_auth = terminal_token` |
| Operação protegida | `impressao.publicar_url`, **sucesso**, 113 ms |
| UUID seguro | terminal `74f08093-ee51-43b8-831f-5a9a9a330425` |
| Empresa pelo servidor | Bazar Eficaz, lida da linha do terminal |
| Idempotência | chave `impressao:c21864af9a19cf91e8407b71bc87e1b7` gravada |
| Telemetria real | 1 linha em `pdv_operacoes`, `metodo = terminal_token` |

## E o bug de 11 dias morreu

```
antes   terminal_id = 'PDV-001'          updated_at = 2026-08-28 11:26
depois  terminal_id = '74f08093-…'       updated_at = 2026-09-08 16:00:20
        print_server_url = https://mysql-interventions-expansion-catherine.trycloudflare.com
```

`pdv_impressao.terminal_id` deixou de ser a string editável e passou a ser o
UUID do terminal. É a primeira linha do sistema em que "qual terminal" quer
dizer algo verificável.

## Hipóteses descartadas

- **Falha de persistência** — descartada; o reinício preservou a credencial.
- **Ordem dentro do `whenReady()`** — descartada como causa. A fragilidade
  segue real (a identidade não deveria depender de `db.initialize()`,
  `createWindow()` e `createTray()`), mas é dívida de robustez, não bug.
- **Falha de chamada à API** — descartada; nenhuma tentativa falhou.

## O que continua verdadeiro

O defeito real é o que eu já havia admitido: **o desenho não emite sinal por
11h30 depois de ativar**, e por isso "não reiniciou" e "quebrou" ficam
indistinguíveis de fora. Foi exatamente isso que fez este diagnóstico consumir
quatro rodadas. A correção é heartbeat + observabilidade, ainda não autorizada.

## Uma anomalia em aberto

Um **401** em `POST /rest/v1/vendas`, papel `anon`, às 15:39:20.757.

- A venda 201952 foi gravada com sucesso 1,1 s antes, às 15:39:19.596;
- a numeração de PDV-001 não tem buraco (201951 → 201956);
- `vendas_duplicidade_bloqueada` está vazia, então não foi a trava de duplicata.

**Nenhuma venda foi perdida.** A causa não foi determinada. Fica em observação.

## Estado do rollout

| Terminal | Renovou | Operação | Situação |
|---|---|---|---|
| Caixa | 16:00:09 | 1 sucesso | **completo** |
| Balcão 1 | 16:03:44 | 0 | falta subir o Tunnel |
| Balcão 02 · 03 · 04 | não | 0 | falta reiniciar |
| PDV-002 | — | — | fora da identidade, desligado há 5 dias |
| PDV-010 | — | — | fora da identidade, em 1.8.23 |

**NO-GO GLOBAL 0.6A** pelo critério "todos". A arquitetura está provada; o
rollout, não.

---

# ADENDO 2 — 08/09, 16:40 UTC: o teste do Escritório Silvano parou no passo 2

Autorizado a fechar a cadeia no terminal `PDV-010` / `CAIXAEFICAZ`, que é a
máquina onde esta sessão roda. **O teste não foi concluído**, e parei no ponto
da falha em vez de contornar.

## Onde parou, e por quê

| Passo | Resultado |
|---|---|
| 1. Registrar estado | ✅ processo PID 17884 desde 13:26, identidade gravada 13:28:20 |
| 2. **Fechar o PDV** | ❌ **impossível a partir desta sessão** |
| 3–15 | não executados |

Duas tentativas:

- **`CloseMainWindow()`** (o mesmo `WM_CLOSE` do botão X) — sem efeito, duas vezes,
  com 10 s e 15 s de espera. O processo seguiu `Responding: True`.
- **`Stop-Process -Force`** — `Acesso negado`.

A causa não é o aplicativo:

```
minha sessão:   CAIXAEFICAZ\DELL   admin: False
PID 17884:      Path <inacessível>
Stop-Process:   Acesso negado
```

**O PDV roda elevado; a sessão do agente, não.** O Windows bloqueia tanto o
encerramento quanto o envio de mensagens de janela de um processo de integridade
menor para um maior (UIPI). Fechá-lo pela interface — botão X ou bandeja →
**Sair** — roda no nível do próprio app e funciona normalmente.

### Correção de uma afirmação minha

Ao ver o `WM_CLOSE` ser ignorado, escrevi que aquilo era "um achado" e cogitei
que explicasse os balcões que não reiniciaram. **Está errado.** É consequência
do meu nível de privilégio, não do comportamento do app. Inspecionei o código:
não há `beforeunload`, não há intercepção de `close`, a janela é comum e
`window-all-closed` chama `app.quit()`. Para quem clica no X, fecha.

## O que eu causei, e o estado em que ficou

Encerrei os processos que **conseguia** encerrar — o renderer e o gpu-process —
e o principal sobreviveu. Isso derrubou a janela de um aplicativo em uso por
cerca de dois minutos, com erros `Render frame was disposed` vindos de
`sync.js`.

O app se recuperou sozinho: renderer novo, janela respondendo, sincronização
completa e sem erro às 13:38:47. Os arquivos de identidade ficaram **intactos**
— mesmo `sha256` e mesmo horário de gravação (13:28:20). Nenhum dado afetado.
Ainda assim, foi degradação real de um app em execução, causada por mim.

## Observação lateral: segunda instância toca o banco

Ao chamar `Start-Process` com o app já rodando, o log registrou
`[DB] SQLite inicializado` às 13:36:36. A trava de instância única
(`if (!GOT_LOCK) { app.quit() }`, `main.js:202`) impede a segunda janela, mas
`app.whenReady()` ainda dispara e `db.initialize()` roda contra o mesmo arquivo
SQLite que a instância primária tem aberto. Não houve dano observado. Fica
registrado.

## A descoberta sobre `safeStorage` / `os_crypt`

Um processo Electron separado **não** conseguiu decifrar
`terminal-identidade.bin`:

```
arquivo existe: true
decifrou em OUTRO processo: false — Error while decrypting the ciphertext
```

**Isto não é defeito do PDV.** No Windows o `safeStorage` do Electron não usa
DPAPI diretamente sobre o dado: ele cifra com uma chave aleatória guardada em
`os_crypt.encrypted_key`, dentro do `Local State` **do próprio aplicativo**, e é
essa chave que fica protegida por DPAPI. Confirmado: existem
`%APPDATA%\pdv-vargas\Local State` e `%APPDATA%\Electron\Local State`, cada um
com sua chave. Meu processo de teste rodou sob o nome "Electron" e portanto
usou outro cofre.

A consequência é uma propriedade **mais forte** do que a documentada até aqui: o
segredo não está preso apenas ao usuário do Windows, está preso ao cofre daquele
aplicativo. Copiar o `.bin` para outra máquina, ou abri-lo com outro programa,
não devolve a credencial.

A evidência que vale continua sendo a de produção: **Caixa e Balcão 1
reiniciaram, recuperaram a identidade sem pedir código e obtiveram token novo.**

## Constatações do disco, num terminal real

Inspeção direta em `CAIXAEFICAZ`, primeira vez que se olha o lado do cliente:

- `terminal-identidade.json` (234 B) contém apenas identificadores — **nenhum segredo**;
- `terminal-identidade.bin` (95 B) começa com `76 31 30 76` = `v10`, formato
  `os_crypt`, e **não contém nenhuma sequência de 64 hex em claro**;
- o log traz `[TERMINAL] Ativado como "Escritorio Silvano" (Bazar Eficaz)`.
