import { createHash } from "node:crypto";

const BASE_URL = "https://sso.hanainsure.co.kr";
const PAGE_URL = `${BASE_URL}/w/disclosure/product/saleProduct`;
const SEARCH_URL = `${BASE_URL}/w/disclosure/product/searchProduct.json`;
const PAGE_SIZE = 500;

const compactToIso = (value) => {
  const text = String(value || "");
  return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : null;
};

const readCookies = (headers) => {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  return (headers.get("set-cookie") || "").split(/,(?=[^;,]+=)/).map((value) => value.split(";", 1)[0]).join("; ");
};

export function mapHanaProduct(product, documentTypes) {
  const registeredAt = compactToIso(product.sSaleStrDt);
  const files = [
    ["보험약관", product.sPolicyFileID],
    ["사업방법서", product.sBizFileID],
    ["상품요약서", product.sSummaryFileID]
  ];
  return files
    .filter(([type, fileId]) => documentTypes.includes(type) && String(fileId || "").trim())
    .map(([documentType, fileId]) => {
      const sourceUrl = `${BASE_URL}/download/${fileId}`;
      return {
        id: createHash("sha256").update(`hana:${fileId}:${documentType}`).digest("hex").slice(0, 20),
        insurerId: "hana",
        insurerName: "하나손해보험",
        productName: String(product.sPrdNm || "상품명미상").trim(),
        documentType,
        registeredAt,
        saleEndedAt: product.sSaleEndDt === "99999999" ? null : compactToIso(product.sSaleEndDt),
        saleStatus: product.sSaleStatus || null,
        sourceUrl
      };
    });
}

export async function searchHana(filters, fetchImpl = fetch) {
  const page = await fetchImpl(PAGE_URL, {
    headers: { "user-agent": "InsureDocHub/0.1 (+public-disclosure-research)" },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000)
  });
  if (!page.ok) throw new Error(`하나손해보험 공시실 응답 오류: HTTP ${page.status}`);
  const cookie = readCookies(page.headers);
  await page.text();

  const requestPage = async (pageNumber) => {
    const response = await fetchImpl(SEARCH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json;charset=utf-8",
        "user-agent": "InsureDocHub/0.1 (+public-disclosure-research)",
        "referer": PAGE_URL,
        ...(cookie ? { cookie } : {})
      },
      body: JSON.stringify({
        sKeyword: "",
        sSaleYn: "",
        sInsType: "",
        page: pageNumber,
        pageSize: PAGE_SIZE
      }),
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) throw new Error(`하나손해보험 상품 조회 오류: HTTP ${response.status}`);
    const data = await response.json();
    if (!data?.header?.success || !Array.isArray(data.body)) throw new Error("하나손해보험 상품 응답 형식이 변경되었습니다.");
    return data;
  };

  const first = await requestPage(1);
  const totalRows = Number(first.page?.totalRows || first.body.length);
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const pages = [first];
  for (let pageNumber = 2; pageNumber <= totalPages; pageNumber += 1) pages.push(await requestPage(pageNumber));

  const products = pages.flatMap((data) => data.body).filter((product) => {
    const registeredAt = compactToIso(product.sSaleStrDt);
    return registeredAt && registeredAt >= filters.startDate && registeredAt <= filters.endDate;
  });
  const documents = products.flatMap((product) => mapHanaProduct(product, filters.documentTypes));
  return {
    insurerId: "hana",
    documents,
    warning: null,
    metadata: { scannedProducts: totalRows, matchedProducts: products.length }
  };
}
