import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const ate = Date.now() + 24*60*1000
let ultimo = 0
while (Date.now() < ate) {
  await new Promise(r=>setTimeout(r, 90000))
  const { data: logs } = await sb.from('marketplace_sync_log').select('canal_id, status, mensagem, created_at')
    .eq('tipo','varredura').order('created_at',{ascending:false}).limit(20)
  const fechados = (logs??[]).filter(l => l.status !== 'executando').length
  if (fechados > ultimo || (logs??[]).length > 6) {
    const { data: cs } = await sb.from('marketplace_canais')
      .select('id, nome, varredura_status, varredura_itens, varredura_rodadas, varredura_cursor, varredura_erro')
      .not('access_token','is',null).order('nome')
    const nome = new Map(cs.map(c=>[c.id,c.nome]))
    console.log('=== LOGS ===')
    for (const l of logs) console.log(` ${l.created_at.slice(11,19)} ${String(nome.get(l.canal_id)).padEnd(11)} ${l.status.padEnd(10)} ${String(l.mensagem).slice(0,100)}`)
    console.log('\n=== CANAIS ===')
    for (const c of cs) console.log(` ${c.nome.padEnd(11)} ${String(c.varredura_status).padEnd(13)} itens:${String(c.varredura_itens).padEnd(6)} rodadas:${c.varredura_rodadas} cursor:${JSON.stringify(c.varredura_cursor)} ${c.varredura_erro ?? ''}`)
    process.exit(0)
  }
}
console.log('24 MIN SEM NENHUM LOG FECHADO — a rodada nao esta concluindo.')
