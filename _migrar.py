# -*- coding: utf-8 -*-
# Migração mecânica: a leitura de profiles.empresa_id passa pelo helper.
import io, os, re

RAIZ = 'src'
# Só o que é servidor: page.tsx, route.ts e libs. O helper usa o client que o
# chamador já tem, então serve para os dois, mas componentes 'use client'
# recebem empresaId por prop e ficam de fora desta fatia.
PADRAO = re.compile(
    r"await\s+(\w+)\s*\.from\('profiles'\)\s*\.select\('([^']*empresa_id[^']*)'\)\s*\.eq\('id',\s*([^)]+?)\)\s*\.single\(\)"
)

alterados, ocorrencias = [], 0
for base, _, arquivos in os.walk(RAIZ):
    for nome in arquivos:
        if not nome.endswith(('.ts', '.tsx')):
            continue
        caminho = os.path.join(base, nome)
        s = io.open(caminho, encoding='utf-8').read()
        if "from('profiles')" not in s or 'empresa_id' not in s:
            continue
        # Componente de cliente não entra nesta fatia.
        if s.lstrip().startswith("'use client'"):
            continue

        def troca(m):
            global ocorrencias
            ocorrencias += 1
            sb, campos, user = m.group(1), m.group(2), m.group(3).strip()
            if campos.strip() == 'empresa_id':
                return f"perfilDaSessao({sb}, {user})"
            return f"perfilDaSessao({sb}, {user}, '{campos}')"

        novo = PADRAO.sub(troca, s)
        if novo == s:
            continue
        # `const { data: profile } = await ...` vira `const profile = await ...`
        novo = re.sub(r"const\s*\{\s*data:\s*(\w+)\s*\}\s*=\s*perfilDaSessao\(", r"const \1 = await perfilDaSessao(", novo)
        novo = re.sub(r"const\s*\{\s*data:\s*(\w+),\s*error:\s*(\w+)\s*\}\s*=\s*perfilDaSessao\(", r"const \1 = await perfilDaSessao(", novo)
        if 'empresaAtiva' not in novo:
            linhas = novo.split('\n')
            ultimo = max(i for i, l in enumerate(linhas) if l.startswith('import '))
            linhas.insert(ultimo + 1, "import { perfilDaSessao } from '@/lib/auth/empresaAtiva'")
            novo = '\n'.join(linhas)
        io.open(caminho, 'w', encoding='utf-8').write(novo)
        alterados.append(caminho)

print(f"{len(alterados)} arquivos, {ocorrencias} ocorrências")
