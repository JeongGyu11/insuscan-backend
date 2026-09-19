import { createHash } from "node:crypto";

const BASE_URL = "https://www.idbins.com";
const PAGE_URL = `${BASE_URL}/FWMAIV1534.do`;
const SEARCH_URL = `${BASE_URL}/insuPcPbanFindProductStep5_AX.do`;

const dottedToIso = (value) => {
  const compact = String(value || "").replace(/\D/g, "").slice(0, 8);
  return /^20\d{6}$/.test(compact) ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` : null;
};

const readCookies = (headers) => {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  return (headers.get("set-cookie") || "").split(/,(?=[^;,]+=)/).map((value) => value.split(";", 1)[0]).join("; ");
};

const requestHeaders = (cookie = "") => ({
  "user-agent": "InsuScan/0.1 (+public-disclosure-research)",
  referer: PAGE_URL,
  ...(cookie ? { cookie } : {})
});

async function openSession(fetchImpl) {
  const page = await fetchImpl(PAGE_URL, {
    headers: { "user-agent": "InsuScan/0.1 (+public-disclosure-research)" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000)
  });
  if (!page.ok) throw new Error(`DB손해보험 공시실 응답 오류: HTTP ${page.status}`);
  const cookie = readCookies(page.headers);
  await page.text();
  return cookie;
}

function validPdfName(value) {
  const name = String(value || "").trim();
  return name && !/[\\/\u0000-\u001f]/.test(name) && name.toLowerCase().endsWith(".pdf");
}

export function mapDbProduct(product, documentTypes) {
  const registeredAt = dottedToIso(product.SALE_BEGIN_DAY);
  const files = [
    ["보험약관", product.INPL_FINM],
    ["사업방법서", product.BIZ_MDDC_FINM],
    ["상품요약서", product.CNSL_SMAR_FINM]
  ];
  return files
    .filter(([type, fileName]) => documentTypes.includes(type) && validPdfName(fileName))
    .map(([documentType, fileName]) => ({
      id: createHash("sha256").update(`db:${product.SQNO}:${fileName}:${documentType}`).digest("hex").slice(0, 20),
      insurerId: "db",
      insurerName: "DB손해보험",
      productName: String(product.PDC_NM || "상품명미상").trim(),
      documentType,
      registeredAt,
      saleStatus: String(product.ARC_PDC_SL_YN) === "1" ? "판매중" : "판매중지",
      fileName,
      sourceUrl: `${BASE_URL}/cYakgwanDown.do?FilePath=InsProduct/${encodeURIComponent(fileName)}`
    }));
}

export async function searchDb(filters, fetchImpl = fetch) {
  const cookie = await openSession(fetchImpl);
  const years = [];
  for (let year = Number(filters.startDate.slice(0, 4)); year <= Number(filters.endDate.slice(0, 4)); year += 1) years.push(year);
  const pages = [];
  for (const year of years) {
    const response = await fetchImpl(SEARCH_URL, {
      method: "POST",
      headers: {
        ...requestHeaders(cookie),
        "content-type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        searchCheck: "1",
        keyword: "",
        beginDate: `${year}0101`,
        endDate: `${year}1231`
      }),
      signal: AbortSignal.timeout(60_000)
    });
    if (!response.ok) throw new Error(`DB손해보험 상품 조회 오류: HTTP ${response.status}`);
    const data = JSON.parse(await response.text());
    if (!Array.isArray(data?.result)) throw new Error("DB손해보험 상품공시 응답 형식이 변경되었습니다.");
    pages.push(...data.result);
  }

  const uniqueProducts = [...new Map(pages.map((product) => [String(product.SQNO), product])).values()];
  const products = uniqueProducts.filter((product) => {
    const registeredAt = dottedToIso(product.SALE_BEGIN_DAY);
    return registeredAt && registeredAt >= filters.startDate && registeredAt <= filters.endDate;
  });
  return {
    insurerId: "db",
    documents: products.flatMap((product) => mapDbProduct(product, filters.documentTypes)),
    warning: null,
    metadata: { scannedProducts: uniqueProducts.length, matchedProducts: products.length }
  };
}

export async function fetchDbPdf(document, fetchImpl = fetch) {
  if (!validPdfName(document.fileName)) throw new Error("DB손해보험 파일명이 올바르지 않습니다.");
  const cookie = await openSession(fetchImpl);
  const sourceUrl = `${BASE_URL}/cYakgwanDown.do?FilePath=InsProduct/${encodeURIComponent(document.fileName)}`;
  const response = await fetchImpl(sourceUrl, {
    headers: requestHeaders(cookie),
    redirect: "follow",
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) throw new Error(`DB손해보험 PDF 다운로드 오류: HTTP ${response.status}`);
  return { bytes: Buffer.from(await response.arrayBuffer()), sourceUrl: response.url || sourceUrl };
}
