# Fase 3 — Sessão de caixa: decisões já tomadas

**Status: NÃO IMPLEMENTADA.** Este documento registra decisões arquiteturais
tomadas durante a Fase 2.1, para que não precisem ser redescobertas quando a
Fase 3 começar. Nada aqui existe em código.

---

## Saldo negativo: a regra global foi recusada

**Decisão: NÃO adotar "o saldo do caixa nunca pode ser negativo".**

A Fase 2 deixou a questão em aberto de propósito — não existe política de
saldo no sistema, `calcularSaldo` devolve negativo sem reclamar, e a Fase 1
já permitia retirada maior que o saldo. A decisão foi não criar a regra
global, e sim resolver o problema no lugar onde ele é operacionalmente
real: a sessão de caixa.

Uma proibição global de saldo negativo quebraria em situações legítimas —
lançamento fora de ordem, ajuste de contagem feito antes do suprimento que
o explica — e transformaria erro de digitação em travamento de caixa.

## O indicador que substitui a regra

O que importa operacionalmente não é o saldo do caixa, é o **saldo esperado
da sessão**:

```
saldo esperado =
    fundo de abertura
  + vendas em dinheiro
  + recebimentos de clientes/carteira em dinheiro
  + suprimentos
  − sangrias
  − devoluções em dinheiro
  − outras saídas de dinheiro autorizadas
```

No fechamento, compara-se com o dinheiro físico:

```
diferença = valor contado − valor esperado
```

- diferença **negativa** → **falta**
- diferença **positiva** → **sobra**

É isto que o operador e o gestor querem saber. "O saldo está negativo" não
responde nada sozinho; "faltam R$ 12,00 no fechamento do turno da tarde"
responde.

## O que a Fase 3 vai precisar distinguir

Quatro coisas que hoje não têm representação:

1. dinheiro que **permanece na gaveta** como troco para o próximo turno;
2. dinheiro **efetivamente entregue à tesouraria** (é a sangria da Fase 2);
3. **falta e sobra** apuradas no fechamento;
4. **sessão encerrada** — depois disso, a sessão não recebe mais movimento.

A política definitiva sobre saldo negativo será especificada junto com esses
conceitos, não antes deles.

## O que a Fase 2 já entrega para isso

- `caixa` tipo `pdv`, com identidade estável por `terminal_id`;
- sangria e suprimento como transferência atômica e idempotente;
- o ledger append-only, de onde qualquer saldo é somado e nunca lido de uma
  coluna.

O que falta é o recorte temporal: a sessão. Hoje o caixa de PDV tem um saldo
contínuo desde que nasceu, sem começo nem fim de turno.
