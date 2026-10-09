# Benchmark pesado no Windows

Mede quanto o coletor custa enquanto suítes grandes rodam e compara duas
versões dele (A/B). Use antes e depois de uma otimização de desempenho e anexe
a tabela do `compare.mjs` ao PR. Os números valem para a máquina em que foram
medidos; não são aceite.

Requisitos: Windows 10/11 nativo com 4 ou mais núcleos e 8 GB, Windows
PowerShell 5.1 (PowerShell 7 e Git Bash são opcionais), Node 14 ou mais novo no
`PATH` para o coletor e nvm-windows para o Node 14 dos projetos Angular. O
provisionamento baixa o resto sem pedir administrador.

## Projetos de teste

`generate.mjs` cria projetos sintéticos determinísticos. `provision.ps1` instala
Node 14, JDK 17, Maven, Chrome for Testing com versão fixa e o listener JUnit,
gera os projetos e roda `npm ci`, o wrapper do Maven, um aquecimento online do
Maven e o venv do pytest.

| Módulo | Pilha | Testes |
| --- | --- | ---: |
| `ng9-a` | Angular 9 + Karma no Node 14, Chrome headless | 1 200 |
| `ng9-b` | Angular 9 + Karma no Node 14, mais componentes com TestBed | 1 500 |
| `mvn-a` | Java 17, `mvnw.cmd`, JUnit 5 com o listener (`events`) | 1 200 |
| `mvn-b` | Java 17, `mvn.cmd`, reator de 3 módulos sem listener (`maven`) | 1 500 |
| `py-a`, `py-b` | pytest pelo adaptador Python | 3 000 cada |

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\bench\provision.ps1 -Fixtures C:\Tools\tp-bench
```

`-Scale 0.1` gera um décimo dos testes, para um smoke rápido. O
`manifest.json` guarda as contagens esperadas de cada módulo, e o `env.json`
guarda os caminhos das ferramentas. As versões e os hashes ficam em
`C:\Tools\tp-bench-tools.json`; uma segunda execução pula o que já está
instalado, e duas execuções simultâneas são barradas por um lock.

Cada download é conferido pelo hash publicado: SHA-256 do Node, checksum da
API do Adoptium e SHA-512 do Maven. O Chrome for Testing não publica hash, então
o primeiro download é registrado e os seguintes são conferidos contra ele. A
pasta do Chrome recebe leitura para `ALL APPLICATION PACKAGES`, como o
instalador faz em `Program Files`, porque sem isso o sandbox de rede do Chrome
falha em toda execução.

## Rodar

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\bench\bench-heavy.ps1 `
  -Workspace C:\Tools\tp-bench -Scenario S1,S2 -Repeat 3 -Label base
```

No Git Bash: `bash scripts/bench/bench-heavy.sh -Workspace /c/Tools/tp-bench ...`
(`TP_BENCH_POWERSHELL=pwsh` usa o PowerShell 7). `-Checkout` escolhe o coletor
medido; o padrão é o checkout do script.

| Cenário | O que roda | Responde |
| --- | --- | --- |
| `S0` | máquina parada por `-IdleSeconds` | ruído de fundo |
| `S1` | cada módulo sozinho, com e sem o coletor | custo do coletor por pilha |
| `S2` | todos os módulos ao mesmo tempo, com e sem o coletor | cenário pesado em 4 núcleos e 8 GB |
| `S4` | `list`, `start`, `status`, `logs` e `cancel` por Node direto, PowerShell 5.1, PowerShell 7, Git Bash → PowerShell e `run-collector.sh` | custo por chamada da skill e do Mod |
| `S5` | replay das capturas de S1/S2 com 1, 2, 4 e 8 módulos | vazão do coletor, sem Java nem Chrome |
| `S6` | S2 várias vezes na mesma sessão | crescimento e sobras |
| `S7` | `-Repeat` lotes curtos na mesma sessão, com `-HistoryModules` módulos que só esperam `-HistorySeconds`, e `-Calls` chamadas de `status` no fim | quanto o estado acumulado numa sessão longa pesa no coletor (execuções agrupadas de 10 em 10; `stateFiles` conta as entradas) |

A rodada sem o coletor (`raw`) usa `capture.mjs`, que lança o comando como o
coletor lançaria e grava a saída com os tempos em `captures\`. O `replay.mjs`
reproduz essa saída no S5: o coletor processa exatamente as mesmas linhas, sem
Java, Chrome ou Node 14, e o A/B fica rápido e menos ruidoso.

O custo do Claude Code observando um run real (painel aberto ou fechado) é
medido com `scripts\bench-sessions.ps1` e sessões reais, como descrito em
[VALIDATION](../../docs/VALIDATION.md#windows).

## O relatório

Cada execução grava um JSON em `<workspace>\results`. Por rodada, ele registra:

- CPU e memória (média e pico) por grupo: `collector`, `mod` (claude.exe),
  `tests`, `av` (Defender e EDRs conhecidos), `harness`, `wmi` e `sampler`;
- CPU do coletor e do antivírus por mil testes, e o overhead no tempo total
  contra a rodada sem coletor;
- tempo do `start` e de cada módulo;
- `valid` e os motivos de invalidação.

Uma rodada é inválida quando as contagens diferem do `manifest.json`, um módulo
termina em estado inseguro, sobra processo do coletor ou dos testes, sobra
arquivo `.tmp` no estado ou um log passa de 1 MiB. Rodadas inválidas ficam no
relatório e não entram na comparação.

## Comparar duas versões

Mantenha dois checkouts, por exemplo `C:\Tools\tp-base` (main) e
`C:\Tools\tp-cand` (branch), e alterne a ordem: A, B, B, A. Descarte a primeira
rodada depois de ligar a máquina ou de provisionar.

```powershell
node scripts\bench\compare.mjs --a results\base-1.json results\base-2.json --b results\cand-1.json results\cand-2.json
```

Cada métrica mostra mediana, mínimo e máximo de cada lado. Uma mudança só
aparece como `better` ou `worse` acima de 10 % e com as faixas sem sobreposição.
Antes de confiar no A/B, rode a mesma versão dos dois lados (A/A): as medianas
devem ficar a menos de 10 % uma da outra.

## Diagnóstico

Para saber onde o coletor gasta, rode o replay com instrumentação:

```powershell
... bench-heavy.ps1 -Workspace C:\Tools\tp-bench -Scenario S5 -ReplayModules 4 -Repeat 1 -Diagnose
```

- `fs-counter.cjs` conta as chamadas síncronas de arquivo por tipo de arquivo de
  estado, os bytes de `Buffer.alloc` e o atraso do event loop. Ele só age nos
  processos de `runner\`.
- `--cpu-prof` grava perfis do coordenador e do watcher, resumidos por
  `cpuprofile-top.mjs`.
- `-EpermEvery 50` faz um rename em cada 50 falhar com EPERM, como um antivírus
  segurando o arquivo, para medir o atraso nos outros módulos.
- `-DefenderSeconds 300`, como Administrador, grava um
  `New-MpPerformanceRecording` e salva o `Get-MpPerformanceReport` com os
  arquivos e processos que o Defender mais varreu.

A instrumentação só roda no replay, então os processos Node 14 do Karma nunca a
recebem. Não meça e diagnostique na mesma rodada: o diagnóstico custa CPU.

## Num projeto real

Sem administrador e sem os projetos gerados, aponte para um projeto que já tem
`.claude\test-progress.json`:

```powershell
... bench-heavy.ps1 -Workspace C:\caminho\do\projeto -Scenario S1,S2,S4 -Repeat 3
```

Sem `manifest.json`, a rodada só confere se cada módulo terminou como
`completed` ou `failed`. Sem administrador, o Defender ainda é medido por CIM,
mas não há o relatório de varredura.

## Por SSH

Rode o benchmark na sessão interativa do usuário, como o Claude Code roda no
dia a dia. Numa sessão SSH não há desktop interativo, e o serviço de rede do
Chrome cai dentro do sandbox, então o Karma nunca captura o navegador. Nesse caso
o `bench-heavy.ps1` liga `TP_BENCH_CHROME_NO_SANDBOX`, o `karma.conf` gerado
acrescenta `--no-sandbox`, e o relatório registra `chromeNoSandbox`. Numa VM
controlada por SSH, uma tarefa agendada com logon interativo
(`New-ScheduledTaskPrincipal -LogonType Interactive`) roda o benchmark na
sessão do usuário. Ela também sobrevive à queda da conexão.

## Limites

- Um processo que vive menos que o intervalo de amostragem (`-SampleMs`, 1 s) não
  entra na CPU do grupo dele; só aparece na CPU da máquina.
- A CPU da máquina inteira numa VM é ruidosa; compare grupos, não o total.
- Numa VM aberta por RDP com a área de transferência compartilhada, o `rdpclip.exe`
  já chegou a 13 GB de memória e derrubou uma campanha por falta de memória virtual.
  Não copie nada grande no host durante a campanha, e rode cada `bench-heavy.ps1`
  num processo próprio para uma falha não levar as rodadas seguintes.
- O Chrome for Testing tem versão fixa, mas o JDK e o Maven ficam na versão
  instalada; registre-as no PR (`tools` no relatório).
