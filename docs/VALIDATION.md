# Validação do contrato v2

## Correções após a primeira publicação do PR

O commit inicial `ee181b6` passou nos grupos de coletor, Mods, Ruby, JUnit,
Angular e segredos da CI. A CI também expôs duas lacunas de ambiente:

- Rails usava checkout shallow, sem o commit publicado anterior exigido pelo
  gate de rollback. O workflow agora traz o histórico completo. O erro foi
  reproduzido em clone shallow sem remotes; clone completo sem remotes passou
  o rollback e `python3 scripts/check.py`.
- Windows elevado criava estado com o proprietário padrão Administrators;
  PowerShell também podia exceder o limite de dois segundos. A criação Win32
  agora atribui atomicamente o SID do usuário e DACL privada; diretórios
  existentes inseguros e junctions são recusados sem alteração. O controle
  PowerShell admite até 7,5 segundos para inicializar: a CI observou 5,2–5,4
  segundos na primeira chamada de PowerShell 7.

A matriz nativa seguinte comprovou a criação privada, reabertura e recusa de
junctions nas quatro combinações. Ela também revelou que PowerShell converte
`$null` em string vazia no argumento de backup de `File.Replace`, impedindo
atualizar a prova do broker. A função real foi reproduzida por AST no PowerShell
7.4.7 Linux; usar `[NullString]::Value` corrigiu o erro. A regressão persistida
em `tests/windows/atomic-write.ps1` cobre três gravações da mesma prova sem
backup nem temporários e roda também no gate nativo PS5.1/7. O gate mede o
bootstrap real do namespace sem executar previamente o helper Windows.

Após essas correções, `python3 scripts/check.py`, actionlint, sintaxe JavaScript,
parsing PowerShell e compilação C# com PowerShell 7.4.7 no Linux passaram. O gate
Windows verifica criação, reabertura sem reescrever ACL, recusa de diretório
existente inseguro e junction no leaf/pai sem criar estado no alvo externo.
Esse gate ainda precisa executar na matriz nativa da CI; parsing Linux não
comprova as APIs Windows. Os aceites locais abaixo permanecem vinculados aos
digests e revisões registrados em cada evidência, anteriores a essa correção
específica de Windows.

Este documento registra os gates da implementação de
[MODULES-PLAN.md](MODULES-PLAN.md). Configuração, cadastro, respostas CLI e estado
persistido usam somente `schemaVersion: 2`. `backend` e `frontend` são IDs comuns;
não há lanes nem demo no produto. O coletor requer Node 14.0.0 ou superior.
Python, Ruby, Java, Maven, Karma e Rails são ferramentas das suítes selecionadas.
O runtime do aplicativo é independente do Node do coletor.

## Gates reproduzíveis

```bash
# Fontes, contratos, concorrência, supervisor, árvores e rollback:
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
| Cadastro v2, IDs, herança e diagnóstico sanitizado | `tests/collector/module-config.mjs` |
| Seleção explícita, ferramentas ausentes e runtimes independentes | `tests/collector/isolation.mjs`, `workspace.mjs` e gates dos adaptadores |
| Claims, snapshots, legado, corrupção por ID e recuperação | `tests/collector/module-state.mjs`, `lock-race.mjs` |
| Troca atômica normal e ancestral substituído por link | `tests/collector/module-state.mjs`; arquivo aberto vinculado ao pathname atual antes dos bytes |
| Preflight sem efeitos e barreira antes dos comandos | `tests/collector/module-batch.mjs` |
| Perda do CLI/worker, compensação e falhas comuns de suíte | `tests/collector/module-batch-faults.mjs` |
| Mudança de configuração, ACK final e reinício independente | `tests/collector/module-batch-races.mjs` |
| Doze workers silenciosos sob gravações e polling concorrentes | `tests/collector/module-batch-races.mjs`; exige ausência de compensação espúria |
| Cancelamento de filhos e netos no Linux | `tests/collector/module-tree.mjs` |
| Classificação da prova Windows e falha de infraestrutura | `tests/collector/module-windows-proof.mjs`, com provas sintéticas |
| Atualização e rollback com a versão publicada anterior | `tests/collector/module-rollout.mjs` |
| Painel terminal/desktop, 0/1/2/12 módulos e callbacks obsoletos | `tests/panel.test.ts`, `activity.test.ts`, `language.test.ts` |

`start all` prepara toda a seleção e não libera um subconjunto quando outro ID
falha. A preparação tem orçamento de 30 segundos, seguido de até 10 segundos
para confirmar o início e até 10 segundos para observar um abort. Isso não impõe
timeout à suíte. O supervisor destacado acompanha os workers após a saída do
CLI. Falhas de infraestrutura podem compensar o lote; teste reprovado, exit não
zero ou ausência de progresso não cancelam os irmãos. Após liberação, compensar
não desfaz efeitos externos já produzidos pelos comandos.

Snapshots e claims são relidos sob o mesmo mutation gate utilizado pelas
gravações do worker. Um gate abandonado bloqueia a operação até recuperação
manual; não expira por idade. Estado legado ou entrada insegura bloqueia novos
inícios. Corrupção segura associada a um ID bloqueia esse ID; consultas e
cancelamentos autenticados dos demais permanecem disponíveis. Veja o protocolo
em [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

O rollout arquiva o commit publicado `3111299bbd5322221256825ee4237f25874feb9b`,
inicia uma suíte v1, cancela e comprova a quiescência de processos e locks. A v2
recusa o namespace legado, que é retirado somente após essa comprovação. O teste
inicia/cancela um módulo v2, comprova novamente a quiescência e retorna à versão
anterior. O namespace pertence exclusivamente à fixture. Nunca misture clientes
v1 e v2 ativos na mesma sessão. O gate precisa do histórico Git; o workflow
Quality usa checkout completo.

## Evidência local de 05/10/2026

A branch incorporou `main` no merge
`921b953741b10c3e0bec185013a7434a46495b77`. As evidências abaixo foram obtidas com
as alterações de implementação ainda no working tree; o SHA identifica a base,
não um commit da implementação. Não houve push nem execução remota dos workflows.

| Gate | Resultado observado |
| --- | --- |
| `check.py --smoke --pytest` | Passou com Node 14.0.0 e 24.20.0; Python 3.14.8 / pytest 9.1.1 |
| Long running Linux | Cinco cenários passaram, incluindo supervisão e recuperação manual |
| Concorrência de 12 módulos | Stress de 120 segundos no Node 14: 1.308 consultas e 51.276 trocas atômicas; zero compensação ou cancelamento espontâneo e 12 locks liberados após cancelamento explícito |
| RSpec | 18 grupos passaram com Ruby 3.4.10 / RSpec 3.13 |
| Rails | Passou com Ruby 3.4.10, Rails 8.1.4 e Minitest 5.25.4 |
| JUnit | Passou com Java 27, Maven 3.9.9, JUnit 5.11.3 e Surefire 3.5.4 |
| Angular 9 e 18 | Seis grupos por versão passaram; app Node 12.22.12 e 22.23.1, coletor Node 24.20.0, Chrome 154.0.8037.57 |
| Claude Mod | Diretório e manifesto válidos; 28 testes passaram no Claude Code 2.1.289 |
| Instalação local por marketplace | Exportação das fontes deste checkout, config Claude temporária e cache instalado com digest idêntico; list/start/status/cancel e limpeza autenticada passaram sem `--plugin-dir` |
| Rollout/rollback | Passou com Node 14.0.0 e 26.7.0 |
| PowerShell/C# | AST dos scripts e compilação do host passaram em PowerShell 7.4.7 no Linux; sem execução Win32 |
| Workflows | `actionlint` passou para Quality, Mod integration e Windows |
| Segredos | Gitleaks 8.30.1 passou na árvore e no histórico de 52 commits |
| Revisões | Achados de estado final, prova Windows, fontes serializadas, controles de lote e ownership corrigidos e conferidos |

### Soak com o runtime final

`node scripts/check-soak.mjs 900` passou com Node 26.7.0 e Claude Code 2.1.289:

```json
{
  "startedAt": "2026-10-05T10:28:28.732Z",
  "endedAt": "2026-10-05T10:43:32.832Z",
  "durationSeconds": 904.1,
  "queries": 32,
  "maxQueryMs": 1090,
  "sha": "921b953741b10c3e0bec185013a7434a46495b77",
  "dirty": true,
  "runtimeDigest": "71d3c46ca615b801c8f3419e963f9c44a32b0efa9f0ecc5ed236d72f063ade4e",
  "status": "completed",
  "resolved": 2,
  "exitCode": 0,
  "lockReleased": true,
  "workerGone": true,
  "commandGone": true
}
```

Cada consulta executa um novo `claude -p` com o mesmo owner, sem persistência de
conversa, configurações pessoais ou requisição ao modelo. A fixture permanece
em 1/2 sem saída até liberação, enquanto o heartbeat avança. O script confere
runId e timestamps, libera após 900 segundos, exige 2/2, exit 0 e duração final
fixa, e só remove seu namespace após comprovar a limpeza. O digest cobre
`runner`, `runtime`, `hooks`, bootstraps e manifesto e deve permanecer igual do
início ao fim. Uma execução anterior com fontes alteradas durante o teste foi
rejeitada por esse gate e não conta como aceite do runtime final.

Consultas do Mod têm limite de 5 segundos no Linux e 15 no Windows; início tem
60 segundos. O cliente de soak usa 10 segundos por consulta e 65 para início.
Nenhum desses limites interrompe automaticamente uma suíte longa.

## Painel real e limites do aceite

O Claude CLI 2.1.289 foi aberto em uma janela Ghostty dedicada, com renderer
fullscreen, tmux e um projeto público sintético. O plugin foi carregado por
`--plugin-dir`; a configuração e o owner eram exclusivos da fixture. Foram
observados cadastro atualizado por polling, execução explícita, persistência
dos jobs após reiniciar o cliente, ajuda por teclado e cancelamento individual
sem interromper o módulo irmão.

Na repetição com o runtime final, os 12 módulos permaneceram ativos por 687
segundos, com os mesmos runIds, inclusive após encerrar o cliente. Um cliente
com outro owner viu somente o catálogo, sem herdar jobs. `/clear` mudou esse
owner e manteve intactas as execuções do owner anterior. O cancelamento
explícito final comprovou as 12 árvores vazias, workers ausentes e locks
liberados antes de retirar somente os namespaces da fixture.

Uma execução inicial de 12 módulos revelou cancelamento espúrio após uma troca
atômica normal de snapshot entre stat e open. A regressão determinística
reproduziu a mesma mensagem e a correção vincula o descritor ao arquivo atual
antes de ler os bytes, repetindo a leitura em trocas legítimas. A regressão de
substituição transitória de um ancestral por link também passou. O stress
concorrente da tabela acima foi repetido na fonte corrigida.

As capturas abaixo vieram diretamente do compositor Wayland, restritas ao painel
e inspecionadas para não publicar caminhos pessoais, histórico ou credenciais:

| Estado real | Captura |
| --- | --- |
| Nenhum módulo ativado | [modules-v2-empty.png](assets/modules-v2-empty.png) |
| Um módulo, com ID e linguagem | [modules-v2-one.png](assets/modules-v2-one.png) |
| Dois módulos da mesma linguagem e ação Todos | [modules-v2-two.png](assets/modules-v2-two.png) |
| Scroll até o último de 12 módulos | [modules-v2-twelve.png](assets/modules-v2-twelve.png) |
| AbovePrompt limitado a três módulos e nove restantes | [modules-v2-summary.png](assets/modules-v2-summary.png) |
| 4/4, pass/fail/skip, 100% e processo ainda ativo | [modules-v2-progress.png](assets/modules-v2-progress.png) |
| Total desconhecido, sem percentual inventado | [modules-v2-unknown.png](assets/modules-v2-unknown.png) |
| Zero testes, distinto de total desconhecido | [modules-v2-zero.png](assets/modules-v2-zero.png) |

Tab selecionou Buttons nativos e Enter acionou ajuda/cancelamento. Ctrl+X seguido
de Tab cicla o foco entre composer e painel no host; com uma única pane já
focada, retorna ao composer. Escape fechou o painel sem cancelar jobs. Captura
não é substituto de teste funcional, e árvore do test kit não é captura real.

O harness cobre as superfícies terminal e desktop, polling, callbacks antigos,
logs fixados por ID/runId, colisão de comando e resumo limitado a três módulos.
Ele não comprova pixels nem navegação real no Claude Desktop. `/clear` foi
observado no CLI; `/resume` de conversa, branch e hot reload completo ainda
precisam de aceite próprio. A recarga automática do hook de duração foi
observada, mas não equivale a toda a matriz de hot reload. Reiniciar um cliente
com o mesmo owner não comprova `/resume` de uma conversa persistida.

## Windows e CI posteriores

O usuário informou que Windows será disponibilizado posteriormente. O gate
[check-windows.ps1](../scripts/check-windows.ps1) e o workflow
[Windows](../.github/workflows/windows.yml) estão preparados para PowerShell
5.1/7 e Node 14/24, com Node 12 separado para o aplicativo. No ambiente nativo:

```powershell
# Execute uma vez em Windows PowerShell 5.1 e outra em PowerShell 7:
.\scripts\check-windows.ps1 -NodePath C:\tools\node24\node.exe -ProjectNode C:\tools\node12\node.exe
```

O gate recusa sistemas não Windows e verifica argv literal, DACL privada,
contenção por Job Object, filhos/netos, cancelamento, compensação por perda do
broker, `.cmd` e runtimes separados. Sintaxe e provas sintéticas no Linux não
comprovam esses comportamentos nativos. O aceite Windows e o aceite real do
Claude Desktop permanecem pendentes. Os workflows foram verificados localmente;
resultados de CI só podem ser registrados após execução remota.

Os registros [VERIFICATION.md](../VERIFICATION.md) e
[docs/VERIFICATION.md](VERIFICATION.md) preservam evidências históricas da v1,
identificadas por seus próprios SHAs. Não são instruções nem aceites da v2.
