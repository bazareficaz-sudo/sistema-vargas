'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatarTelefone, formatarCep, formatarCpfCnpj, soDigitos, buscarCep, ESTADOS } from '@/lib/formato/contato'

// Cadastro de cliente — o formulário que nunca existiu. Antes daqui só era
// possível editar os campos financeiros; nome, telefone, e-mail e endereço
// apareciam como texto, e não havia nenhuma forma de CRIAR um cliente pelo
// sistema (só o PDV externo criava, gravando direto no banco).
//
// Mesma gaveta lateral com abas de FornecedoresClient, para não inventar um
// padrão novo de tela num sistema que já tem o dele.

type Contato = {
  id?: string; nome: string; cargo: string; telefone: string; email: string
  autorizado_compra: boolean; recebe_avisos: boolean; _novo?: boolean; _removido?: boolean
}
type EnderecoEntrega = {
  id?: string; apelido: string; cep: string; logradouro: string; numero: string
  complemento: string; bairro: string; cidade: string; estado: string
  referencia: string; padrao: boolean; _novo?: boolean; _removido?: boolean
}

const CLIENTE_VAZIO = {
  nome: '', cpf_cnpj: '', telefone: '', whatsapp: '', email: '',
  cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '',
  permite_fiado: false, limite_credito: 0, bloqueado_fiado: false, motivo_bloqueio: '',
  observacoes_financeiras: '', cobranca_whatsapp_ativa: true,
  alerta_pedido_whatsapp: false, alerta_pedido_telefone: '',
}

type Aba = 'dados' | 'endereco' | 'contatos' | 'entrega' | 'financeiro'

export default function ClienteFormDrawer({ empresaId, clienteId, aberto, onFechar, onSalvo }: {
  empresaId: string
  /** null/undefined abre em branco, para cadastrar. */
  clienteId?: string | null
  aberto: boolean
  onFechar: () => void
  onSalvo?: (clienteId: string) => void
}) {
  const sb = createClient()
  const [aba, setAba] = useState<Aba>('dados')
  const [form, setForm] = useState({ ...CLIENTE_VAZIO })
  const [contatos, setContatos] = useState<Contato[]>([])
  const [enderecos, setEnderecos] = useState<EnderecoEntrega[]>([])
  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [buscandoCep, setBuscandoCep] = useState<'principal' | number | null>(null)
  const [buscandoCnpj, setBuscandoCnpj] = useState(false)
  // Cadastro que já existe: em vez de criar a segunda ficha, oferece abrir
  // a que está lá. O banco também protege (gatilho impedir_cliente_duplicado
  // faz a cópia nascer apontando pro original), mas cair no gatilho deixaria
  // a tela achando que criou um cliente que na verdade nasceu inativo.
  const [jaExiste, setJaExiste] = useState<{ id: string; nome: string; telefone: string | null } | null>(null)

  const set = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }))

  const carregar = useCallback(async () => {
    if (!clienteId) { setForm({ ...CLIENTE_VAZIO }); setContatos([]); setEnderecos([]); return }
    setCarregando(true)
    const [{ data: cli }, { data: cts }, { data: ends }] = await Promise.all([
      sb.from('clientes').select('*').eq('id', clienteId).maybeSingle(),
      sb.from('cliente_contatos').select('*').eq('cliente_id', clienteId).eq('ativo', true).order('nome'),
      sb.from('cliente_enderecos_entrega').select('*').eq('cliente_id', clienteId).eq('ativo', true).order('apelido'),
    ])
    if (cli) {
      setForm({
        nome: cli.nome ?? '', cpf_cnpj: cli.cpf_cnpj ?? '', telefone: cli.telefone ?? '',
        whatsapp: cli.whatsapp ?? '', email: cli.email ?? '',
        cep: cli.cep ?? '', logradouro: cli.logradouro ?? '', numero: cli.numero ?? '',
        complemento: cli.complemento ?? '', bairro: cli.bairro ?? '', cidade: cli.cidade ?? '', estado: cli.estado ?? '',
        permite_fiado: !!cli.permite_fiado, limite_credito: Number(cli.limite_credito ?? 0),
        bloqueado_fiado: !!cli.bloqueado_fiado, motivo_bloqueio: cli.motivo_bloqueio ?? '',
        observacoes_financeiras: cli.observacoes_financeiras ?? '',
        cobranca_whatsapp_ativa: cli.cobranca_whatsapp_ativa !== false,
        alerta_pedido_whatsapp: !!cli.alerta_pedido_whatsapp,
        alerta_pedido_telefone: cli.alerta_pedido_telefone ?? '',
      })
    }
    setContatos((cts ?? []).map((c: any) => ({
      id: c.id, nome: c.nome ?? '', cargo: c.cargo ?? '', telefone: c.telefone ?? '', email: c.email ?? '',
      autorizado_compra: !!c.autorizado_compra, recebe_avisos: !!c.recebe_avisos,
    })))
    setEnderecos((ends ?? []).map((e: any) => ({
      id: e.id, apelido: e.apelido ?? '', cep: e.cep ?? '', logradouro: e.logradouro ?? '',
      numero: e.numero ?? '', complemento: e.complemento ?? '', bairro: e.bairro ?? '',
      cidade: e.cidade ?? '', estado: e.estado ?? '', referencia: e.referencia ?? '', padrao: !!e.padrao,
    })))
    setCarregando(false)
  }, [clienteId, sb])

  useEffect(() => { if (aberto) { setAba('dados'); setErro(''); carregar() } }, [aberto, carregar])

  async function preencherPorCep(cep: string, alvo: 'principal' | number) {
    setBuscandoCep(alvo)
    const end = await buscarCep(cep)
    setBuscandoCep(null)
    if (!end) return
    if (alvo === 'principal') {
      setForm(p => ({ ...p, logradouro: end.logradouro || p.logradouro, bairro: end.bairro || p.bairro, cidade: end.cidade || p.cidade, estado: end.estado || p.estado }))
    } else {
      setEnderecos(prev => prev.map((e, i) => i === alvo
        ? { ...e, logradouro: end.logradouro || e.logradouro, bairro: end.bairro || e.bairro, cidade: end.cidade || e.cidade, estado: end.estado || e.estado }
        : e))
    }
  }

  // Reaproveita a rota /api/cnpj (BrasilAPI com fallback) que o cadastro de
  // empresa já usa — digitar 14 dígitos preenche razão social e endereço.
  async function preencherPorCnpj() {
    const d = soDigitos(form.cpf_cnpj)
    if (d.length !== 14) return
    setBuscandoCnpj(true)
    try {
      const r = await fetch(`/api/cnpj?cnpj=${d}`).then(r => r.json())
      if (r?.razaoSocial) {
        setForm(p => ({
          ...p,
          nome: p.nome || r.razaoSocial,
          cep: p.cep || (r.cep ?? ''),
          logradouro: p.logradouro || (r.logradouro ?? ''),
          numero: p.numero || (r.numero ?? ''),
          bairro: p.bairro || (r.bairro ?? ''),
          cidade: p.cidade || (r.municipio ?? ''),
          estado: p.estado || (r.uf ?? ''),
        }))
      }
    } catch { /* consulta externa fora do ar não pode travar o cadastro */ }
    setBuscandoCnpj(false)
  }

  function addContato() {
    setContatos(p => [...p, { nome: '', cargo: '', telefone: '', email: '', autorizado_compra: true, recebe_avisos: false, _novo: true }])
  }
  function addEndereco() {
    setEnderecos(p => [...p, {
      apelido: '', cep: '', logradouro: '', numero: '', complemento: '', bairro: '',
      cidade: '', estado: '', referencia: '', padrao: p.filter(e => !e._removido).length === 0, _novo: true,
    }])
  }
  // Só um padrão: marcar um desmarca os outros. O banco também garante isso
  // por índice único, mas deixar a tela coerente evita o erro na hora de salvar.
  function marcarPadrao(idx: number) {
    setEnderecos(p => p.map((e, i) => ({ ...e, padrao: i === idx })))
  }

  // Mesmo critério de clientes_equivalentes() no banco e de _mesmoCliente()
  // no PDV externo: nome igual, telefone e documento não conflitantes. Os
  // três precisam concordar, senão a duplicata entra pela porta que um
  // deles não vigia.
  const chaveNome = (n: string) =>
    n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase()

  async function procurarEquivalente() {
    const nome = form.nome.trim()
    if (!nome) return null
    const doc = soDigitos(form.cpf_cnpj)
    const tel = soDigitos(form.telefone)

    const { data } = await sb.from('clientes')
      .select('id, nome, telefone, cpf_cnpj')
      .eq('empresa_id', empresaId).eq('ativo', true).is('mesclado_em', null)
      .ilike('nome', `${nome.split(/\s+/)[0]}%`).limit(500)

    return (data || []).find(c => {
      if (c.id === clienteId) return false
      if (chaveNome(c.nome || '') !== chaveNome(nome)) return false
      const t = soDigitos(c.telefone || ''), d = soDigitos(c.cpf_cnpj || '')
      if (tel && t && tel !== t) return false
      if (doc && d && doc !== d) return false
      return true
    }) || null
  }

  async function salvar() {
    if (!form.nome.trim()) { setErro('O nome do cliente é obrigatório.'); setAba('dados'); return }
    setSalvando(true); setErro(''); setJaExiste(null)
    try {
      // Só no cadastro novo: editar um cliente existente não é duplicar.
      if (!clienteId) {
        const igual = await procurarEquivalente()
        if (igual) {
          setJaExiste({ id: igual.id, nome: igual.nome, telefone: igual.telefone })
          setAba('dados'); setSalvando(false); return
        }
      }
      const dados = {
        empresa_id: empresaId,
        nome: form.nome.trim(),
        cpf_cnpj: soDigitos(form.cpf_cnpj) || null,
        telefone: soDigitos(form.telefone) || null,
        whatsapp: soDigitos(form.whatsapp) || null,
        email: form.email.trim() || null,
        cep: soDigitos(form.cep) || null,
        logradouro: form.logradouro.trim() || null,
        numero: form.numero.trim() || null,
        complemento: form.complemento.trim() || null,
        bairro: form.bairro.trim() || null,
        cidade: form.cidade.trim() || null,
        estado: form.estado || null,
        permite_fiado: form.permite_fiado,
        limite_credito: Number(form.limite_credito) || 0,
        bloqueado_fiado: form.bloqueado_fiado,
        motivo_bloqueio: form.motivo_bloqueio.trim() || null,
        observacoes_financeiras: form.observacoes_financeiras.trim() || null,
        cobranca_whatsapp_ativa: form.cobranca_whatsapp_ativa,
        alerta_pedido_whatsapp: form.alerta_pedido_whatsapp,
        alerta_pedido_telefone: soDigitos(form.alerta_pedido_telefone) || null,
        status_credito: form.bloqueado_fiado ? 'bloqueado' : form.permite_fiado ? 'liberado' : 'restrito',
        updated_at: new Date().toISOString(),
      }

      let id = clienteId
      if (id) {
        const { error } = await sb.from('clientes').update(dados).eq('id', id)
        if (error) throw error
      } else {
        const { data, error } = await sb.from('clientes').insert({ ...dados, ativo: true }).select('id').single()
        if (error) throw error
        id = data.id
      }

      // Filhos: apaga o que foi marcado pra remover, atualiza o que já
      // existia, insere o que é novo.
      const removerContatos = contatos.filter(c => c._removido && c.id).map(c => c.id!)
      if (removerContatos.length) await sb.from('cliente_contatos').delete().in('id', removerContatos)
      await Promise.all(contatos.filter(c => !c._removido && c.nome.trim()).map(c => {
        const linha = {
          empresa_id: empresaId, cliente_id: id, nome: c.nome.trim(), cargo: c.cargo.trim() || null,
          telefone: soDigitos(c.telefone) || null, email: c.email.trim() || null,
          autorizado_compra: c.autorizado_compra, recebe_avisos: c.recebe_avisos,
          updated_at: new Date().toISOString(),
        }
        return c.id
          ? sb.from('cliente_contatos').update(linha).eq('id', c.id)
          : sb.from('cliente_contatos').insert(linha)
      }))

      const removerEnds = enderecos.filter(e => e._removido && e.id).map(e => e.id!)
      if (removerEnds.length) await sb.from('cliente_enderecos_entrega').delete().in('id', removerEnds)
      // Padrão sai antes de entrar: o índice único não deixa dois padrões
      // conviverem nem por um instante durante a gravação.
      const ativos = enderecos.filter(e => !e._removido && (e.logradouro.trim() || e.apelido.trim()))
      await Promise.all(ativos.filter(e => e.id).map(e =>
        sb.from('cliente_enderecos_entrega').update({ padrao: false }).eq('id', e.id!)))
      for (const e of ativos) {
        const linha = {
          empresa_id: empresaId, cliente_id: id, apelido: e.apelido.trim() || null,
          cep: soDigitos(e.cep) || null, logradouro: e.logradouro.trim() || null, numero: e.numero.trim() || null,
          complemento: e.complemento.trim() || null, bairro: e.bairro.trim() || null,
          cidade: e.cidade.trim() || null, estado: e.estado || null, referencia: e.referencia.trim() || null,
          padrao: e.padrao, updated_at: new Date().toISOString(),
        }
        if (e.id) await sb.from('cliente_enderecos_entrega').update(linha).eq('id', e.id)
        else await sb.from('cliente_enderecos_entrega').insert(linha)
      }

      onSalvo?.(id!)
      onFechar()
    } catch (e: any) {
      setErro(e?.message ?? 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  if (!aberto) return null

  const contatosVisiveis = contatos.filter(c => !c._removido)
  const enderecosVisiveis = enderecos.filter(e => !e._removido)

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/30" onClick={onFechar} />
      <div className="relative ml-auto w-full max-w-2xl bg-white h-full flex flex-col shadow-2xl">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">{clienteId ? 'Editar Cliente' : 'Novo Cliente'}</h2>
          <button onClick={onFechar} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="flex border-b border-gray-200 px-6 overflow-x-auto">
          {([['dados', 'Dados'], ['endereco', 'Endereço'], ['contatos', `Contatos${contatosVisiveis.length ? ` (${contatosVisiveis.length})` : ''}`],
             ['entrega', `Entrega${enderecosVisiveis.length ? ` (${enderecosVisiveis.length})` : ''}`], ['financeiro', 'Financeiro']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setAba(k as Aba)}
              className={`py-3 px-4 text-sm whitespace-nowrap border-b-2 transition-colors ${aba === k ? 'border-blue-600 text-blue-600 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {l}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {carregando && <p className="text-sm text-gray-400">Carregando...</p>}

          {aba === 'dados' && (
            <>
              <Field label="Nome / Razão Social *" value={form.nome} onChange={v => set('nome', v)} />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">CPF / CNPJ</label>
                  <div className="flex gap-2">
                    <input value={formatarCpfCnpj(form.cpf_cnpj)} onChange={e => set('cpf_cnpj', e.target.value)}
                      onBlur={preencherPorCnpj} placeholder="000.000.000-00"
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                    {buscandoCnpj && <span className="self-center text-xs text-gray-400">buscando…</span>}
                  </div>
                  {soDigitos(form.cpf_cnpj).length === 14 && (
                    <p className="text-xs text-gray-400 mt-1">CNPJ preenche razão social e endereço automaticamente.</p>
                  )}
                </div>
                <Field label="E-mail" type="email" value={form.email} onChange={v => set('email', v)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Telefone" value={formatarTelefone(form.telefone)} onChange={v => set('telefone', v)} placeholder="(21) 99999-9999" />
                <Field label="WhatsApp" value={formatarTelefone(form.whatsapp)} onChange={v => set('whatsapp', v)} placeholder="Se diferente do telefone" />
              </div>
            </>
          )}

          {aba === 'endereco' && (
            <>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">CEP</label>
                  <input value={formatarCep(form.cep)} onChange={e => set('cep', e.target.value)}
                    onBlur={e => preencherPorCep(e.target.value, 'principal')} placeholder="00000-000"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  {buscandoCep === 'principal' && <p className="text-xs text-gray-400 mt-1">buscando…</p>}
                </div>
                <div className="col-span-2">
                  <Field label="Logradouro" value={form.logradouro} onChange={v => set('logradouro', v)} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <Field label="Número" value={form.numero} onChange={v => set('numero', v)} />
                <div className="col-span-2"><Field label="Complemento" value={form.complemento} onChange={v => set('complemento', v)} /></div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <Field label="Bairro" value={form.bairro} onChange={v => set('bairro', v)} />
                <Field label="Cidade" value={form.cidade} onChange={v => set('cidade', v)} />
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">UF</label>
                  <select value={form.estado} onChange={e => set('estado', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                    <option value="">—</option>
                    {ESTADOS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                  </select>
                </div>
              </div>
            </>
          )}

          {aba === 'contatos' && (
            <>
              <p className="text-xs text-gray-500">
                Pessoas que falam ou compram em nome deste cliente. Marcar <b>autorizado</b> faz o nome aparecer
                no PDV ao escolher o cliente — é informação para o balconista, não trava a venda.
              </p>
              {contatosVisiveis.length === 0 && <p className="text-sm text-gray-400">Nenhum contato cadastrado.</p>}
              {contatos.map((c, i) => c._removido ? null : (
                <div key={i} className="border border-gray-200 rounded-xl p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Nome" value={c.nome} onChange={v => setContatos(p => p.map((x, j) => j === i ? { ...x, nome: v } : x))} />
                    <Field label="Cargo / função" value={c.cargo} onChange={v => setContatos(p => p.map((x, j) => j === i ? { ...x, cargo: v } : x))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Telefone" value={formatarTelefone(c.telefone)} onChange={v => setContatos(p => p.map((x, j) => j === i ? { ...x, telefone: v } : x))} />
                    <Field label="E-mail" type="email" value={c.email} onChange={v => setContatos(p => p.map((x, j) => j === i ? { ...x, email: v } : x))} />
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input type="checkbox" checked={c.autorizado_compra} className="accent-blue-600"
                        onChange={e => setContatos(p => p.map((x, j) => j === i ? { ...x, autorizado_compra: e.target.checked } : x))} />
                      Autorizado a comprar
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input type="checkbox" checked={c.recebe_avisos} className="accent-emerald-600"
                        onChange={e => setContatos(p => p.map((x, j) => j === i ? { ...x, recebe_avisos: e.target.checked } : x))} />
                      Recebe aviso de compra
                    </label>
                    <button onClick={() => setContatos(p => p.map((x, j) => j === i ? { ...x, _removido: true } : x))}
                      className="ml-auto text-xs text-red-500 hover:underline">Remover</button>
                  </div>
                </div>
              ))}
              <button onClick={addContato} className="text-sm text-blue-600 hover:underline">+ Adicionar contato</button>
            </>
          )}

          {aba === 'entrega' && (
            <>
              <p className="text-xs text-gray-500">
                Endereços para onde este cliente pede entrega — obra, filial, depósito. O marcado como padrão
                vem pré-selecionado no PDV.
              </p>
              {enderecosVisiveis.length === 0 && <p className="text-sm text-gray-400">Nenhum endereço de entrega cadastrado.</p>}
              {enderecos.map((e, i) => e._removido ? null : (
                <div key={i} className="border border-gray-200 rounded-xl p-3 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <Field label="Apelido" value={e.apelido} placeholder="Obra Bangu, Filial Centro..."
                        onChange={v => setEnderecos(p => p.map((x, j) => j === i ? { ...x, apelido: v } : x))} />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mt-5 whitespace-nowrap">
                      <input type="radio" name="endereco-padrao" checked={e.padrao} onChange={() => marcarPadrao(i)} className="accent-blue-600" />
                      Padrão
                    </label>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">CEP</label>
                      <input value={formatarCep(e.cep)} placeholder="00000-000"
                        onChange={ev => setEnderecos(p => p.map((x, j) => j === i ? { ...x, cep: ev.target.value } : x))}
                        onBlur={ev => preencherPorCep(ev.target.value, i)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                      {buscandoCep === i && <p className="text-xs text-gray-400 mt-1">buscando…</p>}
                    </div>
                    <div className="col-span-2">
                      <Field label="Logradouro" value={e.logradouro} onChange={v => setEnderecos(p => p.map((x, j) => j === i ? { ...x, logradouro: v } : x))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Número" value={e.numero} onChange={v => setEnderecos(p => p.map((x, j) => j === i ? { ...x, numero: v } : x))} />
                    <Field label="Complemento" value={e.complemento} onChange={v => setEnderecos(p => p.map((x, j) => j === i ? { ...x, complemento: v } : x))} />
                    <Field label="Bairro" value={e.bairro} onChange={v => setEnderecos(p => p.map((x, j) => j === i ? { ...x, bairro: v } : x))} />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Cidade" value={e.cidade} onChange={v => setEnderecos(p => p.map((x, j) => j === i ? { ...x, cidade: v } : x))} />
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">UF</label>
                      <select value={e.estado} onChange={ev => setEnderecos(p => p.map((x, j) => j === i ? { ...x, estado: ev.target.value } : x))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                        <option value="">—</option>
                        {ESTADOS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                      </select>
                    </div>
                    <Field label="Referência" value={e.referencia} placeholder="Portão azul, ao lado da..."
                      onChange={v => setEnderecos(p => p.map((x, j) => j === i ? { ...x, referencia: v } : x))} />
                  </div>
                  <button onClick={() => setEnderecos(p => p.map((x, j) => j === i ? { ...x, _removido: true } : x))}
                    className="text-xs text-red-500 hover:underline">Remover endereço</button>
                </div>
              ))}
              <button onClick={addEndereco} className="text-sm text-blue-600 hover:underline">+ Adicionar endereço de entrega</button>
            </>
          )}

          {aba === 'financeiro' && (
            <>
              <Toggle label="Permite Fiado" ajuda="Habilitar compras sem pagamento imediato"
                ligado={form.permite_fiado} onChange={v => set('permite_fiado', v)} />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Limite de Crédito (R$)</label>
                <input type="number" value={form.limite_credito} onChange={e => set('limite_credito', parseFloat(e.target.value) || 0)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
              <Toggle label="Bloqueado para Fiado" ajuda="Impede novas compras fiadas" cor="red"
                ligado={form.bloqueado_fiado} onChange={v => set('bloqueado_fiado', v)} />
              {form.bloqueado_fiado && (
                <Field label="Motivo do bloqueio" value={form.motivo_bloqueio} onChange={v => set('motivo_bloqueio', v)} />
              )}
              <Toggle label="Cobrança automática via WhatsApp" ajuda="Extrato e situação da conta. Desligar não afeta outras mensagens."
                ligado={form.cobranca_whatsapp_ativa} onChange={v => set('cobranca_whatsapp_ativa', v)} />
              <Toggle label="Avisar cada compra por WhatsApp" cor="emerald"
                ajuda="Manda uma mensagem a cada compra feita em nome deste cliente, com itens e total."
                ligado={form.alerta_pedido_whatsapp} onChange={v => set('alerta_pedido_whatsapp', v)} />
              {form.alerta_pedido_whatsapp && (
                <Field label="Número que recebe o aviso (opcional)" value={formatarTelefone(form.alerta_pedido_telefone)}
                  onChange={v => set('alerta_pedido_telefone', v)} placeholder="Vazio usa o telefone do cadastro" />
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Observações financeiras</label>
                <textarea value={form.observacoes_financeiras} rows={3}
                  onChange={e => set('observacoes_financeiras', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-blue-500" />
              </div>
            </>
          )}
        </div>

        {erro && <p className="px-6 text-sm text-red-600">{erro}</p>}
        {jaExiste && (
          <div className="mx-6 mb-2 p-3 rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-900">
            <p className="font-medium">Esse cliente já está cadastrado.</p>
            <p className="mt-0.5">
              <span className="font-medium">{jaExiste.nome}</span>
              {jaExiste.telefone ? ` — ${formatarTelefone(jaExiste.telefone)}` : ' — sem telefone'}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => { const id = jaExiste.id; setJaExiste(null); onSalvo?.(id); onFechar() }}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium rounded-lg">
                Abrir o cadastro que já existe
              </button>
              <button
                onClick={() => setJaExiste(null)}
                className="px-3 py-1.5 border border-amber-400 text-amber-800 text-xs rounded-lg hover:bg-amber-100">
                Não é o mesmo — mudar o nome
              </button>
            </div>
          </div>
        )}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button onClick={onFechar} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
          <button onClick={salvar} disabled={salvando}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
            {salvando ? 'Salvando...' : 'Salvar cliente'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
    </div>
  )
}

function Toggle({ label, ajuda, ligado, onChange, cor = 'blue' }: {
  label: string; ajuda: string; ligado: boolean; onChange: (v: boolean) => void; cor?: 'blue' | 'red' | 'emerald'
}) {
  const fundo = ligado ? (cor === 'red' ? 'bg-red-600' : cor === 'emerald' ? 'bg-emerald-600' : 'bg-blue-600') : 'bg-gray-300'
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <label className="text-gray-900 text-sm font-medium">{label}</label>
        <p className="text-gray-500 text-xs">{ajuda}</p>
      </div>
      <button onClick={() => onChange(!ligado)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${fundo}`}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${ligado ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  )
}
