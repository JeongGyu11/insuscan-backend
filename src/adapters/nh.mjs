import { createHash } from "node:crypto";

const BASE_URL = "https://www.nhfire.co.kr";
const ANNOUNCE_URL = `${BASE_URL}/announce/productAnnounce/retrieveInsuranceProductsAnnounce.nhfire`;
const CATALOG_URL = `${BASE_URL}/front/announce/retrievePdtCd.ajax`;
const PDT_INFO_URL = `${BASE_URL}/front/announce/retrievePdtInfo.ajax`;
const DOWNLOAD_URL = `${BASE_URL}/imageView/downloadFile.ajax`;

const GROUP_NAMES = {
  "01": "장기보험",
  "02": "일반보험",
  "03": "자동차보험",
  "04": "농작물재해보험"
};

export function parseTag(xml, tag) {
  const re = new RegExp(`<${tag}>(?:<\\!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`, "g");
  const vals = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    vals.push((m[1] !== undefined ? m[1] : m[2]).trim());
  }
  return vals;
}

export function parseNhCatalog(xml, defaultSaleStatus = "판매중") {
  const cds = parseTag(xml, "pdtCd");
  const nms = parseTag(xml, "pdtNm");
  const addNms = parseTag(xml, "addPdtNm");
  const ntgYns = parseTag(xml, "ntgDivdYn");
  const grs = parseTag(xml, "pdtGrCd");
  const dcds = parseTag(xml, "pdtDcd");

  const products = [];
  for (let i = 0; i < cds.length; i++) {
    const cd = cds[i];
    if (!cd) continue;
    const rawNm = nms[i] || "";
    const addNm = addNms[i] || "";
    const fullName = (ntgYns[i] === "Y" && !rawNm.startsWith("(무)") ? "(무)" : "") + rawNm + addNm;
    products.push({
      pdtCd: cd,
      productName: fullName.trim(),
      pdtGrCd: grs[i] || "",
      pdtDcd: dcds[i] || "",
      category: GROUP_NAMES[grs[i]] || "기타",
      saleStatus: defaultSaleStatus
    });
  }
  return products;
}

export function parseNhPdtInfo(xml, product) {
  const fileIds = parseTag(xml, "fileId");
  const pdtSelStDts = parseTag(xml, "pdtSelStDt");
  const pdtSelEdDts = parseTag(xml, "pdtSelEdDt");
  const plcndSeqns = parseTag(xml, "plcndAfileSeqn");
  const plcndNms = parseTag(xml, "plcndAfileNm");
  const smmrSeqns = parseTag(xml, "smmrAfileSeqn");
  const smmrNms = parseTag(xml, "smmrAfileNm");
  const bzSeqns = parseTag(xml, "bzMtdAfileSeqn");
  const bzNms = parseTag(xml, "bzMtdAfileNm");
  const fireSeqns = parseTag(xml, "fireMtdAfileSeqn");
  const fireNms = parseTag(xml, "fireMtdAfileNm");
  const cfmtYns = parseTag(xml, "cfmtYn");

  const revisions = [];
  for (let i = 0; i < fileIds.length; i++) {
    if (cfmtYns[i] && cfmtYns[i] !== "Y") continue;
    const fileId = fileIds[i];
    if (!fileId) continue;

    const stDtRaw = pdtSelStDts[i] || "";
    const edDtRaw = pdtSelEdDts[i] || "";
    const registeredAt = /^\d{8}$/.test(stDtRaw)
      ? `${stDtRaw.slice(0, 4)}-${stDtRaw.slice(4, 6)}-${stDtRaw.slice(6, 8)}`
      : null;
    const saleEndedAt = /^\d{8}$/.test(edDtRaw) && !["99991231", "29991231"].includes(edDtRaw)
      ? `${edDtRaw.slice(0, 4)}-${edDtRaw.slice(4, 6)}-${edDtRaw.slice(6, 8)}`
      : null;

    revisions.push({
      fileId,
      registeredAt,
      saleEndedAt,
      saleStatus: (!saleEndedAt || saleEndedAt >= new Date().toISOString().slice(0, 10)) ? "판매중" : "판매중지",
      termsFile: plcndNms[i] && plcndSeqns[i] ? { fileName: plcndNms[i], seqn: plcndSeqns[i] } : null,
      summaryFile: smmrNms[i] && smmrSeqns[i] ? { fileName: smmrNms[i], seqn: smmrSeqns[i] } : null,
      methodFile: (bzNms[i] && bzSeqns[i]) ? { fileName: bzNms[i], seqn: bzSeqns[i] } : (fireNms[i] && fireSeqns[i] ? { fileName: fireNms[i], seqn: fireSeqns[i] } : null)
    });
  }
  return revisions;
}

export function mapNhRevision(product, revision, documentTypes) {
  const docs = [];
  const { fileId, registeredAt, saleEndedAt, saleStatus, termsFile, summaryFile, methodFile } = revision;
  if (!fileId || !registeredAt) return docs;

  // 1. 보험약관
  if (termsFile && documentTypes.includes("보험약관")) {
    docs.push({
      id: createHash("sha256").update(`nh:${fileId}:${termsFile.seqn}:보험약관`).digest("hex").slice(0, 20),
      insurerId: "nh",
      insurerName: "NH농협손해보험",
      productName: product.productName,
      documentType: "보험약관",
      registeredAt,
      saleEndedAt,
      saleStatus,
      productCategory: product.category,
      fileId,
      afileSeqn: termsFile.seqn,
      fileName: termsFile.fileName,
      sourceUrl: `${DOWNLOAD_URL}?fileId=${encodeURIComponent(fileId)}&afileSeqn=${encodeURIComponent(termsFile.seqn)}`
    });
  }

  // 2. 상품요약서
  if (summaryFile && documentTypes.includes("상품요약서")) {
    docs.push({
      id: createHash("sha256").update(`nh:${fileId}:${summaryFile.seqn}:상품요약서`).digest("hex").slice(0, 20),
      insurerId: "nh",
      insurerName: "NH농협손해보험",
      productName: product.productName,
      documentType: "상품요약서",
      registeredAt,
      saleEndedAt,
      saleStatus,
      productCategory: product.category,
      fileId,
      afileSeqn: summaryFile.seqn,
      fileName: summaryFile.fileName,
      sourceUrl: `${DOWNLOAD_URL}?fileId=${encodeURIComponent(fileId)}&afileSeqn=${encodeURIComponent(summaryFile.seqn)}`
    });
  }

  // 3. 사업방법서
  if (methodFile && documentTypes.includes("사업방법서")) {
    docs.push({
      id: createHash("sha256").update(`nh:${fileId}:${methodFile.seqn}:사업방법서`).digest("hex").slice(0, 20),
      insurerId: "nh",
      insurerName: "NH농협손해보험",
      productName: product.productName,
      documentType: "사업방법서",
      registeredAt,
      saleEndedAt,
      saleStatus,
      productCategory: product.category,
      fileId,
      afileSeqn: methodFile.seqn,
      fileName: methodFile.fileName,
      sourceUrl: `${DOWNLOAD_URL}?fileId=${encodeURIComponent(fileId)}&afileSeqn=${encodeURIComponent(methodFile.seqn)}`
    });
  }

  return docs;
}

// In-memory caches for fast sub-second repeated queries
let catalogCache = null;
let catalogCacheTime = 0;
const productInfoCache = new Map();

async function fetchCatalog(fetchImpl) {
  const now = Date.now();
  if (catalogCache && (now - catalogCacheTime < 3600_000)) {
    return catalogCache;
  }

  const products = new Map();

  async function fetchGroup(pdtSelYn, pdtGrCd, basicDate = "", flag = "") {
    const body = { type: "ajax", pdtSelYn, pdtGrCd, pdtDcd: "" };
    if (pdtSelYn === "N") {
      body.basicDate = basicDate;
      body.flag = flag;
    }
    const res = await fetchImpl(CATALOG_URL, {
      method: "POST",
      headers: {
        "User-Agent": "InsuScan/0.1 (+public-disclosure-research)",
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": ANNOUNCE_URL
      },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(30_000)
    });
    if (!res.ok) return;
    const xml = await res.text();
    const list = parseNhCatalog(xml, pdtSelYn === "Y" ? "판매중" : "판매중지");
    for (const p of list) {
      if (!products.has(p.pdtCd)) {
        products.set(p.pdtCd, p);
      }
    }
  }

  const groups = ["01", "02", "03", "04"];
  // 1. On sale
  for (const gr of groups) await fetchGroup("Y", gr);
  // 2. Discontinued after 2012-03-02
  for (const gr of groups) await fetchGroup("N", gr, "20120302", "A");
  // 3. Discontinued before 2012-03-01
  for (const gr of groups) await fetchGroup("N", gr, "20120301", "B");

  catalogCache = Array.from(products.values());
  catalogCacheTime = now;
  return catalogCache;
}

export async function searchNh(filters, fetchImpl = fetch) {
  const allProducts = await fetchCatalog(fetchImpl);
  let targetProducts = allProducts;

  // Filter by keyword if provided
  if (filters.keyword && filters.keyword.trim()) {
    const kw = filters.keyword.trim().toLowerCase();
    targetProducts = targetProducts.filter(p => p.productName.toLowerCase().includes(kw));
  } else {
    // If no keyword, default to on-sale products (or saleStatus filter if given)
    if (filters.saleStatus === "STOPPED" || filters.saleStatus === "판매중지") {
      targetProducts = targetProducts.filter(p => p.saleStatus === "판매중지");
    } else {
      // Default to on-sale products for quick scanning
      targetProducts = targetProducts.filter(p => p.saleStatus === "판매중");
    }
  }

  // Concurrency pool to fetch product revision infos
  const CONCURRENCY = 15;
  let idx = 0;
  const allDocuments = [];

  async function worker() {
    while (idx < targetProducts.length) {
      const product = targetProducts[idx++];
      let revisions = productInfoCache.get(product.pdtCd);

      if (!revisions) {
        try {
          const res = await fetchImpl(PDT_INFO_URL, {
            method: "POST",
            headers: {
              "User-Agent": "InsuScan/0.1 (+public-disclosure-research)",
              "Content-Type": "application/x-www-form-urlencoded",
              "Referer": ANNOUNCE_URL
            },
            body: new URLSearchParams({ type: "ajax", fileType: "05", pdtCd: product.pdtCd }).toString(),
            signal: AbortSignal.timeout(30_000)
          });
          if (res.ok) {
            const xml = await res.text();
            revisions = parseNhPdtInfo(xml, product);
            productInfoCache.set(product.pdtCd, revisions);
          }
        } catch {
          revisions = [];
        }
      }

      if (revisions && revisions.length > 0) {
        for (const rev of revisions) {
          const docs = mapNhRevision(product, rev, filters.documentTypes);
          allDocuments.push(...docs);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targetProducts.length) }, () => worker()));

  // Filter documents by date range
  const filteredDocuments = allDocuments.filter(doc => {
    if (!doc.registeredAt) return false;
    if (filters.startDate && doc.registeredAt < filters.startDate) return false;
    if (filters.endDate && doc.registeredAt > filters.endDate) return false;
    return true;
  });

  // Deduplicate by ID
  const documents = [...new Map(filteredDocuments.map(d => [d.id, d])).values()];

  return {
    insurerId: "nh",
    documents,
    warning: null,
    metadata: {
      scannedProducts: targetProducts.length,
      matchedDocuments: documents.length
    }
  };
}

export async function fetchNhPdf(document, fetchImpl = fetch) {
  let fileId = document.fileId;
  let afileSeqn = document.afileSeqn;

  if (!fileId || !afileSeqn) {
    const url = new URL(document.sourceUrl);
    fileId = url.searchParams.get("fileId");
    afileSeqn = url.searchParams.get("afileSeqn");
  }

  if (!fileId || !afileSeqn) {
    throw new Error("NH농협손해보험 PDF 파라미터(fileId, afileSeqn)가 올바르지 않습니다.");
  }

  const response = await fetchImpl(DOWNLOAD_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "referer": ANNOUNCE_URL,
      "user-agent": "InsuScan/0.1 (+public-disclosure-research)"
    },
    body: new URLSearchParams({ fileId, afileSeqn }).toString(),
    signal: AbortSignal.timeout(60_000)
  });

  if (!response.ok) {
    throw new Error(`NH농협손해보험 PDF 다운로드 오류: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, sourceUrl: document.sourceUrl };
}
