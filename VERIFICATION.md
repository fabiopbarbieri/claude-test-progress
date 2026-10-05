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
- Claude Code 2.1.289: `plugin validate` passou; `plugin test` passou em 9 testes.
  A distribuição npm fixada também foi instalada em prefixo temporário e executou
  os mesmos 9 testes, sem conta ou API key. Isso valida o procedimento do workflow
  localmente; o resultado remoto deve ser conferido no SHA do PR.

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

## Pendências de aceite

- **Captura visual real:** indisponível neste ambiente. `orca-ide computer
  capabilities --json` retornou `unsupported_capability`: “Linux Computer Use
  requires python3-gi and AT-SPI packages. Install python3-gi gir1.2-atspi-2.0
  at-spi2-core, then retry.” Não foi alterada a configuração global do desktop.
  Nenhuma imagem gerada foi publicada como screenshot. Faltam captura e inspeção
  do painel real, teclado/foco/scroll e ciclos reais de `/clear`, `/resume` e hot reload.
- **Windows nativo:** PowerShell 5.1/7 e comportamento de Job Objects continuam
  pendentes. Testes Linux e desenho no harness `surface: desktop` não provam Win32
  nem o aplicativo Claude Desktop.
- **Duração:** o soak controlado não prova execuções de horas.
- **Aplicativos/frameworks reais:** esta revisão usa fixtures públicas Node e
  unittest; não amplia o aceite para Maven paralelo, Karma/browser ou Selenium.
- **Documentação externa:** `docs/VALIDATION.md` está pronto para ligação futura
  pelo README. `docs/assets/panel-*.png` permanece reservado para captura real;
  README/guias de outra frente não foram alterados.

O PR permanece draft até obter e revisar a evidência visual ausente. Não houve
merge, publicação de release, alteração de tags ou de proteção do repositório.
