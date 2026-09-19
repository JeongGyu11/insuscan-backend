import { createHash } from "node:crypto";

const BASE_URL = "https://www.heungkukfire.co.kr";
const PAGE_URL = `${BASE_URL}/FRW/announce/insGoodsGongsiSale.do`;
const DOWNLOAD_URL = `${BASE_URL}/common/download.do`;

export function parseHeungkukRows(html, saleStatus) {
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  const products = [];
  while ((match = rowRegex.exec(html)) !== null) {
    const row = match[1];
    if (row.includes("<th") || row.includes("조회된 내역이 없습니다")) continue;

    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1].trim());
    if (cells.length < 5) continue;

    const category = cells[0].replace(/<[^>]+>/g, "").trim();
    const saleYear = cells[1].replace(/<[^>]+>/g, "").trim();
    const productName = cells[2].replace(/<[^>]+>/g, "").trim();
    const dateText = cells[3].replace(/<[^>]+>/g, "").trim();

    const dateParts = dateText.split("~").map((s) => s.trim());
    const registeredAt = /^\d{4}-\d{2}-\d{2}$/.test(dateParts[0]) ? dateParts[0] : null;
    const saleEndedAt = dateParts[1] && /^\d{4}-\d{2}-\d{2}$/.test(dateParts[1]) ? dateParts[1] : null;

    const btnRegex = /<a\b[^>]*onclick=["']fn_filedownX\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"][^)]*\)[^>]*>([\s\S]*?)<\/a>/gi;
    let fMatch;
    const files = [];
    while ((fMatch = btnRegex.exec(cells[4])) !== null) {
      const filePath = fMatch[1];
      const fileRealName = fMatch[2];
      const fileSaveName = fMatch[3];
      const label = fMatch[4].replace(/<[^>]+>/g, "").trim();

      let docType = null;
      if (/약관/i.test(label) || /약관/i.test(fileRealName)) docType = "보험약관";
      else if (/방법서/i.test(label) || /방법서/i.test(fileRealName)) docType = "사업방법서";
      else if (/요약서/i.test(label) || /요약서/i.test(fileRealName)) docType = "상품요약서";

      if (docType) {
        files.push({ filePath, fileRealName, fileSaveName, docType });
      }
    }

    products.push({
      category,
      saleYear,
      productName,
      registeredAt,
      saleEndedAt,
      saleStatus,
      files
    });
  }
  return products;
}

export function parseLastPage(html) {
  const endMatch = html.match(/goPage\((\d+)\)[^>]*class=["']go_end["']/i) 
    || html.match(/class=["']go_end["'][^>]*goPage\((\d+)\)/i);
  if (endMatch) return parseInt(endMatch[1]);

  const allMatches = [...html.matchAll(/goPage\((\d+)\)/g)].map((m) => parseInt(m[1]));
  const onMatch = html.match(/class=["']on["']><span>(\d+)<\/span>/i);
  if (onMatch) allMatches.push(parseInt(onMatch[1]));

  return allMatches.length ? Math.max(...allMatches) : 1;
}

export function mapHeungkukProduct(product, documentTypes) {
  const { category, productName, registeredAt, saleEndedAt, saleStatus, files } = product;
  if (!registeredAt || !productName) return [];

  const docs = [];
  for (const f of files) {
    if (!documentTypes.includes(f.docType)) continue;
    const sourceUrl = `${DOWNLOAD_URL}?filePath=${encodeURIComponent(f.filePath)}&fileRealName=${encodeURIComponent(f.fileRealName)}&fileSaveName=${encodeURIComponent(f.fileSaveName)}`;

    docs.push({
      id: createHash("sha256").update(`heungkuk:${f.fileSaveName}:${f.docType}:${registeredAt}`).digest("hex").slice(0, 20),
      insurerId: "heungkuk",
      insurerName: "흥국화재",
      productName,
      documentType: f.docType,
      registeredAt,
      saleEndedAt,
      saleStatus,
      productCategory: category,
      filePath: f.filePath,
      fileRealName: f.fileRealName,
      fileSaveName: f.fileSaveName,
      sourceUrl
    });
  }
  return docs;
}

export async function searchHeungkuk(filters, fetchImpl = fetch) {
  const categories = [
    { mode: "go", type: "1" },
    { mode: "go", type: "2" },
    { mode: "go", type: "3" },
    { mode: "stop", type: "1" },
    { mode: "stop", type: "2" },
    { mode: "stop", type: "3" }
  ];

  async function fetchCategoryPage(mode, type, page) {
    const params = new URLSearchParams();
    params.append("mode", mode);
    params.append("type", type);
    params.append("page", String(page));
    params.append("searchvalue", "");

    const res = await fetchImpl(PAGE_URL, {
      method: "POST",
      headers: {
        "user-agent": "InsuScan/0.1 (+public-disclosure-research)",
        "content-type": "application/x-www-form-urlencoded",
        "referer": PAGE_URL
      },
      body: params.toString(),
      signal: AbortSignal.timeout(30_000)
    });
    if (!res.ok) throw new Error(`흥국화재 공시실 응답 오류: HTTP ${res.status}`);
    return await res.text();
  }

  const allProducts = [];

  for (const cat of categories) {
    const firstHtml = await fetchCategoryPage(cat.mode, cat.type, 1);
    const lastPage = parseLastPage(firstHtml);
    const saleStatus = cat.mode === "go" ? "판매중" : "판매중지";
    const page1Products = parseHeungkukRows(firstHtml, saleStatus);
    allProducts.push(...page1Products);

    let stopPaging = false;
    const oldestOnPage1 = page1Products[page1Products.length - 1]?.registeredAt;
    if (oldestOnPage1 && oldestOnPage1 < filters.startDate) {
      stopPaging = true;
    }

    if (!stopPaging && lastPage > 1) {
      const BATCH_SIZE = 8;
      for (let p = 2; p <= lastPage; p += BATCH_SIZE) {
        const batchPages = [];
        for (let i = p; i < p + BATCH_SIZE && i <= lastPage; i++) {
          batchPages.push(i);
        }
        const htmls = await Promise.all(batchPages.map((pageNum) => fetchCategoryPage(cat.mode, cat.type, pageNum)));
        for (const html of htmls) {
          const prods = parseHeungkukRows(html, saleStatus);
          allProducts.push(...prods);
          const oldest = prods[prods.length - 1]?.registeredAt;
          if (oldest && oldest < filters.startDate) {
            stopPaging = true;
            break;
          }
        }
        if (stopPaging) break;
      }
    }
  }

  const filteredProducts = allProducts.filter((product) => {
    return product.registeredAt && product.registeredAt >= filters.startDate && product.registeredAt <= filters.endDate;
  });

  const mapped = filteredProducts.flatMap((product) => mapHeungkukProduct(product, filters.documentTypes));
  const documents = [...new Map(mapped.map((document) => [document.id, document])).values()];

  return {
    insurerId: "heungkuk",
    documents,
    warning: null,
    metadata: { scannedProducts: allProducts.length, matchedDocuments: documents.length }
  };
}

export async function fetchHeungkukPdf(document, fetchImpl = fetch) {
  let filePath = document.filePath;
  let fileRealName = document.fileRealName;
  let fileSaveName = document.fileSaveName;

  if (!filePath || !fileRealName || !fileSaveName) {
    const url = new URL(document.sourceUrl);
    filePath = url.searchParams.get("filePath");
    fileRealName = url.searchParams.get("fileRealName");
    fileSaveName = url.searchParams.get("fileSaveName");
  }

  if (!filePath || !fileRealName || !fileSaveName) {
    throw new Error("흥국화재 PDF 파라미터가 올바르지 않습니다.");
  }

  const params = new URLSearchParams();
  params.append("filePath", filePath);
  params.append("fileRealName", fileRealName);
  params.append("fileSaveName", fileSaveName);
  params.append("mode", "View");

  const response = await fetchImpl(DOWNLOAD_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "referer": PAGE_URL,
      "user-agent": "InsuScan/0.1 (+public-disclosure-research)"
    },
    body: params.toString(),
    signal: AbortSignal.timeout(60_000)
  });

  if (!response.ok) throw new Error(`흥국화재 PDF 다운로드 오류: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, sourceUrl: document.sourceUrl };
}
