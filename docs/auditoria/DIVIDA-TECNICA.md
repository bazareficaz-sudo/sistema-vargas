# Dívida técnica — registrada, não resolvida

Itens medidos durante a Fase 1.1 (22/09/2026) que ficaram **de fora** do
escopo de propósito. Cada um tem o número que foi apurado na ocasião; se for
retomado depois, medir de novo antes de agir.

---

## 1. Reconciliação global do histórico de migrations

**Fase futura própria. Não resolver de dentro de outra fase.**

O repositório nunca foi a fonte de verdade das migrations deste projeto.

| Medida (22/09/2026) | |
|---|---|
| Migrations no histórico do Supabase | **74** |
| Arquivos `.sql` em `supabase/migrations/` | **20** (19 + a da Fase 1.1) |
| Arquivos cuja versão batia com o histórico | **2** |
| Arquivos com versionamento divergente | **17** (1 reconciliado na Fase 1.1 → restam **16**) |
| Migrations aplicadas sem arquivo correspondente | **55** |
| Arquivos cujo DDL ainda exige auditoria específica | **5** |

### A causa

O histórico separa as migrations em dois grupos, e a coluna `created_by`
denuncia qual é qual:

- `created_by = null` (**2**) — aplicadas por `supabase db push`. O CLI
  preserva o timestamp do arquivo, então versão e nome batem.
- `created_by = bazareficaz@gmail.com` (**72**) — aplicadas pelo MCP ou pelo
  Studio, que geram o timestamp no instante da aplicação e ignoram como o
  arquivo se chama.

Não é erro de ninguém: são dois caminhos legítimos que produzem numerações
diferentes, usados alternadamente ao longo de meses.

### A consequência

**`supabase db push` não é confiável hoje.** Ele tentaria aplicar os 16
arquivos cuja versão não consta no histórico. O primeiro `CREATE POLICY` ou
`CREATE TRIGGER` aborta com `42710: already exists` — os objetos já existem
em produção.

Isso vale desde antes do Caixa. A Fase 1.1 não introduziu nem agravou.

### Os 5 que precisam de auditoria própria

Comparando o DDL efetivo (ignorando comentários e espaços em branco), 14 dos
19 arquivos batiam com o que rodou. Divergiram:

| Arquivo | Observação |
|---|---|
| `ia_saas_configuracao_consumo` | 26 statements no histórico — a divergência pode ser artefato de recomparar statements reconcatenados |
| `ia_provedor_segredos` | 4 statements, mesma ressalva |
| `pdv_heartbeat_e_versao_minima` | divergência real a investigar |
| `pdv_rotas_por_operacao_e_fallback` | idem |
| `orcamento_transacional_e_revisao` | idem |

Onde o texto bruto diferia mas o DDL era igual, a causa era comentário
expandido depois de aplicar — confirmado em
`revogar_truncate_anon_produtos_vendas_clientes`, cujos três `REVOKE` são
idênticos ao que rodou.

### Enquanto não for resolvido

Toda migration nova segue o procedimento da Fase 1.1: aplicar pelo mecanismo
controlado, ler a `version` registrada, nomear o arquivo local com ela, e
provar por `md5` que arquivo e SQL aplicado são a mesma coisa.

---

## 2. `exigirPermissao` ignora a empresa ativa

**Corrigido apenas no domínio do Caixa.** As demais rotas seguem como estavam.

`src/lib/auth/permissoes.ts` → `exigirPermissao()` lê `profiles.empresa_id`
direto, sem passar por `perfilDaSessao`. O sistema tem seletor de empresa
(`/api/empresa-ativa`, cookie httpOnly conferido contra `usuario_empresas`),
o layout do dashboard o respeita, mas o guard das rotas não.

| Medida (22/09/2026) | |
|---|---|
| Rotas que usam `exigirPermissao` | **70** |
| Dessas, que resolvem a empresa ativa | **4** |
| Rotas do Caixa corrigidas na Fase 1.1 | **3** |

Efeito prático nas rotas não corrigidas: o operador troca de empresa no
seletor e a rota continua gravando na empresa do cadastro.

O Caixa foi corrigido primeiro porque é onde o erro vira dinheiro num ledger
append-only, em que a correção é estorno e o engano fica no histórico. A
correção está em `src/lib/caixa/contextoCaixa.ts`.

Corrigir as outras 67 é uma fase própria: são 67 rotas com comportamentos e
testes diferentes, e trocar o guard de todas de uma vez é exatamente o tipo
de mudança ampla que este projeto evita fazer sem medir antes.

### Sub-item: o papel não muda junto com a empresa

`profiles.role` é global do usuário. `usuario_empresas.perfil` existe e não é
consultado na autorização. Um usuário `admin` na empresa A continua `admin`
ao trocar para a B, mesmo que o vínculo diga `operador`.

Não foi tocado na Fase 1.1 — mudar isso altera autorização em todo o sistema,
não só no Caixa.

---

## 3. RLS por grupo não separa empresas

As policies do Caixa usam `empresa_do_meu_grupo()`, que aceita qualquer
empresa com vínculo ativo do usuário. Não é defeito — é o modelo do sistema,
que quer visão consolidada do grupo.

Mas significa que **a RLS não impede uma operação de cruzar CNPJs**. Onde
isso importa (a transferência da Fase 2), a trava tem de ser explícita na
camada de aplicação. Registrado como invariante 1 em
`FASE-2-INVARIANTES-SANGRIA-E-SUPRIMENTO.md`.

---

## 4. Fase 0.5 de segurança financeira ficou parcial

Medido em 22/09/2026, fora do escopo da Fase 1.1:

| Tabela | RLS | `anon` pode |
|---|---|---|
| `vendas` | **desligada** | SELECT, INSERT |
| `venda_itens` | **desligada** | SELECT, INSERT |
| `contas_receber` | **desligada** | SELECT, INSERT, UPDATE |
| `recebimentos` | **desligada** | SELECT, INSERT, UPDATE |
| `creditos_cliente` | **desligada** | SELECT, INSERT, UPDATE |
| `clientes` | **desligada** | SELECT, INSERT, UPDATE |
| `contas_pagar` | ligada | SELECT, INSERT, UPDATE |
| `caixa` | ligada | — |
| `caixa_movimento` | ligada | — |

`TRUNCATE` e `DELETE` do `anon` foram revogados nas migrations de segurança
de setembro. RLS e os demais privilégios de escrita continuam pendentes
porque dependem de migrar caminhos do PDV.

O Caixa está isolado disso: `anon` não tem privilégio nenhum nas duas
tabelas do ledger.
