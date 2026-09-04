-- POR QUE ESTE ANÚNCIO NÃO SUBIU?
--
-- Anúncio 58267446668 (Pistola Finca Pino), Shp Ouro. Mostra "enviando" na
-- listagem, tem regra, teve movimentação, e a Shopee continua com 30 unidades
-- 12 horas depois.
--
-- A fila NÃO decide em silêncio: cada avaliação vira uma linha em
-- `marketplace_fila_simulacao` com `acao` e `detalhe`. As sete consultas
-- abaixo percorrem, na ordem, tudo que precisa ser verdade — e a primeira
-- que vier "não" é a resposta. Rode todas: a última também importa.

-- ── 1. O INTERRUPTOR MESTRE ────────────────────────────────────────────────
-- `ativo = false` e nenhuma rodada acontece, para nenhum produto.
-- `ultima_execucao` velha significa que o cron não está chamando a rota.
select ativo, simulacao, intervalo_min, max_produtos_rodada, ultima_execucao,
       now() - ultima_execucao as ha_quanto_tempo
from marketplace_fila_config;

-- ── 2. O ANÚNCIO: regra, produto, variação, status ─────────────────────────
-- `tem_variacao = true` seria decisivo: a fila pula o anúncio na primeira
-- linha do laço, grava `com_variacao` e não envia nada. A Shopee mostra um
-- "Model ID", mas isso não prova variação — ela dá model para item simples
-- também, e a listagem do sistema NÃO exibiu o chip "Com variações" neste
-- anúncio. Então provavelmente é `false`; confirme aqui em vez de supor.
--
-- `sincronizar_estoque` é o candidato mais forte: `canalAceitaEnvio` exige os
-- DOIS interruptores do canal, e a tela só olhava `atualizar_estoque_canal`.
-- Com ele desligado a fila grava `canal_desligado`, que não conta como falha
-- e tira o produto da fila sem reenviar.
select a.id, a.id_externo, a.titulo, a.status, a.tem_variacao,
       a.produto_id, a.regra_id, a.estoque_externo, a.preco_venda,
       a.pausa_origem, c.nome as canal, c.plataforma,
       c.sincronizar_estoque, c.atualizar_estoque_canal, c.fila_simulacao
from marketplace_anuncios a
join marketplace_canais c on c.id = a.canal_id
where a.id_externo = '58267446668';

-- ── 3. A REGRA VINCULADA ───────────────────────────────────────────────────
select r.* from marketplace_regras_preco r
where r.id = (select regra_id from marketplace_anuncios where id_externo = '58267446668');

-- ── 4. O PRODUTO ENTROU NA FILA? ───────────────────────────────────────────
-- Sem linha aqui, o gatilho de movimentação não enfileirou — e aí o problema
-- é ANTES da fila. Ver a memória sobre o gatilho sem SECURITY DEFINER.
select f.id, f.sujo_em, f.motivo, f.prioridade, f.enviado_em, f.tentativas
from marketplace_fila f
where f.produto_id = (select produto_id from marketplace_anuncios where id_externo = '58267446668')
order by f.sujo_em desc
limit 20;

-- ── 5. O QUE A FILA DECIDIU SOBRE ESTE ANÚNCIO ─────────────────────────────
-- ESTA É A CONSULTA PRINCIPAL. `acao` diz o que aconteceu:
--   enviado         foi para a Shopee (e ela aceitou)
--   enviaria        calculou e não enviou — está em simulação
--   sem_mudanca     o espelho local já tinha o número (pode ser espelho errado)
--   com_variacao    pulado por ter variação
--   canal_desligado interruptor do canal desligado
--   sem_anuncio     produto sem anúncio vinculado
--   erro            a plataforma recusou; `detalhe` traz a mensagem dela
select s.rodada_em, s.acao, s.estoque_sistema, s.estoque_canal,
       s.estoque_enviaria, s.preco_canal, s.preco_enviaria, s.detalhe
from marketplace_fila_simulacao s
where s.anuncio_id = (select id from marketplace_anuncios where id_externo = '58267446668')
order by s.rodada_em desc
limit 30;

-- ── 6. A RODADA INTEIRA, PARA SABER SE A FILA ESTÁ VIVA ────────────────────
-- Se as últimas rodadas só têm `sem_anuncio` e `sem_mudanca`, a fila roda e
-- não trabalha. Se não há rodada nenhuma nas últimas horas, o cron parou.
select date_trunc('hour', rodada_em) as hora, acao, count(*)
from marketplace_fila_simulacao
where rodada_em > now() - interval '24 hours'
group by 1, 2
order by 1 desc, 3 desc;

-- ── 7. ERROS REGISTRADOS PELA ROTA DO CRON ─────────────────────────────────
select created_at, tipo, status, mensagem, detalhes
from marketplace_sync_log
where tipo = 'fila' and created_at > now() - interval '48 hours'
order by created_at desc
limit 20;
