# Preparar e publicar uma versão

Este roteiro prepara `0.2.0`. A publicação ainda depende de revisão humana,
integração de documentação e validação funcional no commit final.
O workflow [Prepare release](../.github/workflows/release.yml) só verifica:
não cria tags, releases, assets nem instala o plugin de usuários.

## Versão e distribuição

- Fonte da versão: [plugin.json](../.claude-plugin/plugin.json). Copie o mesmo
  valor para [package.json](../package.json); este pacote continua privado.
- Use versões estáveis `MAJOR.MINOR.PATCH`, sem prefixo, zeros à esquerda ou
  sufixos neste fluxo. Patch corrige comportamento preservando o contrato;
  minor acrescenta funcionalidades. Durante `0.x`, uma quebra exige novo minor,
  aviso explícito e instruções de migração; depois de `1.0`, exige major.
- Atualize o [changelog](../CHANGELOG.md) no mesmo PR com código que existe e
  limites de aceite. Nunca reutilize uma versão já distribuída. As notas viram
  o corpo da GitHub Release: use links absolutos para a tag
  (`https://github.com/fabiopbarbieri/claude-test-progress/blob/test-progress--vX.Y.Z/...`);
  o verificador recusa links relativos.
- O catálogo mantém `test-progress-marketplace`, plugin `test-progress` e
  `source: "./"`, sem campo `version`. O repositório chama-se
  `claude-test-progress`; nenhuma dessas identidades é intercambiável.
- A tag escolhida é **`test-progress--v0.2.0`**, seguindo o nome do plugin.
  A convenção permite resolução de dependências por intervalo de versão no
  repositório do marketplace. Não é `claude-test-progress--v0.2.0`.
- Continue distribuindo pelo Git. Não há ZIP próprio nesta preparação nem
  promessa de digest permanente dos arquivos automáticos do GitHub. Uma futura
  distribuição ZIP precisa gerar e verificar seu próprio asset reproduzível.

O manifest controla a versão calculada e o cache de instalações Git. Alterar
apenas arquivos sem aumentar a versão pode deixar usuários na cópia antiga.
Carregamento com `--plugin-dir` e marketplace adicionado por diretório local
não comprovam atualização desse cache.
[Versões e atualização no Claude](https://code.claude.com/docs/en/plugins/host-marketplace#release-a-new-version).

Tags para dependências usam `<plugin-name>--v<version>` no repositório que
contém o plugin; com source relativo, esse é o repositório do marketplace.
[Dependências e tags](https://code.claude.com/docs/en/plugins/dependencies#release-a-plugin-that-others-depend-on).

**O merge do bump na `main` também é uma decisão de distribuição.** Quem
adicionou o marketplace sem `#ref` pode obter a nova versão ao atualizar, mesmo
antes de existir uma GitHub Release. O workflow manual não bloqueia esse canal.
O mantenedor deve concluir os gates de integração antes de integrar o bump.
Para permanecer em um snapshot, o usuário pode adicionar o marketplace Git
com `#<tag>`; não há migração automática de canal neste PR.

## Responsabilidades antes do merge

O autor prepara versão, notas, teste de atualização e evidências. O mantenedor
confere escopo, fontes, CI e comportamento, decide se o bump pode alcançar os
usuários e faz o merge pelo fluxo protegido. Não dispense checks ou proteções.

A preparação 0.2.0 recebe pela `main` estas entregas, já integradas:
documentação (frente 02, PR #7), validação e correções (frente 03, PR #9) e
módulos v2 com supervisão em lote (frente 06, PR #29). A frente 06 é uma
**mudança incompatível**: config e estado `schemaVersion: 2`, sem lanes, `--lane`
ou demo. Antes do merge do bump:

1. Conferir README, guias e o [changelog](../CHANGELOG.md) no SHA final: seção de
   mudança incompatível, passos de migração a partir de 0.1.0, Node 14 do
   coletor, `runtime: "node-project"` para Node/`.nvmrc` e limites de
   Windows/Selenium. Não reintroduzir texto sobre demo ou lanes.
2. Se novos workflows com gatilho `push` entrarem na `main`, incluí-los em
   `WORKFLOWS` de [check-release.py](../scripts/check-release.py); o teste de
   release falha enquanto a lista divergir.
3. No SHA combinado, repetir as verificações abaixo e o ensaio de atualização.
   Registrar versões, resultados, links de CI e limitações na revisão. Não
   anunciar aceite de Selenium nem do painel interativo sem evidência própria.

Enquanto esses gates estiverem pendentes, mantenha o PR de bump em **draft**.
Uma evidência desta branch não substitui a do SHA integrado.

## Verificação local

Requer Git, Python 3.8+ e Node 14+; o cenário de atualização também requer Bash
e Claude CLI. Não instale Ruby/Java/Karma para verificar apenas release/core.
Use ambientes isolados quando selecionar suites opcionais.

```bash
python3 -B -m unittest discover -s tests/release -p 'test_*.py' -v
python3 scripts/check-release.py --expected-version 0.2.0
python3 scripts/check.py --smoke
python3 scripts/check-long-running.py
bash scripts/scan-secrets.sh
```

O smoke seleciona unittest e exige Python; não torna Python dependência do
core. Os testes de release usam apenas a biblioteca padrão. O verificador
rejeita divergências entre manifests, versão no catálogo, mudança do source,
versão não estável, changelog ausente, reutilização/regressão de tags e, quando
solicitado, SHA incorreto, árvore suja, commit fora de `main` e, quando o SHA
é informado, título do changelog sem data ISO (`## [X.Y.Z] - AAAA-MM-DD`).

Faça commit antes do ensaio. Por exemplo, use o primeiro snapshot público 0.1.0
como origem e o SHA completo da candidata como destino:

```bash
python3 tests/release/marketplace_upgrade.py \
  --previous-sha 9c1cafe0606852a6a47ffd90eb6b8dbab187643d \
  --candidate-sha "$(git rev-parse HEAD)"
```

O ensaio executa comandos reais `claude plugin marketplace add`, `install`,
`marketplace update` e `plugin update`. Exporta os commits para um repositório
Git temporário; somente nos subprocessos, `url.*.insteadOf` redireciona a origem
sintética `git@release-test.invalid:marketplace.git` para esse Git local.
Não faz push, não publica tags e não acessa credenciais pessoais.
[Configuração temporária e URL rewriting do Git](https://git-scm.com/docs/git-config).

`HOME`, `CLAUDE_CONFIG_DIR`, XDG e diretórios temporários ficam isolados; o
ambiente é uma lista permitida sem tokens herdados. O teste verifica origem
Git registrada, commit, versão e cache distintos, bytes dos arquivos, paths
relativos dos hooks e execução do bootstrap instalado a partir de outro
projeto com espaços no caminho. Em ambas as versões, uma suíte unittest real
produz 1 sucesso, 1 falha intencional, 1 skip e exit code 1: em 0.1.0 pelo
contrato v1 (`--lane backend`), em 0.2.0 por um módulo v2 (`--module backend`,
`schemaVersion: 2`). O teste também confere preservação de settings e do
manifest do cache anterior. Ele usa owners distintos por versão; não exercita a
adoção v2 sobre estado legado no mesmo namespace.

O diretório temporário fica disponível para inspeção. `report.json` contém
somente evidência sintética e paths relativos; revise-o antes de anexar ao PR.
É evidência de atualização real do cache por marketplace Git, **não** de
transporte/autenticação SSH/GitHub, pintura do Mod, `--plugin-dir` ou Windows.
Não copie configurações pessoais para repetir o teste.

## Preparar o SHA final no GitHub

Depois do merge aprovado e dos workflows do commit final passarem, um mantenedor
executa **Prepare release → Run workflow**, na branch `main`, informando SHA
completo e versão. O workflow precisa existir na branch padrão para despacho.
[Execução manual no GitHub](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

O workflow exige que o SHA pertença ao histórico da `main` no instante do
despacho, confere versão/tag e o run mais recente de cada workflow
`quality.yml`, `ruby.yml`, `rails.yml`, `adapters.yml`, `mod-integration.yml` e
`windows.yml` no mesmo SHA, evento `push`, branch `main`.
Falha, ausência, cancelamento ou execução pendente bloqueiam a preparação.
Quality inclui scanner de árvore/histórico; Ruby e Rails cobrem suas suites;
Adapters executa JUnit/Surefire e Angular 9/18 com Karma/browser; Mod integration
roda os testes nativos do Mod no Claude CLI fixado; Windows executa os cenários
nativos em PowerShell 5.1/7. A matriz adicional repete release/core em Node
14.0.0 e Node 24.

Os jobs têm somente `contents: read` e, no job que consulta CI, `actions: read`.
Actions são fixadas por SHA; o checkout não persiste credenciais. Inputs entram
por variáveis de ambiente, não como código shell. Não existe gatilho de
publicação em push/PR/tag nem job com permissão de escrita.
[Segurança de Actions](https://docs.github.com/en/actions/reference/security/secure-use).

O resumo verde significa **preparação técnica**, não aprovação de release.
O mantenedor ainda revisa a evidência de atualização do SHA escolhido, os gates
02/03 e os limites anunciados. Se `main` avançar, decida explicitamente se o SHA
continua sendo o correto; nunca substitua o SHA aprovado silenciosamente.

## Publicação humana após aprovação final

Esta seção é um roteiro futuro; nenhum comando de publicação faz parte dos
testes. Registre no PR a aprovação final, o SHA e a versão. Em checkout limpo
desse SHA, com `origin` por SSH, obtenha as refs atuais e verifique novamente:

```bash
git fetch origin main --tags
python3 scripts/check-release.py --expected-version 0.2.0 \
  --expected-sha "$RELEASE_SHA" --main-ref origin/main --require-clean \
  --github-ci fabiopbarbieri/claude-test-progress
claude plugin tag --dry-run
```

`RELEASE_SHA` deve conter os 40 caracteres do commit aprovado; não use um
nome de branch móvel. Finalize a data e o texto do changelog no PR antes de
escolher esse SHA. Confira o plano da tag e a inexistência da tag remota:
`git ls-remote --tags origin refs/tags/test-progress--v0.2.0` deve retornar
vazio. Se existir, pare; não force nem apague a tag.

Somente com a aprovação final explícita, o mantenedor gera as notas fora do
checkout e publica:

```bash
python3 scripts/check-release.py --notes > "$RELEASE_NOTES_FILE"
git tag -a test-progress--v0.2.0 "$RELEASE_SHA" -m 'Test Progress 0.2.0'
git push origin refs/tags/test-progress--v0.2.0
gh release create test-progress--v0.2.0 \
  --repo fabiopbarbieri/claude-test-progress --verify-tag \
  --title 'Test Progress 0.2.0' --notes-file "$RELEASE_NOTES_FILE"
```

`RELEASE_NOTES_FILE` é um arquivo temporário escolhido pelo mantenedor, fora do
repo. Revise as notas antes do último comando. `--verify-tag` evita a criação
implícita de uma tag em outro commit. Se o push da tag passou e a criação da
release falhou, confira o SHA da tag remota e retome apenas a criação da release;
não recrie a tag. Após publicação, confira SHA/tag, notas e instalação por Git
em configuração isolada, preservando a instalação pessoal.

Para usuários do marketplace Git existente, a atualização manual é:

```bash
claude plugin marketplace update test-progress-marketplace
claude plugin update test-progress@test-progress-marketplace
claude plugin list
```

Reinicie a sessão para aplicar os arquivos novos. Instalações fixadas com `#ref`
continuam nesse ref; usuários precisam escolher explicitamente outro. Preserve
as configurações e o estado dos projetos durante qualquer atualização.

## Rollback por correção patch

Se 0.2.0 tiver regressão, prepare `0.2.1` restaurando/corrigindo somente o código
necessário, preservando configurações e formatos de estado. Explique a regressão
no changelog, execute os gates e teste também a atualização **0.2.0 → 0.2.1** em
ambiente isolado antes da aprovação humana. O cenário fornecido é específico
para 0.1.0 → 0.2.0; adapte suas versões esperadas para testar a próxima patch.

Publique uma nova tag `test-progress--v0.2.1`. Não mova tags publicadas, não
reutilize 0.2.0 para outros bytes e não apague caches, estado ou settings dos
usuários como mecanismo de rollback. Pause a publicação enquanto a correção
não tiver evidência suficiente; uma release removida no GitHub não desfaz o
conteúdo já recebido pelo marketplace Git.
