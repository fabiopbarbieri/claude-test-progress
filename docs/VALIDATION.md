# Validação

Como validar o Test Progress e o que cada gate cobre. O resultado de cada
commit é o estado da CI no GitHub Actions; a presença de um workflow não
significa que uma execução passou. Para a matriz de versões, veja
[COMPATIBILITY](COMPATIBILITY.md).

## Gates reproduzíveis

```bash
# Fontes, contratos, concorrência, supervisor e árvores:
python3 scripts/check.py

# Adaptador Python com unittest e pytest no ambiente selecionado:
python3 scripts/check.py --smoke --pytest

# Silêncio, rotação, perda do worker/coordenador e cancelamento Linux:
python3 scripts/check-long-running.py

# Manifesto e integração real com o test kit de Mods:
claude plugin validate . --strict
claude plugin validate .claude-plugin/plugin.json --strict
claude plugin test .

# Cliente Claude real e execução silenciosa de pelo menos 15 minutos:
node scripts/check-soak.mjs 900
```

Escolha o Node do coletor por `PATH` ou `TEST_PROGRESS_NODE`. Os scripts de
desenvolvimento usam Python 3.8+; isso não adiciona Python ao bootstrap do plugin.
`--pytest` exige pytest no mesmo ambiente Python usado para executar o check.
Os checks usam projetos e estado temporários e não carregam configurações ou
credenciais de aplicativos reais.

Gates opcionais exigem as ferramentas dos respectivos aplicativos:

```bash
RUBY=/caminho/para/ruby python3 scripts/check-ruby.py
python3 scripts/check-rails.py --ruby /caminho/para/ruby
python3 scripts/check-junit.py --maven /caminho/para/mvn --node /caminho/para/node
python3 scripts/check-karma.py --angular 9 --frontend-node /caminho/node12 --node /caminho/node24 --chrome /caminho/chrome
python3 scripts/check-karma.py --angular 18 --frontend-node /caminho/node22 --node /caminho/node24 --chrome /caminho/chrome
```

As gems devem estar disponíveis no ambiente Ruby escolhido. Karma instala as
fixtures com lockfile em diretório temporário. O cancelamento usa polling do
Karma, observa 50 resultados reais de TestBed e deixa o 51º pendente: exige
`cancelled`, 50/51, nenhuma falha e `totalStable: false`. Os cenários normais
preservam os transportes padrão. Rails valida views e system tests com
`rack_test`; não comprova Selenium.

## Cobertura dos contratos

| Área | Evidência |
| --- | --- |
| Cadastro, IDs, herança e diagnóstico sanitizado | `tests/collector/module-config.mjs` |
| Seleção explícita, ferramentas ausentes e runtimes independentes | `tests/collector/isolation.mjs`, `workspace.mjs` e gates dos adaptadores |
| Claims, snapshots, estado incompatível, corrupção por ID e recuperação | `tests/collector/module-state.mjs`, `lock-race.mjs` |
| Troca atômica normal e ancestral substituído por link | `tests/collector/module-state.mjs`; arquivo aberto vinculado ao pathname atual antes dos bytes |
| Preflight sem efeitos e barreira antes dos comandos | `tests/collector/module-batch.mjs` |
| Perda do CLI/worker, compensação e falhas comuns de suíte | `tests/collector/module-batch-faults.mjs` |
| Mudança de configuração, ACK final e reinício independente | `tests/collector/module-batch-races.mjs` |
| Doze workers silenciosos sob gravações e polling concorrentes | `tests/collector/module-batch-races.mjs`; exige ausência de compensação espúria |
| Cancelamento de filhos e netos no Linux | `tests/collector/module-tree.mjs` |
| Classificação da prova Windows e falha de infraestrutura | `tests/collector/module-windows-proof.mjs`, com provas sintéticas |
| Painel terminal/desktop: 0/1/2/12 módulos, layout largo e estreito, logs, legenda e callbacks obsoletos | `tests/panel.test.ts`, `language.test.ts` |
| Faixa acima do prompt, polling e propriedade do comando | `tests/activity.test.ts` |

`start all` prepara toda a seleção e não libera um subconjunto quando outro ID
falha. A preparação tem orçamento de 30 segundos, seguido de até 10 segundos
para confirmar o início e até 10 segundos para observar um abort. Isso não impõe
timeout à suíte. O supervisor destacado acompanha os workers após a saída do
CLI. Falhas de infraestrutura podem compensar o lote; teste reprovado, exit não
zero ou ausência de progresso não cancelam os irmãos. Após liberação, compensar
não desfaz efeitos externos já produzidos pelos comandos.

Snapshots e claims são relidos sob o mesmo mutation gate utilizado pelas
gravações do worker. Um gate abandonado bloqueia a operação até recuperação
manual; não expira por idade. Estado incompatível ou entrada insegura bloqueia
novos inícios. Corrupção segura associada a um ID bloqueia esse ID; consultas e
cancelamentos autenticados dos demais permanecem disponíveis. Veja o protocolo
em [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Painel em sessão real

A versão 0.3.0 foi conferida numa sessão real do Claude Code 2.1.290 no Linux,
com o plugin carregado por `--plugin-dir` e quatro módulos sintéticos
(`tests/collector/fixtures/panel-suite.mjs`): estados ocioso, rodando, total
desconhecido, concluído com falha e cancelado; logs sob o módulo; faixa de uma
linha acima do prompt, que some depois que as falhas são vistas. O painel
acoplado é estreito e usa o layout de duas linhas por módulo.

## Windows

O gate [check-windows.ps1](../scripts/check-windows.ps1) roda na CI hospedada
pelo workflow [Windows](../.github/workflows/windows.yml), com PowerShell 5.1/7 e
Node 14/24, e Node 12 separado para o aplicativo. Numa máquina Windows:

```powershell
# Execute uma vez em Windows PowerShell 5.1 e outra em PowerShell 7:
.\scripts\check-windows.ps1 -NodePath C:\tools\node24\node.exe -ProjectNode C:\tools\node12\node.exe
```

O gate recusa sistemas não Windows e verifica argv literal, DACL privada,
contenção por Job Object, filhos/netos, cancelamento, compensação por perda do
broker, `.cmd` e runtimes separados. Sintaxe e provas sintéticas no Linux não
comprovam esses comportamentos nativos. Os dois gates passaram numa VM Windows 11
em 06/10/2026, junto com o aceite visual do Mod no Claude Code
([detalhes](../WINDOWS.md#aceite-em-windows-11)). O aceite numa máquina física e
o aceite do Claude Desktop permanecem pendentes.
