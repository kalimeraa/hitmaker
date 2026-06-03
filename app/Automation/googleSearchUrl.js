const { googleSearch } = require("../../config/app");

function appendIfPresent(url, key, value) {
  if (typeof value === "undefined" || value === null || value === "") return;
  url.searchParams.set(key, String(value));
}

function buildGoogleSearchUrl(keyword, options = {}) {
  const url = new URL("https://www.google.com/search");

  url.searchParams.set("q", keyword);
  appendIfPresent(url, "hl", options.hl ?? googleSearch.hl);
  appendIfPresent(url, "gl", options.gl ?? googleSearch.gl);
  appendIfPresent(url, "pws", options.pws ?? googleSearch.pws);
  appendIfPresent(url, "udm", options.udm ?? googleSearch.udm);
  appendIfPresent(url, "start", options.start);

  return url.toString();
}

module.exports = {
  buildGoogleSearchUrl
};
