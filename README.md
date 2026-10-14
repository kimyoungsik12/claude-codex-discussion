# Claude–Codex 함께 작업하기

**AI에게 아래 한 줄을 전달하세요.** 설치 도구/파일 접근 권한이 있는 Codex 또는 Claude Code가 필요합니다. 일반 웹 채팅만으로는 PC에 설치할 수 없습니다.

> https://github.com/kimyoungsik12/claude-codex-discussion 의 AI_INSTALL.md를 읽고 내 환경에 설치한 뒤 확인해줘.

[AI 설치 안내](AI_INSTALL.md) · [배포 ZIP](https://github.com/kimyoungsik12/claude-codex-discussion/releases/latest) · [검증 범위](TESTING.md)

설계 합의 → 담당 선택 → 구현 → 테스트 → 양쪽 리뷰를 실행하는 개인용 스킬입니다. 기본 구현자는 Claude이며, 관측된 잔여량이 Claude 20% 이하이고 Codex 40% 이상이면 Codex를 선택합니다. 사용자가 지정한 담당자가 우선합니다. 대화만 요청하면 코드를 변경하지 않습니다.

## 가장 쉬운 설치: AI에게 맡기기

ZIP을 **먼저 압축 해제**하고 Codex 또는 Claude에 아래처럼 요청하세요.

> 이 폴더의 AI_INSTALL.md를 읽고 스킬을 설치하고 설치 결과까지 확인해줘: [압축 해제한 폴더의 전체 경로]

## 직접 설치

| 환경 | 압축 해제한 폴더에서 실행 |
|---|---|
| Windows | `install.cmd` 더블클릭 또는 터미널에서 `install.cmd install` |
| macOS | `bash install.sh` |
| Ubuntu / WSL Ubuntu | `bash install.sh` |

Python **3.10 이상**, Claude CLI, Codex CLI가 필요합니다. 설치 스크립트는 Python 표준 라이브러리만 사용하며 pip 설치가 필요 없습니다. 관리자 권한 없이 현재 사용자에게 설치합니다. Windows와 WSL은 별개 환경이므로 AI를 실행하는 쪽에 설치하고 로그인하세요.

- Python: https://www.python.org/downloads/ (Windows는 PATH 추가 옵션 확인). Ubuntu 22.04 이상은 `python3 --version`으로 확인하고 없으면 `sudo apt install python3`를 사용자가 실행합니다. 구형 Ubuntu의 Python이 3.10 미만이면 먼저 업그레이드해야 합니다.
- Claude CLI 공식 설치: https://code.claude.com/docs/en/setup
- Codex CLI 공식 설치: https://developers.openai.com/codex/cli
- 각각 `claude`, `codex`를 실행해 본인 계정으로 로그인하세요. 구독/계정 이용 조건과 비용은 각 서비스에 따릅니다. API 키 사용 환경에서는 구독 잔여량이 제공되지 않을 수 있습니다.

설치 후 새 AI 세션을 여세요. 다음 문장으로 시작할 수 있습니다.

> claude-codex-discussion 스킬로 [원하는 작업]을 설계·합의·구현·테스트·상호 리뷰까지 진행해줘. 설계는 Claude, 구현은 자동 선택해줘.

Codex에서는 `$claude-codex-discussion`, Claude에서는 `/claude-codex-discussion`로도 호출할 수 있습니다. 발견되지 않으면 아래 설치 경로의 SKILL.md를 읽도록 요청하세요.

## 진단·업데이트·제거

- Windows: `install.cmd doctor`, macOS/Ubuntu: `bash install.sh doctor`. 명령 지원 여부를 확인하며 로그인이나 실제 모델 호출 성공을 보장하는 검사는 아닙니다.
- 설치 위치: `~/.codex/skills/claude-codex-discussion`, `~/.claude/skills/claude-codex-discussion`. CODEX_HOME / CLAUDE_CONFIG_DIR를 설정한 경우 그 아래 skills를 사용합니다.
- 업데이트: 진행 중인 협업을 마친 뒤 새 ZIP을 풀고 다시 설치합니다. 이전 버전은 각 설정 폴더의 `skill-backups`에 보존됩니다. 기존 settings.json·상태줄·로그인은 변경하지 않습니다.
- 제거: 위의 **해당 스킬 폴더만** 제거하세요. 로그·백업은 자동 삭제하지 않습니다. 별도로 상태줄을 연결했다면 먼저 그 스킬의 `scripts/usage.py uninstall`로 복구하세요.
- 상세 역할/설정: `skill/SKILL.md`, `skill/references/config.md`. 모델 버전·실행 제한과 파일 범위를 지정할 수 있습니다.

## 알아둘 점

현재 열린 채팅에 메시지를 주고받는 방식이 아니라 독립 CLI 호출로 협업합니다. 선택한 소스 코드는 두 서비스로 전송되므로 비밀 파일을 포함하지 마세요. 로그는 `~/.codex/discussions`에 남으며 다른 사람에게 배포하지 마세요. 이 ZIP에는 계정·프로젝트·사용량 캐시·개인 대화 기록이 들어 있지 않습니다.

사용량은 실제 CLI 이벤트에서 수집하며 오래되거나 없으면 추정하지 않습니다. 전환은 작업 라운드 사이에서 이뤄집니다. 양쪽 서비스가 응답할 수 있어야 상호 리뷰까지 완료할 수 있습니다. 파일당 원자적 쓰기, 제한된 재시도이며 무한 자동 작업·중단 후 자동 재개는 아닙니다.

Windows 실환경과 Ubuntu WSL의 검사 결과, macOS 미검증 범위는 TESTING.md를 확인하세요. GitHub에 업로드할 때는 이 배포 폴더만 올리면 됩니다. 재배포/공개 라이선스 결정은 배포자가 별도로 하세요.
