import { createHash } from "node:crypto";

const BASE_URL = "https://papi.kakaoinsure.com";
const NOTICES_URL = `${BASE_URL}/notilus/v1/notices`;
const REFERER_URL = "https://www.kakaopayinscorp.co.kr/disclosure/goods";

const TYPE_MAP = {
  INSURANCE_POLICY: "보험약관",
  PRODUCT_SUMMARY: "상품요약서",
  BUSINESS_PLAN: "사업방법서"
};

export function parseKakaoDate(str) {
  if (!str) return null;
  const match = str.match(/(\d{2,4})\.(\d{1,2})\.(\d{1,2})/);
  if (!match) return null;
  let year = match[1];
  if (year.length === 2) year = `20${year}`;
  const month = match[2].padStart(2, "0");
  const day = match[3].padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function encodeKakaoUrl(url) {
  if (!url) return url;
  try {
    const match = url.match(/^(https?:\/\/[^/]+)(\/[^?#]*)(\?[^#]*)?(#.*)?$/);
    if (!match) return url;
    const [, origin, pathname, search = "", hash = ""] = match;
    const encodedPath = pathname.split("/").map((seg) => {
      if (!seg) return seg;
      let decoded;
      try { decoded = decodeURIComponent(seg); } catch { decoded = seg; }
      return encodeURIComponent(decoded);
    }).join("/");
    return `${origin}${encodedPath}${search}${hash}`;
  } catch {
    return url;
  }
}

export function mapKakaoProduct(item, documentTypes) {
  const docs = [];
  const parts = (item.etc3 || "").split("~").map((s) => s.trim());
  let registeredAt = parseKakaoDate(parts[0]);
  let saleEndedAt = parts[1] && !parts[1].includes("현재") ? parseKakaoDate(parts[1]) : null;

  if (!registeredAt && item.displayPeriodStart) {
    registeredAt = item.displayPeriodStart.slice(0, 10);
  }

  const saleStatus = (!saleEndedAt || saleEndedAt >= new Date().toISOString().slice(0, 10)) ? "판매중" : "판매중지";
  const category = item.etc1 || "기타";

  for (const file of item.filePathList || []) {
    const docType = TYPE_MAP[file.type];
    if (!docType || !documentTypes.includes(docType)) continue;
    const sourceUrl = encodeKakaoUrl(file.filePath);

    docs.push({
      id: createHash("sha256").update(`kakao:${file.fileId || file.filePath}:${docType}`).digest("hex").slice(0, 20),
      insurerId: "kakao",
      insurerName: "카카오페이손해보험",
      productName: item.title,
      documentType: docType,
      registeredAt,
      saleEndedAt,
      saleStatus,
      productCategory: category,
      fileId: file.fileId,
      sourceUrl
    });
  }
  return docs;
}

export async function searchKakao(filters, fetchImpl = fetch) {
  async function fetchCategory(catId) {
    let page = 0;
    const all = [];
    while (true) {
      const url = `${NOTICES_URL}?categoryId=${catId}&pageNumber=${page}&pageSize=50`;
      const res = await fetchImpl(url, {
        headers: {
          "User-Agent": "InsuScan/0.1 (+public-disclosure-research)",
          "Referer": REFERER_URL
        },
        signal: AbortSignal.timeout(30_000)
      });
      if (!res.ok) throw new Error(`카카오페이손해보험 공시 API 오류: HTTP ${res.status}`);
      const json = await res.json();
      const content = json.data?.content || [];
      all.push(...content);
      if (json.data?.last || content.length === 0) break;
      page++;
    }
    return all;
  }

  const categoryIds = [];
  if (filters.saleStatus === "STOPPED" || filters.saleStatus === "판매중지") {
    categoryIds.push(16);
  } else if (filters.saleStatus === "ON_SALE" || filters.saleStatus === "판매중") {
    categoryIds.push(15);
  } else {
    // Both on-sale (15) and discontinued (16)
    categoryIds.push(15, 16);
  }

  const responses = await Promise.all(categoryIds.map((cid) => fetchCategory(cid)));
  let items = responses.flat();

  // Filter by keyword
  if (filters.keyword && filters.keyword.trim()) {
    const kw = filters.keyword.trim().toLowerCase();
    items = items.filter((p) => (p.title || "").toLowerCase().includes(kw));
  }

  // Map to documents
  const allDocs = items.flatMap((item) => mapKakaoProduct(item, filters.documentTypes));

  // Filter by date range
  const filteredDocs = allDocs.filter((doc) => {
    if (!doc.registeredAt) return false;
    if (filters.startDate && doc.registeredAt < filters.startDate) return false;
    if (filters.endDate && doc.registeredAt > filters.endDate) return false;
    return true;
  });

  const documents = [...new Map(filteredDocs.map((d) => [d.id, d])).values()];

  return {
    insurerId: "kakao",
    documents,
    warning: null,
    metadata: {
      scannedProducts: items.length,
      matchedDocuments: documents.length
    }
  };
}

export async function fetchKakaoPdf(document, fetchImpl = fetch) {
  const url = encodeKakaoUrl(document.sourceUrl);
  const response = await fetchImpl(url, {
    headers: {
      "user-agent": "InsuScan/0.1 (+public-disclosure-research)",
      "referer": REFERER_URL
    },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000)
  });

  if (!response.ok) {
    throw new Error(`카카오페이손해보험 PDF 다운로드 오류: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, sourceUrl: response.url || document.sourceUrl };
}
