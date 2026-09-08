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
