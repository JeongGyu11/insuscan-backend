export const insurers = [
  {
    id: "hyundai",
    name: "현대해상",
    sourceUrl: "https://www.hi.co.kr/serviceAction.do?menuId=100932",
    allowedHosts: ["hi.co.kr", "www.hi.co.kr", "mdirect2.hi.co.kr"],
    strategy: "hyundai_public_json",
    status: "live_adapter"
  },
  {
    id: "samsung",
    name: "삼성화재",
    sourceUrl: "https://www.samsungfire.com/vh/page/VH.HPIF0103.do",
    allowedHosts: ["samsungfire.com", "www.samsungfire.com", "m.samsungfire.com"],
    strategy: "samsung_public_json",
    status: "live_adapter"
  },
  {
    id: "db",
    name: "DB손해보험",
    sourceUrl: "https://www.idbins.com/FWMAIV1534.do",
    allowedHosts: ["idbins.com", "www.idbins.com", "dbmail.idbins.com"],
    strategy: "db_public_json",
    status: "live_adapter"
  },
  {
    id: "kb",
    name: "KB손해보험",
    sourceUrl: "https://www.kbinsure.co.kr/CG802030001.ec",
    allowedHosts: ["kbinsure.co.kr", "www.kbinsure.co.kr"],
    strategy: "kb_public_html",
    status: "live_adapter"
  },
  {
    id: "lotte",
    name: "롯데손해보험",
    sourceUrl: "https://biz.lotteins.co.kr/web/C/D/H/cdh170.jsp",
    allowedHosts: ["lotteins.co.kr", "www.lotteins.co.kr", "biz.lotteins.co.kr"],
    strategy: "html_pdf_index",
    status: "probe_ready"
  },
  {
    id: "meritz",
    name: "메리츠화재",
    sourceUrl: "https://www.meritzfire.com/disclosure/product-announcement/product-list.do#!/",
    allowedHosts: ["meritzfire.com", "www.meritzfire.com", "direct.meritzfire.com"],
    strategy: "meritz_public_json",
    status: "live_adapter"
  },
  {
    id: "heungkuk",
    name: "흥국화재",
    sourceUrl: "https://www.heungkukfire.co.kr/FRW/announce/goodsUseInfo.do",
    allowedHosts: ["heungkukfire.co.kr", "www.heungkukfire.co.kr"],
    strategy: "html_pdf_index",
    status: "probe_ready"
  },
  {
    id: "nh",
    name: "NH농협손해보험",
    sourceUrl: "https://www.nhfire.co.kr/",
    allowedHosts: ["nhfire.co.kr", "www.nhfire.co.kr", "m.nhfire.co.kr"],
    strategy: "dynamic",
    status: "source_path_required"
  },
  {
    id: "hana",
    name: "하나손해보험",
    sourceUrl: "https://sso.hanainsure.co.kr/w/disclosure/product/saleProduct",
    allowedHosts: ["hanainsure.co.kr", "www.hanainsure.co.kr", "sso.hanainsure.co.kr"],
    strategy: "hana_public_json",
    status: "live_adapter"
  },
  {
    id: "kakao",
    name: "카카오페이손해보험",
    sourceUrl: "https://www.kakaopayinscorp.co.kr/",
    allowedHosts: ["kakaopayinscorp.co.kr", "www.kakaopayinscorp.co.kr", "static.kakaoinsure.com"],
    strategy: "html_pdf_index",
    status: "probe_ready"
  }
];

export const insurerById = new Map(insurers.map((insurer) => [insurer.id, insurer]));
