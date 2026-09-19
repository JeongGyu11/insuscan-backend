# InsureDoc Hub backend

10개 손해보험사의 공개 공시자료를 같은 형식으로 조회하고 PDF 원본을 정해진 규칙으로 저장하기 위한 백엔드 초안입니다.

## 현재 구현

- `GET /api/health`: 서버 상태
- `GET /api/insurers`: 10개 보험사와 공식 출처·어댑터 상태
- `POST /api/search`: 보험사·기간·문서 유형별 PDF 후보 조회
- `POST /api/download`: 공식 도메인의 PDF만 검증 후 저장
- 파일명: `보험사-yyyy-mm-상품명_문서유형_yyyymmdd.pdf`
- 폴더: `기본경로/보험사/yyyy/mm/`
- 동일 파일명은 기본적으로 건너뜀
- PDF 헤더 검사, 공식 도메인 허용 목록, SHA-256 기록
- 하나손해보험 공개 JSON 공시 조회 어댑터 실연결
- 현대해상 공개 공시 거래 조회 및 PDF 다운로드 어댑터 실연결
- DB손해보험 공개 공시 조회 및 PDF 다운로드 어댑터 실연결
- KB손해보험 공개 상품목록·상세 공시 및 PDF 다운로드 어댑터 실연결
- 삼성화재 공개 공시 거래 조회 및 PDF 다운로드 어댑터 실연결
- 메리츠화재 공개 공시 거래 및 암호화 식별자 기반 PDF 다운로드 어댑터 실연결

## 실행

번들 Node.js 또는 Node.js 20 이상에서 실행합니다.

```powershell
$env:DOWNLOAD_ROOT = "C:\InsuranceDisclosure"
node src/server.mjs
```

기본 주소는 `http://127.0.0.1:8787`입니다.

## 조회 예시

```json
{
  "insurers": ["hyundai", "samsung", "db"],
  "startDate": "2025-01-01",
  "endDate": "2025-12-31",
  "documentTypes": ["상품요약서", "사업방법서", "보험약관"]
}
```

## 중요한 상태 구분

보험사들은 통일된 개발자 API를 공개하지 않습니다. 하나손해보험, 현대해상, 삼성화재, DB손해보험, KB손해보험, 메리츠화재는 각 공시실이 사용하는 공개 요청을 재현해 실제 문서 목록과 PDF를 가져옵니다. `html_pdf_index` 출처는 첫 HTML에서 PDF 링크를 탐색할 수 있고, `dynamic` 출처는 화면 내부 요청을 재현하는 전용 어댑터가 필요합니다. `source_path_required`는 공식 상품공시 목록 주소를 추가로 확정해야 합니다.

재밋 화면과 연결하려면 이 서버를 HTTPS로 배포한 뒤 재밋 허용 출처와 `ZAEMIT_ORIGIN`을 맞춰야 합니다. 로컬 주소는 공개된 재밋 사이트에서 직접 호출할 수 없습니다.
