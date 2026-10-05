# Evidências: painel e resiliência

Base revisada: `cc9c0aa710fa80d123c00856ec277b8f04741544`.
As correções de runtime estão no commit
`c07655bb33eeab13b1a6bc23b34774d8cc6dcfba`. Os comandos e os limites reproduzíveis
estão em [docs/VALIDATION.md](docs/VALIDATION.md). Este registro complementa o
[registro anterior](docs/VERIFICATION.md), sem transformar evidências anteriores
em aceite desta revisão.

## Resultados locais

- Regressão de recuperação de lock: falhou na base porque o processo concorrente
  reservou a lane durante a remoção. Passou com exclusão mútua cobrindo a operação
  inteira; também foram testadas liberação concorrente, identidade do owner e
  bloqueio conservador após abandono da seção crítica.
- Regressão Maven: falhou na base com `3 != 5`. Passou com 5 resolvidos/1 falha,
  agregados deduplicados e execução Failsafe distinta.
- Node 14.0.0 obtido da distribuição oficial e conferido contra seu SHA-256;
  Node 24.20.0 e Node 26.7.0 instalados: regressões e isolamento do core/demo
  passaram. Gates completos de fontes + smoke passaram com Node 14.0.0 e 24.20.0.
  A checagem curta do soak também passou com Node 14.0.0 (12,058 s, 3 consultas),
  comprovando saída do comando/worker e liberação do lock nessa amostra curta.
- Isolamento Linux: `PATH` vazio, ausência explícita de Python/Ruby/Java/Maven/
  Karma/Rails, demo backend 8/8 (uma falha deliberada), frontend 12/12 (um skip),
  erro `python3`/`ENOENT` somente quando selecionado. Nenhum framework instalado
  globalmente pelo plugin.
- `python3 scripts/check.py --smoke`: fontes, manifests, links, sintaxe,
  unittest pass/fail/skip e cancelamento passaram com Python 3.14.8.
- `python3 scripts/check-long-running.py`: 4 testes passaram (22,958 s): silêncio,
  consultas separadas, rotação de logs e recuperação controlada após perda de worker.
- Claude Code 2.1.289: `plugin validate` passou; o primeiro `plugin test` passou em 9 testes.
  A distribuição npm fixada também foi instalada em prefixo temporário e executou
  os mesmos 9 testes, sem conta ou API key. Isso valida o procedimento do workflow
  localmente; o resultado remoto deve ser conferido no SHA do PR.
- Ajustes de painel e workspace: `plugin test` passou em 14 testes. O check
  de workspace passou com Node 14.0.0 e 26.7.0: somente backend/frontend,
  configuração removida com execução ativa, logs/cancelamento, saída de
  worker/comando e lock liberado. O gate completo de fontes + smoke passou
  novamente com Node 14.0.0 após esses ajustes (`a056c55`).
- Cancelamento Karma (`5f916e7`): a fixture anterior, com polling forçado e
  espera reduzida a 2 s, reproduziu o defeito do gate: `completed`, 2/2, sem
  resultado parcial observável. A fixture corrigida, no mesmo ambiente,
  retornou `cancelled`, 50/51 e `totalStable: false`. O gate completo Angular
  18 passou com aplicativo Node 22.23.3 (arquivo oficial e SHA-256 conferido),
  coletor Node 24.20.0 e Chrome real. Instalação e cache foram isolados;
  manifests e lockfiles não mudaram. No SHA `5f916e7`, os 32 checks da PR
  passaram, incluindo Angular 9 e 18 com coletores Node 14.0.0/24,
  JUnit, Ruby, Rails, fontes/isolamento, scanner e Mod nativo. Os resultados
  podem ser conferidos no [gate de adaptadores](https://github.com/fabiopbarbieri/claude-test-progress/actions/runs/37284775781)
  e na [PR](https://github.com/fabiopbarbieri/claude-test-progress/pull/9).

## Soak

Execução real em Linux, em 2026-10-04 no horário de São Paulo (UTC abaixo).
Runtime: `c07655bb33eeab13b1a6bc23b34774d8cc6dcfba`; não houve alteração de
`runner/**` ou `hooks/**` durante o ensaio.

| Medida | Resultado observado |
| --- | --- |
| Comando | `node scripts/check-soak.mjs 900` |
| Node / Claude | 26.7.0 / 2.1.289 |
| Início UTC | 2026-10-05T01:18:05.115Z |
| Fim UTC | 2026-10-05T01:33:07.310Z |
| Duração medida | 902,195 s (15 min 2,195 s) |
| Consultas reais Claude | 32, em processos separados |
| Maior duração de consulta | 1065 ms |
| Intervalo silencioso | Pelo menos 900 s com 1/2 resolvido |
| Persistência | Mesmo runId; heartbeat avançando; saída/progresso inalterados |
| Resultado final | `completed`, 2/2, exit 0; duração final fixa após reconsulta |
| Encerramento | Lock liberado, worker e comando ausentes por identidade |
| Limpeza | Projeto e namespace somente da fixture removidos; script saiu com 0 |

As consultas tiveram limites próprios (10 s no cliente, 5 s no coletor do Mod),
sem impor timeout total à suíte. Nenhuma chave de API ou chamada ao modelo foi
usada. A fixture foi pública/sintética; este registro não inclui logs, caminhos
locais ou conteúdo autenticado. Ajustes posteriores ao script apenas permitem
Node 14, fixam o SHA no início, desativam atualizações do CLI e evitam uma última
amostra menor que um intervalo de heartbeat. A versão final do script passou
novamente na amostra curta com Node 14.0.0 (12,058 s, 3 consultas).

Gitleaks 8.30.1 (checksum conferido) examinou a árvore e o histórico com saída
redigida, sem achados. A inspeção final não encontrou workers ativos originados
desta worktree; nenhum processo de outra sessão foi encerrado.

## Painel real no Claude interativo

Claude Code 2.1.289 foi aberto com `--plugin-dir` apontando para o checkout e
`--setting-sources ''` em um projeto Node público/sintético descartável. Não
foram feitas chamadas ao modelo. A fixture reproduzível está em
`tests/collector/fixtures/panel-suite.mjs`.

Foram observados progresso conhecido e desconhecido, 100% ainda em execução,
zero testes, sucesso/falha/skip, logs e duas lanes. `/clear` mostrou outra sessão
sem os jobs; `/resume` retornou à sessão com os mesmos runIds; hot reload manteve
as execuções. A perda controlada do worker exibiu o estado órfão, preservou os
contadores e permitiu cancelamento seguro. Depois do cancelamento, a identidade
do worker/comando não existia, o grupo estava vazio e o lock havia sido liberado.

Capturas reais em Linux/Wayland, recortadas diretamente por `grim` para publicar
somente o painel sintético, foram inspecionadas antes de entrar na árvore:

| Estado | Captura |
| --- | --- |
| Worker perdido, resultados conservados e recuperação disponível | [panel-worker-loss.png](docs/assets/panel-worker-loss.png) |
| Grupo órfão encerrado e resultado preservado | [panel-cancelled.png](docs/assets/panel-cancelled.png) |

As capturas foram feitas sobre `50afab1`, com a remoção visual de “total parcial”
então local e posteriormente incorporada a `a056c55`. Não são imagens geradas
nem evidência de uma versão futura. Não contêm conta, conversa, diretório pessoal
ou dados de aplicativos. A evidência de pixels acima cobre esses dois estados;
o harness e as observações interativas têm alcances distintos.

O desenho foi revisado a partir dessas capturas. Os símbolos mantêm rótulos de
texto; ainda aparecem fases técnicas e uma mensagem histórica vermelha no
cancelamento órfão. Não foi encontrada API documentada para consultar/herdar a
cor de fundo do terminal hospedeiro; nenhuma cor pessoal foi fixada no plugin.

## Pendências de aceite

- **Teclado/foco/scroll:** falta o aceite interativo completo dos botões no dock,
  especialmente fechar/reabrir por teclado. O callback de fechar sem cancelar foi
  validado no test kit. `orca-ide computer capabilities --json` continua retornando
  `unsupported_capability` por indisponibilidade de python3-gi/AT-SPI no runtime
  do Orca; as capturas reais foram obtidas pelo compositor Wayland. A configuração
  global do desktop não foi alterada. Larguras menores e contraste não foram medidos.
- **Windows nativo:** PowerShell 5.1/7 e comportamento de Job Objects continuam
  pendentes. Testes Linux e desenho no harness `surface: desktop` não provam Win32
  nem o aplicativo Claude Desktop.
- **Duração:** o soak controlado não prova execuções de horas.
- **Aplicativos/frameworks reais:** esta revisão usa fixtures públicas Node,
  unittest e Angular 18/Karma/Chrome; não amplia o aceite para aplicações privadas,
  Maven paralelo ou Selenium.
- **Documentação externa:** `docs/VALIDATION.md` está pronto para ligação futura
  pelo README. `docs/assets/panel-*.png` contém os dois recortes reais acima;
  README/guias de outra frente não foram alterados.

O PR permanece draft para o aceite de teclado/foco/scroll pendente. Não houve
merge, publicação de release, alteração de tags ou de proteção do repositório.
