# 배포 검증 — 2026-10-14

| 항목 | 결과 |
|---|---|
| Windows / Python 3.10.9 | 설치 테스트 4개, 협업 실행기 단위 테스트 15개 통과 |
| Ubuntu 22.04 WSL / Python 3.10.12 | 동일한 19개 테스트 통과, bash 진입점 실행 확인 |
| macOS | POSIX 경로와 Bash/Python 설치 스크립트 제공. 실제 macOS 기기 실행 미검증 |
| 린트 / 스킬 frontmatter 검사 | 통과 |
| Windows CLI doctor | 현재 설치된 두 CLI의 필수 명령 옵션 확인. 로그인·모델 호출 검사는 아님 |

설치 테스트는 새 임시 사용자 홈에서 양쪽 설치, 공백 경로, 사용자 지정 설정 디렉터리, 한쪽만 설치, 재설치 시 이전 버전 백업, 기존 settings.json 보존, 두 번째 대상 실패 시 첫 번째 대상 복원, 손상된 배포 파일 설치 차단을 검사합니다.

협업 실행기의 실제 인증 호출은 Windows에서 이전에 검증했습니다: 양쪽 설계/리뷰, 실제 사용량 수집, 자동 기본 담당 선택, 실제 구현/테스트가 완료됐습니다. 낮은 Claude 잔여량을 별도 테스트 입력으로 제공했을 때 Codex 자동 선택 후 실제 구현·테스트·양쪽 리뷰도 완료됐습니다. 실제 계정 한도를 소진한 실험은 아닙니다. Ubuntu/macOS에서 실제 모델 호출과 자동 전환을 검증했다는 의미는 아닙니다.

재현: 패키지 루트에서 `python -X utf8 -m unittest test_install` 및 `python -X utf8 -m unittest discover -s skill/scripts -p "test_*.py"`. macOS/Ubuntu는 python 대신 python3를 사용합니다. 이 테스트들은 과금되는 모델 호출을 하지 않습니다.

체크섬 생성/ZIP 재생성: `python -X utf8 build_release.py`. manifest.json은 패키지 손상 검사용이며 서명이나 신원 인증 수단은 아닙니다. 개인 경로·계정·대화 로그·프로젝트 파일·실제 사용량 캐시는 배포하지 않습니다.
