# CI e governança

Repositório público pessoal `fabiopbarbieri/claude-test-progress`, branch `main`.
Este guia descreve os workflows, a proteção de `main` e as convenções de
contribuição. Resultados e limites de validação ficam em [VALIDATION](VALIDATION.md).

## Workflows

Todos rodam em runners hospedados, com token `contents: read`, checkout sem
credenciais persistidas, actions fixadas por SHA, limite de duração e
cancelamento de runs anteriores da mesma PR ou branch.

| Workflow | O que exercita |
| --- | --- |
| [Quality](../.github/workflows/quality.yml) | Coletor com Node 14.0.0/Python 3.8 e Node 24/Python 3.14: sintaxe, manifests, links, cadastro, estado, lotes e smoke Python; Gitleaks em arquivos e histórico |
| [Mod integration](../.github/workflows/mod-integration.yml) | `claude plugin validate --strict` e `claude plugin test` com CLI fixado, sem login nem rede |
| [Java, Angular and Playwright adapters](../.github/workflows/adapters.yml) | JUnit/Surefire real (Java 17 e 21), Angular 9/18 com Karma e Chrome headless e Playwright Test mínimo (1.44) e recente com Chromium headless |
| [Ruby](../.github/workflows/ruby.yml) / [Rails](../.github/workflows/rails.yml) | RSpec em Ruby 3.1/3.4/4.0 e Rails 7.2/8.0/8.1 com Minitest |
| [Windows modules](../.github/workflows/windows.yml) | PowerShell 5.1 e 7, coletor Node 14.0.0/24 e app Node 12.22.12 |
| [Prepare release](../.github/workflows/release.yml) | Manual: confere versão, changelog, SHA e CI; não publica nada |

O [check.py](../scripts/check.py) cria projetos temporários com espaços no
caminho e exercita CLI, worker e adapters Python: sucesso, falha intencional,
skip, contadores, exit code e cancelamento. São fixtures do projeto; o CI não
executa suítes dos usuários.

Lacunas conhecidas: aceite numa máquina Windows real (o runner Windows Server
não substitui Windows 10/11), cobertura do pytest 7 como mínimo declarado e
testes de browser com Selenium no Rails. Testes do Mod verificam a árvore e os
callbacks; a aparência exige uma sessão real.

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
  exige PR, os três checks do Quality (`Collector (Node 14.0.0, Python 3.8)`,
  `Collector (Node 24, Python 3.14)` e `Secrets (tree and history)`), branch atualizada com `main`
  e conversas resolvidas; bloqueia force push e exclusão. Desde 05/10/2026,
  `fabiopbarbieri` pode dispensar essas exigências somente ao mesclar uma PR
  (`bypass_mode: pull_request`); push direto continua bloqueado.

No painel de uma PR, a restrição de atualização aparece como
`Cannot update this protected ref`. O mantenedor autorizado dispõe da opção
`Merge without waiting for requirements to be met (bypass rules)` para liberar
a regra de autorização antes de confirmar o merge. A mesma opção também libera
os checks e demais requisitos de `main-quality`. Usar só em PRs triviais
(documentação, metadados), combinável com `[skip ci]` na mensagem do commit:
o bypass também dispensa o scanner `Secrets`. O push resultante em `main` roda o
CI completo, e a [preparação de release](RELEASING.md) exige esse CI verde no SHA
escolhido, então um merge com bypass não chega a release sem os gates.

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
(`integration_id: 15368`). Somente os checks do Quality são exigidos; os demais
workflows rodam em toda PR, mas não bloqueiam o merge. Reavaliar os checks
exigidos ao integrar novas suítes. Evitar filtros que deixem um workflow
obrigatório pendente.
[Checks obrigatórios](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).

Os payloads de criação estão em
[main-quality.json](../.github/rulesets/main-quality.json) e
[main-maintainer-merge.json](../.github/rulesets/main-maintainer-merge.json).
Editar esses arquivos não muda o GitHub automaticamente. A ativação foi conferida
pela leitura dos rulesets e de `/rules/branches/main`; `/branches/main` retorna
`protected: true`.

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
