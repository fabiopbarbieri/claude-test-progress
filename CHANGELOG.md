# Changelog

A versão em `.claude-plugin/plugin.json` identifica o plugin distribuído.
`package.json` acompanha esse valor; o catálogo não declara outra versão.

## [Unreleased]

## [0.6.0] - 2026-10-06

Adapter para Playwright Test, log do painel com scroll e cores do runner,
Minitest 6 no Rails e README renovado.

### Documentação

- README mais curto, com logo nova e imagem fiel do painel com projetos
  fictícios no lugar da capa ilustrativa.

### Adapters

- Playwright Test: reporter opt-in `adapters/playwright/reporter.cjs` para
  `@playwright/test` 1.44+, por `--reporter` ou pelo `playwright.config`. Conta
  cada teste uma vez após retries (`flaky` e `test.fail()` esperado contam como
  passed) e usa o total do plano desde o início. Gate real em Chromium headless
  com `scripts/check-playwright.py`. `/test-progress paths` mostra o caminho.

### Painel

- Log com scroll: a roda do mouse sobre o painel rola o log aberto, numa janela
  de 12 linhas; nas bordas o painel volta a rolar. `↓` volta ao fim, que segue
  a execução ao vivo. O cabeçalho mostra o trecho (`linhas 26–37 de 40`). O
  coletor passa a guardar as últimas 200 linhas legíveis do log (antes 40).
- O log aberto no painel mostra as cores do runner (SGR: 16, 256 e truecolor,
  negrito, esmaecido). Movimentos de cursor e outros controles continuam
  descartados; `--text` segue sem cor.
- O coletor pede cor por módulo: `FORCE_COLOR=1` sempre, `MAVEN_ARGS` com
  `-Dstyle.color=always` para Maven 3.9+, `SPEC_OPTS` com `--force-color` para
  RSpec; o adaptador Rails libera a cor do reporter do Rails. `NO_COLOR` ou um
  `FORCE_COLOR` explícito desligam.

### Rails

- Minitest 6 aceito (`>= 5.20 e < 7`); antes era recusado antes de executar
  testes. Job de CI Rails 8.1 com Minitest 6.0.6. No Minitest 6 o carregamento
  de plugins é opt-in, e o gate faz esse opt-in no boot da fixture.

## [0.5.0] - 2026-10-06

Windows nativo leve e aceito: helper compilado, supervisão por eventos, `status`
sem PowerShell e aceite visual do Mod no Windows 11.

### Windows

- Aceite registrado no Windows 11 (VM): `check-windows.ps1` em PowerShell 5.1 e
  7 e aceite visual do Mod no Claude Code com pytest, unittest e `node --test`;
  detalhes em [WINDOWS](https://github.com/fabiopbarbieri/claude-test-progress/blob/test-progress--v0.5.0/WINDOWS.md#aceite-em-windows-11).
- Helper nativo: depois da primeira verificação da raiz privada, o Windows
  PowerShell 5.1 compila uma vez `WindowsProcessHost.cs` e `WindowsHelper.cs`
  em `helper-<hash>.exe`, que executa as chamadas de controle e é o broker de
  cada job (~15 MB e dezenas de ms, contra 67–81 MB e 0,3–1 s do PowerShell).
  Sem compilação possível ou com o helper bloqueado (AppLocker/WDAC), o
  PowerShell continua sendo usado; `TEST_PROGRESS_WINDOWS_HELPER=0` força esse
  caminho.
- Supervisão por eventos: o coordenador acompanha os workers que iniciou pelo
  `ChildProcess` (o handle aberto impede reuso do PID), e cada worker percebe o
  fim do coordenador pelo fechamento de um pipe no stdin. Com jobs parados, o
  plugin não abre nenhum processo de controle.
- `status`, `list` e `logs`: um job com heartbeat recente (até 15 s) e PID do
  worker existente é lido como vivo sem processo de controle, e a verificação
  completa da DACL é reusada por até 10 min; `start` e `cancel` sempre
  verificam.
- Sem o helper, o PowerShell fica mais leve: a DLL de `WindowsProcessHost.cs`
  fica em cache na raiz privada (só é carregada com dono confiável), raiz e
  diretório do workspace são protegidos numa única chamada, e worker e
  coordenador reusam por 2 s uma confirmação positiva de que o outro está vivo.
- `-ExecutionPolicy Bypass` em cada PowerShell aberto pelo plugin e pelo Mod:
  funciona com o padrão `Restricted` do Windows cliente, sem gravar política.
  Group Policy continua prevalecendo.
- Prazos de preparação e de confirmação do início crescem 1 s por módulo no
  Windows (até 50 s e 40 s); o broker consulta a cada 250 ms e o coordenador a
  cada 500 ms.
- Logs com acentos corretos: cada linha da saída é lida como UTF-8 e, se não
  for UTF-8 válido, na code page ANSI do sistema (lida uma vez do registro).
  Python, Java e outras ferramentas usam essa code page com a saída
  redirecionada; antes apareciam `�` no lugar dos acentos.
- `scripts/bench-windows.ps1` mede latência do `status`, `start`/`cancel` e CPU
  com N módulos no Windows nativo.

Medido numa VM Windows 11 com 4 núcleos, antes e depois desta versão:

| Cenário | 0.4.0 | 0.5.0 |
| --- | --- | --- |
| CPU com 1 job parado | 77% | ~0% |
| CPU com 3 jobs e o painel aberto | 98–100% | 2–3% |
| Latência do `status` | 2–4 s | 80–140 ms |
| `start all` com 20 módulos | falhava por prazo | ~3 s |
| CPU com 20 jobs parados | — | 4,5–8% |

### Coletor

- `start` não é mais recusado quando coincide com a atualização do manifesto de
  outro lote (gate de milissegundos): reavalia o estado por até 1 s antes de
  recusar e, se recusar, informa o motivo.

### Mod

- Resultado, tempo e ações de cada módulo ficam sempre alinhados à direita; o
  nome ocupa o espaço livre e é cortado só quando falta largura. Antes, com o
  painel largo, o resultado colava no nome.
- Testes ignorados aparecem como `⊘ 2` (antes `↷2`, pouco legível em algumas
  fontes).

### Limites

- O aceite Windows foi feito numa VM; faltam máquina física, um app Angular 9
  real e o Claude Desktop.
- O helper não foi testado com AppLocker/WDAC ativos; o fallback para PowerShell
  está coberto por teste unitário.
- Cada job ativo usa ~77 MB de RAM, quase toda do worker Node.

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
