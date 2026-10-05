# CI e governança

Estado histórico registrado em 04/10/2026 para o repositório público pessoal
`fabiopbarbieri/claude-test-progress`, branch `main`. A proteção descrita abaixo
foi ativada pela API do GitHub. As sugestões de evolução do CI continuam sendo
propostas. Evidências complementares estão em [VERIFICATION.md](VERIFICATION.md).

## Baseline histórico observado

O [primeiro run Quality](https://github.com/fabiopbarbieri/claude-test-progress/actions/runs/37236035815)
passou no commit `9c1cafe0606852a6a47ffd90eb6b8dbab187643d`, com estes checks:

- `Collector (Node 14.0.0, Python 3.8)`;
- `Collector (Node 24, Python 3.14)`;
- `Secrets (tree and history)`.

O [workflow](../.github/workflows/quality.yml) roda em Linux, em pushes e PRs.
Usa token com `contents: read`, checkout sem credenciais persistidas, actions
fixadas por SHA, limites de duração e cancelamento de runs anteriores da mesma
PR ou branch. O Gitleaks tem versão e checksum fixados e verifica arquivos e
histórico completo. Secret scanning, push protection e private vulnerability
reporting estão habilitados; os dois rulesets de `main` estão ativos.

O [check.py](../scripts/check.py) verifica sintaxe, manifests, links e arquivos
da distribuição. Seus smoke tests criam um projeto temporário com espaços no
caminho e exercitam CLI, worker e adapters Python: sucesso, falha intencional,
skip, contadores, exit code e cancelamento. São fixtures do nosso projeto;
o CI não executa suites dos usuários. Node 14 é exercitado em execução, além
da análise de sintaxe.

Instalações pelos marketplaces local e remoto passaram com Claude Code
2.1.289. A demo local foi observada no host headless. Isso não comprova pintura
do painel, comportamento Windows ou testes pelo harness oficial do Mod.

## Gaps naquele baseline e evolução proposta

**Comprovado naquele baseline:** o workflow então disponível não executa Windows, JUnit, Karma nem os hooks
no harness do Mod. PowerShell/C# não são validados pelo check estático;
XML válido não prova compilação Java.

Prioridades sugeridas, usando fixtures próprias e sem credenciais:

1. **Contrato de progresso e isolamento:** testar eventos inválidos, snapshots
   repetidos, múltiplos scopes, total desconhecido versus zero e agregado Maven
   sem duplicação. Exercitar duas sessões, início concorrente, descendentes e
   recuperação sem encerrar processos estranhos. Interfaces existentes:
   [Progress](../runner/progress.mjs) e [estado](../runner/state.mjs).
2. **Python:** descoberta/setup/teardown com falha, subtests, xfail/XPASS,
   failfast e zero testes; comparar exit code com execução nativa. Acrescentar
   pytest 7 para cobrir o mínimo declarado.
3. **JUnit/Karma:** compilar o [listener](../adapters/junit/pom.xml) em Java 11
   e executar testes dinâmicos, contêiner ignorado e paralelismo. Rodar fixture
   Karma com o [reporter](../adapters/karma/reporter.cjs), incluindo ciclos e
   desconexão. Preservar uma combinação compatível com Angular 9.
4. **Windows:** selecionar explicitamente PowerShell 5.1 e 7 para o broker;
   testar quoting, `.cmd`, DACL, cancelamento de pai/filho/neto e queda do broker.
   **Hipótese:** a contenção implementada funciona conforme o contrato.
   **Risco:** checks Linux não comprovam Job Objects. **Evidência decisiva:**
   execução nativa mostrando término da árvore e recuperação segura. Runner
   Windows Server não substitui todo o aceite Windows 10/11.
5. **Mod:** adicionar `claude plugin validate --strict` e `claude plugin test`
   em job separado com CLI fixado. O harness oficial permite eventos, relógio
   controlado, stubs de processos e botões sem login ou rede. Priorizar troca
   de sessão durante consulta, polling concorrente e respostas inválidas.
   Testes de desenho verificam árvore/callbacks; aparência exige sessão real.
   Não presumir que o harness moderno roda em Node 14.
   [Fonte Anthropic](https://code.claude.com/docs/en/plugins/mods/test).

## Proteção ativa de main

Repositórios pessoais têm owner e colaboradores, sem papel granular
`maintain`. A restrição clássica de quem pode fazer push é destinada a
organizações. Branch rulesets estão disponíveis em repositórios públicos no
GitHub Free. [Permissões pessoais](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/permission-levels-for-a-personal-account-repository),
[proteção clássica](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule).

Dois rulesets separados se aplicam a `refs/heads/main`:

- [main-maintainer-merge](https://github.com/fabiopbarbieri/claude-test-progress/rules/24473698):
  restringe atualizações, com exceção somente para `fabiopbarbieri` em merges
  por PR. A conta foi identificada pelo ID público `49872514`, tipo `User`.
  Push direto não tem exceção. Colaboradores propõem; o mantenedor integra.
- [main-quality](https://github.com/fabiopbarbieri/claude-test-progress/rules/24473696):
  exige PR, os três checks Quality listados acima, branch atualizada com `main`
  e conversas resolvidas; bloqueia force push e exclusão. Não tem bypass,
  inclusive para o proprietário. A exceção de autorização não dispensa qualidade.

No painel de uma PR, a restrição de atualização aparece como
`Cannot update this protected ref`. O mantenedor autorizado dispõe da opção
`Merge without waiting for requirements to be met (bypass rules)` para liberar
a regra de autorização antes de confirmar o merge. Essa exceção não libera os
checks ou demais requisitos de `main-quality`, que não permite bypass.
O controle foi observado na conta proprietária, sem marcar a opção nem fazer merge.

Foram configuradas **zero aprovações obrigatórias** enquanto há um único
mantenedor: o autor não pode aprovar sua própria PR. O descarte de aprovações
antigas está ativo; aprovação do último push e de CODEOWNERS não são exigidas.
Com segundo revisor real, reavaliar uma aprovação obrigatória. Inclusive o
proprietário passa pelo fluxo branch → PR → checks → merge, mas continua podendo
administrar as regras. Um novo mantenedor precisa ser incluído explicitamente
na regra de autorização; conceder acesso de escrita sozinho não libera merge.
[Rulesets e bypass](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository),
[restrição de atualização](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets),
[aprovação de PR](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews).

Os checks foram vinculados aos nomes registrados e à origem GitHub Actions
(`integration_id: 15368`). Os workflows Ruby/Rails dos PRs ainda abertos não são
exigidos globalmente enquanto não fizerem parte da branch principal; exigir agora
bloquearia PRs que ainda não contêm esses workflows. Reavaliar os checks após
integrar novas suítes. Evitar filtros que deixem um workflow obrigatório pendente.
[Checks obrigatórios](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).

Os payloads de criação estão em
[main-quality.json](../.github/rulesets/main-quality.json) e
[main-maintainer-merge.json](../.github/rulesets/main-maintainer-merge.json).
Editar esses arquivos não muda o GitHub automaticamente. A ativação foi conferida
pela leitura dos rulesets e de `/rules/branches/main`; `/branches/main` retornou
`protected: true`, com o mesmo commit. Nenhum PR foi mesclado para testar a regra.

## Convenções e forks

Conventional Commits pode começar como convenção: `feat:`, `fix:`, `docs:`,
`test:` e `ci:`. Uma opção futura é validar título da PR e usar squash, sem
obrigar a reescrever cada commit. Assinatura permanece opcional; exigir commits
assinados demanda verificar também contribuições e bots.
[Assinaturas](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-signed-commits).

Template de PR deve pedir comportamento alterado, evidência, versões e limites.
`CODEOWNERS` indica responsáveis e solicita revisão; não concede permissão nem
restringe merge. Não exigir aprovação do único owner nas próprias PRs.
[CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners).

Preservar `pull_request` sem secrets em runners hospedados. Não executar código
de forks em `pull_request_target`; manter pins SHA e revisar atualizações.
[Segurança de Actions](https://docs.github.com/en/actions/reference/security/secure-use).

## Refactor de módulos v2: definições locais

Em 05/10/2026, esta branch preparou gates para o contrato v2: Quality executa
cadastro/estado/lotes/rollback e smoke Python; Mod valida estritamente diretório
e manifest antes do test kit; [Windows](../.github/workflows/windows.yml) usa
PowerShell 5.1/7, collector Node14/24 e app Node12 separados.

O checkout Quality traz histórico completo para extrair o artefato main anterior
no teste quiescente de rollback. Os jobs continuam com token read-only, actions
pinadas e sem credenciais persistidas. Lint local dos workflows não comprova CI
remoto. Não houve push, execução remota desta alteração ou modificação dos
rulesets. Windows será disponibilizado posteriormente pelo usuário.

Resultados locais e limites: [VALIDATION.md](VALIDATION.md). Reconsultar rulesets
e checks no SHA exato antes de uma integração futura; o estado histórico acima
não foi revalidado nesta entrega.
