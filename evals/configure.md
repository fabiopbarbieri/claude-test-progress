# Avaliações da skill `test-progress:configure`

Rode cada prompt numa sessão nova, com a skill ligada e desligada, num projeto
de teste sem `.claude/test-progress.json` (exceto quando o prompt diz o contrário).
Anote o que o Claude abriu, o que pulou e se chegou ao "Feito".

### Cadastrar pytest
Prompt: adiciona os testes pytest deste projeto no painel do test-progress
Should trigger: yes
First file Claude should open: .claude/test-progress.json (no cwd da sessão)
Done looks like: o Claude roda `list` pela CLI (`scripts/run-collector.sh`, `--owner "$CLAUDE_CODE_SESSION_ID"`) e vê o módulo sem diagnóstico, com `command` usando o Python da `.venv` e o caminho absoluto de `adapters/python/run.py`

### Maven no Windows
Prompt: configura o test-progress pro backend Maven, estou no Windows
Should trigger: yes
First file Claude should open: <raiz>/WINDOWS.md
Done looks like: módulo com `command` `[".\\mvnw.cmd", "test"]`, `adapter` `maven`; num Windows real, `list` pela CLI (`run-collector.ps1`) sem diagnóstico

### Sem eventos de progresso
Prompt: o painel do test-progress diz "sem eventos de progresso reconhecidos" no módulo api
Should trigger: yes
First file Claude should open: .claude/test-progress.json
Done looks like: o comando do módulo passa a usar o adapter da tabela, ou `adapter` vira `exit`, e o Claude confirma com `start` e `status` pela CLI: `jobs.api.progressObserved` vira `true`

### Órfão (precisa de um run com `recoveryRequired`)
Prompt: o módulo web aparece com "órfão: processo ainda vivo", resolve isso
Should trigger: yes
First file Claude should open: nenhum; roda `cancel` e depois `status` pela CLI
Done looks like: cancela e confere com `status`, sem apagar locks nem arquivos de estado

### Fora do escopo
Prompt: escreve um teste pytest para a função parse_date
Should trigger: no
Done looks like: o Claude escreve o teste sem carregar a skill nem tocar em `.claude/test-progress.json`
