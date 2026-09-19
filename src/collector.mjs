import { createHash } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { insurerById } from "./insurers.mjs";
import { searchHana } from "./adapters/hana.mjs";
import { fetchHyundaiPdf, searchHyundai } from "./adapters/hyundai.mjs";
import { fetchDbPdf, searchDb } from "./adapters/db.mjs";
import { fetchKbPdf, searchKb } from "./adapters/kb.mjs";
import { fetchSamsungPdf, searchSamsung } from "./adapters/samsung.mjs";
import { fetchMeritzPdf, searchMeritz } from "./adapters/meritz.mjs";
import { fetchLottePdf, searchLotte } from "./adapters/lotte.mjs";
import { fetchHeungkukPdf, searchHeungkuk } from "./adapters/heungkuk.mjs";

export const DOCUMENT_TYPES = new Set(["상품요약서", "사업방법서", "보험약관"]);

const TYPE_PATTERNS = [
  ["상품요약서", /(상품\s*요약서|요약서|summary)/i],
  ["사업방법서", /(사업\s*방법서|방법서|business)/i],
  ["보험약관", /(보험\s*약관|약관|terms?)/i]
];

const decodeHtml = (value) => value
  .replaceAll("&amp;", "&")
  .replaceAll("&quot;", '"')
  .replaceAll("&#39;", "'")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">");

export function sanitizeSegment(value, fallback = "미상") {
  const cleaned = String(value || "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return (cleaned || fallback).slice(0, 120);
}

export function classifyDocument(text) {
  return TYPE_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] || null;
}

export function extractDate(text) {
  const compact = String(text).replace(/[^0-9]/g, "");
  const match = compact.match(/(20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const short = compact.match(/(\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])/);
  return short ? `20${short[1]}-${short[2]}-${short[3]}` : null;
}

export function buildFilename({ insurerName, productName, documentType, registeredAt }) {
  const date = registeredAt || "0000-00-00";
  const month = /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : "0000-00";
  const compactDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.replaceAll("-", "") : "00000000";
  return `${sanitizeSegment(insurerName)}-${month}-${sanitizeSegment(productName, "상품명미상")}_${sanitizeSegment(documentType)}_${compactDate}.pdf`;
}

function stripTags(value) {
  return decodeHtml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

export function extractPdfCandidates(html, baseUrl, insurer) {
  const results = [];
  const anchorPattern = /<a\b([^>]*)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const href = decodeHtml(match[2]);
    const context = stripTags(`${match[1]} ${match[3]} ${match[4]}`);
    if (!/\.pdf(?:$|[?#])/i.test(href) && !/pdf/i.test(context)) continue;
    let url;
    try { url = new URL(href, baseUrl); } catch { continue; }
    if (!insurer.allowedHosts.includes(url.hostname.toLowerCase())) continue;
    const documentType = classifyDocument(`${context} ${url.pathname}`);
    const registeredAt = extractDate(`${context} ${url.pathname} ${url.search}`);
    const productName = context
      .replace(/(다운로드|새창|PDF|상품요약서|사업방법서|보험약관|요약서|방법서|약관)/gi, " ")
      .replace(/\s+/g, " ")
      .trim() || decodeURIComponent(path.basename(url.pathname, ".pdf"));
    results.push({
      id: createHash("sha256").update(`${insurer.id}:${url.href}`).digest("hex").slice(0, 20),
      insurerId: insurer.id,
      insurerName: insurer.name,
      productName,
      documentType,
      registeredAt,
      sourceUrl: url.href
    });
  }
  return [...new Map(results.map((item) => [item.sourceUrl, item])).values()];
}

export async function searchInsurer(insurer, filters, fetchImpl = fetch) {
  if (insurer.strategy === "meritz_public_json") return searchMeritz(filters, fetchImpl);
  if (insurer.strategy === "samsung_public_json") return searchSamsung(filters, fetchImpl);
  if (insurer.strategy === "kb_public_html") return searchKb(filters, fetchImpl);
  if (insurer.strategy === "db_public_json") return searchDb(filters, fetchImpl);
  if (insurer.strategy === "hyundai_public_json") return searchHyundai(filters, fetchImpl);
  if (insurer.strategy === "hana_public_json") return searchHana(filters, fetchImpl);
  if (insurer.strategy === "lotte_public_html") return searchLotte(filters, fetchImpl);
  if (insurer.strategy === "heungkuk_public_html") return searchHeungkuk(filters, fetchImpl);
  if (insurer.strategy !== "html_pdf_index") {
    return { insurerId: insurer.id, documents: [], warning: "전용 동적 어댑터 구현이 필요합니다." };
  }
  const response = await fetchImpl(insurer.sourceUrl, {
    headers: { "user-agent": "InsureDocHub/0.1 (+public-disclosure-research)" },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`공시실 응답 오류: HTTP ${response.status}`);
  const html = await response.text();
  let documents = extractPdfCandidates(html, response.url || insurer.sourceUrl, insurer);
  documents = documents.filter((document) => {
    if (filters.documentTypes.length && !filters.documentTypes.includes(document.documentType)) return false;
    if (document.registeredAt && document.registeredAt < filters.startDate) return false;
    if (document.registeredAt && document.registeredAt > filters.endDate) return false;
    return true;
  });
  return {
    insurerId: insurer.id,
    documents,
    warning: documents.length ? null : "첫 HTML 응답에서 PDF를 찾지 못했습니다. 동적 어댑터가 필요할 수 있습니다."
  };
}

export function validateSearchRequest(body) {
  const insurerIds = Array.isArray(body?.insurers) ? [...new Set(body.insurers)] : [];
  const documentTypes = Array.isArray(body?.documentTypes) ? [...new Set(body.documentTypes)] : [];
  if (!insurerIds.length) throw new Error("보험사를 한 곳 이상 선택하세요.");
  if (insurerIds.some((id) => !insurerById.has(id))) throw new Error("지원하지 않는 보험사가 포함되어 있습니다.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body?.startDate || "") || !/^\d{4}-\d{2}-\d{2}$/.test(body?.endDate || "")) {
    throw new Error("기간은 YYYY-MM-DD 형식이어야 합니다.");
  }
  if (body.startDate > body.endDate) throw new Error("시작일은 종료일보다 늦을 수 없습니다.");
  if (!documentTypes.length || documentTypes.some((type) => !DOCUMENT_TYPES.has(type))) {
    throw new Error("상품요약서, 사업방법서, 보험약관 중 하나 이상을 선택하세요.");
  }
  return { insurerIds, documentTypes, startDate: body.startDate, endDate: body.endDate };
}

function assertAllowedSource(document) {
  const insurer = insurerById.get(document.insurerId);
  if (!insurer) throw new Error("지원하지 않는 보험사입니다.");
  const url = new URL(document.sourceUrl);
  if (url.protocol !== "https:" || !insurer.allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new Error(`${insurer.name} 공식 출처가 아닌 URL은 내려받을 수 없습니다.`);
  }
  return insurer;
}

async function fetchPdfBytes(document, fetchImpl) {
  if (document.insurerId === "meritz") return fetchMeritzPdf(document, fetchImpl);
  if (document.insurerId === "samsung") return fetchSamsungPdf(document, fetchImpl);
  if (document.insurerId === "kb") return fetchKbPdf(document, fetchImpl);
  if (document.insurerId === "db") return fetchDbPdf(document, fetchImpl);
  if (document.insurerId === "hyundai") return fetchHyundaiPdf(document, fetchImpl);
  if (document.insurerId === "lotte") return fetchLottePdf(document, fetchImpl);
  if (document.insurerId === "heungkuk") return fetchHeungkukPdf(document, fetchImpl);
  const response = await fetchImpl(document.sourceUrl, {
    headers: { "user-agent": "InsureDocHub/0.1 (+public-disclosure-research)" },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) throw new Error(`PDF 다운로드 오류: HTTP ${response.status}`);
  return { bytes: Buffer.from(await response.arrayBuffer()), sourceUrl: response.url || document.sourceUrl };
}

export async function downloadDocument(document, destinationRoot, fetchImpl = fetch) {
  const insurer = assertAllowedSource(document);
  const registeredAt = document.registeredAt || extractDate(document.sourceUrl) || "0000-00-00";
  const year = registeredAt.slice(0, 4);
  const month = registeredAt.slice(5, 7);
  const directory = path.join(destinationRoot, sanitizeSegment(insurer.name), year, month);
  await mkdir(directory, { recursive: true });
  const filename = buildFilename({ ...document, insurerName: insurer.name, registeredAt });
  const target = path.join(directory, filename);
  try {
    await access(target);
    return { status: "skipped", path: target, reason: "duplicate_filename" };
  } catch {}
  const { bytes } = await fetchPdfBytes(document, fetchImpl);
  if (bytes.length < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("응답이 PDF 파일이 아닙니다.");
  }
  await writeFile(target, bytes, { flag: "wx" });
  return {
    status: "saved",
    path: target,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

export async function fetchDocumentPdf(document, fetchImpl = fetch) {
  const insurer = assertAllowedSource(document);
  const registeredAt = document.registeredAt || extractDate(document.sourceUrl) || "0000-00-00";
  const filename = buildFilename({ ...document, insurerName: insurer.name, registeredAt });
  const { bytes } = await fetchPdfBytes(document, fetchImpl);
  if (bytes.length < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("응답이 PDF 파일이 아닙니다.");
  }
  return { bytes, filename, insurerName: insurer.name, registeredAt };
}
