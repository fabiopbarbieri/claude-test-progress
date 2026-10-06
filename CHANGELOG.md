# Changelog

A versão em `.claude-plugin/plugin.json` identifica o plugin distribuído.
`package.json` acompanha esse valor; o catálogo não declara outra versão.

## [Não lançado]

### Windows

- Controle mais leve: a DLL de `WindowsProcessHost.cs` fica em cache na raiz
  privada do estado (só é carregada com dono confiável), raiz e diretório do
  workspace são protegidos numa única chamada, e worker e coordenador reusam
  por 2 s uma confirmação positiva de que o outro está vivo. Numa VM com
  4 núcleos e pwsh 7, um job ativo caiu de 77% para 14% de CPU, cinco jobs de
  100% para 39%, e o `start` de 1 módulo de 12 s para 5,6 s.
- `-ExecutionPolicy Bypass` em cada PowerShell aberto pelo plugin e pelo Mod:
  funciona com o padrão `Restricted` do Windows cliente, sem gravar política.
  Group Policy continua prevalecendo.
- `scripts/bench-windows.ps1` mede latência do `status`, `start`/`cancel` e CPU
  com N módulos no Windows nativo.
- Supervisão por eventos: o coordenador acompanha os workers que iniciou pelo
  `ChildProcess` (o handle aberto impede reuso do PID), e cada worker percebe o
  fim do coordenador pelo fechamento de um pipe no stdin. Com jobs parados, o
  plugin não abre mais nenhum PowerShell.
- `status`, `list` e `logs`: um job com heartbeat recente (até 15 s) e PID do
  worker existente é lido como vivo sem PowerShell, e a verificação completa da
  DACL é reusada por até 10 min; `start` e `cancel` sempre verificam. Com 3 jobs
  e o painel consultando a cada 1 s, a CPU caiu de 63% (pwsh 7) e 98% (5.1)
  para 2–3%, e o `status` de 1,2–3,3 s para ~80 ms.
- Prazos de preparação e de confirmação do início crescem 1 s por módulo no
  Windows (até 50 s e 40 s); o broker consulta a cada 250 ms e o coordenador a
  cada 500 ms. Com pwsh 7, 20 módulos iniciam juntos em 7,5 s.
- Helper nativo: depois da primeira verificação da raiz privada, o Windows
  PowerShell 5.1 compila uma vez `WindowsProcessHost.cs` e `WindowsHelper.cs`
  em `helper-<hash>.exe`, que executa as chamadas de controle e é o broker de
  cada job (~15 MB e dezenas de ms, contra 67–81 MB e 0,3–1 s do PowerShell).
  Sem compilação possível ou com o helper bloqueado (AppLocker/WDAC), o
  PowerShell continua sendo usado; `TEST_PROGRESS_WINDOWS_HELPER=0` força esse
  caminho.

## [0.4.0] - 2026-10-06

Painel redesenhado, adapter `exit`, skill de configuração e Mod alinhado à
documentação de Mods do Claude Code.

### Requisito

- Claude Code **2.1.289+** (antes 2.1.287+): o Mod usa `$.state`, `$.ui.panes` e
  `$.ui.close`, cobertos pelo test kit da CI nessa versão. Os launchers recusam
  versões anteriores.

### Skill

- `test-progress:configure`: o Claude cadastra suítes em `.claude/test-progress.json`
  (adapter e runtime por stack, caminhos absolutos a partir do plugin) e diagnostica
  os sintomas do painel, deixando o início dos testes com a pessoa.

### Mod

- Hooks em `hooks/register.tsx` (JSX nativo do Claude Code, tipado por `claude-code`).
- O que o painel e a faixa desenham fica em `$.state` (`test-progress.panel`), com
  contrato em `types/index.d.ts`: um hot reload preserva seleção de log, runs vistos
  e o Node do coletor, e as mudanças redesenham sem `$.ui.invalidate`.
- O desenho não grava mais estado: abrir o painel (posicionado), usá-lo ou mantê-lo
  visível durante o polling marca as execuções como vistas.

### Painel

- Erros quebram linha em vez de truncar e terminam numa próxima ação
  (`≡` abre o log; aviso de `adapter` quando nenhum evento foi reconhecido).
- Run encerrado mostra o resultado (`✓19 · 19 testes`), sem barra; a barra fina
  aparece só enquanto o módulo roda.
- A barra do topo resume módulos, execuções e falhas no lugar do título repetido.
- Botão `×` fecha o painel (nunca cancela runs); `×` no cabeçalho do log o recolhe.
- `/test-progress` sem argumentos alterna o painel entre aberto e fechado.
- O log omite linhas `@@TEST_PROGRESS@@` do protocolo e colapsa linhas vazias.

### Adapters

- Novo adapter `exit`: aceita eventos `@@TEST_PROGRESS@@` quando existirem e,
  sem eles, decide ✓/✗ só pelo exit code (contagem desconhecida). Serve para
  suítes sem integração, como `scripts/check.py` e `claude plugin test`.
  O painel mostra `exit 0` / `exit N` como resultado.

### Limites

- O hot reload preservando o painel e o botão `×` foram cobertos pelo test kit;
  o aceite visual em sessão real desta versão está pendente.
- O listener JUnit continua `0.3.0`: o artefato não mudou.
- `tsc` checa o Mod apenas onde o Claude gerou `.claude-plugin/types`; a CI não
  roda essa checagem. Windows nativo segue sem aceite registrado.

## [0.3.0] - 2026-10-05

Primeira versão pública do Test Progress.

### Recursos

- Módulos de teste declarados por workspace em `.claude/test-progress.json`
  (`schemaVersion: 1`), com IDs, rótulos, ordem, templates pessoais opcionais e
  runtime explícito: `inherit` ou `node-project` (Node e `.nvmrc` do app).
- Início explícito por ID ou `all`, com preparação em lote tudo-ou-nada,
  supervisão em segundo plano, consulta, logs e cancelamento por sessão.
- Painel minimalista: uma linha por módulo, com status por ícone e cor, barra,
  percentual, contadores e tempo; ações `▶` `■` `≡` e legenda em `?`. Em painéis
  estreitos o progresso desce para uma segunda linha.
- Faixa de uma linha acima do prompt com o que está rodando e as falhas ainda
  não vistas, e resposta textual completa com `--text`.
- Adaptadores: JUnit 5.14+ (listener para Java 17+ ou fallback Maven), Karma
  (reporter ou fallback), pytest e unittest, Ruby/RSpec e Rails/Minitest.
- Linux e WSL por Bash; Windows por PowerShell 5.1/7, com cancelamento da árvore
  de processos por Job Object.
- Estado privado por workspace e sessão, recuperação autenticada de jobs órfãos
  e bloqueio de novos starts diante de estado incompatível ou ilegível.
- Verificação de versão, changelog, SHA e CI do mesmo commit antes de publicar,
  com workflow manual de preparação somente leitura.

### Limites

- O coletor exige Node 14+. Python, Ruby, Java e Karma só são necessários
  conforme os módulos cadastrados; o plugin não instala runners nem browsers.
- Percentual é testes resolvidos sobre o total conhecido. 100% não comprova
  encerramento nem sucesso; confira estado, falhas e código de saída.
- Fixtures Rails de views/system usam `rack_test`; Selenium não tem aceite
  funcional. Windows nativo tem CI própria, ainda sem aceite registrado.
