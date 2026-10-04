# Claude Test Progress

![Capa ilustrada do Claude Test Progress, com progresso de backend e frontend](docs/assets/cover.png)

**Acompanhe seus testes dentro do Claude Code enquanto eles rodam em segundo plano.**
O plugin `test-progress` abre um painel com duas áreas, backend e frontend,
mostra testes resolvidos, resultados, logs e estado do comando. Você escolhe
quando iniciar uma execução e pode continuar trabalhando na conversa.

É um [Claude Code Mod](https://code.claude.com/docs/en/plugins/mods/create),
distribuído como plugin neste repositório. Versão **0.1.0**, licença **MIT**.
A capa é uma ilustração; a interface real é um painel de terminal do Claude Code.

## O que ele faz

- Executa os comandos de teste que você configurou, por pedido explícito.
- Atualiza o painel e um resumo acima do prompt a cada segundo.
- Exibe passaram, falharam, ignorados, total conhecido ou parcial e código de saída.
- Mantém logs locais e oferece cancelamento dos jobs da sessão atual.
- Separa o Node do coletor do Node usado pelo frontend, respeitando a `.nvmrc` do app.
- Oferece uma demo sintética e respostas com `--text`, inclusive em modo headless.

O percentual mede **testes resolvidos / total conhecido**. Testes ignorados também
são resolvidos. Um total desconhecido aparece como desconhecido, não como zero.
O total parcial pode crescer; **100% não comprova encerramento nem sucesso**.
Confira o estado, as falhas e o código de saída. Cobertura de código, estimativa
de tempo restante e integração com uma plataforma de CI não são calculadas.

## Requisitos e integrações

| Uso | Requisitos e caminho de integração |
| --- | --- |
| Claude Code | **2.1.287+**, com Mods permitido no ambiente; consulte `claude --version` |
| Coletor | **Node 14+** instalado; sem dependências npm do plugin |
| Linux / WSL | Bash e ferramentas usuais do sistema; descoberta nvm usa GNU `sort -V` |
| Windows nativo | PowerShell **5.1 ou 7** e Node local; implementação disponível, aceite em Windows pendente |
| Java / Maven | Fallback por logs do Maven; [listener JUnit 5](adapters/junit/README.md) opcional, JDK 11+ para compilá-lo |
| Angular / Karma | [Reporter Karma](adapters/karma/README.md) ou fallback por logs; CLI e browser já instalados no app |
| Angular 9 | [Node do app independente](ANGULAR9.md); a matriz histórica lista Node 10/12, enquanto o coletor requer 14+ |
| Python | [pytest 7+ ou unittest](adapters/python/README.md), Python 3.8+ do app, execução serial na área backend |

O plugin usa as dependências do seu projeto; não instala runners, browsers,
versões Node ou pacotes Python. A validação local usa Linux e Claude Code
**2.1.289**. Resultados, comandos e limites estão em [VERIFICATION](docs/VERIFICATION.md).
Validação do coletor e dos adaptadores não substitui o teste em cada app real.

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

Comece sem tocar na suíte do app:

```text
/test-progress help
/test-progress paths
/test-progress demo
/test-progress status
```

A demo gera eventos sintéticos identificados como **DEMO**. Abrir o painel ou
consultar o estado não inicia testes reais.

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
Para PowerShell, consulte [WINDOWS.md](WINDOWS.md).

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
precisam de aspas extras. Pipes, `&&` e expansão de variáveis não são interpretados.
No Windows, wrappers `.cmd`/`.bat` usam um contrato restrito de argumentos,
explicado no [guia Windows](WINDOWS.md).

`cwd` é relativo ao diretório da sessão; um executável relativo é procurado no
diretório da área configurada. `env` acrescenta variáveis ao processo do comando.
Evite segredos em arquivos versionados. Você pode configurar somente backend
ou frontend; `/test-progress all` exige as duas configurações.

| `adapter` | Comportamento |
| --- | --- |
| `auto` | Reconhece eventos dos adaptadores e, na ausência deles, logs Maven/Karma |
| `events` | Usa eventos `@@TEST_PROGRESS@@`; exige um dos [adaptadores](adapters/README.md) |
| `maven` | Fallback backend por resumos do Maven; total permanece desconhecido durante a execução |
| `karma` | Fallback frontend por linhas `Executed … of …`; precisão depende do formato do log |

Use **`/test-progress paths`** para consultar os caminhos absolutos dos adaptadores
na instalação ativa; confira-os novamente após atualizar o plugin. Para Python,
use `backend` e `adapter: "events"`. O comando deve chamar o Python
do seu app, o **caminho absoluto** de `adapters/python/run.py` nesta instalação
e então `pytest` ou `unittest`. Para Karma com eventos, acrescente o caminho
absoluto de `adapters/karma/reporter.cjs` aos plugins do app. Siga os guias dos
adaptadores; caminhos de exemplo precisam ser substituídos pelos seus caminhos.

Modelos: [Java + frontend](config.example.json), [Angular 9](config.angular9.example.json),
[Python](config.python.example.json), [Windows](config.windows.example.json) e
[Python no Windows](config.python.windows.example.json).

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
usam `all`; `logs all` apresenta backend. Logs completos ficam no caminho
indicado pelo status. Jobs continuam em segundo plano quando o painel fecha;
encerrar ou recarregar o Claude não implica cancelamento automático.

## Segurança, limites e contribuição

O plugin inicia processos com as permissões do seu usuário. Use comandos e
adaptadores que você conhece. A demo não comprova a integração com seu runner.
Execuções watch contínuas, Jest/Vitest e pytest-xdist não têm integração própria;
prefira comandos finitos. Windows nativo ainda requer aceite operacional.

Consulte [SECURITY](SECURITY.md), [CONTRIBUTING](CONTRIBUTING.md) e
[VERIFICATION](docs/VERIFICATION.md). Ao abrir uma issue, informe versões,
runner, comando sem dados sensíveis e o resultado observado. Revise logs antes
de anexá-los: eles podem conter dados ou segredos produzidos pelo seu app.

Código distribuído sob a [licença MIT](LICENSE). Claude Code é um produto da
Anthropic; este projeto é independente.
