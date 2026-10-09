# Contribuir

Correções, documentação, testes e sugestões são bem-vindos. Uma issue prévia é
opcional; para mudanças amplas, discutir o problema antes ajuda a delimitar o
escopo. Use português nos relatos e descreva uma mudança por PR.

## Relatar um problema ou sugerir uma melhoria

Consulte as [issues existentes](https://github.com/fabiopbarbieri/claude-test-progress/issues)
e escolha um dos [formulários](https://github.com/fabiopbarbieri/claude-test-progress/issues/new/choose).
Para bugs, informe versões do plugin/mod `test-progress`, Claude Code, sistema,
shell e runner usado, uma reprodução mínima e o resultado esperado e observado.
Se não souber uma versão, diga isso. Para sugestões, explique o problema, o caso
de uso, o resultado desejado e as alternativas consideradas.

Prefira exemplos públicos e sintéticos. Trechos de saída são opcionais: revise
e remova credenciais, dados pessoais, URLs internas e caminhos privados antes
de compartilhar. Não envie logs completos, `.env`, dumps de ambiente ou sua
configuração real. Não execute diagnósticos de uma suíte que você não usa só
para preencher o relato.

Vulnerabilidades devem ir pelo
[canal privado de segurança](https://github.com/fabiopbarbieri/claude-test-progress/security/advisories/new),
nunca por uma issue pública. Consulte a [política de segurança](SECURITY.md).

## Preparar um fork e uma branch

Crie um fork pelo GitHub. Com uma chave SSH configurada, substitua `SEU_USUARIO`
pelo dono do fork e execute:

```bash
git clone git@github.com:SEU_USUARIO/claude-test-progress.git
cd claude-test-progress
git remote add upstream git@github.com:fabiopbarbieri/claude-test-progress.git
git fetch upstream
git switch -c docs/minha-alteracao upstream/main
```

`origin` deve apontar para seu fork; `upstream`, para o repositório público.
Confira com `git remote -v`. Escolha um nome de branch que descreva o escopo.
Quem tem acesso de escrita também trabalha em branch própria e abre PR.

## Dependências e checks locais

O coletor usa **Node 14+**. Os checks básicos abaixo usam também
**Python 3.8+**, **Bash** e Git em Linux/WSL. Não é necessário instalar pacotes
npm, Ruby, Rails, Java, Karma ou pytest para esse primeiro passo:

```bash
python3 scripts/check.py
python3 scripts/check.py --smoke
```

O primeiro comando verifica fontes, manifests, links locais, sintaxe e arquivos
proibidos na distribuição. O smoke usa unittest da biblioteca padrão do Python
e cria fixtures temporárias de sucesso, falha, skip e cancelamento, inclusive em
caminho com espaços. As falhas das fixtures são intencionais; o gate deve terminar
com sucesso. Ele não executa testes de outro projeto nem exige credenciais.

Para documentação, rode o check estático e revise links, exemplos e formatação.
Para mudanças no coletor, rode também o smoke e os cenários de execução longa:

```bash
python3 scripts/check-long-running.py
```

Instale apenas as ferramentas das integrações alteradas, em ambiente isolado.
Não acrescente frameworks como dependências globais do plugin.

| Alteração | Verificação adicional | Preparação e alcance |
| --- | --- | --- |
| Python/pytest | `python3 scripts/check.py --smoke --pytest` | Instale pytest no Python do check; exemplo isolado abaixo. |
| Ruby/RSpec | `python3 scripts/check-ruby.py` | Ruby 3.1+, RSpec Core 3.13.x e rspec-retry 0.6.2; use gems isoladas e as versões do [workflow Ruby](.github/workflows/ruby.yml). Veja o [adaptador](adapters/ruby/README.md). |
| Rails/Minitest | `python3 scripts/check-rails.py` | Prepare Ruby, Bundler e gems da combinação do [workflow Rails](.github/workflows/rails.yml) em ambiente isolado. Inclui Rails, Minitest, mutex_m, Capybara e selenium-webdriver; o teste system usa `rack_test`, sem aceite de Selenium/browser. Veja o [adaptador](adapters/rails/README.md). |
| Java/JUnit | `(cd adapters/junit && bash build.sh)` | JDK 17+ e curl; o build baixa dependências para `build/`. Compilação não comprova execução em Surefire. Veja o [listener](adapters/junit/README.md) e acrescente uma fixture pública para o comportamento alterado. |
| Karma | `node --check adapters/karma/reporter.cjs` | Só verifica sintaxe. Para comportamento, use uma fixture isolada com Karma e browser compatíveis com a versão em teste, conforme o [reporter](adapters/karma/README.md). |
| Mod, painel ou manifests/hooks | Comandos Claude abaixo | Use o CLI compatível com Mods; o mínimo Node do coletor não define o runtime do Claude. |
| Desempenho do coletor no Windows | A/B com `scripts/bench/bench-heavy.ps1` e tabela do `compare.mjs` no PR | Windows nativo com 4+ núcleos e 8 GB; o replay (S5) roda em minutos. Veja o [fluxo de benchmark](scripts/bench/README.md). |

Exemplo opcional para pytest, executado em Bash com Python compatível com a
versão escolhida no [workflow Quality](.github/workflows/quality.yml):

```bash
checks_dir=$(mktemp -d)
python3 -m venv "$checks_dir/venv"
# Exemplo da combinação Python 3.8 do CI:
"$checks_dir/venv/bin/python" -m pip install 'pytest==8.3.5'
"$checks_dir/venv/bin/python" scripts/check.py --smoke --pytest
```

Para o Mod, painel ou manifests/hooks, com Claude Code instalado:

```bash
claude plugin validate . --strict
claude plugin validate .claude-plugin/plugin.json --strict
claude plugin test .
```

Os testes do Mod simulam respostas do coletor. Não equivalem a olhar ou operar
o painel em uma sessão real. Tipos em `.claude-plugin/types` são gerados pelo
Claude; `tsconfig.json` não é um gate independente antes dessa geração. Com os tipos
gerados, `npx -p typescript@5 tsc -p .` checa `hooks/register.tsx`, o contrato de
estado em `types/index.d.ts` e `runner/module-presentation.d.mts`; os testes ficam
fora porque os fixtures são propositalmente parciais.

Ao alterar contagem, observe seleção, falhas de preparação/finalização,
interrupção, total desconhecido e zero testes. Preserve o
[contrato de eventos](adapters/README.md) e o código de saída nativo.
O cadastro e o estado usam `schemaVersion: 1`. IDs não escolhem runtime:
`inherit` conserva o ambiente e `node-project` resolve Node/.nvmrc explicitamente.
Teste seleção individual e `all`, barreira, compensação de infraestrutura e
recuperação de estado.

## Antes de enviar

Selecione apenas arquivos da sua mudança, revise o conteúdo staged e crie um
commit de escopo no formato Conventional Commits (gitmoji opcional). O tipo
decide a próxima versão e o assunto vira a linha do changelog
([regras](docs/RELEASING.md#pr-de-release-automático)): escreva-o para quem usa
o plugin. Exemplo para uma alteração neste guia:

```bash
git add CONTRIBUTING.md
git diff --cached
git commit -m "docs: explicar contribuição"
```

Revise também arquivos adicionados, diff e histórico da sua branch. Depois dos
commits, rode Gitleaks tanto nos arquivos quanto no histórico:

```bash
git status --short
git diff
git diff --cached
git log --oneline upstream/main..HEAD
git diff --stat upstream/main...HEAD
git diff upstream/main...HEAD
bash scripts/scan-secrets.sh
```

Instale Gitleaks separadamente ou indique seu executável por `GITLEAKS_BIN`.
O [workflow Quality](.github/workflows/quality.yml) mostra a instalação com
checksum verificado. O scanner usa saída redigida; não publique relatórios de
achados. Ele detecta padrões conhecidos e não garante ausência de segredos.
`.gitignore` não remove conteúdo já commitado.

Não versione `.claude/test-progress.json`, `.env`, credenciais, logs, capturas
autenticadas, tipos gerados, ambientes Python, dependências baixadas ou builds
Java. Se encontrar dados privados, saneie arquivos e commits antes do push;
credenciais expostas precisam ser revogadas, conforme [SECURITY](SECURITY.md).

Envie somente a branch de escopo para seu fork:

```bash
git push -u origin docs/minha-alteracao
```

Abra um PR para `fabiopbarbieri/claude-test-progress:main`. O template pede o
problema, o comportamento final, os comandos realmente executados com versões
e resultados, e os limites pendentes. Relacione uma issue apenas se existir.
Use draft quando faltar evidência necessária para a mudança e registre o que
falta. Títulos como `docs: explicar contribuição` ou `fix: preservar contagem`
ajudam a identificar o escopo.

## CI, revisão e aceite

Checks locais, CI e aceite visual são evidências diferentes. Confira os checks
do SHA mais recente do PR; uma execução local não comprova CI. Os workflows em
[`.github/workflows`](.github/workflows) mostram as suítes remotas. O colaborador
não precisa instalar todas essas linguagens localmente para contribuir.

Mudanças de interface precisam de observação em sessão real: aparência, teclado
e ações afetadas. Checagem estática ou execução Linux não comprova Windows nativo,
cujo aceite continua pendente. Registre plataformas e cenários que você não
testou; consulte os limites em [VALIDATION](docs/VALIDATION.md).

A integração exige PR, checks obrigatórios aprovados, branch atualizada com
`main` e conversas resolvidas. Somente o proprietário mantenedor integra.
Há zero aprovações obrigatórias enquanto existe um único mantenedor, evitando
exigir autoaprovação. Revisão de código e autorização para integrar são coisas
distintas: zero aprovações obrigatórias não autoriza merge por colaboradores.
Não há exigência de aprovação de CODEOWNERS. Veja
[governança de CI](docs/CI-GOVERNANCE.md) e as
[regras ativas](https://github.com/fabiopbarbieri/claude-test-progress/rules).

Contribuições são distribuídas sob a [licença MIT](LICENSE), sem CLA adicional.
Inclua apenas conteúdo que você tem direito de contribuir; preserve atribuições
e informe a origem e a licença de material de terceiros.
