/** ISO 639-2/3 codes (as used by GDELT's `srclc:`) to the two-letter codes browsers use. */
const MAP: Record<string, string> = {
  afr: "af", alb: "sq", sqi: "sq", amh: "am", ara: "ar", arm: "hy", hye: "hy", aze: "az",
  baq: "eu", eus: "eu", bel: "be", ben: "bn", bos: "bs", bul: "bg", bur: "my", mya: "my",
  cat: "ca", chi: "zh", zho: "zh", hrv: "hr", cze: "cs", ces: "cs", dan: "da", dut: "nl",
  nld: "nl", eng: "en", est: "et", fin: "fi", fre: "fr", fra: "fr", glg: "gl", geo: "ka",
  kat: "ka", ger: "de", deu: "de", gre: "el", ell: "el", guj: "gu", heb: "he", hin: "hi",
  hun: "hu", ice: "is", isl: "is", ind: "id", gle: "ga", ita: "it", jpn: "ja", kan: "kn",
  kaz: "kk", khm: "km", kor: "ko", kur: "ku", kir: "ky", lao: "lo", lav: "lv", lit: "lt",
  mac: "mk", mkd: "mk", may: "ms", msa: "ms", mal: "ml", mlt: "mt", mar: "mr", mon: "mn",
  nep: "ne", nor: "no", nob: "nb", nno: "nn", ori: "or", pan: "pa", per: "fa", fas: "fa",
  pol: "pl", por: "pt", pus: "ps", rum: "ro", ron: "ro", rus: "ru", srp: "sr", sin: "si",
  slo: "sk", slk: "sk", slv: "sl", som: "so", spa: "es", swa: "sw", swe: "sv", tgl: "tl",
  tam: "ta", tel: "te", tha: "th", tur: "tr", tuk: "tk", ukr: "uk", urd: "ur", uzb: "uz",
  vie: "vi", wel: "cy", cym: "cy", yor: "yo", zul: "zu", hau: "ha", ibo: "ig", tir: "ti",
  kin: "rw", mlg: "mg", sna: "sn", xho: "xh", tat: "tt", uig: "ug", tgk: "tg",
};

export function toBcp47(code: string | undefined): string {
  if (!code) return "und";
  const c = code.trim().toLowerCase();
  if (c.length === 2) return c;
  return MAP[c] ?? "und";
}
