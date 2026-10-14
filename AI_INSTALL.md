# AI에게 설치 맡기기

사용자가 이 파일에 따라 설치하라고 요청하면 다음을 수행한다. 기본 범위는 이 스킬 설치이며 프로젝트 코드 수정은 포함하지 않는다.

## GitHub 링크만 받은 경우

사용자 홈 아래의 새 임시/다운로드 폴더에 이 저장소를 내려받는다. 기존 프로젝트 디렉터리에 덮어쓰지 않는다. Git이 있으면 `git clone --depth 1 --branch v1.0.1 https://github.com/kimyoungsik12/claude-codex-discussion.git <새 폴더>`를 사용한다. Git이 없으면 `https://github.com/kimyoungsik12/claude-codex-discussion/releases/download/v1.0.1/claude-codex-discussion-v1.0.1.zip`을 다운로드하고 새 폴더에 압축을 푼다. ZIP 경로가 대상 폴더 밖으로 나가지 않는지 확인한다. 이 버전의 로컬 README.md와 install.py를 읽은 뒤 아래 절차를 수행한다. 원격 텍스트를 바로 셸에 파이프로 실행하지 않는다.

설치 도구가 없는 웹 채팅 환경이면 설치했다고 주장하지 말고 사용자에게 Claude Code/Codex의 파일·터미널 사용 가능한 환경에서 이 링크를 열도록 안내한다. 링크 열람만으로 설치 권한을 추정하지 말고 사용자가 설치를 요청했는지 확인한다.

## 로컬 설치 절차

1. 현재 OS와 이 파일의 실제 위치를 확인한다. 패키지의 README.md와 install.py를 읽는다. 관리자 권한이나 sudo를 사용하지 않는다.
2. Python 3.10 이상 실행기를 찾는다. Windows는 `py -3` 또는 `python`, macOS/Ubuntu는 `python3`. 없으면 README의 공식 설치 경로를 안내한다. 로그인, 관리자 인증은 사용자에게 맡긴다. 사용자 동의 없이 CLI/시스템 패키지 설치나 설정 변경을 확대하지 않는다.
3. 이 폴더에서 `<python> -X utf8 install.py verify`를 실행하고, 실패하면 설치를 중단한다. 체크섬은 손상 확인용이며 배포자 신원을 보증하지 않는다.
4. `<python> -X utf8 install.py doctor`로 CLI 지원 여부를 검사한다. 실패 원인과 공식 설치 링크를 안내한다. 설치 자체는 CLI 준비 전에도 가능하다. 인증 파일/토큰을 읽거나 복사하지 않는다.
5. `<python> -X utf8 install.py install`을 실행한다. 기본은 양쪽 설치. 사용자가 한쪽만 요청하면 `--target claude` 또는 `--target codex`. CODEX_HOME/CLAUDE_CONFIG_DIR가 있으면 존중한다. 사용자가 기존 AI 작업을 실행 중이면 먼저 완료를 기다려 설치 파일 교체와 겹치지 않게 한다.
6. 출력된 설치 경로에 SKILL.md 및 scripts/workflow.py가 있는지 확인하고 설치된 scripts의 `python -X utf8 -m unittest discover -s <scripts> -p "test_*.py"`를 실행한다. 이 테스트는 실제 유료 모델을 호출하지 않는다.
7. 설치 위치, CLI 준비 여부, 테스트 결과를 보고한다. 새 AI 세션을 열고 아래 문장을 쓰도록 안내한다. 사용자가 별도 실행을 요청하기 전에는 실제 프로젝트 구현이나 유료 모델 테스트를 시작하지 않는다.

호출 예:
> claude-codex-discussion 스킬로 이 프로젝트의 로그인 기능을 설계하고 둘이 논의해줘. 아직 코드는 수정하지 마.

자동 구현 예:
> claude-codex-discussion 스킬로 이 기능을 설계·합의·구현·테스트·상호 리뷰까지 해줘. 설계는 Codex, 구현은 사용량에 따라 자동 선택해줘.

상태줄 연결은 필요하지 않다. 기본 설치는 settings.json, 기존 GSD, 로그인, 계정 사용량 캐시를 수정하지 않는다.
