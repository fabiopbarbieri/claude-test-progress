# Contribuir

Clone por SSH e trabalhe em uma branch própria:

```bash
git clone git@github.com:fabiopbarbieri/claude-test-progress.git
cd claude-test-progress
git switch -c minha-alteracao
python3 scripts/check.py --smoke
```

Com pytest já instalado no Python usado para verificar:

```bash
python3 scripts/check.py --smoke --pytest
```

Os cenários criam fixtures temporárias com sucessos, falhas intencionais e skips.
Eles conferem contadores, código de saída e cancelamento. Não executam os testes
de outro projeto nem exigem credenciais. Node 14+, Bash e Python 3.8+ são
necessários para os checks Linux. Para os manifests/hooks, use Claude Code:

```bash
claude plugin validate . --strict
claude plugin validate .claude-plugin/plugin.json --strict
```

Instale Gitleaks e confira arquivos e histórico antes de enviar:

```bash
bash scripts/scan-secrets.sh
```

Não versione `.claude/test-progress.json`, `.env`, logs, tokens, dumps, tipos
gerados pelo Claude, ambientes Python, dependências baixadas ou builds Java.
Os tipos em `.claude-plugin/types` são gerados pelo Claude; `tsconfig.json`
aponta para eles e não é um gate independente antes dessa geração.

Em PRs, descreva o comportamento alterado, runners/versões verificados e limites
pendentes. Alterar contagem exige observar seleção, falhas de preparação e
finalização, interrupção, total desconhecido e zero testes. Preserve o contrato
de [eventos dos adaptadores](adapters/README.md) e o código de saída nativo.
Não declare Windows ou painel interativo aceitos usando só uma checagem Linux.

Contribuições ao código são distribuídas sob a [licença MIT](LICENSE).
