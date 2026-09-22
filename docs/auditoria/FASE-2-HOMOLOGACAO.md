# Fase 2 — Homologação concluída

**22/09/2026 · GO**

Sangria e suprimento executados pela interface autenticada, em produção, e
conferidos no banco. Os registros **permanecem no ledger**: são lançamentos
legítimos, e apagá-los contradiria o append-only que a fase inteira existe
para sustentar.

## Ambiente

| | |
|---|---|
| Execução | interface autenticada, pelo operador |
| Commit | `950d934` — Fase 2 |
| Banco | Supabase `ntwfkmwprjciucydedku` (produção) |
| Empresa | Bazar Eficaz `a1000000-0000-0000-0000-000000000001` |
| Usuário | Administrador Bazar Eficaz `e06647ed-3995-423d-9fe8-64fb21b69a77` |
| Terminal | YOGA `a3c2f27c-c6b5-4a8b-885c-9f918c0d9181` |

## As duas operações

| | Sangria | Suprimento |
|---|---|---|
| Identificador | `71304b05-5ca0-4d9c-b6bf-aa9af664f677` | `a310128e-beeb-4b75-a4bf-9afb53b182e0` |
| Valor | R$ 10,00 | R$ 10,00 |
| Origem | Caixa YOGA (pdv) | Caixa da Empresa (tesouraria) |
| Destino | Caixa da Empresa (tesouraria) | Caixa YOGA (pdv) |
| Horário | 16:28:18 BRT | 16:28:48 BRT |

Movimentos gerados — dois por transferência, um em cada caixa:

```
sangria     Caixa YOGA        saida     sangria              −10,00  → contraparte Caixa da Empresa
            Caixa da Empresa  entrada   sangria_recebida     +10,00  → contraparte Caixa YOGA

suprimento  Caixa da Empresa  saida     suprimento_entregue  −10,00  → contraparte Caixa YOGA
            Caixa YOGA        entrada   suprimento           +10,00  → contraparte Caixa da Empresa
```

## O que ficou provado

- **2** transferências, **4** movimentos, **0** a mais;
- cada transferência com exatamente 2 movimentos, um por caixa;
- `contraparte_caixa_id` simétrica nos quatro movimentos;
- `empresa_id` e `usuario_id` do movimento iguais aos do documento;
- zero pares `(transferencia_id, caixa_id)` duplicados;
- zero movimentos fora do fluxo, zero estornos;
- efeito líquido **R$ 0,00** nos dois caixas — as duas operações se anulam,
  como o roteiro previa;
- **Caixa YOGA criado uma única vez**, sob demanda, no instante da sangria
  (16:28:18), associado ao terminal YOGA por `terminal_id`;
- auditoria com exatamente duas linhas: `caixa_sangria` 16:28:18 e
  `caixa_suprimento` 16:28:49;
- as três tabelas do Caixa com RLS ligada; nenhum aviso de segurança do
  Supabase aponta para elas.

O que a tela mostrou bate com o banco: saldo da tesouraria 0 → 10 → 0,
"Sangria recebida +R$ 10,00 / Origem: Caixa YOGA" e "Suprimento enviado
−R$ 10,00 / Destino: Caixa YOGA".

## Duas divergências, nenhuma funcional

**1. O identificador da sangria no comprovante.** O relato trouxe
`…aa9af064f677`; o banco tem `…aa9af664f677` — um dígito (`0` × `6`).
Verificado: o id do relato **não existe** na base; o do banco existe e é
único. Transcrição manual, não defeito.

**2. A observação gravada foi `teste`,** nas duas operações, em vez de
`HOMOLOGAÇÃO FASE 2 - SANGRIA` e `HOMOLOGAÇÃO FASE 2 - SUPRIMENTO`. Não
afeta nenhuma garantia — a observação é texto livre e entra apenas no
fingerprint de idempotência. Mas o ledger é append-only: o texto fica assim,
e este documento é o que liga esses dois lançamentos à homologação.

## O que continua não provado

**Concorrência real entre duas sessões.** O MCP serializa as chamadas — a
sessão B esperou 0,00 s por um lock que A segurou por 4 s. O
`pg_advisory_xact_lock` está no código e o raciocínio é o mesmo validado na
0.6D.2, mas a prova empírica segue pendente.

A homologação não exercitou duplo clique, timeout, payload conflitante nem
rollback: foram cobertos de forma controlada antes, e provocá-los em
produção foi explicitamente descartado.
