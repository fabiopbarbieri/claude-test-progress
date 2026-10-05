# Guia de uso

[Início](../README.md) · [Compatibilidade](COMPATIBILITY.md) ·
[Diagnóstico](TROUBLESHOOTING.md) · [Windows](../WINDOWS.md)

O plugin executa comandos somente quando você solicita. Instale primeiro, confira
a demo e depois configure uma suíte finita do seu projeto. Nenhum runner ou
framework de teste é dependência global do mod.

## Instalar pelo marketplace próprio

No Claude Code, adicione o repositório e abra a instalação:

```text
/plugin marketplace add git@github.com:fabiopbarbieri/claude-test-progress.git
/plugin install test-progress@test-progress-marketplace
```

Selecione **Install** nos detalhes do plugin. O nome do marketplace é
`test-progress-marketplace`: este é um catálogo mantido por este projeto,
independente do catálogo oficial da Anthropic. A URL SSH exige acesso GitHub
configurado no seu computador.

Pelo terminal, os comandos equivalentes são:

```bash
claude plugin marketplace add git@github.com:fabiopbarbieri/claude-test-progress.git
claude plugin install test-progress@test-progress-marketplace
```

Ao fechar o painel de plugins, o Claude aplica as mudanças pendentes. Você também
pode usar `/reload-plugins`; se `/test-progress` ainda não estiver disponível,
reinicie o Claude Code no diretório do app. O fluxo segue a
[referência oficial de comandos de plugins](https://code.claude.com/docs/en/plugins/cli-reference).

Em uma sessão sem jobs ativos, comece sem tocar na suíte do app:

```text
/test-progress help
/test-progress paths
/test-progress demo
/test-progress status
```

A demo gera eventos sintéticos identificados como **DEMO** e ocupa as mesmas
áreas da sessão. Ao terminar, backend mostra 8/8 com uma falha deliberada (exit 1);
frontend mostra 12/12 com um ignorado (exit 0). Aguarde o estado terminal antes
de iniciar testes reais nessas áreas. Abrir o painel ou consultar o estado não
inicia testes reais.

### Carregar um checkout local

```bash
git clone git@github.com:fabiopbarbieri/claude-test-progress.git
cd claude-test-progress
claude plugin validate .
```

Depois, no diretório do seu app, abra uma sessão com o caminho absoluto do clone:

```bash
bash /caminho/absoluto/claude-test-progress/launch.sh
```

O launcher confere a versão do Claude e carrega o plugin com `--plugin-dir`.
Também pode usar `claude --plugin-dir /caminho/absoluto/claude-test-progress`.
Para PowerShell, consulte [WINDOWS.md](../WINDOWS.md).

## Configurar seu projeto

Crie **`.claude/test-progress.json` no diretório em que abriu a sessão**.
A integração é opt-in: revise o comando e adapte os diretórios ao seu app.
Por exemplo, Maven na raiz e Angular em `frontend`:

```json
{
  "schemaVersion": 1,
  "backend": {
    "command": ["./mvnw", "test"],
    "cwd": ".",
    "adapter": "auto",
    "env": {}
  },
  "frontend": {
    "command": ["node", "./node_modules/@angular/cli/bin/ng", "test", "--watch=false", "--browsers=ChromeHeadless"],
    "cwd": "frontend",
    "adapter": "karma",
    "env": {}
  }
}
```

`command` é uma lista de argumentos (**argv**), sem avaliação por shell no Linux.
Escreva cada argumento em seu próprio elemento; caminhos com espaços não
precisam de aspas extras. Pipes, `&&`, `~` e expansão de variáveis não são
interpretados. Em particular,
`CLAUDE_PLUGIN_ROOT` e `${CLAUDE_PLUGIN_ROOT}` **não são interpolados no JSON argv**.
Use os caminhos absolutos retornados por `/test-progress paths`; valores de `env`
também são strings literais, não expressões de shell.
No Windows, wrappers `.cmd`/`.bat` usam um contrato restrito de argumentos,
explicado no [guia Windows](../WINDOWS.md).

`cwd` é relativo ao diretório da sessão. Um executável com caminho relativo
(como `./mvnw` ou `.venv/bin/python`) é resolvido no `cwd` da área; um nome simples
(como `python` ou `bundle`) é procurado no PATH herdado pelo coletor. `env`
acrescenta variáveis ao processo do comando.
Evite segredos em arquivos versionados. Você pode configurar somente backend
ou frontend; `/test-progress all` exige as duas configurações. Iniciar somente
`backend` não lê nem valida a configuração frontend, mesmo se ela estiver inválida.
A área frontend sempre prepara Node e a `.nvmrc` do app; não é uma área agnóstica
de linguagem. Testes Rails de views e system, Python e RSpec usam backend.

| `adapter` | Comportamento |
| --- | --- |
| `auto` | Reconhece eventos dos adaptadores e, na ausência deles, logs Maven/Karma |
| `events` | Usa eventos `@@TEST_PROGRESS@@`; exige um dos [adaptadores](../adapters/README.md) |
| `maven` (só backend) | Fallback backend por resumos de classe do Maven; total permanece desconhecido durante a execução |
| `karma` (só frontend) | Fallback frontend por linhas `Executed … of …`; precisão depende do formato do log |

Use **`/test-progress paths`** para consultar os caminhos absolutos dos adaptadores
na instalação ativa; confira-os novamente após atualizar o plugin. Para Python,
use `backend` e `adapter: "events"`. O comando deve chamar o Python
do seu app, o **caminho absoluto** de `adapters/python/run.py` nesta instalação
e então `pytest` ou `unittest`. Para Karma com eventos, acrescente o caminho
absoluto de `adapters/karma/reporter.cjs` aos plugins do app. Siga os guias dos
adaptadores; caminhos de exemplo precisam ser substituídos pelos seus caminhos.

Modelos: [Java + frontend](../config.example.json), [Angular 9](../config.angular9.example.json),
[Python](../config.python.example.json), [Windows](../config.windows.example.json) e
[Python no Windows](../config.python.windows.example.json),
[Ruby / RSpec](../config.ruby.example.json) e [Rails](../config.rails.example.json).

## Comandos

| Comando | Ação |
| --- | --- |
| `/test-progress` ou `/test-progress status` | Consulta o estado e abre/atualiza o painel |
| `/test-progress help` | Mostra ajuda |
| `/test-progress paths` | Mostra os caminhos instalados dos adaptadores e exemplos |
| `/test-progress demo [backend\|frontend\|all]` | Inicia eventos sintéticos, sem executar a suíte |
| `/test-progress backend` | Inicia o comando backend configurado |
| `/test-progress frontend` | Inicia o comando frontend configurado |
| `/test-progress all` | Inicia os dois comandos configurados |
| `/test-progress logs [backend\|frontend\|all]` | Mostra registros recentes; para consultar ambos, peça cada área |
| `/test-progress cancel [backend\|frontend\|all]` | Solicita cancelamento dos jobs da sessão |
| `--text` | Acrescente a um comando para obter resposta textual |

Exemplo: `/test-progress status --text`. Sem área explícita, demo e cancel
usam `all`; `logs all` apresenta backend. A cauda do log fica no caminho
indicado pelo status. Jobs continuam em segundo plano quando o painel fecha;
encerrar ou recarregar o Claude não implica cancelamento automático.

## Testes demorados e consultas pelo Claude

Inicie com `/test-progress backend --text` e consulte depois com
`/test-progress status --text`. O início devolve o controle assim que o worker
é lançado; o comando de teste continua em processo separado. Não há limite de
duração da suíte no coletor. O timeout de 5 segundos no Linux, ou 15 no Windows,
vale para cada chamada curta do Mod ao coletor, não para o teste em segundo plano.
Se uma consulta falhar, consulte novamente antes de tentar iniciar outra suíte.

O worker salva um **sinal de atividade a cada 5 segundos**, mesmo sem novos logs.
O resumo textual mostra duração, último sinal do executor, última saída e último
evento de progresso reconhecido. Esses sinais são distintos: executor ativo não
comprova que o teste está avançando; ele pode estar esperando I/O ou travado.
Silêncio não fabrica resultados, não significa sucesso e não cancela a suíte.
Os timestamps ficam disponíveis também no JSON do coletor como `heartbeatAt`,
`lastOutputAt`, `lastProgressAt`, `elapsedMs` e `heartbeatAgeMs`.

Para o Claude acompanhar, peça que consulte o status e continue outras tarefas
enquanto o estado for `preparing` ou `running`. O painel atualiza sozinho na
sessão aberta; isso não envia notificações autônomas ao modelo. O resultado só
está confirmado quando o estado é terminal e o código de saída foi observado.
`completed` indica conclusão com progresso reconhecido e sem falhas; `failed`
indica falha; `cancelled` indica cancelamento. `error` exige ler o diagnóstico:
se houver `recoveryRequired: true`, a árvore do comando ainda não foi confirmada
como encerrada. Nem `error` isolado nem 100% permitem presumir término seguro.

O estado fica em arquivos locais com gravação atômica, separado por diretório
do projeto e `owner` da sessão. Anote o `owner` mostrado na resposta textual.
Após fechar o Claude, outra consulta com o mesmo diretório e owner encontra a
execução; uma sessão com outro ID não a adota automaticamente. Para consultar
um owner conhecido pelo terminal ou pela ferramenta de shell do Claude:

```bash
node /caminho/absoluto/claude-test-progress/runner/cli.mjs status \
  --cwd /caminho/absoluto/do/app --owner ID_INFORMADO_PELO_MOD --lane backend
```

O diretório temporário do sistema guarda o estado e os logs; não há promessa de
retomada após reboot, limpeza desses arquivos ou morte do executor. Os contadores
persistem separados do log, cuja cauda é limitada a aproximadamente 1 MiB por
execução. Para saída completa, configure também os relatórios do runner do app.
Se o worker desaparecer, o status preserva resultados parciais, acusa a perda e
bloqueia outra execução quando ainda houver processos sem recuperação confirmada.
Use `cancel` para a recuperação oferecida pelo coletor e consulte o status novamente.

## Atualizar com jobs encerrados

Antes de atualizar, recarregar ou remover, volte a **cada sessão responsável** por
jobs deste plugin. Consulte `/test-progress status --text`; espere o término ou
solicite `/test-progress cancel all --text` e consulte novamente até confirmar o
encerramento. Cancelamento é um pedido assíncrono. Se houver recuperação pendente,
siga o [diagnóstico](TROUBLESHOOTING.md) antes de mudar a instalação.
Uma sessão nova tem outro owner e não cancela automaticamente jobs antigos.

No terminal, para uma instalação no escopo padrão `user`:

```bash
claude plugin marketplace update test-progress-marketplace
claude plugin update test-progress@test-progress-marketplace --scope user
```

Depois, na sessão Claude, aplique `/reload-plugins`; reinicie a sessão se a mudança
não aparecer. Reconsulte `/test-progress paths` e ajuste **todos os caminhos de
adaptadores** na configuração do app, inclusive o `require` do reporter Karma.
O cache pode mudar de caminho após o upgrade. Confira `help`, `paths`, demo e
status antes de executar novamente a suíte real. Se usa escopo `project` ou
`local`, substitua `--scope user` pelo escopo instalado.

Para um clone carregado com `--plugin-dir`, após encerrar seus jobs, atualize o
clone que você mantém (por exemplo, `git pull --ff-only` em um clone limpo na
branch desejada), valide com `claude plugin validate . --strict` e recarregue ou
reabra a sessão. Marketplace e clone local são instalações diferentes: confirme
o caminho realmente carregado antes de editar a configuração.

## Remover

Conclua o procedimento de encerramento acima. No terminal:

```bash
claude plugin uninstall test-progress@test-progress-marketplace --scope user
```

Ajuste o escopo se necessário e recarregue/reabra o Claude. Para deixar de carregar
um checkout local, abra a próxima sessão sem `--plugin-dir` e sem o launcher.
Restaure os comandos originais no app e retire referências aos adaptadores,
como a entrada do reporter Karma, se não pretende mais usá-los.

**Uninstall, reload e fechar o painel não encerram processos detached.** Também
não comprovam limpeza do estado/logs do coletor: eles ficam no temporário do
sistema, fora do cache do plugin. Relatórios gerados pelo runner do app têm seu
próprio destino. Só avalie remover arquivos específicos depois de confirmar que
os respectivos jobs terminaram; não apague locks para forçar nova execução.

Os comandos de instalação, atualização e remoção seguem a
[referência oficial do Claude Code](https://code.claude.com/docs/en/plugins/cli-reference).
