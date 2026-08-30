# Retomar aqui

Resumo de repasse para uma sessão nova, em outra máquina ou noutro dia.
Escrito em **27/08/2026**. Números medidos no banco de produção nesta data,
não deduzidos do código.

Este arquivo é o atalho. O relato longo, com o porquê de cada decisão, está em
[`../CONTINUIDADE.md`](../CONTINUIDADE.md); as auditorias, em [`.`](.).

---

## Em uma frase

ERP + PDV + três marketplaces + loja própria, num só repositório Next.js sobre
Supabase, publicado na Vercel a cada push na `main` — **sem homologação no
meio**.

---

## Antes de tocar em qualquer coisa

1. **`.env.local` não vem no clone.** `npx vercel link && npx vercel env pull .env.local`.
   Sem isso a aplicação sobe e não acha dado nenhum. É o erro mais provável do
   primeiro dia.
2. **As migrações são manuais.** Arquivos `supabase-*.sql` na raiz, executados
   no SQL Editor do Supabase. Não há `migrate` automático, e a ordem é a da
   necessidade, não a alfabética.
3. **Rodar o SQL ANTES de publicar o código que lê a coluna nova.** Um `select`
   de coluna inexistente derruba a consulta inteira, e com ela a tela. Melhor
   ainda: ler configuração com `select('*')` e coalescer campo a campo, que é
   o que `lojaAtual()` e a aba Preços fazem — aí a ordem deixa de importar.
4. **Depois de `ALTER TABLE`, recarregar o cache do PostgREST.** Ele guarda o
   esquema, e por alguns instantes continua respondendo *"Could not find the
   'x' column of 'y' in the schema cache"* para uma coluna que já existe. O
   usuário encontrou isso em 30/08 ao salvar a aba Preços logo depois da
   migração; salvar de novo minutos depois funcionou. O conserto é uma linha
   no SQL Editor, e vale rodar junto de toda migração:

   ```sql
   NOTIFY pgrst, 'reload schema';
   ```
5. **Ler o dado de produção antes de afirmar.** Vários erros desta série de
   sessões vieram de deduzir pelo código. Consultar o banco custa segundos.
6. **`git status` no fim de cada fatia.** Foi ele que pegou um `src/proxy.ts`
   sobrescrito que o `next build` deixou passar — o compilador não protege
   contra arquivo apagado.
7. **O Next 16 renomeou Middleware para Proxy.** O arquivo é `src/proxy.ts` e
   ele já existe. Procurar `middleware.ts`, não achar e concluir que não há
   camada de proxy é erro fácil; já foi cometido.

---

## As quatro frentes

### 1. Loja Online — no ar, invisível de propósito

**Onde está:** https://bazareficaz.sistemavargas.com.br (HTTP 200, DNS
resolvido). Fase 1 completa: 14 tabelas, busca com `tsvector` + trigrama,
vitrine mobile-first, painel de 8 abas no ERP.

**Números hoje:** 533 produtos publicados · `ativo = true` ·
**`indexavel = false`** · 0 pedidos (o checkout é da Fase 3).

**O que trava o próximo passo — e não é código:** a dívida de segurança. A
chave `anon` do Supabase lê `produtos` (com `preco_custo`), `clientes` (com
CPF), `vendas` e `usuarios_pdv` (com `senha_hash`) **sem login**. Confirmei de
novo hoje, por acidente: um teste de API com a chave anônima devolveu 1.000
linhas de `vendas`. O plano está em
[`seguranca-fechar-acesso-anon.md`](seguranca-fechar-acesso-anon.md) e começa
por medir o que o PDV externo realmente usa. **Ligar `indexavel` e divulgar o
endereço antes disso é atrair tráfego para uma porta aberta.**

**Depois disso, a Fase 2:** reserva de estoque. `estoque_reservas` existe, com
índices e expiração, e `loja_estoque_disponivel()` já subtrai reservas — a
tabela tem **0 linhas** porque falta o caminho de escrita (reservar ao iniciar
o checkout, consumir ao confirmar, liberar ao cancelar). A decisão em aberto:
reserva só para a loja (simples) ou para todos os canais (resolve o
overselling real entre PDV, loja e marketplaces). A recomendação registrada é
**todos os canais, ligada canal a canal, com modo simulação primeiro** — o
mesmo padrão que `marketplace_fila` já usa.

### 2. Marketplaces — o editor de anúncios está no ar e nunca foi usado

9.232 anúncios sincronizados (ML, Shopee, Nuvemshop).

**O ponto de atenção:** o editor de anúncios (`EditarAnuncioModal`, seis abas,
edita fotos com ordenação, atributos da categoria, ficha do pacote e
variações) foi promovido para a `main` em 26/08. Ele **envia a alteração para
a plataforma** — precisa disso, porque `marketplace_anuncios` é um espelho e o
sync sobrescreveria qualquer edição local na rodada seguinte.

**Nunca houve um `update_item` real na Shopee nem um `PUT /items` real no ML.**
`tsc` limpo e build completo não dizem nada sobre o que a API aceita. Primeiro
uso: anúncio **pausado ou de pouca saída**, uma mudança por vez (só a ordem das
fotos; depois só um atributo), conferindo no painel da plataforma entre uma e
outra.

Fora de escopo, escrito na tela: trocar categoria (zera atributos) e criar ou
remover variação (a API pede o conjunto inteiro; mexer errado zera o estoque
das existentes).

**Em andamento pela sessão paralela:** promoções de marketplace — a fatia 1 lê
as campanhas da Shopee (`marketplace_promocoes` existe, 0 linhas até agora).

### 3. Relatórios — consertados hoje, ainda não conferidos na tela

**O defeito:** o PostgREST devolve no máximo 1.000 linhas por requisição. Toda
tela que buscava as linhas e somava em JavaScript somava o pedaço — status 200,
sem erro. A Visão Geral mostrava R$ 26.614,94 de faturamento em agosto; o mês
tinha R$ 45.012,53 em 1.701 vendas. O card exibia, ao centavo, a soma das 1.000
vendas mais antigas.

Estava em oito telas, incluindo o capital em estoque, calculado sobre 1.000 dos
14.263 produtos ativos.

**O conserto (commit `d9fb508`, migração já aplicada):** onde a tela quer um
número, a soma foi para o banco — `supabase-relatorios-agregados.sql` cria
`vendas_resumo`, `vendas_por_dia`, `produtos_vendidos`, `vendas_por_cliente` e
`estoque_resumo`. Onde a tela precisa das linhas (curva ABC, venda por hora,
RFM), entrou `buscarTudo()` em `src/lib/supabase/paginar.ts`, que **exige
`.order()` por coluna estável** — sem ordem declarada a paginação repete e
perde linha, defeito pior porque é intermitente.

**Pendente: abrir as telas e conferir.** Nenhuma foi vista funcionando. A Visão
Geral deve mostrar ~R$ 45 mil (era 26,6 mil) e o capital em estoque ~R$ 85 mil.

**A regra que fica:** qualquer soma nova sobre tabela que passe de 1.000 linhas
vai para o banco ou usa `buscarTudo()`. `produtos` tem 14.263 ativos,
`produto_estoque` 28.748, `marketplace_anuncios` 9.232 — três armadilhas
prontas.

### 4. Extensão do Chrome — funciona, está parada

Captura anúncio do Mercado Livre para Anúncios Rascunhos. Repositório próprio
(privado): `bazareficaz-sudo/vargas-extensao-chrome`.

5 capturas, **3 já viraram anúncio publicado**. Última captura em **13/08** —
duas semanas atrás, então não dá para garantir que os seletores da página do ML
ainda batem; a prévia no popup é o teste.

Instalação: `chrome://extensions` → modo desenvolvedor → carregar sem
compactação → pasta da extensão. Conectar: **Marketplaces → Anúncios Rascunhos
→ 🧩 Extensão do Chrome** → gerar código (aparece uma vez só) → colar no popup.

Só lê Mercado Livre; sem captura em lote, de propósito (coleta automatizada é
restrita nos termos e o risco de bloqueio é do dono da conta).

---

## O que mais existe, e não está aqui dentro

| Repositório | O que é |
|---|---|
| `bazareficaz-sudo/sistema-vargas` | **este** — ERP, PDV, marketplaces, Loja Online |
| `bazareficaz-sudo/vargasnexus-pdv` | o PDV instalado nos terminais da loja |
| `bazareficaz-sudo/sistema-vargas-app` | o app |
| `bazareficaz-sudo/sistemavargas` | site |
| `bazareficaz-sudo/vargas-extensao-chrome` | a extensão acima |
| `bazareficaz-sudo/vargas-entrada-agent` | agente de entrada de mercadoria por WhatsApp (Z-API + NF-e) |

O PDV dos terminais **grava direto no banco**, sem passar pelas telas deste
repositório. É por isso que regra que mora em componente não o alcança — foi a
causa das vendas duplicadas e do saldo do cliente congelado, os dois resolvidos
com trava no banco.

---

## Números da operação (27/08/2026, Bazar Eficaz)

| | |
|---|---:|
| Faturamento registrado desde 08/05 | R$ 126.837,42 |
| — PDV / balcão | R$ 58.486,20 |
| — Mercado Livre (confirmados) | R$ 49.740,36 |
| — Shopee (não cancelados) | R$ 18.610,86 |
| Agosto, só PDV | R$ 45.410,32 |
| Produtos ativos | 14.263 |
| Capital em estoque | ~R$ 85.148 |

Ressalvas que mudam a leitura: o PDV só entrou em uso de verdade em julho, então
maio e junho não descrevem a loja; os valores de marketplace são **brutos**
(incluem frete, não descontam comissão); e a Loja Online ainda não fatura.

**13.641 dos 14.263 produtos ativos estão com estoque zero no cadastro.** A loja
tem mercadoria, o sistema não sabe. Isso contamina reposição, vitrine e
qualquer alerta de ruptura — e a correção em massa depende de inventário, não
de código.

---

## Se for a primeira mensagem de uma sessão nova

Peça para ler, nesta ordem: este arquivo, `CONTINUIDADE.md`, e a auditoria da
frente em que for mexer. Depois disso, conferir no banco antes de afirmar
qualquer número.
