import { createHash } from "node:crypto";

const BASE_URL = "https://www.lotteins.co.kr";
const PAGE_URL = `${BASE_URL}/web/C/D/H/cdh190.jsp`;
const SEARCH_URL = `${BASE_URL}/CChannelSvl`;

function officialPdfUrl(value) {
  const path = String(value || "").trim();
  if (!path.startsWith("/upload/") || !path.toLowerCase().endsWith(".pdf")) return null;
  const url = new URL(path, BASE_URL);
  return url.hostname === "www.lotteins.co.kr" ? url.href : null;
}

export function parseLotteCatalog(html) {
  function parseSection(sectionHtml, defaultStatus) {
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let match;
    const items = [];
    while ((match = rowRegex.exec(sectionHtml)) !== null) {
      const rowContent = match[1];
      if (rowContent.includes("<th")) continue;

      const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      const cells = [];
      let tdMatch;
      while ((tdMatch = tdRegex.exec(rowContent)) !== null) {
        cells.push(tdMatch[1].trim());
      }
      if (cells.length < 3) continue;

      const category = cells[0].replace(/<[^>]+>/g, "").trim();
      const productName = cells[1].replace(/<[^>]+>/g, "").trim();
      const periodText = cells[2].replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").trim();

      const periodMatch = periodText.match(/(\d{4}\.\d{2}\.\d{2})\s*~\s*(\d{4}\.\d{2}\.\d{2}|현재)?/);
      const registeredAt = periodMatch ? periodMatch[1].replace(/\./g, "-") : null;
      const saleEndedAt = periodMatch && periodMatch[2] && periodMatch[2] !== "현재"
        ? periodMatch[2].replace(/\./g, "-")
        : null;

      const extractLink = (cell) => {
        if (!cell) return null;
        const m = cell.match(/href\s*=\s*['"]?([^'"\s>]+)['"]?/i);
        return m ? m[1] : null;
      };

      const ykLink = extractLink(cells[3]);
      const bmLink = extractLink(cells[4]);
      const smLink = extractLink(cells[5]);

      items.push({
        category,
        productName,
        registeredAt,
        saleEndedAt,
        saleStatus: defaultStatus,
        files: {
          "보험약관": ykLink,
          "사업방법서": bmLink,
          "상품요약서": smLink
        }
      });
    }
    return items;
  }

  const idx1 = html.indexOf('parent.document.getElementById("searchviewissale").innerHTML = "');
  const idx2 = html.indexOf('parent.document.getElementById("searchviewisnotsale").innerHTML = "');

  let saleItems = [];
  let endItems = [];

  if (idx1 !== -1) {
    const start = idx1 + 'parent.document.getElementById("searchviewissale").innerHTML = "'.length;
    const end = html.indexOf('";\n', start);
    saleItems = parseSection(html.slice(start, end !== -1 ? end : undefined), "판매중");
  }
  if (idx2 !== -1) {
    const start = idx2 + 'parent.document.getElementById("searchviewisnotsale").innerHTML = "'.length;
    const end = html.indexOf('";\n', start);
    endItems = parseSection(html.slice(start, end !== -1 ? end : undefined), "판매중지");
  }

  return [...saleItems, ...endItems];
}

export function mapLotteProduct(item, documentTypes) {
  const { category, productName, registeredAt, saleEndedAt, saleStatus, files } = item;
  if (!registeredAt || !productName) return [];

  const docs = [];
  for (const [docType, link] of Object.entries(files)) {
    if (!documentTypes.includes(docType) || !link) continue;
    const sourceUrl = officialPdfUrl(link);
    if (!sourceUrl) continue;

    docs.push({
      id: createHash("sha256").update(`lotte:${sourceUrl}:${docType}:${registeredAt}`).digest("hex").slice(0, 20),
      insurerId: "lotte",
      insurerName: "롯데손해보험",
      productName,
      documentType: docType,
      registeredAt,
      saleEndedAt,
      saleStatus,
      productCategory: category,
      sourceUrl
    });
  }
  return docs;
}

export async function searchLotte(filters, fetchImpl = fetch) {
  const params = new URLSearchParams();
  params.append("ops_tc", "dfi.c.d.g.cmd.Cdg079Cmd");
  params.append("task", "searchKey");
  params.append("rtnUri", "/web/C/D/H/cdh190_result.jsp");
  params.append("issale", "Y");
  params.append("srcPrdNm", "%");

  const response = await fetchImpl(SEARCH_URL, {
    method: "POST",
    headers: {
      "user-agent": "InsuScan/0.1 (+public-disclosure-research)",
      "content-type": "application/x-www-form-urlencoded",
      "referer": PAGE_URL
    },
    body: params.toString(),
    signal: AbortSignal.timeout(60_000)
  });

  if (!response.ok) throw new Error(`롯데손해보험 공시 조회 오류: HTTP ${response.status}`);
  const buf = await response.arrayBuffer();
  const html = new TextDecoder("euc-kr").decode(buf);
  const products = parseLotteCatalog(html);

  const mapped = products.flatMap((product) => mapLotteProduct(product, filters.documentTypes));
  const documents = [...new Map(mapped.map((document) => [document.id, document])).values()]
    .filter((document) => document.registeredAt >= filters.startDate && document.registeredAt <= filters.endDate);

  return {
    insurerId: "lotte",
    documents,
    warning: null,
    metadata: { catalogProducts: products.length, matchedDocuments: documents.length }
  };
}

export async function fetchLottePdf(document, fetchImpl = fetch) {
  const sourceUrl = officialPdfUrl(new URL(document.sourceUrl).pathname);
  if (!sourceUrl || sourceUrl !== document.sourceUrl) throw new Error("롯데손해보험 PDF 경로가 올바르지 않습니다.");
  const response = await fetchImpl(sourceUrl, {
    headers: {
      referer: PAGE_URL,
      "user-agent": "InsuScan/0.1 (+public-disclosure-research)"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) throw new Error(`롯데손해보험 PDF 다운로드 오류: HTTP ${response.status}`);
  return { bytes: Buffer.from(await response.arrayBuffer()), sourceUrl: response.url || sourceUrl };
}
