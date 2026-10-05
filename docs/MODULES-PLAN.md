# Plano integrado: atualização da base e módulos v2

Este documento reúne os dois planos na ordem aprovada: **A — atualizar a branch
com `main`; B — implementar o refactor completo para módulos v2**. O usuário
aprovou descartar v1, retirar a demo, usar verbos explícitos e adotar a barreira
com supervisor detached. Implementação autorizada em 05/10/2026.

O plano descreve o contrato final. Evidências observadas e limitações ficam em
[VALIDATION.md](VALIDATION.md). A existência de código ou workflow não fecha um
aceite nativo, visual ou remoto.

## A. Integrar main antes do refactor

1. Conferir branch, alterações locais, remoto SSH e operações Git pendentes.
2. Buscar `origin/main` e integrar por merge, preservando commits e alterações
   da branch atual e sem alterar outros worktrees.
3. Resolver conflitos preservando o comportamento já validado de progresso,
   workspace, locks, runners, Node do app e Node do coletor.
4. Executar o gate da base integrada antes de iniciar o refactor.

**Executado:** `main` em `3111299bbd5322221256825ee4237f25874feb9b` foi integrada
sem conflitos na branch `feature/public-06-modules-plan`. Merge local:
`921b953741b10c3e0bec185013a7434a46495b77`. Ambos os históricos são ancestrais do
merge. O gate `python3 scripts/check.py` passou na base integrada. Não houve push.

## B. Objetivo e escopo do refactor

O usuário cadastra **0..N módulos** por workspace. Cada módulo tem ID estável,
label, linguagem opcional, ordem, comando, diretório, adapter, runtime e ambiente.
Dois IDs da mesma linguagem mantêm execução, progresso, logs e cancelamento
independentes. O cadastro pessoal fornece templates reutilizáveis e só participa
quando o workspace referencia um template.

- Workspace, registry, envelope CLI, snapshots, jobs, claims, cancelamentos e
  manifestos de lote usam `schemaVersion: 2` e `moduleId` quando aplicável.
- Remover leitores, aliases e operações v1; remover `lane`, `lanes`, `--lane`,
  `-Lane`, demo e atalhos de início `/test-progress backend|frontend|all`.
- `backend` e `frontend` continuam IDs comuns válidos, sem determinar runtime.
- Manter namespace por usuário/cwd canônico/owner, identidade de processos,
  contenção de árvores, logs limitados e duração/progresso observados.
- Preservar adapters e suas limitações: percentual de testes resolvidos,
  total desconhecido distinto de zero, exit code nativo, parcial após interrupção.
- Não migrar frameworks, instalar dependências no app, elevar mínimo Node,
  publicar release ou alterar outros worktrees nesta entrega. A branch é
  publicada somente como PR draft para a CI remota.

A prova privada do broker Windows permanece **`schema: 1`**, pois é um protocolo
independente de contenção por runId. Isso não mantém suporte ao estado v1.
Eventos dos adapters preservam seu contrato existente.

## 1. Cadastro e identidade

Fontes:

| Fonte | Caminho e papel |
| --- | --- |
| Workspace | `<cwd da sessão>/.claude/test-progress.json`; ativa os módulos |
| Registry opcional | `$CLAUDE_CONFIG_DIR/test-progress.registry.json`, ou `~/.claude/test-progress.registry.json`; oferece templates |
| Config alternativa | `--config <arquivo>` somente na CLI do coletor; não expor seleção arbitrária no slash/painel |

Não buscar automaticamente em pais nem ativar templates do registry sem referência.
Exemplos públicos ficam fora de `.claude/`:
[workspace](../config.modules.example.json), [registry](../config.registry.example.json)
e [configuração simples](../config.example.json).

```json
{
  "schemaVersion": 2,
  "modules": {
    "api": {
      "label": "API",
      "language": "JVM",
      "order": 10,
      "runtime": "inherit",
      "command": ["mvn", "test"],
      "cwd": "services/api",
      "adapter": "maven"
    },
    "web": {
      "label": "Aplicação web",
      "order": 20,
      "runtime": "node-project",
      "command": ["node", "./node_modules/@angular/cli/bin/ng", "test", "--watch=false"],
      "cwd": "web",
      "adapter": "karma"
    }
  }
}
```

IDs: `^[a-z][a-z0-9-]{0,47}$`. Rejeitar `all`, `constructor`, `prototype`,
`con`, `prn`, `aux`, `nul`, `com1`..`com9`, `lpt1`..`lpt9`, separadores, controles,
maiúsculas e travessia. Validar no cadastro, CLI, estado, filenames e broker.
Mapas indexados por IDs não usam objetos com protótipo mutável.

Campos: `extends`, `label`, `language`, `order`, `enabled`, `runtime`, `command`,
`cwd`, `adapter`, `env`. Defaults: label=ID, linguagem ausente, order=0,
enabled=true, runtime=`inherit`, cwd=`.`, adapter=`auto`, env vazio. `command`
precisa ser argv não vazio ao iniciar. Ausência ou `enabled:false` não ativa um
módulo. Declarações `null`/`false` e campos nulos são inválidos; não há aliases v1.

Precedência: defaults → template → workspace. Override por **campo inteiro**,
inclusive `command` e `env`; não concatenar argv nem mesclar segredos. Não há
herança recursiva de templates. cwd relativo é resolvido a partir do workspace.
`env` aceita nomes e strings seguros; no Windows rejeitar colisões por caixa,
como `PATH`/`Path`. Validar tipos, adapter/runtime conhecidos e textos limitados,
sem caracteres de controle. Fontes JSON têm limite de 1 MiB.

Schema inválido, IDs inválidos ou JSON quebrado invalidam o cadastro global.
Erro de um módulo não selecionado não impede outro módulo válido. Registry
inválido só impede módulos que o referenciam. `all` seleciona todos os habilitados,
na ordem `order`, depois ID, e valida o conjunto inteiro antes de qualquer reserva.

## 2. Interfaces e separação de responsabilidades

`runner/module-config.mjs` expõe:

- `discoverModules(context, {configPath?})`: leitura síncrona; retorna catálogo
  público, status `absent|valid|invalid`, diagnósticos, catálogo privado efetivo
  e revisão privada das fontes. Não invoca runtimes nem ferramentas de suíte.
- `prepareSelection(discovery, id|all)`: valida somente os selecionados; captura
  comando/cwd/ambiente/runtime efetivos e executável absoluto; retorna IDs e
  configurações privadas prontas. `inherit` ignora `.nvmrc`.
- `assertSourcesUnchanged(revision)`: antes da liberação, rejeita alteração,
  remoção ou aparecimento de fontes desde o preflight.

Resposta CLI:

```json
{
  "schemaVersion": 2,
  "ok": true,
  "modules": {},
  "jobs": {},
  "workspace": {
    "moduleConfig": {"status": "absent", "schemaVersion": null, "enabledIds": []},
    "stateBlocked": false
  },
  "stateDiagnostics": {}
}
```

`modules` contém apenas metadados públicos: ID/label/language/order/enabled,
presença do diretório, origem workspace/template e diagnósticos sanitizados.
Não inclui env, command, catálogo efetivo, registry path ou detalhes de stderr.
`jobs` é indexado por moduleId. `stateDiagnostics` usa arrays por ID e `*` para
problemas globais. Erros de ação preservam catálogo e jobs válidos; ações
múltiplas retornam `actionResults` por ID, sem interromper cancelamento dos demais.

`list/status/logs/cancel` funcionam sem cadastro válido e não resolvem ferramentas
da suíte. O painel rejeita envelopes incompatíveis antes de atualizar estado.

## 3. Estado, segurança e recuperação

Arquivos mantêm o namespace existente e IDs/runIds autenticados. Snapshots,
claims e cancels usam v2; job privado inclui moduleId/runId/batchId. Log pertence
à mesma execução e só é lido depois de autenticar seu caminho.

Enumerar estado além do cadastro: módulo removido com job ativo, órfão ou
incompatível continua consultável. Rejeitar symlinks, travessia, entradas
inesperadas, arquivos excessivos, ownership divergente e registros ilegíveis.
Nunca tratar corrupção como ausência nem um PID isolado como identidade.
Permissões POSIX 0700/0600 e DACL Windows privada/verificada.

Reservas e remoções de `<id>.lock` usam `<id>.mutation` com mkdir atômico,
identidade/runId e exclusão mútua cobrindo decisão e alteração. Lock/mutation
não expira por idade. Gate abandonado fica bloqueado para manutenção quiescente.
Cancelamento opera somente a execução autenticada, sem seguir arquivo hostil ou
apagar reserva de outro runId. Árvores presentes/desconhecidas conservam lock.

Estado v1, incompatível ou entrada desconhecida bloqueia novos starts no namespace.
Corrupção segura e delimitada a um ID produz diagnóstico bloqueante nesse ID;
outros IDs seguros continuam disponíveis. Caminho/identidade incerto não é
recuperado automaticamente. `cancel all` ainda processa jobs v2 seguros e informa
entradas que não pode operar.
O produto v2 não adapta, encerra nem remove jobs v1.

## 4. Execução com barreira e supervisor

Todo start, inclusive individual, segue o protocolo de lote:

1. Preflight completo da seleção e captura privada dos descritores/revisões.
2. Reservar IDs em ordem estável; conflito aborta sem comandos da nova seleção.
3. Gravar jobs/manifesta/request privados e iniciar supervisor detached.
4. Workers validam identidade, arquivos e configuração capturada, publicam ready
   e aguardam a barreira. Nenhum comando do usuário roda nesta fase.
5. Supervisor exige todos ready, revisões ainda iguais e claims autenticados;
   publica `released` atomicamente. Antes disso, falha implica zero comandos.
6. Workers passam a barreira, publicam tentativa de spawn e ack observados.
   Windows exige prova de contenção e `resumed:true` para ack.
7. Supervisor permanece após a CLI retornar, observando cada runId do lote.
   Falha de infraestrutura depois da liberação compensa os irmãos ainda ativos.

Prazos: preparação 30 s, ack de spawn 10 s, observação de aborto 10 s,
chamada start pelo hook 60 s. Queries usam 5 s no Linux e 15 s no Windows.
Esses prazos controlam infraestrutura e clientes; **não há deadline da suíte**.

Manifesto v2 tem batchId, state `preparing|released|aborted`, entries
moduleId/runId, identidade do coordenador e deadline. Alterações e compensação
são privadas/autenticadas. Morte de coordenador, worker ou broker exige contenção
ou retenção de estado incerto; não sinalizar processos presumidos.

Após `released`, não existe atomicidade transacional dos comandos: um comando
pode produzir efeitos antes da compensação. Os efeitos externos da suíte não
são revertidos. A compensação só cancela árvores da seleção/runIds conhecidos.
Falha normal de teste, exit code não zero e término sem progresso **não** são
falhas de infraestrutura; não cancelam irmãos. Cancelamento individual após
release afeta somente esse ID. Cancelar durante preparação aborta o lote.

## 5. Runtime e Windows

`inherit` usa ambiente efetivo, PATH e executável capturado; qualquer ID pode
executar Ruby, Python, Java ou Node. `node-project` resolve Node/.nvmrc do módulo
e antepõe esse Node apenas ao PATH filho. Coletor usa seu próprio Node 14+;
Angular 9 pode continuar no Node 12 existente. Não executar nvm use/install,
modificar aliases, junctions, shell startup ou PATH global.

Linux usa bootstrap Bash e contenção por grupo/identidade em `/proc`.
Windows usa PowerShell 5.1/7, `-Module`, argv literal para exe/com e quoting
restrito para cmd/bat. Controles/expansões de shell são recusados antes da reserva.
Broker autentica job/claim v2 e prova privada runId/schema1; cria processo
suspenso, atribui ao Job Object, grava contenção e só então resume.
Cancelamento confirma Job Object vazio; presença/ausência do broker não prova
árvore vazia. Cancel Windows é forçado. Preserve implementação C#/DACL e
recuperação por PID+instante+SID, sem degradar a segurança.

## 6. Comando, painel e lifecycle

Manter um único `/test-progress`, sem invocar modelo:

| Uso | Resultado |
| --- | --- |
| sem argumentos | Consulta e abre painel; nenhum teste iniciado |
| `list` | Catálogo, IDs, linguagens e diagnósticos em texto |
| `start <id|all>` | Início explícito |
| `status [id|all]` | Consulta estado |
| `logs [id|all]` | Logs separados por ID/runId; seleção explícita na pane |
| `cancel [id|all]` | Cancelamento da sessão, inclusive módulos removidos seguros |
| `help`, `paths` | Ajuda e caminhos instalados |
| `--text` | Resposta textual equivalente, inclusive headless |

Autocomplete expõe hint genérico de verbos/ID. Registrar somente comando ausente
ou comprovadamente pertencente ao plugin; colisão de ownership não sobrescreve
outro comando nem para a consulta de estado. Não registrar N slash commands.

Pane usa Box/Text/Button nativos, scroll do host, labels legíveis, ID explícito,
linguagem sem inferir executor, falhas/skip/estado/duração e diagnósticos. Estados
vazios não mostram módulos inventados. Total desconhecido e zero têm textos
próprios. 100% resolvido com comando ativo continua “Em execução”. `all` aparece
como ação de início quando há pelo menos dois habilitados. Botões indisponíveis
têm indicação visual e callback guardado (API nativa não possui `disabled`).

Poll nominal 1 s, sem consultas sobrepostas. Status sempre reconcilia o catálogo,
mesmo enquanto logs estão selecionados. Seleção de logs fixa ID+runId; uma
execução nova não troca os logs silenciosamente. Catálogo/ação renderizados
usam generation/projeção: troca de sessão ou resposta/callback antigo não altera
nem cancela job de outra seleção. Revalidar antes de ação de botão.

AbovePrompt limita-se a três módulos, prioriza ativos/recuperáveis e informa
quantos restam. Módulos removidos/desativados só permanecem se ativos,
recuperáveis ou com diagnóstico de estado. Lifecycle consulta no início, não
inicia testes; fechar pane, clear/resume/branch ou encerrar cliente não mata
workers detached. Recuperação e troca de owner seguem namespace próprio.

## 7. Adoção quiescente e rollback

1. Na versão antiga, encerrar/cancelar jobs v1 e comprovar árvores vazias/locks
   liberados. Não executar clientes de versões diferentes simultaneamente.
2. Guardar configuração antiga e instalação compatível fora do repositório.
3. Substituir configuração por v2, explicitando runtime `node-project` somente
   nos módulos que precisam dele; atualizar templates e paths de adapters.
4. Iniciar sessão de teste isolada, verificar catálogo, execução, logs/cancel e
   estado terminal. Namespace legado ainda existente exige procedimento manual
   autenticado/quiescente, nunca remoção automática por idade.
5. Para rollback, usar v2 para encerrar todos os jobs v2 e confirmar árvore/locks,
   restaurar instalação/configuração antiga em sessão limpa e repetir sua prova.
   O cliente v1 não deve gerenciar IDs/estado v2. Não reescrever snapshots ativos.

Teste de rollback usa apenas fixture temporária e artefato antigo da base Git;
não mexe em configuração real, cache instalado ou outros worktrees.

## 8. Entregas e gates

| Etapa | Responsabilidade | Critério |
| --- | --- | --- |
| B1 | module-id/config/runtime, exemplos | Descoberta só leitura; herança; IDs; seleção/PATH/revisão sanitizados |
| B2 | state/worker/process identities | v2-only; corrupção bloqueia; locks entre processos; árvores/ownership |
| B3 | CLI/coordenador/broker/wrappers | Barreira zero antes release; supervisor após retorno; falhas injetadas |
| B4 | hook/presentation/pane/test kit | Catálogo dinâmico; lifecycle; generation; logs fixos; ações/texto |
| B5 | scripts/workflows/docs/aceite | Matriz, apps reais, segredo, rollback, visual e Windows observados |

Regressões obrigatórias:

| Grupo | Cenários decisivos |
| --- | --- |
| Cadastro | 0, 1, 2, 12 módulos; dois IDs da mesma linguagem; template sem ativação; override env inteiro |
| Preflight | Ferramenta/cwd/Node ausente só quando selecionado; inválido all inicia zero; `.nvmrc` ignorada inherit |
| Segurança | IDs hostis; prototype/device names; JSON/env case collision; segredo/stderr redigidos; links/arquivos hostis |
| Estado | job removido da config; snapshot/claim/runId divergente; v1/desconhecido; mutation abandonada |
| Lote | conflito reserva; ready failure; fonte alterada; prep/ack deadline; worker/broker/coordinator perdido |
| Após release | Compensação por infra; falha normal preserva irmão; cancel individual isolado; cleanup autenticado |
| UI | Catálogo ao vivo/logs; callbacks/respostas atrasados; ownership comando; pane ausente/foco/teclado/scroll |
| Progresso | desconhecido/zero/parcial/100% ativo; logs sem eventos; silêncio longo/heartbeat; rotatividade |
| Plataformas | Node 14.0.0 e atual; Linux; Windows PS5.1/7; app Node distinto; quoting/DACL/árvores |
| Rollout | Adoção e rollback quiescentes; scanner árvore/histórico; instalações e CI no artefato exato |

Gates locais: `python3 scripts/check.py --smoke --pytest`,
`python3 scripts/check-long-running.py`, testes dos adapters afetados,
`claude plugin validate . --strict`, validação do manifest, `claude plugin test .`,
`node scripts/check-soak.mjs 900`, scanner, revisão de fontes e artefato.
Windows: [check-windows.ps1](../scripts/check-windows.ps1), executado nativamente
em PS5.1 e 7. O [workflow](../.github/workflows/windows.yml) prepara collector
Node14/24 e app Node12. Matriz configurada não é CI aprovado.

**Condição de conclusão completa:** gates locais relevantes verdes, rollout
quiescente demonstrado, Windows nativo PS5.1/7 e revisão visual/teclado em CLI e
Desktop reais com 0/1/2/12 módulos. Test kit não comprova pixels; Windows Server
CI não substitui toda aceitação Windows10/11. Sem acesso a essas superfícies,
registrar os aceites pendentes sem anunciar suporte ampliado ou release completa.

Windows será disponibilizado posteriormente pelo usuário; o aceite nativo fica
para essa etapa. Os gates Linux e a implementação continuam nesta entrega.

## 9. Estado da implementação em 05/10/2026

A integração com `main` foi concluída no merge `921b953`. O refactor v2, os
exemplos, a CLI, o supervisor/barreira, o painel e os gates foram commitados em
`ee181b6` e publicados no PR draft #29, seguidos das correções expostas pela CI.
A versão v2 deste checkout pode ser carregada por `--plugin-dir`; a instalação
remota só inclui essas alterações após o merge.

Passaram gates completos com Node 14.0.0/24.20.0, adaptadores reais Linux,
rollout/rollback quiescente, 28 testes do Mod, revisão de padrões/especificação,
stress de 12 módulos e instalação isolada por marketplace local. O soak final
durou 904,1 segundos, com 32 consultas, máximo de 1.090 ms e digest constante.
O CLI real mostrou 0/1/2/12 módulos, teclado/scroll, desconhecido versus zero,
100% ainda ativo, logs, cancelamento individual e troca de owner por `/clear`.

O registro completo e as capturas estão em [VALIDATION.md](VALIDATION.md).
Permanecem para aceite posterior: Windows nativo PS5.1/7, Claude Desktop real,
`/resume` de conversa/branch e a matriz completa de hot reload. A CI remota,
incluindo a matriz Windows Server PS5.1/7, passou nos seis workflows em push e PR
no commit `37b80b7`. CI verde não equivale ao aceite completo dessas superfícies
nem à publicação da v2.
