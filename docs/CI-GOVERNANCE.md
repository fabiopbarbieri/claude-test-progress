# CI e governança

Avaliação registrada em 04/10/2026 para o repositório público pessoal
`fabiopbarbieri/claude-test-progress`, branch `main`. As propostas abaixo não
ativam proteção de branch nem adicionam workflows. Evidências complementares
estão em [VERIFICATION.md](VERIFICATION.md).

## Baseline observado

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
reporting estão habilitados; proteção de `main` ainda não foi ativada.

O [check.py](../scripts/check.py) verifica sintaxe, manifests, links e arquivos
da distribuição. Seus smoke tests criam um projeto temporário com espaços no
caminho e exercitam CLI, worker e adapters Python: sucesso, falha intencional,
skip, contadores, exit code e cancelamento. São fixtures do nosso projeto;
o CI não executa suites dos usuários. Node 14 é exercitado em execução, além
da análise de sintaxe.

Instalações pelos marketplaces local e remoto passaram com Claude Code
2.1.289. A demo local foi observada no host headless. Isso não comprova pintura
do painel, comportamento Windows ou testes pelo harness oficial do Mod.

## Gaps e evolução proposta

**Comprovado:** o workflow atual não executa Windows, JUnit, Karma nem os hooks
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

## Governança proposta para um proprietário único

Repositórios pessoais têm owner e colaboradores, sem papel granular
`maintain`. A restrição clássica de quem pode fazer push é destinada a
organizações. Branch rulesets estão disponíveis em repositórios públicos no
GitHub Free. [Permissões pessoais](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/permission-levels-for-a-personal-account-repository),
[proteção clássica](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule).

**A — Recomendação:** dois rulesets separados para `main`:

- **Autorização:** `Restrict updates`, com bypass somente do owner/admin e
  modo `For pull requests only`. Colaboradores propõem; o proprietário integra.
- **Qualidade:** exigir PR, os três checks observados, conversas resolvidas e
  bloquear force push/exclusão, sem bypass. Assim, a exceção de autorização
  não dispensa os checks.

Confirmar os atores disponíveis na UI/API antes de ativar. Exigir **zero
aprovações** enquanto houver um único mantenedor: o autor não pode aprovar sua
própria PR. Com segundo revisor real, considerar uma aprovação e descarte de
aprovações antigas. Ao ativar, inclusive o proprietário passa pelo fluxo
branch → PR → checks → merge; continua podendo editar as regras.
[Rulesets e bypass](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository),
[restrição de atualização](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets),
[aprovação de PR](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews).

Selecionar checks pelos nomes registrados e, quando disponível, origem GitHub
Actions. Evitar filtros que deixem um workflow obrigatório pendente.
[Checks obrigatórios](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).

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
