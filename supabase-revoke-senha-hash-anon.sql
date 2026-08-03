-- ═══════════════════════════════════════════════════════════════════════
-- PASSO FINAL da migração de autenticação do PDV — SÓ RODAR DEPOIS que
-- TODOS os terminais estiverem atualizados para a versão que loga via
-- autenticar_operador_pdv() (ver supabase-autenticar-operador-pdv.sql).
--
-- Se isso rodar antes de todos os terminais terem a atualização, qualquer
-- terminal ainda na versão antiga (select('*') + comparação local) para
-- de conseguir logar, inclusive o caixa fica travado — a versão antiga
-- depende de ler essa coluna diretamente.
--
-- Ordem: 1) aplicar supabase-autenticar-operador-pdv.sql
--        2) publicar/distribuir a nova versão do terminal pra todo mundo
--        3) confirmar (ex: pela tela de terminais) que não sobrou terminal
--           na versão antiga
--        4) só então rodar este arquivo
-- ═══════════════════════════════════════════════════════════════════════

REVOKE SELECT (senha_hash) ON usuarios_pdv FROM anon, PUBLIC;

-- ── Para desfazer (ex: se algum terminal ainda não migrado aparecer) ────
-- GRANT SELECT (senha_hash) ON usuarios_pdv TO anon;
