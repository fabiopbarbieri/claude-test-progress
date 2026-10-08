# Windows · PowerShell 5.1 e 7

[Início](README.md) · [Uso](docs/USAGE.md) ·
[Compatibilidade](docs/COMPATIBILITY.md) · [Diagnóstico](docs/TROUBLESHOOTING.md)

Implementação destinada a **Windows 10/11** e **Windows Server 2019+**,
com Windows PowerShell **5.1** ou PowerShell **7**. Claude Code requer **2.1.295+**
e Mods permitido no ambiente. O coletor usa Node **14.0.0+** já instalado.
Angular 9 e suas dependências permanecem como estão.

**Estado de aceite:** implementação e gate nativo estão presentes, e a matriz
[Windows modules](.github/workflows/windows.yml) roda na CI hospedada. Há um
aceite registrado no Windows 11 nativo, numa VM (detalhes em
[Aceite em Windows 11](#aceite-em-windows-11)). Faltam aceite numa máquina
física, com um app Angular 9 real e no Claude Desktop.

O cadastro usa `schemaVersion: 1` com `modules` e IDs seguros; o início é sempre
explícito, por ID ou `all`. Templates pessoais opcionais também usam schemaVersion 1; somente workspace
ativa módulos. Consulte [cadastro e templates](docs/USAGE.md#configurar-seu-projeto).

## Abrir a partir de qualquer PowerShell

Instale pelo marketplace conforme o [README](README.md), ou mantenha um clone
completo em `C:\Tools\claude-test-progress` para usar os exemplos abaixo. Para
criar esse clone (Git e acesso SSH GitHub já configurados):

```powershell
git clone git@github.com:fabiopbarbieri/claude-test-progress.git 'C:\Tools\claude-test-progress'
claude plugin validate 'C:\Tools\claude-test-progress' --strict
```

No PowerShell 5.1 ou 7, entre no diretório do app/worktree e execute:

```powershell
& 'C:\Tools\claude-test-progress\launch.ps1'
```

Não há requisito de Bash, WSL, npm install ou execução como administrador.
O launcher usa o Claude encontrado no PATH. `CLAUDE_BIN` é opcional quando
você já dispõe de um binário Claude em outro local. Ele confere a versão e
carrega `--plugin-dir`; não atualiza o Claude instalado.

Também é possível carregar diretamente:

```powershell
claude --plugin-dir 'C:\Tools\claude-test-progress'
```

No Claude:

```text
/test-progress help
/test-progress paths
/test-progress list
/test-progress start web
/test-progress status all --text
/test-progress logs web --text
/test-progress cancel all --text
/test-progress status --text
```

`start web` pressupõe um módulo `web` habilitado no workspace. `start all`
seleciona todos os habilitados; listar e consultar não executa comandos. IDs
`frontend`/`backend` não escolhem runtime nem adapter.

O Mod detecta o caminho Windows da sessão e chama o bootstrap PowerShell.
Por padrão usa o Windows PowerShell 5.1 do `SystemRoot`, mesmo quando aberto
em um terminal PowerShell 7. Para usar explicitamente o engine 7 nos helpers:

```powershell
$env:TEST_PROGRESS_POWERSHELL = (Get-Command pwsh.exe -CommandType Application).Source
& 'C:\Tools\claude-test-progress\launch.ps1'
```

Essa variável fica no processo atual e seus filhos; não é gravada globalmente.

As operações do coletor no Windows usam chamadas curtas de controle (diretório
privado, identidade e estado de processos) e um broker por job. Depois da
primeira verificação da raiz privada do estado, em TEMP, o Windows PowerShell
5.1 compila uma vez `WindowsProcessHost.cs` e `WindowsHelper.cs` em
`helper-<hash>.exe` nessa raiz; o hash vem do código-fonte. O helper executa as
mesmas ações e validações de `runtime/windows-process.ps1` em dezenas de
milissegundos e ~15 MB, e também é o broker de cada job. Ele só é usado como
arquivo comum, sem link, dentro da raiz com DACL privada verificada, a mesma
confiança dada aos arquivos de job que definem os comandos. Se não puder ser
compilado (nova tentativa após 1 h) ou iniciado, por exemplo por AppLocker ou
WDAC, o plugin usa o PowerShell como antes; `TEST_PROGRESS_WINDOWS_HELPER=0`
força esse caminho. No caminho PowerShell, a DLL compilada de
`WindowsProcessHost.cs` fica em cache na mesma raiz e só é carregada se o dono
for o usuário, Administrators ou SYSTEM. Cada chamada é
limitada por padrão a **7500 ms** no 5.1 e **15000 ms** no 7 (`pwsh.exe`), que
inicia mais devagar a frio. Se ainda houver `ETIMEDOUT` nessas chamadas, defina o
limite para o engine em uso; a variável vale para os dois:

```powershell
$env:TEST_PROGRESS_POWERSHELL_TIMEOUT_MS = '20000'
```

Aceita inteiros de 1000 a 30000; valor inválido gera erro, sem voltar ao
padrão em silêncio. O limite vale por chamada, e uma operação faz várias. Por
isso valores altos podem esbarrar no prazo de preparação do lote (30 s mais 1 s por módulo), que
aborta o start sem executar comandos, e no tempo que o Mod espera pelo coletor
(15 s em status/cancel/logs, 60 s em start). Se o Mod esgotar o tempo, consulte
`status` antes de repetir a ação.

Os scripts usam `-NoProfile`, parâmetros escalares no bootstrap e UTF-8 BOM
para leitura correta em 5.1. Cada PowerShell que o plugin abre recebe
`-ExecutionPolicy Bypass`, que vale só para aquele processo: funciona com o
padrão `Restricted` do Windows cliente sem gravar política. O plugin não muda
`ExecutionPolicy` persistente, assinatura ou políticas da organização; política
definida por Group Policy continua prevalecendo e pode bloquear os scripts.

Os logs são gravados em UTF-8. Cada linha da saída dos testes é lida como
UTF-8 e, quando não é UTF-8 válido, na code page ANSI do sistema (`ACP` em
`HKLM\SYSTEM\CurrentControlSet\Control\Nls\CodePage`), que é a usada por
Python e Java com a saída redirecionada. Ferramentas que escrevem na code page
OEM do console (como 850) ainda podem mostrar acentos trocados.

## Descoberta de Node e nvm-windows

O coletor procura um Node 14+ executável no PATH. Se necessário, considera
somente versões já instaladas no nvm-windows. A descoberta não chama
`nvm use`, `nvm install` nem modifica junctions, aliases ou PATH global.

- **nvm-windows 1.x:** lê `NVM_HOME`, o `root:` de `settings.txt` e o alvo
  existente de `NVM_SYMLINK`; inventaria diretórios de versões locais.
- **nvm-windows 2.x:** lê raízes de instalação no Registro do usuário/máquina
  e considera o diretório padrão em `LOCALAPPDATA`. Shims 2.x conhecidos são
  identificados sem executá-los, evitando que o probe dispare instalação
  automática. A seleção usa diretamente binários já instalados.
- **Módulo `node-project`:** procura a `.nvmrc` mais próxima, subindo do `cwd`
  do módulo. Versão ausente ou seletor não suportado interrompe o preflight.
  Sem `.nvmrc`, prefere Node do PATH. O diretório escolhido fica primeiro
  somente no PATH do processo selecionado. `inherit` não consulta `.nvmrc`
  nem executa o resolvedor do aplicativo.
- **Coletores e app separados:** `.nvmrc` com `12.22.12` pode manter Angular 9
  em Node 12 e o coletor em outro Node 14+. Isso não instala versões ausentes.

Seletores locais: versões numéricas, `node`/`stable` e `lts/*`/`lts/<nome>`.
LTS é identificado pelo próprio binário (`process.release.lts`), sem tabela
fixa nem consulta remota. `current`/`default` no layout 1.x usam o alvo atual
de `NVM_SYMLINK`; não equivalem ao mecanismo de aliases do `nvm.sh` Linux.
Aliases arbitrários não são executados nem adivinhados. Na versão 2.x, várias
raízes locais podem existir; inventário não afirma qual shim está ativo.

Para inspecionar sem iniciar um job:

```powershell
& 'C:\Tools\claude-test-progress\runtime\resolve-node.ps1' -Mode collector -Cwd $PWD.Path
& 'C:\Tools\claude-test-progress\runtime\resolve-node.ps1' -Mode project -Cwd $PWD.Path
```

JSON mostra caminho, versão, origem e `.nvmrc`. `TEST_PROGRESS_NODE` continua
como override opcional do coletor; se inválido, gera erro sem fallback.

## Configuração Java/Spring e Angular 9

Use [config.windows.example.json](config.windows.example.json) como modelo de
`<diretório da sessão>\.claude\test-progress.json`. O exemplo pressupõe Maven
na raiz e Angular em `frontend`; ajuste cada `cwd`. Para Angular sozinho,
declare somente o módulo Angular com `cwd: "."` e `runtime: "node-project"`.
`start all` requer preflight de todos os módulos habilitados, sem exigir outra
linguagem. Iniciar um ID ignora ferramentas dos não selecionados. Python, RSpec
e Rails (inclusive views/system) normalmente usam `runtime: "inherit"`.

Cada argumento é uma string no JSON. Escape barras invertidas (`\\`) e use
caminhos absolutos de `/test-progress paths` para os adaptadores; não escreva
`$env:CLAUDE_PLUGIN_ROOT`, `${CLAUDE_PLUGIN_ROOT}`, `%CLAUDE_PLUGIN_ROOT%` ou `~`
no argv esperando expansão. O JSON não é interpretado como PowerShell ou shell.

O módulo Angular usa `node` e o Angular CLI **local** em `node_modules`, sem resolução
por npx. A `.nvmrc` deve indicar o runtime adequado ao app; a matriz de
suporte do Angular 9 lista Node 10/12. O plugin não exige atualizar Angular,
TypeScript, Karma, Jasmine ou lockfile. Veja [ANGULAR9.md](ANGULAR9.md) para integrar o reporter.
`adapter: "events"` requer esse reporter; `karma` é o fallback por logs.

O módulo Maven com `runtime: "inherit"` aceita `.\mvnw.cmd`; Maven instalado também pode usar `mvn.cmd`.
O listener JUnit 5 opcional pode ser compilado pelo Maven no Windows:

```powershell
mvn.cmd -f 'C:\Tools\claude-test-progress\adapters\junit\pom.xml' -DskipTests package
```

Esse é um comando de build para o ambiente Windows; a execução nativa ainda
precisa ser validada nessa plataforma. O JAR
resultante fica em `adapters\junit\target`; integração/compatibilidade do JUnit
do app continua opt-in conforme [adapter JUnit](adapters/junit/README.md).

## CLI e bootstrap por ID

A CLI usa `--module`; o bootstrap PowerShell usa o parâmetro escalar `-Module`.
Ações disponíveis: `start`, `list`, `status`, `logs` e `cancel`, selecionando ID
ou `all`. Exemplo, depois de cadastrar `web`:

```powershell
& 'C:\Tools\claude-test-progress\scripts\run-collector.ps1' `
  -Action start -Cwd $PWD.Path -Owner 'owner-conhecido' -Module web
& 'C:\Tools\claude-test-progress\scripts\run-collector.ps1' `
  -Action status -Cwd $PWD.Path -Owner 'owner-conhecido' -Module all
```

`-Config`/`--config` é override somente da CLI/bootstrap, relativo ao workspace.
Não altera namespace ou owner; o painel usa o arquivo default da sessão.
Cada fonte tem limite de 1 MiB. command/env substituem campos inteiros do
template, sem merge profundo. Discovery não publica command/env nem executa
resolvedores; preflight valida somente selecionados e captura o comando Windows.

O início conjunto reserva todos os módulos e aguarda barreira: preparação 30 s,
confirmação 10 s e aborto 10 s; a chamada start do Mod tem limite de 60 s. No
Windows, cada módulo selecionado acrescenta 1 s à preparação (até 50 s) e à
confirmação (até 40 s), porque cada um inicia seu próprio broker PowerShell.
A suíte não tem deadline. Falha normal de teste não aborta outros módulos;
falha de infraestrutura pode compensar o lote. Sem término comprovado, os locks
são conservados. Status/logs/cancel de jobs autenticados permanecem disponíveis
com configuração removida/inválida.

## Comandos e cancelamento

Executáveis `.exe`/`.com` recebem argumentos literais. `.cmd`/`.bat` são
resolvidos no cwd/PATH/PATHEXT e executados por `cmd.exe /d /s /v:off /c`, com
quoting próprio. O contrato aceita argv simples, inclusive espaços; expansões
e controles de shell são recusados antes dos locks. Em wrappers batch,
caracteres como `%`, `!`, `&`, `|`, `<`, `>`, `^`, parênteses e aspas não são
aceitos. Prefira `node` + entrypoint JS para o Angular, mantendo argumentos
literais. Para scripts PowerShell próprios, configure o executável
`powershell.exe` ou `pwsh.exe` com `-File` e o caminho do script.

O broker coloca o comando e seus descendentes em um **Windows Job Object**,
atribuído na criação do processo antes de executá-lo. O encerramento é
confirmado quando não há processos ativos no Job. A prova fica em sidecar
atômico privado; fechamento normal libera o módulo e conserva exit code.
O sidecar de **prova Windows tem formato próprio (`schema: 1`)**, independente
do `schemaVersion` do cadastro, do estado de módulos e da resposta da CLI.

Cancelamento no Windows encerra o Job inteiro de forma forçada: não oferece
um SIGTERM gracioso equivalente ao Linux. Recuperação exige identidade do
broker por PID, instante de criação e SID, consultada por handle; nenhum PID
presumido é encerrado. Fechar o último handle do Job encerra seus descendentes.
O estado da árvore é consultado separadamente no Job nomeado, incluindo a
sessão Windows; presença ou ausência do broker não substitui essa consulta.
Se a contenção/identidade não puder ser comprovada, o módulo fica bloqueado para
recuperação manual. Snapshots e jobs ficam em TEMP com DACL privada do usuário
e SYSTEM; não se confia apenas nos modos POSIX 0700/0600 no Windows.

WSL mantém o caminho Linux quando Claude e toolchain rodam dentro dele. Não
misture executáveis Windows com a recuperação Linux por `/proc`.

## Atualizar e remover

Na sessão responsável por cada job, consulte `/test-progress status --text`.
Aguarde o término ou peça `/test-progress cancel all --text` e consulte de novo
até confirmar o estado terminal, sem recuperação pendente, antes de trocar a
instalação.

No PowerShell, para o escopo `user`:

```powershell
claude plugin marketplace update test-progress-marketplace
claude plugin update test-progress@test-progress-marketplace --scope user
```

Aplique `/reload-plugins` no Claude ou reabra a sessão. Consulte novamente
`/test-progress paths` e ajuste os caminhos dos adaptadores na configuração do
app, inclusive o reporter Karma. Para remover, após encerrar todos os jobs:

```powershell
claude plugin uninstall test-progress@test-progress-marketplace --scope user
```

Use o escopo instalado, caso seja `project` ou `local`. Uninstall, reload e fechar
o painel não equivalem a encerrar a árvore detached. O estado/logs do coletor
ficam em TEMP, fora do cache do plugin, e não têm limpeza comprovada por uninstall.
Retire também as referências aos adaptadores no app quando deixar de usá-los.
Veja o [procedimento completo](docs/USAGE.md#atualizar-com-jobs-encerrados).

## Gate nativo e matriz configurada

O gate [scripts/check-windows.ps1](scripts/check-windows.ps1) executa
[tests/windows/native.mjs](tests/windows/native.mjs) e recusa sistemas que não
sejam Windows. Execute separadamente no PowerShell 5.1 e no 7, com caminhos
para Node do coletor e Node do aplicativo já instalados:

```powershell
& 'C:\Tools\claude-test-progress\scripts\check-windows.ps1' `
  -NodePath 'C:\Tools\node14\node.exe' -ProjectNode 'C:\Tools\node12\node.exe'
```

A [matriz declarada](.github/workflows/windows.yml) combina PowerShell 5.1/7,
Node 14.0.0/24 do coletor e Node 12.22.12 do app. Ela pretende exercitar wrapper,
argv literal/caminhos com espaços, seleção/all, DACL privada, Job Object,
encerramento de pai/filho/neto, perda autenticada do broker, compensação,
configuração removida e runtimes separados, e roda na CI hospedada. Parsing ou
testes Linux não substituem as chamadas reais de DACL/Job Objects/prova de árvore
vazia, e a CI hospedada não substitui o aceite numa máquina Windows real.

## Aceite em Windows 11

Em 06/10/2026, numa VM Windows 11 (build 26200, QEMU com 4 núcleos e 4 GB,
política de execução no padrão `Restricted`), com o `main` em `c65c868`:

- `scripts/check-windows.ps1` passou em Windows PowerShell 5.1 e PowerShell
  7.6.6, com e sem o helper nativo.
- Aceite visual do Mod no Claude Code 2.1.291 (Windows Terminal, coletor em
  Node 24.21.0), com um app de teste de seis módulos: pytest 9.1.1 e unittest
  pelo [adaptador Python](adapters/python/README.md) (Python 3.12.10, inclusive
  skip, xfail, subtests, falhas e erro de coleta) e `node --test` com o adapter
  `exit`. Conferidos `list`, `start all` com o painel aberto, contagens e
  resultado final, logs com falhas e acentos, `cancel` individual sem processos
  restantes e o layout largo e estreito.

O aceite não cobre máquina física, Angular 9 nem o Claude Desktop.

## Fontes e evidências

[Validação e limites](docs/VALIDATION.md) · [Configuração e instalação](README.md).

O código usa [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects),
[CreateProcessW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw)
e [SetNamedSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-setnamedsecurityinfow).
Esses contratos explicam a implementação; não substituem uma execução em Windows.
