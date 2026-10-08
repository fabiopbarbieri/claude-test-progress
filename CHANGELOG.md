# Changelog

Gerado por `scripts/release.py` a partir dos commits (gitmoji + Conventional
Commits). A versão em `.claude-plugin/plugin.json` identifica o plugin
distribuído; `package.json` acompanha esse valor.

## [0.9.0] - 2026-10-08

### Funcionalidades

- **skill:** add run-tests to start registered modules through the collector ([64358d2](https://github.com/fabiopbarbieri/claude-test-progress/commit/64358d20a672947f64a1d62fffcce8f1007ed634))

## [0.8.0] - 2026-10-07

### Funcionalidades

- **panel:** open the pane on the first failed log once every run ends ([2e2b888](https://github.com/fabiopbarbieri/claude-test-progress/commit/2e2b888c5cb0564f69cd8545ce7ffc33bd05055d))

### Correções

- **skill:** trigger configure for operating modules and refused cancels ([709e83e](https://github.com/fabiopbarbieri/claude-test-progress/commit/709e83e8db2ddd05731b2223d6c73df98374d1c2))

## [0.7.0] - 2026-10-07

### Funcionalidades

- **panel:** open the pane when an unseen run starts ([1a50d53](https://github.com/fabiopbarbieri/claude-test-progress/commit/1a50d538438ccfa449d20a21ef1ed0f410906be2))
- **release:** automate semantic versioning and changelog via a release PR ([7c78589](https://github.com/fabiopbarbieri/claude-test-progress/commit/7c78589a025034d382553b5e2772cd8f93c414ca))

### Correções

- **skill:** run test-progress actions through the collector CLI ([1e88498](https://github.com/fabiopbarbieri/claude-test-progress/commit/1e88498d3dc2a945c03dd0e65759e1131312db62))

### Documentação

- **skill:** tighten test-progress:configure after audit ([22c143e](https://github.com/fabiopbarbieri/claude-test-progress/commit/22c143e74852e26d3ba4697a095fa555c0049762))

## [0.6.0] - 2026-10-06

### Funcionalidades

- **rails:** accept Minitest 6 ([35e3f77](https://github.com/fabiopbarbieri/claude-test-progress/commit/35e3f77b8060e28b41ebc09c750b648b60cd20ad))
- **playwright:** add a Playwright Test progress reporter ([d890fec](https://github.com/fabiopbarbieri/claude-test-progress/commit/d890fec4419e4f4cedf9cf60b7cc5eea9b62b48e))
- **panel:** scroll the open log with the mouse wheel ([8d089e1](https://github.com/fabiopbarbieri/claude-test-progress/commit/8d089e10d64cde6ba8cfd5b7b77f5c5d9ab799a7))
- **log:** show runner colors in the panel log ([604d57b](https://github.com/fabiopbarbieri/claude-test-progress/commit/604d57b1aefe3bd9f8de8ffca969c6ed25db3105))

### Documentação

- **readme:** simplify README with new logo and panel image ([632834a](https://github.com/fabiopbarbieri/claude-test-progress/commit/632834a6eb8e695dc4e4d873084a41c53a4d8269))

## [0.5.0] - 2026-10-06

### Correções

- **windows:** decode non-UTF-8 runner output with the ANSI code page ([0439aa4](https://github.com/fabiopbarbieri/claude-test-progress/commit/0439aa4b730e5700920e30fda8bdeecd4e2fed9b))
- **collector:** wait out a transient batch gate before refusing a start ([c768485](https://github.com/fabiopbarbieri/claude-test-progress/commit/c76848561152b71694b4cd11d6265998458f3ccd))

### Desempenho

- **windows:** cache host assembly, batch secure dirs and space liveness checks ([151bb43](https://github.com/fabiopbarbieri/claude-test-progress/commit/151bb4363e88681b85a41bf0017454669261d32e))
- **windows:** supervise workers by events instead of PowerShell polling ([ec47482](https://github.com/fabiopbarbieri/claude-test-progress/commit/ec47482a7543ee88b6c6d9267ac6e1ce438ec9bb))
- **windows:** reuse a recent DACL verification on read-only calls ([9f903a5](https://github.com/fabiopbarbieri/claude-test-progress/commit/9f903a5e6e7a6671051f364ce7414c63d91ea916))
- **windows:** scale start deadlines per module and slow idle loops ([6823536](https://github.com/fabiopbarbieri/claude-test-progress/commit/6823536bb347dd9060087ed58065822f4f218303))
- **windows:** run control calls and brokers through a native helper ([8acdf8b](https://github.com/fabiopbarbieri/claude-test-progress/commit/8acdf8b612879621af7174fcd644a059577b0cd8))

### Documentação

- **windows:** record the Windows 11 acceptance ([250b91e](https://github.com/fabiopbarbieri/claude-test-progress/commit/250b91e6a416c560df84c7d07edce9787a034db8))

## [0.4.0] - 2026-10-06

### Funcionalidades

- **panel:** wrap errors, show results instead of full bars, add close and toggle ([1fd005c](https://github.com/fabiopbarbieri/claude-test-progress/commit/1fd005c9bb11a31634f5ac66d9b1192f2394112d))
- **adapters:** add exit adapter that settles runs by exit code ([1950803](https://github.com/fabiopbarbieri/claude-test-progress/commit/195080353b734fc3d4917fda5685489b6dc26569))
- **panel:** show the exit code as the result of exit-adapter runs ([66beed0](https://github.com/fabiopbarbieri/claude-test-progress/commit/66beed01d5e0d315ff396199ea57aaee8714a261))
- **skill:** add test-progress:configure to set up and diagnose modules ([8667f89](https://github.com/fabiopbarbieri/claude-test-progress/commit/8667f8963915ca06bd85fc7d9e8578c03d45bf30))

### Documentação

- declare JUnit 5.14 floor and Minitest 5.27 coverage ([919b1d8](https://github.com/fabiopbarbieri/claude-test-progress/commit/919b1d85b4605a0e66f7150d2a3efaf30ee3592e))
- fold unreleased notes into the 0.3.0 entry ([e2ff7ce](https://github.com/fabiopbarbieri/claude-test-progress/commit/e2ff7ce44742c66be471e1444469749997efcf00))
- document pane close shortcuts and the open-by-keyboard limit ([94995b8](https://github.com/fabiopbarbieri/claude-test-progress/commit/94995b8b5a522db4b84e45634a7f4816e902b967))

## [0.3.0] - 2026-10-05

### ⚠ Mudanças incompatíveis

- Configuration and state require schemaVersion 2. Lane options, implicit start shortcuts and the product demo are removed. Quiesce old jobs before upgrading. ([ee181b6](https://github.com/fabiopbarbieri/claude-test-progress/commit/ee181b6aef10451353af08b3015b1db7e0b34d9d))
- **junit:** the listener no longer loads in apps running Java 11. ([c1e2d38](https://github.com/fabiopbarbieri/claude-test-progress/commit/c1e2d38db6fdda95c08defc48bc6dc7a075d7a2d))
- configurations and state must use schemaVersion 1. ([f8aa76d](https://github.com/fabiopbarbieri/claude-test-progress/commit/f8aa76df9f0f9b6fd3d9c01e28ca1aef5a23e95b))

### Funcionalidades

- publish Test Progress as a standalone Claude marketplace ([9c1cafe](https://github.com/fabiopbarbieri/claude-test-progress/commit/9c1cafe0606852a6a47ffd90eb6b8dbab187643d))
- add opt-in Ruby RSpec progress adapter ([34a1703](https://github.com/fabiopbarbieri/claude-test-progress/commit/34a17039d9e1f874a473b7c35db09e0ce4756936))
- report Rails Minitest progress with native runner semantics ([f9a273a](https://github.com/fabiopbarbieri/claude-test-progress/commit/f9a273af53be13af48415fc87292055301e3b1dc))
- prepare 0.2.0 release and isolated marketplace upgrade ([7d0e73c](https://github.com/fabiopbarbieri/claude-test-progress/commit/7d0e73cb0a19b4321571316390b02c8b80f21577))
- make the PowerShell control timeout configurable ([3fae967](https://github.com/fabiopbarbieri/claude-test-progress/commit/3fae967cf35f830c77e8d1a85db74d0cbb8a70fd))
- default PowerShell 7 control calls to 15 s ([91e014d](https://github.com/fabiopbarbieri/claude-test-progress/commit/91e014d8b7b7f1c1c79d6a4ee68078cb30aa5783))
- **mod:** minimal panel and one-line band ([9d3ef4d](https://github.com/fabiopbarbieri/claude-test-progress/commit/9d3ef4df94ebcfa0e5923db91125625418e53dd0))

### Correções

- persist worker activity during long quiet tests ([6ca576d](https://github.com/fabiopbarbieri/claude-test-progress/commit/6ca576d370fd59c666493d6dc0b3a4f999d5791c))
- preserve native Minitest 5.20 plugin discovery ([ea3c2ba](https://github.com/fabiopbarbieri/claude-test-progress/commit/ea3c2ba5c49f4a766ce05e05b0fa5f0e67db0fef))
- serialize lane lock recovery and scope Maven results by execution ([c07655b](https://github.com/fabiopbarbieri/claude-test-progress/commit/c07655bb33eeab13b1a6bc23b34774d8cc6dcfba))
- honor enabled workspace suites in collector and panel ([a056c55](https://github.com/fabiopbarbieri/claude-test-progress/commit/a056c55b2737f18aa098be3a106fd5d214160426))
- validate private Windows creation and CI rollback history ([13ae9d9](https://github.com/fabiopbarbieri/claude-test-progress/commit/13ae9d92feb8e25bfb7e2f096638f965997be26c))
- pass a real null backup for atomic Windows broker proofs ([396aa0f](https://github.com/fabiopbarbieri/claude-test-progress/commit/396aa0fa9767742456637c4e81eb51101f87881c))
- isolate Windows coordinator handles and share atomic state reads ([0c7edd8](https://github.com/fabiopbarbieri/claude-test-progress/commit/0c7edd8d73dee4022f96f95e0b5956b0f77e0bd4))
- retry bounded Windows sharing conflicts during atomic state writes ([d70ef3f](https://github.com/fabiopbarbieri/claude-test-progress/commit/d70ef3ffee78e30e224323c1a2f0e94ba44e897d))
- authenticate concurrent teardown and native Windows test identities ([dd5cb7b](https://github.com/fabiopbarbieri/claude-test-progress/commit/dd5cb7bd04ee4d40da1165f65c291611380c826b))
- batch Windows identity probes within preparation deadlines ([b2d8ce7](https://github.com/fabiopbarbieri/claude-test-progress/commit/b2d8ce7bb696cfcb6cd277134090a5814fb97d3a))
- bound Windows sharing retries with monotonic backoff ([f7af854](https://github.com/fabiopbarbieri/claude-test-progress/commit/f7af854ec5862b40c320fb13636a91e91968570c))
- yield to gated teardown during state inspection ([37b80b7](https://github.com/fabiopbarbieri/claude-test-progress/commit/37b80b71f3fea105f24fc35d3dafc9ca36c64b87))
- keep running jobs visible while heartbeats hold the gate ([4072635](https://github.com/fabiopbarbieri/claude-test-progress/commit/4072635ded53ed44ec7b0ac56d77187a78d1ae9c))
- align 0.2.0 release prep with breaking v2 modules ([3f9bdbb](https://github.com/fabiopbarbieri/claude-test-progress/commit/3f9bdbba17e2df2dd4facc3eb93a15d4a66f8e40))
- retry cold Windows directory setup and diagnose lingering race locks ([b2a3a98](https://github.com/fabiopbarbieri/claude-test-progress/commit/b2a3a98fd7ed7349e7c6ec32e5608e6d6eb58dde))
- retry transient sharing errors when reading the Windows proof ([8f59f40](https://github.com/fabiopbarbieri/claude-test-progress/commit/8f59f409854bc5a2fdc67d7637dac7c77dfeb596))
- **mod:** queue actions behind polling and stop spawning a shell every second ([32ac5de](https://github.com/fabiopbarbieri/claude-test-progress/commit/32ac5deaf9a622c630e3424fa9cba2e2e754f9c9))
- **maven:** match only whole "Running <class>" lines ([7d9b678](https://github.com/fabiopbarbieri/claude-test-progress/commit/7d9b6787b061eea4ecba1075ab3d370ae13640af))

### Desempenho

- **collector:** read only the log tail and coalesce snapshot writes ([349a0b7](https://github.com/fabiopbarbieri/claude-test-progress/commit/349a0b79351eb930cc57915f8e736bb9de59c692))

### Documentação

- record release verification and extension assessments ([f51c35f](https://github.com/fabiopbarbieri/claude-test-progress/commit/f51c35f6f2c61d958a9cbff6ac64aa2afcbb5565))
- expose Ruby adapter in paths and runner guides ([f48ebd5](https://github.com/fabiopbarbieri/claude-test-progress/commit/f48ebd53c0cc3cb30ea803a2d9cd6a03c059f339))
- distinguish elapsed time from simulated query timeout ([5b4baf0](https://github.com/fabiopbarbieri/claude-test-progress/commit/5b4baf0583ea755fa3a75cc40a840db14cfe4a06))
- record active protection for main ([49681d7](https://github.com/fabiopbarbieri/claude-test-progress/commit/49681d7ed47b2a52fb282751ada2365e20eec87b))
- explain maintainer-only merge confirmation ([4841230](https://github.com/fabiopbarbieri/claude-test-progress/commit/4841230a419c8d72d3330408bf9ae50f9845d0a8))
- orientar contribuições e relatos públicos ([a5bbfdf](https://github.com/fabiopbarbieri/claude-test-progress/commit/a5bbfdf57ab95d908fe1aa455b7b74f229080c59))
- separate quick start, compatibility and operational guides ([6aea890](https://github.com/fabiopbarbieri/claude-test-progress/commit/6aea890e8fc667ea4ff5479755709a141b88a0dd))
- planejar módulos cadastrados por workspace ([f453b92](https://github.com/fabiopbarbieri/claude-test-progress/commit/f453b9217c12efc7d172767bbdd238cb17616f08))
- record real panel captures and completed validation ([98cdfec](https://github.com/fabiopbarbieri/claude-test-progress/commit/98cdfec65c39817d4135bf80c8cc3a9d62e948a7))
- sync v2 plan and validation with remote CI state ([03b4975](https://github.com/fabiopbarbieri/claude-test-progress/commit/03b4975bcec31b1ffff48ece5e77372f490d5cfd))
- finalize 0.2.0 changelog and require dated release heading ([61dff1e](https://github.com/fabiopbarbieri/claude-test-progress/commit/61dff1e3e57e088b073d6ed91fcf9c8f9dae65ec))
- use tag-absolute links in 0.2.0 release notes ([df98f72](https://github.com/fabiopbarbieri/claude-test-progress/commit/df98f72c65a46d3839b065d20b26240fbe1c81e9))
- describe all adapters in manifests and shrink the cover to 188 KB ([85295b0](https://github.com/fabiopbarbieri/claude-test-progress/commit/85295b04c7cf535991a8067b0cc5f13baa2138b3))
- present 0.3.0 as the first public release ([d039247](https://github.com/fabiopbarbieri/claude-test-progress/commit/d039247f446d40f5f19b547e5cc1313757d84aa4))
