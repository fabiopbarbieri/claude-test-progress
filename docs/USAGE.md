# Guia de uso

[Início](../README.md) · [Compatibilidade](COMPATIBILITY.md) ·
[Diagnóstico](TROUBLESHOOTING.md) · [Windows](../WINDOWS.md)

O plugin executa comandos somente quando você solicita. Cada workspace declara
zero ou vários módulos de testes com ID estável. Nenhum runner é dependência
global do Mod; dependências, ambientes e comandos reais pertencem ao seu app.

## Instalar pelo marketplace próprio

No Claude Code, com acesso SSH GitHub configurado, rode um comando por vez:

```text
/plugin marketplace add git@github.com:fabiopbarbieri/claude-test-progress.git
```

```text
/plugin install test-progress@test-progress-marketplace
```

```text
/reload-plugins
```

Depois confira `/test-progress help`, `paths`, `list` e `status`.

O marketplace `test-progress-marketplace` é mantido por este projeto,
independente do catálogo oficial da Anthropic. Pelo terminal:

```bash
claude plugin marketplace add git@github.com:fabiopbarbieri/claude-test-progress.git
claude plugin install test-progress@test-progress-marketplace
```

Selecione Install nos detalhes do plugin. Ao fechar o painel, o Claude aplica
mudanças pendentes; recarregue ou reabra a sessão se o comando não aparecer.
Listar ou consultar estado não executa a suíte nem resolvedores do aplicativo.
Um workspace sem módulos é um estado normal.

### Carregar um checkout local

```bash
git clone git@github.com:fabiopbarbieri/claude-test-progress.git
cd claude-test-progress
claude plugin validate .
```

Depois, no diretório do app:

```bash
bash /caminho/absoluto/claude-test-progress/launch.sh
```

O launcher confere o Claude e carrega o plugin com `--plugin-dir`. Também pode
usar `claude --plugin-dir /caminho/absoluto/claude-test-progress`.
PowerShell 5.1/7: [WINDOWS.md](../WINDOWS.md); aceite nativo requer os gates
Windows, separado da validação Linux e dos checks estáticos.

## Configurar seu projeto

Crie **`.claude/test-progress.json` no diretório em que abriu a sessão**. Não há
busca automática na raiz Git ou ativação por linguagem, `package.json` ou Gemfile.
Somente declarações deste arquivo ativam módulos; `modules: {}` declara zero.
Exemplo de dois módulos independentes:

```json
{
  "schemaVersion": 1,
  "modules": {
    "api": {
      "label": "API principal",
      "language": "JVM",
      "command": ["./mvnw", "test"],
      "cwd": ".",
      "adapter": "maven",
      "runtime": "inherit",
      "order": 10,
      "env": {}
    },
    "web": {
      "label": "Aplicação web",
      "language": "TypeScript",
      "command": ["node", "./node_modules/@angular/cli/bin/ng", "test", "--watch=false", "--browsers=ChromeHeadless"],
      "cwd": "frontend",
      "adapter": "karma",
      "runtime": "node-project",
      "order": 20,
      "env": {}
    }
  }
}
```

Os nomes `backend` e `frontend` continuam IDs possíveis, sem semântica especial.
Um módulo chamado `frontend` pode executar Ruby com `runtime: "inherit"`.
Labels iguais e vários módulos da mesma linguagem são permitidos; o ID distingue
configuração, estado, locks e ações. Linguagem é apenas uma dica visual.

| Campo | Regra e default |
| --- | --- |
| ID em `modules` | 1..48 caracteres; começa com letra minúscula, seguido de letras minúsculas, números ou `-` |
| `enabled` | Booleano; default `true`; somente `false` desativa |
| `label` | 1..64 caracteres sem controles; default ID |
| `language` | Opcional, 1..40 caracteres sem controles |
| `cwd` | Default `.`; relativo ao workspace, inclusive quando herdado de template |
| `command` | Array não vazio de strings; um elemento por argumento, primeiro executável obrigatório |
| `adapter` | `auto`, `events`, `maven`, `karma` ou `exit`; default `auto` |
| `runtime` | `inherit` ou `node-project`; default `inherit` |
| `env` | Map de strings literais; default `{}` |
| `order` | Inteiro; default 0; empate pelo ID ASCII |
| `extends` | Opcional; ID de um único template pessoal |

IDs reservados: `all`, `constructor`, `prototype`, `con`, `prn`, `aux`, `nul`,
`com1`..`com9` e `lpt1`..`lpt9`. Não há normalização de caixa ou pontuação.
`null` não apaga campos: é inválido. Campos desconhecidos geram diagnóstico.
Cada fonte JSON tem limite de **1 MiB**. `schemaVersion` diferente de 1, estruturas mistas, JSON/root
inválido ou ID inseguro no workspace bloqueiam todo novo início. Erros de um
módulo não impedem iniciar outro válido; `all` também seleciona declarações
malformadas habilitadas e falha antes de executar qualquer comando.

### Argumentos, diretórios e ambientes

`command` é **argv**, sem avaliação por shell no Linux. Caminhos com espaços
não precisam de aspas extras. Pipes, `&&`, `~`, `CLAUDE_PLUGIN_ROOT` e
`${CLAUDE_PLUGIN_ROOT}` não são interpolados no JSON. Use caminhos absolutos
retornados por `/test-progress paths` para os adapters. `env` também contém
strings literais, não instruções de expansão; evite segredos versionados.

`cwd` é relativo ao workspace, inclusive em `--config` alternativo. Um comando
com caminho relativo é resolvido no `cwd` do módulo. Nomes simples são procurados
no **PATH efetivo do filho**, incluindo overrides de `env`; no Linux o executável
é capturado como caminho absoluto no preflight. Diretórios fora da árvore do
workspace podem ser explicitamente configurados. No Windows, `.cmd`/`.bat`
seguem o contrato restrito de [WINDOWS](../WINDOWS.md).

`inherit` não descobre Node nem consulta `.nvmrc`. `node-project` executa o
resolvedor somente no início dos módulos selecionados, respeita a `.nvmrc` do
app e acrescenta o diretório do Node escolhido ao PATH do filho. Não instala
Node nem muda o PATH global. O Node 14+ do coletor é independente do Node do app.

### Cores no log

A saída do runner vai para um pipe, então o coletor pede cor a cada módulo:
`FORCE_COLOR=1` para todos (Node/Karma, pytest, unittest no Python 3.13+);
`MAVEN_ARGS=-Dstyle.color=always` quando o adapter é `maven` ou o comando é
`mvn`/`mvnw` (Maven 3.9+); `SPEC_OPTS=--force-color` quando o comando chama
`rspec`. Valores que você já tenha em `MAVEN_ARGS`/`SPEC_OPTS` são mantidos, e
uma opção de cor já presente neles vence. O adaptador Rails liga as cores do
reporter do Rails sob `FORCE_COLOR`. O painel desenha as cores (SGR) e descarta
outros controles de terminal; `--text` e a CLI de texto mostram linhas sem cor.
Para desligar num módulo, use `"env": {"NO_COLOR": "1"}`; um `NO_COLOR` ou
`FORCE_COLOR` herdado do ambiente também desliga a política.

| Adapter | Progresso |
| --- | --- |
| `auto` | Eventos e, na ausência deles, fallback de logs Maven/Karma |
| `events` | Eventos `@@TEST_PROGRESS@@` dos [adapters](../adapters/README.md) |
| `maven` | Resumos de classe Maven; total desconhecido durante a execução |
| `karma` | Linhas `Executed … of …`; precisão depende do formato do log |
| `exit` | Eventos, se houver; sem eles, só o exit code decide ✓/✗ (contagem desconhecida) |

Todos os adapters podem ser usados por qualquer ID. Configurar um runner sem
integração não cria contadores. Python, Ruby e Rails normalmente usam `inherit`
e `events`; Angular/Karma normalmente usa `node-project` com reporter ou fallback;
Playwright Test usa `node-project` e `events` com o reporter.

Modelos: [Módulos](../config.modules.example.json), [Templates](../config.registry.example.json),
[Java + web](../config.example.json), [Angular 9](../config.angular9.example.json),
[Python](../config.python.example.json), [Windows](../config.windows.example.json),
[Python no Windows](../config.python.windows.example.json), [Ruby](../config.ruby.example.json),
[Rails](../config.rails.example.json) e [Playwright](../config.playwright.example.json). Ajuste comandos e caminhos ao seu app.

### Templates pessoais opcionais

O registry fica em `test-progress.registry.json` dentro de **CLAUDE_CONFIG_DIR**,
quando definido, ou em `~/.claude/test-progress.registry.json`. O diretório
configurado precisa ser absoluto; não há expansão de shell nem criação automática.
Ausência equivale a templates vazios. Não são lidos settings, tokens ou outros
arquivos pessoais do Claude.

```json
{
  "schemaVersion": 1,
  "templates": {
    "jvm-tests": {
      "command": ["mvn", "test"],
      "adapter": "maven",
      "runtime": "inherit",
      "env": {"TEST_MODE": "serial"}
    }
  }
}
```

No workspace, um módulo pode declarar `"extends": "jvm-tests"`. Um template
oferece label, language, cwd, command, adapter, runtime e env; não oferece
`enabled`, `order` nem herança de outro template. A precedência é defaults,
template, campos explícitos do workspace. **command e env substituem o campo
inteiro**: `env: {}` elimina todos os overrides do template, mas o filho continua
herdando o ambiente do coletor. Uma referência inexistente é inválida mesmo com
overrides suficientes. Registry inválido prejudica quem o referencia; módulos
standalone continuam disponíveis. Templates sozinhos nunca ativam módulos.

A descoberta expõe somente ID, label, linguagem, ordem, habilitação, origem,
presença de diretório e diagnósticos seguros. Não publica command, env, caminho
pessoal do registry ou digest; não executa comandos nem resolvedores. Execução,
ambiente, cwd e primeiro executável são validados somente para os selecionados.
As fontes privadas são revalidadas antes da reserva e da liberação da barreira.

## Comandos

| Comando | Ação |
| --- | --- |
| `/test-progress` | Abre o painel ou, se aberto, fecha |
| `/test-progress status [id\|all]` | Consulta estado e abre/atualiza painel |
| `/test-progress help` / `paths` | Ajuda / arquivos instalados |
| `/test-progress list` | Lista catálogo e diagnósticos |
| `/test-progress start id` / `start all` | Inicia selecionados habilitados |
| `/test-progress logs id` / `logs all` | Consulta logs dos selecionados |
| `/test-progress cancel id` / `cancel all` | Solicita cancelamento da sessão |
| `--text` | Alternativa textual no Mod |

Não há atalho `/test-progress id`: o início é sempre explícito. Status/logs/cancel consultam
jobs autenticados mesmo se o módulo tiver sido removido ou a configuração estiver
inválida. Um job removido do cadastro continua visível como órfão do cadastro;
isso não significa perda do worker. Listar e consultar não inicia testes.

A CLI aceita `start/list/status/logs/cancel`, usando `--module id|all`.
`help`, `paths` e `--text` pertencem ao Mod. O override **--config é somente CLI**:
substitui o arquivo workspace naquela chamada, sem alterar owner/namespace.
Caminho relativo é resolvido no workspace; o painel usa o arquivo default.

```bash
node /caminho/absoluto/claude-test-progress/runner/cli.mjs start \
  --cwd /caminho/absoluto/do/app --owner OWNER_CONHECIDO --module api \
  --config config-local.json
```

## Testes demorados e consultas pelo Claude

Inicie com `/test-progress start api --text` e consulte com
`/test-progress status api --text`. O início passa por preflight de todos os
selecionados e reserva todos os locks antes de executar comandos. Workers
preparados aguardam uma barreira comum: preparação **30 s**, confirmação de
lançamento **10 s**, aborto/encerramento **10 s**; no Windows, cada módulo
selecionado acrescenta 1 s à preparação (até 50 s) e à confirmação (até 40 s).
A chamada start do Mod tem limite de **60 s**, separado da duração da suíte. Não há deadline da suíte.

Se preparação/reserva falhar, nenhum comando é liberado. Falha de infraestrutura
após a liberação solicita compensação dos demais participantes; encerramento
não comprovado conserva locks e requer recuperação. Uma **falha normal de teste**
(exit não zero com execução observada) não cancela os outros módulos do lote.
Uma consulta ou chamada start que excedeu o limite não comprova encerramento:
consulte o estado antes de tentar outro start.

O worker grava heartbeat a cada 5 segundos, mesmo sem logs. Último heartbeat,
última saída e último progresso são sinais distintos: atividade do executor
não comprova avanço do teste. Silêncio não fabrica resultados nem sucesso.
O painel atualiza na sessão aberta; isso não envia notificações autônomas ao
modelo. Peça ao Claude para consultar enquanto a execução estiver ativa.

`completed` indica término com progresso reconhecido sem falhas; `failed`
indica falha; `cancelled` indica cancelamento. `error` exige diagnóstico.
Se `recoveryRequired` for true, a árvore não teve encerramento comprovado;
100%, erro isolado e pedido de cancelamento não provam limpeza.

O estado é separado pelo cwd canônico e owner. Uma sessão nova não adota jobs
de outra. Preserve o owner mostrado no modo textual para consultar pelo terminal:

```bash
node /caminho/absoluto/claude-test-progress/runner/cli.mjs status \
  --cwd /caminho/absoluto/do/app --owner OWNER_CONHECIDO --module all
```

Estado e logs ficam no temporário do sistema, fora do cache do plugin. Não há
promessa de retomada após reboot/limpeza. Contadores persistem separados da cauda
do log, limitada a aproximadamente 1 MiB por execução; relatórios completos
pertencem ao runner. Perda de worker preserva resultados parciais e pode exigir
cancelamento/recuperação no owner original. Não apague locks para liberar jobs.

## Atualizar com jobs encerrados

Em **cada sessão responsável**, consulte status, espere o término ou peça
`/test-progress cancel all --text` e consulte até confirmar ausência de recuperação
pendente. Depois, no terminal, ajustando o escopo instalado:

```bash
claude plugin marketplace update test-progress-marketplace
claude plugin update test-progress@test-progress-marketplace --scope user
```

Recarregue/reabra o Claude, confira help/list/status e reconsulte paths. Ajuste
os caminhos de todos os adapters, inclusive o `require` no Karma; o cache pode
mudar. Para checkout com `--plugin-dir`, após encerrar os jobs, atualize seu clone
limpo na branch desejada, valide `claude plugin validate . --strict` e reabra.
Marketplace e checkout são instalações diferentes: confira qual está carregada.

## Remover

Após a confirmação de encerramento, no terminal:

```bash
claude plugin uninstall test-progress@test-progress-marketplace --scope user
```

Ajuste o escopo e reabra o Claude. Para checkout, abra sem launcher/`--plugin-dir`.
Restaure comandos originais e retire referências aos adapters no app, se desejado.
**Uninstall, reload e fechar painel não encerram processos detached** nem apagam
necessariamente o estado/logs. Só avalie limpeza específica após comprovar o fim
das execuções. Instalação segue a
[referência oficial de plugins](https://code.claude.com/docs/en/plugins/cli-reference).
