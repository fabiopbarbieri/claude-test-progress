# Preparar e publicar uma versão

Roteiro para preparar e publicar uma versão `X.Y.Z` (exemplos com `0.3.0`). A
publicação depende de revisão humana e de validação funcional no commit final.
O workflow [Prepare release](../.github/workflows/release.yml) só verifica:
não cria tags, releases, assets nem instala o plugin de usuários.

## Versão e distribuição

- Fonte da versão: [plugin.json](../.claude-plugin/plugin.json). Copie o mesmo
  valor para [package.json](../package.json); este pacote continua privado.
- Use versões estáveis `MAJOR.MINOR.PATCH`, sem prefixo, zeros à esquerda ou
  sufixos neste fluxo. Patch corrige comportamento preservando o contrato;
  minor acrescenta funcionalidades. Durante `0.x`, uma quebra exige novo minor e
  aviso explícito no changelog; depois de `1.0`, exige major.
- Atualize o [changelog](../CHANGELOG.md) no mesmo PR com código que existe e
  limites de aceite. Nunca reutilize uma versão já distribuída. As notas viram
  o corpo da GitHub Release: use links absolutos para a tag
  (`https://github.com/fabiopbarbieri/claude-test-progress/blob/test-progress--vX.Y.Z/...`);
  o verificador recusa links relativos.
- O catálogo mantém `test-progress-marketplace`, plugin `test-progress` e
  `source: "./"`, sem campo `version`. O repositório chama-se
  `claude-test-progress`; nenhuma dessas identidades é intercambiável.
- A tag segue o nome do plugin: **`test-progress--vX.Y.Z`**. A convenção
  permite resolução de dependências por intervalo de versão no repositório do
  marketplace. Não é `claude-test-progress--vX.Y.Z`.
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
com `#<tag>`.

## Responsabilidades antes do merge

O autor prepara versão, notas e evidências. O mantenedor confere escopo, fontes,
CI e comportamento, decide se o bump pode alcançar os usuários e faz o merge pelo
fluxo protegido. Não dispense checks ou proteções. Antes do merge do bump:

1. Conferir README, guias e o [changelog](../CHANGELOG.md) no SHA final: recursos,
   limites de aceite (Windows, Selenium) e, se houver, mudanças incompatíveis.
2. Se novos workflows com gatilho `push` entrarem na `main`, incluí-los em
   `WORKFLOWS` de [check-release.py](../scripts/check-release.py); o teste de
   release falha enquanto a lista divergir.
3. No SHA combinado, repetir as verificações abaixo. Registrar versões,
   resultados, links de CI e limitações na revisão. Não anunciar aceite de
   Selenium nem do Claude Desktop sem evidência própria.

Enquanto esses gates estiverem pendentes, mantenha o PR de bump em **draft**.
Uma evidência de branch não substitui a do SHA integrado.

## Verificação local

Requer Git, Python 3.8+ e Node 14+. Não instale Ruby/Java/Karma para verificar
apenas release/core.
Use ambientes isolados quando selecionar suites opcionais.

```bash
python3 -B -m unittest discover -s tests/release -p 'test_*.py' -v
python3 scripts/check-release.py --expected-version 0.3.0
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

Antes de publicar, instale a candidata a partir de um marketplace Git isolado
(sem a configuração pessoal) e confira `help`, `paths`, `list` e uma suíte
sintética iniciada e concluída pelo painel. `--plugin-dir` e marketplace por
diretório local não comprovam a atualização do cache de instalações Git.

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
O mantenedor ainda revisa a evidência de instalação do SHA escolhido e os
limites anunciados. Se `main` avançar, decida explicitamente se o SHA
continua sendo o correto; nunca substitua o SHA aprovado silenciosamente.

## Publicação humana após aprovação final

Esta seção é um roteiro futuro; nenhum comando de publicação faz parte dos
testes. Registre no PR a aprovação final, o SHA e a versão. Em checkout limpo
desse SHA, com `origin` por SSH, obtenha as refs atuais e verifique novamente:

```bash
git fetch origin main --tags
python3 scripts/check-release.py --expected-version 0.3.0 \
  --expected-sha "$RELEASE_SHA" --main-ref origin/main --require-clean \
  --github-ci fabiopbarbieri/claude-test-progress
claude plugin tag --dry-run
```

`RELEASE_SHA` deve conter os 40 caracteres do commit aprovado; não use um
nome de branch móvel. Finalize a data e o texto do changelog no PR antes de
escolher esse SHA. Confira o plano da tag e a inexistência da tag remota:
`git ls-remote --tags origin refs/tags/test-progress--v0.3.0` deve retornar
vazio. Se existir, pare; não force nem apague a tag.

Somente com a aprovação final explícita, o mantenedor gera as notas fora do
checkout e publica:

```bash
python3 scripts/check-release.py --notes > "$RELEASE_NOTES_FILE"
git tag -a test-progress--v0.3.0 "$RELEASE_SHA" -m 'Test Progress 0.3.0'
git push origin refs/tags/test-progress--v0.3.0
gh release create test-progress--v0.3.0 \
  --repo fabiopbarbieri/claude-test-progress --verify-tag \
  --title 'Test Progress 0.3.0' --notes-file "$RELEASE_NOTES_FILE"
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

Se `X.Y.Z` tiver regressão, prepare `X.Y.(Z+1)` restaurando/corrigindo somente o
código necessário, preservando configurações e formatos de estado. Explique a
regressão no changelog, execute os gates e teste a atualização entre as duas
versões em ambiente isolado antes da aprovação humana.

Publique uma nova tag. Não mova tags publicadas, não reutilize uma versão para
outros bytes e não apague caches, estado ou settings dos usuários como mecanismo
de rollback. Pause a publicação enquanto a correção não tiver evidência
suficiente; uma release removida no GitHub não desfaz o conteúdo já recebido
pelo marketplace Git.
