import http from "node:http";
import path from "node:path";
import { insurers, insurerById } from "./insurers.mjs";
import { buildFilename, downloadDocument, fetchDocumentPdf, searchInsurer, validateSearchRequest } from "./collector.mjs";

const PORT = Number(process.env.PORT || 8787);
const DOWNLOAD_ROOT = path.resolve(process.env.DOWNLOAD_ROOT || path.join(process.cwd(), "downloads"));
const ZAEMIT_ORIGIN = process.env.ZAEMIT_ORIGIN || "https://wv1789732709009236.zaemit.ai";

function corsHeaders(contentType = "application/json; charset=utf-8") {
  return {
    "content-type": contentType,
    "access-control-allow-origin": ZAEMIT_ORIGIN,
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "vary": "origin"
  };
}

function send(res, status, body) {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    ...corsHeaders(),
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("요청 본문이 너무 큽니다.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/api/health") {
      return send(res, 200, { ok: true, service: "insuredoc-backend", version: "0.1.0" });
    }
    if (req.method === "GET" && url.pathname === "/api/insurers") {
      return send(res, 200, { insurers });
    }
    if (req.method === "POST" && url.pathname === "/api/search") {
      const filters = validateSearchRequest(await readJson(req));
      const results = await Promise.allSettled(filters.insurerIds.map((id) => searchInsurer(insurerById.get(id), filters)));
      const sources = results.map((result, index) => result.status === "fulfilled"
        ? result.value
        : { insurerId: filters.insurerIds[index], documents: [], error: result.reason?.message || "조회 실패" });
      const documents = sources.flatMap((item) => item.documents).map((document) => ({
        ...document,
        filename: buildFilename(document)
      }));
      return send(res, 200, {
        filters,
        total: documents.length,
        documents,
        sources
      });
    }
    if (req.method === "POST" && url.pathname === "/api/file") {
      const document = await readJson(req);
      const { bytes, filename } = await fetchDocumentPdf(document);
      res.writeHead(200, {
        ...corsHeaders("application/pdf"),
        "content-length": bytes.length,
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "x-insuscan-filename": encodeURIComponent(filename),
        "access-control-expose-headers": "content-disposition,x-insuscan-filename"
      });
      return res.end(bytes);
    }
    if (req.method === "POST" && url.pathname === "/api/download") {
      const body = await readJson(req);
      if (!Array.isArray(body.documents) || !body.documents.length) throw new Error("저장할 문서를 선택하세요.");
      if (body.documents.length > 300) throw new Error("한 작업에서 최대 300개까지 저장할 수 있습니다.");
      const requested = body.destination ? path.resolve(String(body.destination)) : DOWNLOAD_ROOT;
      if (requested !== DOWNLOAD_ROOT && process.env.ALLOW_ARBITRARY_DESTINATION !== "true") {
        throw new Error("임의 경로 저장은 비활성화되어 있습니다. DOWNLOAD_ROOT를 설정하세요.");
      }
      const results = [];
      for (const document of body.documents) {
        try { results.push({ id: document.id, ...(await downloadDocument(document, requested)) }); }
        catch (error) { results.push({ id: document.id, status: "failed", error: error.message }); }
      }
      return send(res, 200, { destination: requested, results });
    }
    return send(res, 404, { error: "API 경로를 찾을 수 없습니다." });
  } catch (error) {
    return send(res, 400, { error: error.message || "요청 처리에 실패했습니다." });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`InsureDoc backend: http://0.0.0.0:${PORT}`);
  console.log(`Download root: ${DOWNLOAD_ROOT}`);
});
