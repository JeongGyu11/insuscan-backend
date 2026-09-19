import { createHash } from "node:crypto";

const BASE_URL = "https://www.kbinsure.co.kr";
const LIST_URL = `${BASE_URL}/CG802030001.ec`;
const DETAIL_URL = `${BASE_URL}/CG802030002.ec`;
const FILE_URL = `${BASE_URL}/CG802030003.ec`;
const PAGE_SIZE = 10;
const REQUEST_CONCURRENCY = 8;
const detailCache = new Map();

const compactToIso = (value) => {
  const compact = String(value || "").replace(/\D/g, "").slice(0, 8);
  return /^20\d{6}$/.test(compact) ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` : null;
};

const decodeHtml = (value) => String(value || "")
  .replaceAll("&amp;", "&")
  .replaceAll("&quot;", '"')
  .replaceAll("&#39;", "'")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">");

const stripTags = (value) => decodeHtml(String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());

const readCookies = (headers) => {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  return (headers.get("set-cookie") || "").split(/,(?=[^;,]+=)/).map((value) => value.split(";", 1)[0]).join("; ");
};

const requestHeaders = (cookie = "") => ({
  "user-agent": "InsuScan/0.1 (+public-disclosure-research)",
  referer: LIST_URL,
  ...(cookie ? { cookie } : {})
});

async function decodeResponse(response) {
  return new TextDecoder("euc-kr").decode(await response.arrayBuffer());
}

async function openSession(fetchImpl) {
  const page = await fetchImpl(LIST_URL, {
    headers: { "user-agent": "InsuScan/0.1 (+public-disclosure-research)" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000)
  });
  if (!page.ok) throw new Error(`KB손해보험 공시실 응답 오류: HTTP ${page.status}`);
  const cookie = readCookies(page.headers);
  await page.arrayBuffer();
  return cookie;
}

async function postForm(url, values, cookie, fetchImpl) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      ...requestHeaders(cookie),
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(values),
    redirect: "follow",
    signal: AbortSignal.timeout(45_000)
  });
  if (!response.ok) throw new Error(`KB손해보험 공시 조회 오류: HTTP ${response.status}`);
  return decodeResponse(response);
}

function parseListPage(html) {
  const products = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const match = row[1].match(/detail\(['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\)[^>]*>([\s\S]*?)<\/a>/i);
    if (!match) continue;
    products.push({
      productCode: match[1],
      categoryCode: match[2],
      productSequence: match[3],
      productName: stripTags(match[4]),
      saleStatus: /판매\s*중지/.test(stripTags(row[1])) ? "판매중지" : "판매중"
    });
  }
  const targetRows = [...html.matchAll(/goPage\(['"](\d+)['"]\)/gi)].map((match) => Number(match[1])).filter(Number.isFinite);
  return { products, lastTargetRow: Math.max(1, ...targetRows) };
}

async function inBatches(items, worker, concurrency = REQUEST_CONCURRENCY) {
  const results = [];
  for (let index = 0; index < items.length; index += concurrency) {
    results.push(...await Promise.all(items.slice(index, index + concurrency).map(worker)));
  }
  return results;
}

async function searchCatalog({ keyword = "", onSale = " " }, cookie, fetchImpl) {
  const requestPage = (targetRow) => postForm(LIST_URL, {
    devonTargetRow: String(targetRow),
    devonOrderBy: "",
    gubun: " ",
    goodsNm: keyword,
    onsaleYn: onSale,
    bojongNo: "",
    bojongSeq: "",
    search_onsale_yn: onSale,
    search_bojong_no: "",
    search_gubun: " ",
    search_goods_nm: keyword
  }, cookie, fetchImpl);

  const first = parseListPage(await requestPage(1));
  const rows = [];
  for (let row = 1 + PAGE_SIZE; row <= first.lastTargetRow; row += PAGE_SIZE) rows.push(row);
  const pages = await inBatches(rows, async (row) => parseListPage(await requestPage(row)));
  return [first, ...pages].flatMap((page) => page.products);
}

function buildSearchTokens(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const months = [];
  for (let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); cursor <= end; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    months.push(`${String(cursor.getUTCFullYear()).slice(-2)}.${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  if (months.length <= 18) return [...new Set(months.flatMap((month) => [month, month.replace(".", "")]))];
  const years = [];
  for (let year = start.getUTCFullYear(); year <= end.getUTCFullYear(); year += 1) years.push(String(year).slice(-2));
  return years;
}

function validPdfName(value) {
  const name = String(value || "").trim();
  return name && !/[\\/\u0000-\u001f]/.test(name) && name.toLowerCase().endsWith(".pdf");
}

export function parseKbDetail(html, product, documentTypes) {
  const documents = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const dates = [...stripTags(row[1]).matchAll(/20\d{6}/g)].map((match) => match[0]);
    const registeredAt = compactToIso(dates[0]);
    if (!registeredAt) continue;
    const saleEndedAt = compactToIso(dates[1]);
    for (const link of row[1].matchAll(/href=['"]([^'"]*CG802030003\.ec\?fileNm=([^'"&]+)[^'"]*)['"][^>]*>[\s\S]*?<img[^>]+alt=['"]([^'"]+)['"]/gi)) {
      const documentType = /사업방법서/.test(link[3]) ? "사업방법서" : /상품요약서/.test(link[3]) ? "상품요약서" : /보험약관/.test(link[3]) ? "보험약관" : null;
      const fileName = decodeURIComponent(link[2]);
      if (!documentType || !documentTypes.includes(documentType) || !validPdfName(fileName)) continue;
      const sourceUrl = `${FILE_URL}?fileNm=${encodeURIComponent(fileName)}`;
      documents.push({
        id: createHash("sha256").update(`kb:${product.productCode}:${fileName}:${documentType}`).digest("hex").slice(0, 20),
        insurerId: "kb",
        insurerName: "KB손해보험",
        productName: product.productName,
        documentType,
        registeredAt,
        saleEndedAt,
        saleStatus: product.saleStatus,
        fileName,
        sourceUrl
      });
    }
  }
  return documents;
}

async function fetchProductDocuments(product, documentTypes, cookie, fetchImpl) {
  const key = `${product.productCode}:${product.categoryCode}:${product.productSequence}`;
  let allDocuments = detailCache.get(key);
  if (!allDocuments) {
    const html = await postForm(DETAIL_URL, {
      bojongNo: product.productCode,
      gubun: product.categoryCode,
      bojongSeq: product.productSequence
    }, cookie, fetchImpl);
    allDocuments = parseKbDetail(html, product, ["상품요약서", "사업방법서", "보험약관"]);
    detailCache.set(key, allDocuments);
  }
  return allDocuments.filter((document) => documentTypes.includes(document.documentType));
}

export async function searchKb(filters, fetchImpl = fetch) {
  const cookie = await openSession(fetchImpl);
  const tokens = buildSearchTokens(filters.startDate, filters.endDate);
  const tokenCatalogs = await inBatches(tokens, (keyword) => searchCatalog({ keyword }, cookie, fetchImpl), 3);
  const catalogs = [...tokenCatalogs];

  const currentYear = new Date().getUTCFullYear();
  if (Number(filters.endDate.slice(0, 4)) >= currentYear - 1) {
    const currentProducts = await searchCatalog({ onSale: "Y" }, cookie, fetchImpl);
    catalogs.push(currentProducts.filter((product) => !/(?:\d{2}\.\d{2}|\d{4})(?:\D|$)/.test(product.productName)));
  }

  const candidates = [...new Map(catalogs.flat().map((product) => [`${product.productCode}:${product.categoryCode}:${product.productSequence}`, product])).values()];
  if (candidates.length > 1_200) throw new Error("KB손해보험 조회 후보가 너무 많습니다. 기간을 3년 이내로 줄여주세요.");
  const pages = await inBatches(candidates, (product) => fetchProductDocuments(product, filters.documentTypes, cookie, fetchImpl));
  const documents = pages.flat().filter((document) => document.registeredAt >= filters.startDate && document.registeredAt <= filters.endDate);
  return {
    insurerId: "kb",
    documents,
    warning: null,
    metadata: { searchTokens: tokens.length, candidateProducts: candidates.length, matchedDocuments: documents.length }
  };
}

export async function fetchKbPdf(document, fetchImpl = fetch) {
  if (!validPdfName(document.fileName)) throw new Error("KB손해보험 파일명이 올바르지 않습니다.");
  const cookie = await openSession(fetchImpl);
  const sourceUrl = `${FILE_URL}?fileNm=${encodeURIComponent(document.fileName)}`;
  const response = await fetchImpl(sourceUrl, {
    headers: requestHeaders(cookie),
    redirect: "follow",
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) throw new Error(`KB손해보험 PDF 다운로드 오류: HTTP ${response.status}`);
  return { bytes: Buffer.from(await response.arrayBuffer()), sourceUrl: response.url || sourceUrl };
}
