import { createHash } from "node:crypto";

const BASE_URL = "https://www.meritzfire.com";
const PAGE_URL = `${BASE_URL}/disclosure/product-announcement/product-list.do#!/`;
const DATA_URL = `${BASE_URL}/json.smart`;
const FILE_URL = `${BASE_URL}/hp/fileDownload.do`;
const SERVICE_ID = "f.cg.he.cu.ua.o.bc.PbanBc.retrieveSalPdSchList";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0 Safari/537.36";

const TYPE_FILES = [
  ["보험약관", "file1"],
  ["사업방법서", "file2"],
  ["상품요약서", "file3"]
];

const compactToIso = (value) => {
  const compact = String(value || "").replace(/\D/g, "").slice(0, 8);
  return /^20\d{6}$/.test(compact) ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` : null;
};

const readCookies = (headers) => {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie") || ""];
  return values.filter(Boolean).map((value) => value.split(";", 1)[0]).join("; ");
};

function requestHeader(viewId = "/01") {
  const now = new Date();
  const teleMsgReqDttm = now.toISOString().replace(/\D/g, "").slice(0, 17);
  return {
    encryDivCd: "0", globId: "", rcvmsgSrvId: SERVICE_ID, resultRcvmsgSrvId: "",
    esbIntfId: "", exsIntfId: "", ipv6Addr1: "", ipv6Addr2: "", teleMsgMacAdr: "",
    envirInfoDivCd: "", firstTranssLcatgBizafairCd: "", transsLcatgBizafairCd: "",
    reqRespnsDivCd: "Q", syncDivCd: "S", teleMsgReqDttm, prcesResultDivCd: "",
    teleMsgRespnsDttm: "", clienTrespnsDttm: "", handcapLcatgBizafairCd: "",
    teleMsgVerDivCd: "", langDivCd: "KR", belongGrpCd: "", empNo: "", empId: "",
    dptCd: "", hgrkDptCd: "", nxupDptCd: "", transGrpCd: "F",
    screenId: "/disclosure/product-announcement/product-list.do", lowrnkScreenId: viewId, resveLet: ""
  };
}

async function openSession(fetchImpl) {
  const response = await fetchImpl(PAGE_URL, {
    headers: { "user-agent": USER_AGENT },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`메리츠화재 공시실 응답 오류: HTTP ${response.status}`);
  const cookie = readCookies(response.headers);
  await response.arrayBuffer();
  return cookie;
}

async function fetchCatalog(notfYn, cookie, fetchImpl, keyword = "") {
  const viewId = notfYn === "Y" ? "/01" : "/03";
  const response = await fetchImpl(DATA_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=UTF-8",
      cookie,
      referer: `${PAGE_URL}${viewId.slice(1)}`,
      "user-agent": USER_AGENT
    },
    body: JSON.stringify({ header: requestHeader(viewId), body: { notfYn, keyWord: keyword } }),
    redirect: "follow",
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) throw new Error(`메리츠화재 공시 조회 오류: HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.header?.prcesResultDivCd !== "0" || !Array.isArray(payload?.body?.salPdList)) {
    throw new Error("메리츠화재 공시 응답 형식이 변경되었습니다.");
  }
  return payload.body.salPdList;
}

export function mapMeritzProduct(product, documentTypes, saleStatus = "판매중") {
  const registeredAt = compactToIso(product?.putupStDdTm);
  if (!registeredAt || !product?.ttlNm) return [];
  const saleEndedAt = product.putupEdDdTm === "-" ? null : compactToIso(product.putupEdDdTm);
  return TYPE_FILES.flatMap(([documentType, field]) => {
    if (!documentTypes.includes(documentType)) return [];
    const encryptedPath = String(product[`${field}#[E]`] || "").trim();
    const officialPath = String(product[field] || "").trim();
    if (!encryptedPath || !officialPath.startsWith("/") || !officialPath.toLowerCase().endsWith(".pdf")) return [];
    const identity = `${encryptedPath}:${documentType}:${registeredAt}`;
    return [{
      id: createHash("sha256").update(`meritz:${identity}`).digest("hex").slice(0, 20),
      insurerId: "meritz",
      insurerName: "메리츠화재",
      productName: String(product.ttlNm).trim(),
      documentType,
      registeredAt,
      saleEndedAt,
      saleStatus,
      encryptedPath,
      officialPath,
      sourceUrl: FILE_URL
    }];
  });
}

export async function searchMeritz(filters, fetchImpl = fetch) {
  const cookie = await openSession(fetchImpl);
  const active = await fetchCatalog("Y", cookie, fetchImpl);
  const stopped = await fetchCatalog("N", cookie, fetchImpl);
  const mapped = [
    ...active.flatMap((product) => mapMeritzProduct(product, filters.documentTypes, "판매중")),
    ...stopped.flatMap((product) => mapMeritzProduct(product, filters.documentTypes, "판매중지"))
  ];
  const documents = [...new Map(mapped.map((document) => [`${document.officialPath}:${document.documentType}`, document])).values()]
    .filter((document) => document.registeredAt >= filters.startDate && document.registeredAt <= filters.endDate);
  return {
    insurerId: "meritz",
    documents,
    warning: null,
    metadata: { activeProducts: active.length, stoppedProducts: stopped.length, matchedDocuments: documents.length }
  };
}

export async function fetchMeritzPdf(document, fetchImpl = fetch) {
  if (!document.encryptedPath || document.sourceUrl !== FILE_URL) throw new Error("메리츠화재 PDF 식별자가 올바르지 않습니다.");
  const cookie = await openSession(fetchImpl);
  const field = document.documentType === "보험약관" ? "file1" : document.documentType === "사업방법서" ? "file2" : "file3";
  const preferredStatus = document.saleStatus === "판매중지" ? "N" : "Y";
  let products = await fetchCatalog(preferredStatus, cookie, fetchImpl, document.productName);
  let current = products.find((product) => product.ttlNm === document.productName && product[field] === document.officialPath);
  if (!current) {
    products = await fetchCatalog(preferredStatus === "Y" ? "N" : "Y", cookie, fetchImpl, document.productName);
    current = products.find((product) => product.ttlNm === document.productName && product[field] === document.officialPath);
  }
  const encryptedPath = current?.[`${field}#[E]`];
  if (!encryptedPath) throw new Error("메리츠화재 PDF의 최신 다운로드 식별자를 찾지 못했습니다.");
  const params = new URLSearchParams({
    path: encryptedPath,
    id: encryptedPath,
    orgFileName: `${document.productName}${document.documentType}.pdf`,
    check: "Y"
  });
  const commonHeaders = { cookie, referer: PAGE_URL, "user-agent": USER_AGENT };
  const check = await fetchImpl(FILE_URL, {
    method: "POST",
    headers: { ...commonHeaders, "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest" },
    body: params,
    redirect: "follow",
    signal: AbortSignal.timeout(30_000)
  });
  if (!check.ok) throw new Error(`메리츠화재 PDF 확인 오류: HTTP ${check.status}`);
  const checkResult = await check.json().catch(() => null);
  if (!checkResult || checkResult.resultMsg !== "") throw new Error(checkResult?.resultMsg || "메리츠화재 PDF를 확인할 수 없습니다.");
  params.set("check", "N");
  const response = await fetchImpl(`${FILE_URL}?${params}`, {
    headers: commonHeaders,
    redirect: "follow",
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) throw new Error(`메리츠화재 PDF 다운로드 오류: HTTP ${response.status}`);
  return { bytes: Buffer.from(await response.arrayBuffer()), sourceUrl: FILE_URL };
}
