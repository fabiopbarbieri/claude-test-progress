# Validação do coletor e do painel

O coletor e a demo requerem Node 14.0.0 ou superior. O bootstrap Unix usa Bash;
o bootstrap Windows usa PowerShell. Python, Ruby, Java, Maven, Karma e Rails
pertencem às suítes que o usuário seleciona, não às dependências globais do plugin.
O frontend configurado ainda resolve Node e a `.nvmrc` do projeto. Views e system
tests Rails usam backend; estes checks não demonstram Selenium nem frontend
agnóstico de runtime.

## Checks rápidos e ferramentas opcionais

```bash
# Somente Node; fixtures temporárias, sem frameworks:
node tests/collector/lock-race.mjs
node tests/collector/maven.mjs
node tests/collector/isolation.mjs
node tests/collector/workspace.mjs

# Verificação de fontes + os checks acima; este script de desenvolvimento usa Python:
python3 scripts/check.py

# Apenas quando quiser verificar o adaptador Python:
python3 scripts/check.py --smoke
# Requer pytest no ambiente Python escolhido:
python3 scripts/check.py --smoke --pytest

# Integração Linux: silêncio, rotação, cancelamento e perda do worker:
python3 scripts/check-long-running.py

# Claude instalado separadamente; nenhum modelo/chave de API é necessário:
claude plugin validate .
claude plugin test .
```

`isolation.mjs` executa o coletor por caminho absoluto com `PATH` vazio. Confirma
que os executáveis Python/Ruby/Java/Maven/Karma/Rails estão ausentes, executa as
duas lanes da demo e seleciona um comando `python3` inexistente. O resultado deve
identificar o comando e `ENOENT`, sem inventar testes ou validar a configuração
inválida da lane não selecionada. É uma prova Linux do núcleo via CLI Node;
não elimina Bash do bootstrap Unix nem PowerShell do Windows.

O gate `scripts/check-karma.py` requer somente as ferramentas da suíte Angular
selecionada: Node do coletor, Node do aplicativo e Chrome. Ele instala a fixture
com lockfile em diretório temporário, sem alterar manifests do plugin. No cenário
de cancelamento, o transporte polling é explícito: o
[cliente oficial do Karma](https://github.com/karma-runner/karma/blob/v6.4.4/client/karma.js)
pode acumular 50 resultados antes do upgrade para WebSocket. A fixture executa
50 testes reais de TestBed e deixa o 51º pendente; o gate exige `cancelled`,
50/51, nenhuma falha e `totalStable: false`. Assim, um término completo antes
do cancelamento falha no check. Os cenários normais preservam os transportes
padrão e seus resultados originais.

`workspace.mjs` inicia e cancela comandos Node reais em projetos com somente
backend ou somente frontend. `start --lane all` inicia apenas as suítes habilitadas
em `.claude/test-progress.json`; uma suíte omitida, `null`, `false` ou com
`enabled: false` não aparece entre os botões de início. Não há descoberta automática
por nomes de pastas. Uma suíte habilitada inválida continua falhando ao ser selecionada.
O painel conserva logs/cancelamento de uma execução ativa ou órfã mesmo se sua
configuração for removida. Consultar estado, logs e cancelar não exige configuração
válida nem resolve ferramentas de suítes. O teste confirma a saída dos processos
da fixture e a liberação dos locks.

O painel oculta o sufixo “total parcial”; os diagnósticos de texto mantêm essa
distinção. Suítes ausentes também ficam fora do resumo acima do prompt. O cadastro
geral de módulos por usuário/workspace é uma evolução separada; esta mudança mantém
os contratos e as identidades backend/frontend existentes.

O workflow [Mod integration](../.github/workflows/mod-integration.yml) instala
`@anthropic-ai/claude-code@2.1.289` em um prefixo temporário. Node 24 atende ao
instalador do CLI; o requisito mínimo do coletor continua Node 14.0.0. Não são
adicionados manifests nem dependências ao plugin. O runner não recebe API keys.
Fontes: [instalação oficial](https://code.claude.com/docs/en/setup#install-with-npm)
e [test kit de Mods](https://code.claude.com/docs/en/plugins/mods/test).

## Regressões de concorrência e Maven

`lock-race.mjs` intercala um segundo **processo** no instante anterior à remoção
física do lock. Confere recuperação de lock antigo e liberação normal, identidade
do proprietário e recusa de recuperar automaticamente uma seção crítica abandonada.
O teste da recuperação falhou na base: o segundo processo conseguiu reservar a
lane e a primeira remoção apagou sua reserva.

Agora todos os criadores e removedores de `<lane>.lock` adquirem antes
`<lane>.mutation` com `mkdir` atômico. A exclusão mútua cobre leitura, decisão,
remoção e criação. Uma releitura de `claim.json` isoladamente não fecharia a
janela TOCTOU. A espera por concorrência é limitada a um segundo por operação;
nenhum limite é imposto à duração da suíte.

Se um processo morrer **dentro** dessa seção curta, `<lane>.mutation` permanece.
O coletor falha de modo conservador, com indicação de recuperação manual. Esse
diretório não expira por idade ou PID, pois a recuperação concorrente do próprio
guard recriaria o defeito. Para recuperar:

1. Pare os clientes que consultam ou alteram **essa sessão/lane**, inclusive polling
   do Claude, e impeça novas consultas durante a manutenção.
2. Verifique o snapshot, claim e identidades dos processos dessa execução. Encerre
   ou espere seus workers/comandos usando o protocolo de cancelamento disponível;
   não sinalize um PID presumido nem remova locks de outras sessões.
3. Somente depois de confirmar ausência de participantes dessa lane, remova o
   diretório **vazio** `<lane>.mutation` com `rmdir`. Se a exclusão mútua não puder
   ser comprovada, mantenha a lane bloqueada.
4. Consulte `status` e siga eventual recuperação de comando órfão antes de iniciar
   outra execução. Não apague snapshots ou claims para contornar a recuperação.

Não execute clientes de versões diferentes simultaneamente na mesma sessão durante
uma atualização: versões antigas não participam dessa seção crítica.

`maven.mjs` reproduz duas classes de mesmo FQCN em módulos distintos: 2 testes/1
falha e 3 testes/0 falhas. A base retornava 3/0; agora retorna 5/1. Banners de goal
Maven delimitam módulos e execuções, inclusive Surefire versus Failsafe. Resumos
sem classe e a seção `Results:` não duplicam os contadores. O total global continua
desconhecido até uma conclusão completa; erro/cancelamento não confirma o total.
Logs truncados, sem banners, ou intercalados por builds Maven paralelos continuam
ambíguos para esse parser textual. Prefira eventos com scopes explícitos para
identidade confiável nessas situações; este check não é aceite de um app Maven real.

## Soak real de 15 minutos

```bash
node scripts/check-soak.mjs 900
```

O script cria um projeto Node sintético isolado. `/test-progress backend --text`
inicia a execução por um processo real do Claude. Cada consulta posterior é um
novo processo `claude -p`, com o mesmo ID, sem persistência de conversa e sem
configurações de usuário. O script remove variáveis de autenticação Anthropic do
ambiente passado ao Claude. Não solicita texto ao modelo.

A fixture emite 1/2 e permanece silenciosa até o arquivo de liberação. A cada
30 segundos, o script consulta o Mod e confronta o snapshot persistido: mesmo
runId, estado `running`, um resultado, timestamps de saída/progresso inalterados
e heartbeat avançando. Cada consulta Claude tem limite de 10 segundos, e o
coletor chamado pelo Mod mantém seu limite de 5 segundos. A suíte não recebe
timeout por causa desses limites.

Após pelo menos 900 segundos, o script libera a fixture, exige 2/2 e exit 0,
reabre o estado final e confere duração fixa, ausência do comando/worker e lock
liberado. Remove somente o projeto e namespace dessa fixture. Uma falha de
limpeza deixa o estado para inspeção e retorna erro. Use 10 segundos apenas para
verificar o script rapidamente; essa execução não é um soak de 15 minutos.

O resumo em JSON inclui versões, SHA, duração e maior tempo de consulta, sem
caminhos locais, IDs de sessão, credenciais ou logs de aplicativos. O registro da
execução revisada fica em [VERIFICATION.md](../VERIFICATION.md).

## Matriz do painel e evidência visual

| Cenário | Evidência automatizada |
| --- | --- |
| Total conhecido/parcial e desconhecido | `tests/panel.test.ts`, superfícies terminal e desktop |
| Zero testes, pass/fail/skip | `tests/panel.test.ts`; demo real com duas lanes no isolamento |
| 100% com processo ainda em execução | `tests/panel.test.ts`, status e exit continuam distintos |
| Logs, ocultar logs, cancelar | Callbacks reais do Mod disparados pelo test kit |
| Fechar/reabrir | Desmontagem/remontagem do painel sem `start` ou `cancel` implícito |
| Retomar mesmo owner / trocar owner | Consulta recarrega snapshot do owner correto |
| Registro e polling automático | `tests/activity.test.ts`, relógio controlado e consultas de 5 s sem iniciar suíte |
| Consulta falha e retry | `tests/activity.test.ts`, sem reiniciar a suíte |
| Silêncio e perda do worker | `scripts/check-long-running.py`; contadores e ação segura no painel |
| Persistência com clientes encerrados | Soak com processos Claude reais e estado em disco |

Os testes nativos montam a árvore e acionam callbacks. **Não verificam pixels,
legibilidade, foco real, teclado, scroll ou o comportamento real de `/resume`,
`/clear` e hot reload.** Para aceite visual, abra o Claude interativo em projeto
sintético, carregue este plugin e capture o painel real durante os estados acima.
A captura deve mostrar apenas dados públicos; não publique nome de conta, histórico,
caminhos pessoais, credenciais ou aplicativos autenticados. Não gere imagens como
substituto de screenshot.

As capturas reais inspecionadas de perda do worker e cancelamento ficam em
[panel-worker-loss.png](assets/panel-worker-loss.png) e
[panel-cancelled.png](assets/panel-cancelled.png). Elas foram obtidas pelo
compositor Wayland e contêm somente o painel da fixture sintética. Versão,
proveniência, ciclos interativos observados e limites estão em
[VERIFICATION.md](../VERIFICATION.md). Teclado/foco/scroll completos do dock
continuam pendentes; capturas e harness não substituem esse aceite. A integração
de links/imagens no README pertence à frente de documentação.
