# Diagnóstico

[Início](../README.md) · [Uso](USAGE.md) · [Compatibilidade](COMPATIBILITY.md)

Comece na sessão que iniciou o job. Use `/test-progress status --text` para
conferir owner, estado e caminhos; consulte os logs da área afetada. Uma falha
na consulta não significa que o teste parou. Consulte novamente antes de iniciar
outra execução. Não existe comando `/test-progress doctor` nesta versão.

## Sintoma, verificação e ação

| Sintoma | Verificação | Ação |
| --- | --- | --- |
| `/test-progress` não aparece | `claude --version`; instalação e permissão de Mods no ambiente | Instale conforme o [guia](USAGE.md), use `/reload-plugins` ou reabra a sessão; respeite políticas da organização |
| Clone/marketplace SSH falha | Confirme acesso ao repositório com `git ls-remote git@github.com:fabiopbarbieri/claude-test-progress.git HEAD` | Configure o acesso SSH GitHub no seu ambiente; não coloque chaves ou tokens em comandos publicados |
| Painel sem espaço ou indisponível | `/test-progress status --text` | Use o modo textual e confira a versão do Claude; uma falha de layout não prova falha da suíte |
| Configuração ausente / inválida | Diretório em que a sessão foi aberta; JSON em `.claude/test-progress.json`, `schemaVersion: 1`, argv de strings | Corrija somente a configuração do app conforme [USAGE](USAGE.md); JSON não aceita comentários |
| `all` falha mas backend funciona | Presença e validade da área frontend | Use `backend` para uma suíte só; `all` exige as duas e prepara Node do frontend |
| Node frontend ausente ou versão divergente | `.nvmrc` mais próxima do `cwd` da área, subindo os diretórios; runtime selecionado no status | Disponibilize a versão local necessária; prefira argv começando com `node`; não mude a `.nvmrc` só para satisfazer o coletor |
| Python/Ruby/Rails procura Node no início | Área configurada | Mova essa suíte para backend; frontend ainda prepara Node/.nvmrc, inclusive para um comando Ruby |
| `ENOENT` / adaptador não encontrado | `/test-progress paths`, `cwd` e executável do app | Use caminho absoluto atual para o adaptador e executável do ambiente correto; após upgrade, ajuste também `require` no Karma |
| Caminho contém literalmente `${CLAUDE_PLUGIN_ROOT}` ou `~` | Strings em `command` | Substitua por caminho absoluto; o JSON argv não interpola variáveis nem avalia shell |
| Erro com `.cmd`/`.bat` | Argumentos com controles/expansão de shell | Siga [WINDOWS](../WINDOWS.md); para Angular prefira `node` + entrypoint JS local; não contorne a recusa por concatenação de shell |
| Estado `error` mesmo com exit 0 | Diagnóstico, `progressObserved` e stdout do comando | Verifique adaptador e modo; `events` exige eventos. No fallback Maven, um resumo agregado sem classe não basta. Exit 0 sozinho não comprova coleta de testes |
| Total desconhecido ou percentual parcial | Runner e fase | É esperado em Rails durante execução e no fallback Maven; espere os resultados reais, sem inventar total ou cobertura |
| 100% e ainda `running` | Estado, código de saída e logs recentes | Aguarde teardown/hooks/encerramento; contadores podem terminar antes do processo |
| Sem novos logs ou contadores | Último heartbeat, última saída e último evento de progresso | Compare sinais: heartbeat só prova atividade do executor. Investigue a suíte ou cancele explicitamente; silêncio não é sucesso |
| Já existe execução ativa | Owner e status da área | Aguarde ou cancele na sessão responsável; não apague locks nem inicie outra sessão para contornar a proteção |
| `orphaned-command` / `recoveryRequired` | Diagnóstico de identidade/árvore de processos no status | Solicite `cancel` na mesma área e owner e consulte novamente; se exigir recuperação manual, preserve evidências e não encerre PIDs por suposição |
| Cancelamento solicitado, mas ainda ativo | `status --text` até sair de `preparing`/`running`, sem recuperação pendente | Aguarde confirmação; Windows termina o Job de forma forçada, Linux usa o grupo de processos. Pedido de cancelamento não é confirmação |
| `logs all` mostra só backend | Consulte `logs backend` e `logs frontend` separadamente | Nesta versão, `logs all` (e logs sem área) seleciona backend; use uma consulta por área |
| Estado sumiu em outra sessão | Diretório e owner originais | Outra sessão não adota o job automaticamente; use o owner conhecido no [comando de consulta](USAGE.md#testes-demorados-e-consultas-pelo-claude) |
| Suíte continua após fechar painel/reload/uninstall | Owner original e estado do coletor | Jobs são detached. Conclua/cancele antes de alterar a instalação; remover o plugin não apaga necessariamente logs fora do cache |

## Reprodução mínima sem aplicação privada

Primeiro, em uma sessão sem jobs ativos, execute:

```text
/test-progress help
/test-progress paths
/test-progress demo all --text
/test-progress status --text
/test-progress logs backend --text
/test-progress logs frontend --text
```

Repita status até ambas as áreas terminarem: backend **8/8, 7 passaram, 1 falhou,
exit 1**; frontend **12/12, 11 passaram, 1 ignorado, exit 0**. A falha do backend
é deliberada. Isso verifica o caminho da demo; não prova seu runner nem a UI.

Para isolar o coletor do Claude em Linux, use um checkout do plugin e um diretório
temporário sem configurações reais. Substitua o caminho absoluto no exemplo:

```bash
repro_dir=$(mktemp -d -t test-progress-repro-XXXXXX)
node /caminho/absoluto/claude-test-progress/runner/cli.mjs demo \
  --cwd "$repro_dir" --owner docs-demo --lane all
node /caminho/absoluto/claude-test-progress/runner/cli.mjs status \
  --cwd "$repro_dir" --owner docs-demo --lane all
```

Reutilize o mesmo `repro_dir` e owner nas consultas. O diretório temporário novo
isola o namespace de outras sessões. Para interromper **essa reprodução**:

```bash
node /caminho/absoluto/claude-test-progress/runner/cli.mjs cancel \
  --cwd "$repro_dir" --owner docs-demo --lane all
node /caminho/absoluto/claude-test-progress/runner/cli.mjs status \
  --cwd "$repro_dir" --owner docs-demo --lane all
```

Confirme o estado terminal, sem `recoveryRequired`, antes de limpar os arquivos
da reprodução. Em `error`, exit code pode ser desconhecido: informe isso, sem
classificar como sucesso. A CLI do coletor oferece `start/status/logs/cancel/demo`;
`help/paths/--text` são comandos/opções do Mod, não dessa CLI.

Se a demo funciona, reduza a configuração para **uma área e um teste sintético**
da linguagem afetada. Execute primeiro o comando nativo no mesmo `cwd` e ambiente,
depois o wrapper do [adaptador](../adapters/README.md), por fim o coletor. Compare
contadores e código de saída. Não tente instalar todas as suítes para investigar
um problema isolado. Prefira comandos finitos, sem watch.

## Informações úteis para uma issue

Informe sistema operacional, versão do Claude (`claude --version`), Node do
coletor, runtime/runner do app e versão ou SHA do plugin. Descreva a área, comando
com argumentos sintéticos, resultado esperado, resultado observado, estado final
e exit code (ou sua ausência). Inclua passos mínimos e indique se o problema
ocorre no comando nativo, no adaptador, no coletor ou somente no painel.

Use apenas um trecho pequeno e **revisado** de `logs backend`/`logs frontend` ou
do arquivo indicado por `logPath`. A cauda local é limitada a aproximadamente
1 MiB; relatório completo do runner pode ficar em outro lugar. Não publique
dumps de ambiente, arquivos de configuração reais, tokens, cookies, dados de
testes privados, caminhos pessoais ou capturas autenticadas. Troque esses dados
por nomes públicos e sintéticos, preservando a estrutura necessária à reprodução.
Para suspeita de vulnerabilidade, siga [SECURITY](../SECURITY.md).
