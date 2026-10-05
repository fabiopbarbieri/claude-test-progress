# Diagnóstico

[Início](../README.md) · [Uso](USAGE.md) · [Compatibilidade](COMPATIBILITY.md)

Comece na sessão que iniciou o job. Consulte `/test-progress status all --text`
e os logs do ID afetado. Falha na consulta não comprova que o teste parou;
consulte novamente antes de outro start. Não existe `/test-progress doctor`.

## Sintoma, verificação e ação

| Sintoma | Verificação | Ação |
| --- | --- | --- |
| Comando não aparece | Claude, instalação e permissão de Mods | Siga [USAGE](USAGE.md), recarregue ou reabra a sessão |
| SSH do marketplace falha | `git ls-remote git@github.com:fabiopbarbieri/claude-test-progress.git HEAD` | Configure acesso SSH; não publique chaves/tokens |
| Painel indisponível | `status all --text` | Use texto; falha de layout não comprova falha da suíte |
| Nenhum módulo | `list`; cwd da sessão; arquivo default | Declare módulos no workspace; registry sozinho não ativa nada |
| Configuração global inválida | JSON, schemaVersion 2, modules e limite 1 MiB | Corrija o cadastro local; v1/misto/ID inseguro bloqueiam todos os starts |
| `all` falha mas um ID funciona | Diagnósticos de cada módulo, inclusive declarações malformadas | Corrija ou desative explicitamente o módulo; preflight de all deve passar por inteiro |
| Template indisponível | `extends`, registry schemaVersion 2 e CLAUDE_CONFIG_DIR absoluto | Corrija a referência/fonte; standalone não depende do registry |
| Node do app ausente/divergente | runtime, `.nvmrc` próxima do cwd, descriptor selecionado | Disponibilize a versão local; prefira command iniciando por `node`; não altere .nvmrc só para satisfazer o coletor |
| Python/Ruby/Rails procura Node | `runtime` efetivo, inclusive template | Configure `inherit`; ID/linguagem não selecionam runtime |
| Executável/adaptador indisponível | PATH efetivo, cwd, paths da instalação | Corrija o primeiro executável e o caminho do adapter; reconsulte paths após upgrade |
| `${CLAUDE_PLUGIN_ROOT}` ou `~` aparece literalmente | command/env | Use caminho literal correto; JSON não interpola shell |
| `.cmd`/`.bat` recusado | Argumentos com expansão/controle | Siga [WINDOWS](../WINDOWS.md); prefira Node com entrypoint JS local quando aplicável |
| Fonte mudou durante início | Edição de workspace/registry após descoberta | Refaça list/preflight; não contorne a revalidação |
| Estado legado bloqueia ID novo | Diagnóstico do namespace | Use o artefato antigo com cwd/owner originais; confirme quiescência antes da adoção v2 |
| Erro antes da barreira | Diagnóstico de preparação/reserva | Nenhum comando deve ser liberado; corrija a causa antes de iniciar novamente |
| Falha de infraestrutura após liberação | Estado do lote, compensação, recoveryRequired | Consulte todos os participantes; mantenha locks sem encerramento comprovado |
| Um teste falhou e outros continuam | Exit code e progresso de cada módulo | Falha normal não aborta os demais; espere ou cancele explicitamente |
| `error` com exit 0 | progressObserved, adapter e stdout | Confira eventos; resumo Maven agregado sem classe não basta para progresso reconhecido |
| Total desconhecido/parcial | Runner/fase | Esperado no Rails/Maven durante execução; não invente total/cobertura |
| 100% ainda ativo | Estado, exit code, logs | Espere teardown/hooks/encerramento; contadores podem concluir primeiro |
| Sem logs/contadores novos | Heartbeat, última saída e último progresso | Atividade do executor não prova avanço; investigue a suíte ou cancele |
| Lock ocupado | Owner e job do mesmo ID | Espere/cancele na sessão responsável; não apague locks |
| Job sem módulo no catálogo | Config removida ou ID desativado | Status/logs/cancel permanecem disponíveis para o job v2 autenticado |
| `orphaned-command` / recoveryRequired | Diagnóstico de identidade/árvore | Peça cancel no mesmo ID/owner; preserve evidência se recuperação manual for necessária |
| Cancel solicitado ainda ativo | Status até término seguro | Pedido não é confirmação; no Windows o Job é terminado, no Linux usa-se o grupo |
| Estado sumiu em nova sessão | Cwd canônico e owner originais | A sessão nova não adota outro owner; consulte o owner conhecido |
| Start passou de 60 s | Status do lote e participantes | Não presuma que parou nem inicie novamente sem consultar |
| Suíte continua após reload/uninstall | Owner/estado original | Jobs são detached; encerre-os antes de trocar a instalação |

Preparação tem limite de 30 s, confirmação de lançamento 10 s e aborto 10 s.
São limites do início, separados de qualquer duração de teste. A suíte não tem
deadline. Logs/status/cancel não dependem de configuração de execução válida.

## Reprodução mínima sem aplicação privada

Em um diretório temporário novo, crie `.claude/test-progress.json` com um módulo
finito que emite um evento sintético; isso testa o coletor, sem comprovar o runner
real nem o aceite visual:

```json
{
  "schemaVersion": 2,
  "modules": {
    "probe": {
      "command": ["node", "-e", "console.log('@@TEST_PROGRESS@@'+JSON.stringify({scope:'synthetic',total:1,resolved:1,passed:1,failed:0,skipped:0,final:true,totalStable:true}));"],
      "runtime": "inherit",
      "adapter": "events"
    }
  }
}
```

Com Node do ambiente disponível no PATH, pelo terminal Linux:

```bash
node /caminho/absoluto/claude-test-progress/runner/cli.mjs list \
  --cwd /caminho/absoluto/da/reproducao --owner docs-probe --module all
node /caminho/absoluto/claude-test-progress/runner/cli.mjs start \
  --cwd /caminho/absoluto/da/reproducao --owner docs-probe --module probe
node /caminho/absoluto/claude-test-progress/runner/cli.mjs status \
  --cwd /caminho/absoluto/da/reproducao --owner docs-probe --module all
```

Reutilize cwd e owner até confirmar `completed`, 1/1, exit 0 e ausência de
recuperação pendente. Se necessário, use `cancel --module probe` e consulte de
novo. Não apague estado antes da confirmação. A CLI oferece
`start/list/status/logs/cancel`; help/paths/--text pertencem ao Mod. Não há demo,
atalhos de início por ID, --lane ou gerenciamento de jobs v1 no produto v2.

Se a reprodução funciona, reduza o app a um módulo e um teste da linguagem
afetada. Execute o comando nativo no mesmo cwd/ambiente, depois o wrapper do
[adapter](../adapters/README.md), por fim o coletor. Compare contadores e exit
code. Prefira comandos finitos, sem watch; não instale todas as suítes para
investigar um problema isolado.

## Informações úteis para uma issue

Informe sistema, versão do Claude/Node do coletor, runtime/runner do app e SHA
ou versão do plugin. Descreva ID, argumentos sintéticos, resultado esperado,
resultado observado, estado final e exit code ou sua ausência. Indique se o
problema ocorre no runner, adapter, coletor ou painel. Distingua gate estático,
comportamento Linux, execução Windows nativa e aceite visual.

Publique só trechos pequenos e revisados de logs. A cauda local tem cerca de
1 MiB; o runner pode guardar relatório completo em outro lugar. Não publique
env, configs reais, tokens, cookies, dados privados, caminhos pessoais ou
capturas autenticadas. Use valores públicos sintéticos, preservando a estrutura
necessária à reprodução. Para vulnerabilidades, siga [SECURITY](../SECURITY.md).
