import test from "node:test";
import assert from "node:assert/strict";
import { buildFilename, classifyDocument, extractDate, extractPdfCandidates, sanitizeSegment } from "../src/collector.mjs";
import { mapHanaProduct } from "../src/adapters/hana.mjs";
import { mapHyundaiProduct } from "../src/adapters/hyundai.mjs";
import { mapDbProduct } from "../src/adapters/db.mjs";
import { parseKbDetail } from "../src/adapters/kb.mjs";
import { mapSamsungProduct } from "../src/adapters/samsung.mjs";
import { mapMeritzProduct } from "../src/adapters/meritz.mjs";
import { mapLotteProduct, parseLotteCatalog } from "../src/adapters/lotte.mjs";
import { mapHeungkukProduct, parseHeungkukRows } from "../src/adapters/heungkuk.mjs";

test("document type classification", () => {
  assert.equal(classifyDocument("상품 요약서 PDF"), "상품요약서");
  assert.equal(classifyDocument("사업방법서 다운로드"), "사업방법서");
  assert.equal(classifyDocument("보험약관"), "보험약관");
});

test("date extraction", () => {
  assert.equal(extractDate("product_20250801_terms.pdf"), "2025-08-01");
  assert.equal(extractDate("상품요약서_250901.pdf"), "2025-09-01");
});

test("safe filename follows requested convention", () => {
  assert.equal(buildFilename({
    insurerName: "현대해상",
    productName: "굿앤굿/어린이보험",
    documentType: "보험약관",
    registeredAt: "2025-08-01"
  }), "현대해상-2025-08-굿앤굿_어린이보험_보험약관_20250801.pdf");
  assert.equal(sanitizeSegment("a:b*c?"), "a_b_c_");
});

test("PDF links are resolved and unofficial hosts are rejected", () => {
  const insurer = {
    id: "sample",
    name: "샘플손해보험",
    allowedHosts: ["official.example"]
  };
  const html = `
    <a href="/files/좋은보험_상품요약서_20250801.pdf">좋은보험 상품요약서</a>
    <a href="https://evil.example/사업방법서_20250801.pdf">외부 파일</a>`;
  const items = extractPdfCandidates(html, "https://official.example/disclosure", insurer);
  assert.equal(items.length, 1);
  assert.equal(items[0].documentType, "상품요약서");
  assert.equal(items[0].registeredAt, "2025-08-01");
});

test("Hana public product response maps to three disclosure documents", () => {
  const documents = mapHanaProduct({
    sPrdNm: "하나 테스트보험",
    sSaleStrDt: "20250801",
    sSaleEndDt: "99999999",
    sSaleStatus: "판매중",
    sPolicyFileID: "policy123",
    sBizFileID: "business123",
    sSummaryFileID: "summary123"
  }, ["상품요약서", "사업방법서", "보험약관"]);
  assert.equal(documents.length, 3);
  assert.equal(documents[0].registeredAt, "2025-08-01");
  assert.equal(documents[0].sourceUrl, "https://sso.hanainsure.co.kr/download/policy123");
});

test("Hyundai public product response maps to three disclosure documents", () => {
  const documents = mapHyundaiProduct({
    prodNm: "현대 테스트보험",
    slStDt: "20250801  ",
    slEdDt: "20260801",
    slYn: "Y",
    clauApnflId: "11111111-1111-1111-1111-111111111111",
    userMthdApnflId: "22222222-2222-2222-2222-222222222222",
    prodSmryApnflId: "33333333-3333-3333-3333-333333333333"
  }, ["상품요약서", "사업방법서", "보험약관"]);
  assert.equal(documents.length, 3);
  assert.equal(documents[0].registeredAt, "2025-08-01");
  assert.equal(documents[0].insurerId, "hyundai");
  assert.equal(documents[0].fileId, "11111111-1111-1111-1111-111111111111");
});

test("DB public product response maps to three disclosure documents", () => {
  const documents = mapDbProduct({
    SQNO: 10085,
    PDC_NM: "무배당 프로미라이프 테스트보험",
    SALE_BEGIN_DAY: "2026.01.01",
    ARC_PDC_SL_YN: "0",
    INPL_FINM: "약관_30652(11)_20260101.pdf",
    BIZ_MDDC_FINM: "사방_30652(11)_20260101.pdf",
    CNSL_SMAR_FINM: "요약_30652(11)_20260101.pdf"
  }, ["상품요약서", "사업방법서", "보험약관"]);
  assert.equal(documents.length, 3);
  assert.equal(documents[0].registeredAt, "2026-01-01");
  assert.equal(documents[0].insurerId, "db");
  assert.match(documents[0].sourceUrl, /^https:\/\/www\.idbins\.com\/cYakgwanDown\.do\?/);
});

test("KB public detail HTML maps disclosure rows", () => {
  const html = `<table><tr>
    <td>20260728</td><td></td>
    <td><a href="/CG802030003.ec?fileNm=20260728_25326_1.pdf"><img alt="보험약관 PDF 보기"></a></td>
    <td><a href="/CG802030003.ec?fileNm=20260728_25326_2.pdf"><img alt="사업방법서 PDF 보기"></a></td>
    <td><a href="/CG802030003.ec?fileNm=20260728_25326_3.pdf"><img alt="상품요약서 PDF 보기"></a></td>
  </tr></table>`;
  const documents = parseKbDetail(html, {
    productCode: "25326",
    productName: "KB 테스트보험(26.07)",
    saleStatus: "판매중"
  }, ["상품요약서", "사업방법서", "보험약관"]);
  assert.equal(documents.length, 3);
  assert.equal(documents[0].registeredAt, "2026-07-28");
  assert.equal(documents[0].insurerId, "kb");
  assert.equal(documents[0].fileName, "20260728_25326_1.pdf");
});

test("Samsung public product response maps three disclosure documents", () => {
  const documents = mapSamsungProduct({
    prdName: "삼성 테스트보험",
    prdGun: "장기보험",
    saleStDt: "20260701",
    saleEnDt: "99991231",
    prdfilename1: "/publication/pdf/TEST_0_20260701_file1.pdf",
    prdfilename2: "/publication/pdf/TEST_0_20260701_file2.pdf",
    prdfilename3: "/publication/pdf/TEST_0_20260701_file3.pdf"
  }, ["상품요약서", "사업방법서", "보험약관"]);
  assert.equal(documents.length, 3);
  assert.equal(documents[0].documentType, "보험약관");
  assert.equal(documents[0].registeredAt, "2026-07-01");
  assert.equal(documents[0].insurerId, "samsung");
  assert.equal(documents[2].sourceUrl, "https://www.samsungfire.com/publication/pdf/TEST_0_20260701_file3.pdf");
});

test("Meritz public product response maps three disclosure documents", () => {
  const documents = mapMeritzProduct({
    ttlNm: "메리츠 테스트보험",
    putupStDdTm: "20260910",
    putupEdDdTm: "-",
    file1: "/cu/test/terms.pdf",
    "file1#[E]": "encrypted-terms",
    file2: "/cu/test/business.pdf",
    "file2#[E]": "encrypted-business",
    file3: "/cu/test/summary.pdf",
    "file3#[E]": "encrypted-summary"
  }, ["상품요약서", "사업방법서", "보험약관"]);
  assert.equal(documents.length, 3);
  assert.equal(documents[0].documentType, "보험약관");
  assert.equal(documents[0].registeredAt, "2026-09-10");
  assert.equal(documents[0].insurerId, "meritz");
  assert.equal(documents[2].encryptedPath, "encrypted-summary");
});

test("Lotte public catalog response maps three disclosure documents", () => {
  const sampleHtml = `
    parent.document.getElementById("searchviewissale").innerHTML = "<table><tr><th scope='col'>상품군</th></tr><tr><td class='alignC'>자동차</td><td class='alignC'>let:way 개인용자동차보험</td><td class='alignC'>2026.09.10 ~ <br>현재</td><td class='alignC'><a href=/upload/C/newProduct/CA00101001_20260910.pdf target='_blank'>약관</a></td><td class='alignC'><a href=/upload/C/newProduct/carmethod_20260801.pdf target='_blank'>사업방법서</a></td><td class='lst alignC'><a href=/upload/C/newProduct/carsum_CA00101001_20251110.pdf target='_blank'>상품요약서</a></td></tr></table>";
    parent.document.getElementById("searchviewisnotsale").innerHTML = "";
  `;
  const products = parseLotteCatalog(sampleHtml);
  assert.equal(products.length, 1);
  assert.equal(products[0].productName, "let:way 개인용자동차보험");
  assert.equal(products[0].registeredAt, "2026-09-10");
  assert.equal(products[0].saleEndedAt, null);
  assert.equal(products[0].saleStatus, "판매중");

  const documents = mapLotteProduct(products[0], ["상품요약서", "사업방법서", "보험약관"]);
  assert.equal(documents.length, 3);
  assert.equal(documents[0].insurerId, "lotte");
  assert.equal(documents[0].insurerName, "롯데손해보험");
  assert.equal(documents[0].documentType, "보험약관");
  assert.equal(documents[0].sourceUrl, "https://www.lotteins.co.kr/upload/C/newProduct/CA00101001_20260910.pdf");
  assert.equal(documents[1].documentType, "사업방법서");
  assert.equal(documents[2].documentType, "상품요약서");
});

test("Heungkuk public table response maps three disclosure documents", () => {
  const sampleHtml = `
    <tr>
      <td><span>의료/건강</span></td>
      <td><span>2026</span></td>
      <td class="t_left"><span>무배당 흥Good 모두 담은 123 치매보험(26.05)</span></td>
      <td class=""><span class="fz14">2026-09-01 </span></td>
      <td>
        <span class="btn_white7"><a href="#" title="약관.pdf" onclick="fn_filedownX('/Upload/gongsi/goods/','약관.pdf', '1789106000893279.pdf'); return false;">상품약관</a></span>
        <span class="btn_white7"><a href="#" title="사업방법서.pdf" onclick="fn_filedownX('/Upload/gongsi/goods/','사업방법서.pdf', '1789106000927799.pdf'); return false;">사업방법서</a></span>
        <span class="btn_white7"><a href="#" title="상품요약서.pdf" onclick="fn_filedownX('/Upload/gongsi/goods/','상품요약서.pdf', '1789106000938417.pdf'); return false;">상품요약서</a></span>
      </td>
    </tr>
  `;
  const products = parseHeungkukRows(sampleHtml, "판매중");
  assert.equal(products.length, 1);
  assert.equal(products[0].productName, "무배당 흥Good 모두 담은 123 치매보험(26.05)");
  assert.equal(products[0].registeredAt, "2026-09-01");
  assert.equal(products[0].saleEndedAt, null);
  assert.equal(products[0].saleStatus, "판매중");

  const documents = mapHeungkukProduct(products[0], ["상품요약서", "사업방법서", "보험약관"]);
  assert.equal(documents.length, 3);
  assert.equal(documents[0].insurerId, "heungkuk");
  assert.equal(documents[0].insurerName, "흥국화재");
  assert.equal(documents[0].documentType, "보험약관");
  assert.equal(documents[0].fileSaveName, "1789106000893279.pdf");
  assert.equal(documents[0].sourceUrl.startsWith("https://www.heungkukfire.co.kr/common/download.do"), true);
  assert.equal(documents[1].documentType, "사업방법서");
  assert.equal(documents[2].documentType, "상품요약서");
});


