import { createHash } from "node:crypto";

const BASE_URL = "https://www.samsungfire.com";
const DATA_URL = `${BASE_URL}/vh/data/VH.HDIF0103.do`;
const PDF_PREFIX = "/publication/pdf/";

const TYPE_FILES = [
  ["보험약관", "prdfilename1"],
  ["사업방법서", "prdfilename2"],
  ["상품요약서", "prdfilename3"]
];

const compactToIso = (value) => {
  const compact = String(value || "").replace(/\D/g, "").slice(0, 8);
  return /^20\d{6}$/.test(compact) ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` : null;
};

function officialPdfUrl(value) {
  const path = String(value || "").trim();
  if (!path.startsWith(PDF_PREFIX) || !path.toLowerCase().endsWith(".pdf")) return null;
  const url = new URL(path, BASE_URL);
  return url.hostname === "www.samsungfire.com" ? url.href : null;
}

export function mapSamsungProduct(product, documentTypes) {
  const registeredAt = compactToIso(product?.saleStDt);
  if (!registeredAt || !product?.prdName) return [];
  const saleEndedAt = product.saleEnDt === "99991231" ? null : compactToIso(product.saleEnDt);
  return TYPE_FILES.flatMap(([documentType, field]) => {
    if (!documentTypes.includes(documentType)) return [];
    const sourceUrl = officialPdfUrl(product[field]);
    if (!sourceUrl) return [];
    return [{
      id: createHash("sha256").update(`samsung:${sourceUrl}`).digest("hex").slice(0, 20),
      insurerId: "samsung",
      insurerName: "삼성화재",
      productName: String(product.prdName).trim(),
      documentType,
      registeredAt,
      saleEndedAt,
      saleStatus: product.saleEnDt === "99991231" ? "판매중" : "판매중지",
      productCategory: String(product.prdGun || "").trim(),
      sourceUrl
    }];
  });
}

function readProducts(payload) {
  const body = payload?.responseMessage?.body;
  if (body?.result !== "S" || !Array.isArray(body?.data?.list)) {
    throw new Error("삼성화재 공시 응답 형식이 변경되었습니다.");
  }
  return body.data.list;
}

export async function searchSamsung(filters, fetchImpl = fetch) {
  const response = await fetchImpl(DATA_URL, {
    headers: {
      accept: "application/json",
      referer: "https://www.samsungfire.com/vh/page/VH.HPIF0103.do",
      "user-agent": "InsuScan/0.1 (+public-disclosure-research)"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(45_000)
  });
  if (!response.ok) throw new Error(`삼성화재 공시 조회 오류: HTTP ${response.status}`);
  const products = readProducts(await response.json());
  const mapped = products.flatMap((product) => mapSamsungProduct(product, filters.documentTypes));
  const documents = [...new Map(mapped.map((document) => [document.sourceUrl, document])).values()]
    .filter((document) => document.registeredAt >= filters.startDate && document.registeredAt <= filters.endDate);
  return {
    insurerId: "samsung",
    documents,
    warning: null,
    metadata: { catalogProducts: products.length, matchedDocuments: documents.length }
  };
}

export async function fetchSamsungPdf(document, fetchImpl = fetch) {
  const sourceUrl = officialPdfUrl(new URL(document.sourceUrl).pathname);
  if (!sourceUrl || sourceUrl !== document.sourceUrl) throw new Error("삼성화재 PDF 경로가 올바르지 않습니다.");
  const response = await fetchImpl(sourceUrl, {
    headers: {
      referer: "https://www.samsungfire.com/vh/page/VH.HPIF0103.do",
      "user-agent": "InsuScan/0.1 (+public-disclosure-research)"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) throw new Error(`삼성화재 PDF 다운로드 오류: HTTP ${response.status}`);
  return { bytes: Buffer.from(await response.arrayBuffer()), sourceUrl: response.url || sourceUrl };
}
