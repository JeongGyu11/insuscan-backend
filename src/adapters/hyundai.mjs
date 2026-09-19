import { createHash, randomBytes } from "node:crypto";

const BASE_URL = "https://www.hi.co.kr";
const PAGE_URL = `${BASE_URL}/serviceAction.do?menuId=100932`;
const API_URL = `${BASE_URL}/ajax.xhi`;
const MENU_ID = "100932";

const compactToIso = (value) => {
  const compact = String(value || "").replace(/\D/g, "").slice(0, 8);
  return /^20\d{6}$/.test(compact) ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` : null;
};

const readCookies = (headers) => {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  return (headers.get("set-cookie") || "").split(/,(?=[^;,]+=)/).map((value) => value.split(";", 1)[0]).join("; ");
};

const requestHeaders = (cookie = "") => ({
  "content-type": "application/json",
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
  if (!page.ok) throw new Error(`현대해상 공시실 응답 오류: HTTP ${page.status}`);
  const cookie = readCookies(page.headers);
  await page.text();
  return cookie;
}

async function requestTransaction(tranId, request, cookie, fetchImpl) {
  const response = await fetchImpl(API_URL, {
    method: "POST",
    headers: requestHeaders(cookie),
    body: JSON.stringify({
      header: {
        gId: `insuscan${Date.now()}${randomBytes(8).toString("hex")}`,
        tranId,
        channelId: "HI-HOME",
        clientIp: "127.0.0.1",
        menuId: MENU_ID,
        loginId: null
      },
      request
    }),
    signal: AbortSignal.timeout(45_000)
  });
  if (!response.ok) throw new Error(`현대해상 공시 API 오류: HTTP ${response.status}`);
  const data = await response.json();
  if (data?.responseStatus?.exceptionOccurred || data?.responseStatus?.exception) {
    throw new Error(data.responseStatus.exception?.message || "현대해상 공시 API가 오류를 반환했습니다.");
  }
  return data.data || {};
}

export function mapHyundaiProduct(product, documentTypes) {
  const registeredAt = compactToIso(product.slStDt);
  const files = [
    ["보험약관", product.clauApnflId],
    ["사업방법서", product.userMthdApnflId],
    ["상품요약서", product.prodSmryApnflId]
  ];
  return files
    .filter(([type, fileId]) => documentTypes.includes(type) && /^[0-9a-f-]{36}$/i.test(String(fileId || "")))
    .map(([documentType, fileId]) => ({
      id: createHash("sha256").update(`hyundai:${fileId}:${documentType}`).digest("hex").slice(0, 20),
      insurerId: "hyundai",
      insurerName: "현대해상",
      productName: String(product.prodNm || "상품명미상").replace(/^\(\s*\)\s*/, "").trim(),
      documentType,
      registeredAt,
      saleEndedAt: compactToIso(product.slEdDt),
      saleStatus: product.slYn === "Y" ? "판매중" : "판매중지",
      fileId,
      sourceUrl: PAGE_URL
    }));
}

export async function searchHyundai(filters, fetchImpl = fetch) {
  const cookie = await openSession(fetchImpl);
  const data = await requestTransaction("HHCA0310M38S", {}, cookie, fetchImpl);
  const products = [...(data.slYProdList || []), ...(data.slNProdList || [])];
  if (!Array.isArray(data.slYProdList) || !Array.isArray(data.slNProdList)) {
    throw new Error("현대해상 상품공시 응답 형식이 변경되었습니다.");
  }
  const matched = products.filter((product) => {
    const registeredAt = compactToIso(product.slStDt);
    return registeredAt && registeredAt >= filters.startDate && registeredAt <= filters.endDate;
  });
  return {
    insurerId: "hyundai",
    documents: matched.flatMap((product) => mapHyundaiProduct(product, filters.documentTypes)),
    warning: null,
    metadata: { scannedProducts: products.length, matchedProducts: matched.length }
  };
}

export async function fetchHyundaiPdf(document, fetchImpl = fetch) {
  if (!/^[0-9a-f-]{36}$/i.test(String(document.fileId || ""))) throw new Error("현대해상 파일 식별자가 올바르지 않습니다.");
  const cookie = await openSession(fetchImpl);
  const file = await requestTransaction("HHCA0310M26S", { apnflId: document.fileId }, cookie, fetchImpl);
  const path = String(file.savPath || "");
  const storedName = String(file.savFileNm || "");
  const extension = String(file.flExts || "").toLowerCase();
  if (!/^\/data\/\d{6}$/.test(path) || !/^[0-9a-f]+$/i.test(storedName) || extension !== "pdf") {
    throw new Error("현대해상 PDF 파일정보 응답 형식이 변경되었습니다.");
  }
  const sourceUrl = `${BASE_URL}/FileActionServlet/download/0${path}/${storedName}.${extension}`;
  const response = await fetchImpl(sourceUrl, {
    method: "POST",
    headers: {
      "user-agent": "InsuScan/0.1 (+public-disclosure-research)",
      referer: PAGE_URL,
      ...(cookie ? { cookie } : {})
    },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) throw new Error(`현대해상 PDF 다운로드 오류: HTTP ${response.status}`);
  return { bytes: Buffer.from(await response.arrayBuffer()), sourceUrl };
}
