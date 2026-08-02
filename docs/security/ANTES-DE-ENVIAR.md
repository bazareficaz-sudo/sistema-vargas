# Antes de enviar o questionário da TikTok Shop

Este arquivo é interno. Não vai junto com o envio.

A política e o pacote de evidências foram escritos para descrever a realidade —
não uma realidade desejada. Os itens abaixo são as afirmações que **ainda não são
verdade hoje**. Cada um precisa estar feito antes de a resposta ser enviada, senão
estaremos atestando controle inexistente a um parceiro — que é exatamente o tipo
de coisa que, se o revisor descobrir depois, encerra a conversa de vez.

Ordem pensada para o risco cair primeiro.

> **Domínio:** em 02/08/2026 o sistema passou de `vargasnexus.com.br` para
> `www.sistemavargas.com.br`. Toda URL citada nos outros dois documentos já está
> no domínio novo. Antes de enviar, confirme que os painéis de desenvolvedor da
> Shopee, do Mercado Livre e da TikTok Shop têm a URL de retorno no domínio novo
> — OAuth registrado no domínio antigo falha na hora de conectar.

---

## 1. Rodar `supabase-fechar-escrita-anonima.sql` ✅ FEITO EM 02/08/2026

O anônimo tinha SELECT, UPDATE e DELETE em 14 tabelas — dava para apagar as 504
vendas, alterar os 14.423 produtos e editar os 44 clientes sem login.

Aplicado e reconferido na produção: a consulta de verificação devolveu as 9
linhas esperadas. Nenhum DELETE em lugar nenhum, `vendas` e `venda_itens` só
aceitam INSERT, e `usuarios_pdv`/`vendedores`/`depositos` não aceitam escrita.

**Falta ainda:** a venda de teste no PDV externo (produto, pagamento, fecha), para
confirmar que nada travou no balcão. Se travar, o rollback está no rodapé do
próprio arquivo.

## 2. Credenciais expostas — decidido em 02/08/2026

A tabela `sistema_integracoes` esteve legível sem login. O acesso foi fechado e
conferido no mesmo dia.

- [x] **Brasil NFe UserToken** — trocado. Era o de maior dano: permite emitir
      documento fiscal no CNPJ da empresa.
- [ ] Shopee `partner_key` — **mantida, por decisão sua**
- [ ] Mercado Livre `app_secret` — **mantida, por decisão sua**
- [ ] WhatsApp Z-API — **mantida, por decisão sua**

O motivo de manter foi o custo de reconectar canal no meio da operação. A
decisão é legítima e está documentada como tal — a §11 da política foi reescrita
para descrever avaliação por risco em vez de rotação incondicional, e o pacote de
evidências declara o episódio abertamente na B4.

**Isso não fica em aberto para sempre.** Marque uma data para revisitar as três.
Enquanto elas estiverem em uso, quem porventura as tenha copiado continua com
elas — fechar a porta não recolhe o que já saiu.

Se um dia trocar: gera credencial nova no painel do serviço, substitui no
Supabase e reconecta o canal. Depois marque o item aqui e reverta a §11 para
rotação incondicional, que é a redação mais forte.

## 3. Ligar MFA em todas as contas administrativas ⛔ BLOQUEIA O ENVIO

A política §4 afirma MFA obrigatório em conta administrativa. Ligue em:

- [ ] Provedor de hospedagem
- [ ] Provedor do banco de dados
- [ ] Repositório de código
- [ ] Registrador do domínio
- [ ] Console de desenvolvedor da Shopee
- [ ] Console de desenvolvedor do Mercado Livre
- [ ] Console de desenvolvedor da TikTok Shop

O pacote de evidências oferece print de MFA ligado como anexo 5. Sem isso, o
anexo não existe.

## 4. Confirmar o plano do banco de dados (backup)

A política §12 afirma backup automático com recuperação a um ponto no tempo. Isso
depende do plano contratado — o plano gratuito não garante. Confira no painel do
provedor e:

- se tiver: nada a fazer;
- se não tiver: ou sobe o plano, ou **corrija a §12** antes de enviar.

## 5. Preencher e assinar a política

Todo campo entre colchetes em `INFORMATION-SECURITY-POLICY.md`:

- [ ] Razão social e CNPJ
- [ ] Nome e cargo de quem assume como responsável pela segurança
- [ ] E-mail e telefone de contato de segurança (crie `security@` no domínio —
      o revisor espera um canal dedicado, não um e-mail pessoal)
- [ ] Data de adoção e assinatura

Depois exporte para PDF. Política sem data e sem assinatura é lida como modelo
baixado da internet — foi exatamente por falta de evidência que a primeira
tentativa caiu.

## 6. Preencher os campos do pacote de evidências

Em `TIKTOK-SHOP-EVIDENCE-PACK.md`: dados de contato, e as datas da seção C
("o que ainda estamos construindo"). Sugestão para as duas primeiras: 90 dias a
partir do envio. Coloque data que você consegue cumprir — data estourada num
compromisso escrito é pior do que não ter prometido.

## 7. Tirar os prints dos anexos

1. Cabeçalhos HTTP (rode `curl -sI https://www.sistemavargas.com.br` — o resultado tem
   que bater com a tabela da seção A).
2. Arquivo da matriz de permissões (6 papéis).
3. Tabela de auditoria com registros reais, com dado sensível tapado.
4. MFA ligado nas contas do item 3.

## 8. Duas correções de conteúdo em relação à tentativa anterior

- [ ] **Não responda com o link da página de privacidade** na pergunta de política
      de segurança. São documentos diferentes; foi isso que o revisor apontou.
      Anexe o PDF da política.
- [ ] **A resposta anterior dizia Google Cloud Platform.** Não é. O pacote de
      evidências corrige isso abertamente na seção B8 — mantenha a correção. Um
      revisor que encontra uma inexatidão sozinho passa a duvidar de todo o resto.
- [ ] Responda tudo **em inglês**. Uma das respostas anteriores estava em
      português, e as instruções pedem inglês.

---

## Depois do envio (não bloqueia)

- Guarda de permissão nas 70 rotas de API que ainda não têm (33 de 103 têm hoje).
- Content-Security-Policy completa, primeiro em modo `report-only`.
- Fechar a leitura anônima do catálogo e dos clientes — depende de o PDV externo
  passar a autenticar via `autenticar_operador_pdv()`. É o único item que exige
  mudança fora deste repositório.
- Tirar o `senha_hash` do alcance do anônimo (bloco separado no fim do SQL do
  item 1, para rodar com a loja fechada, depois do PDV externo atualizado).
