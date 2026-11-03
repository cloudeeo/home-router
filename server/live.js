// Requests that need live information from the internet (weather, news, prices, scores, traffic).
// Laya is often unsure on these in Italian and French, and the LLM then invents an answer
// ("domani a Ginevra 23 °C, sereno" in November). Matching them here sends them straight to the
// web-search permission step, so the user is asked first and nothing is made up.
const plain = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, ' ')

const LIVE = [
  // Italian
  /\bmeteo\b|\bche tempo (fa|fara|faceva)\b|\bprevision[ei]\b|\bpiov(e|era|ere)\b|\bnevic(a|hera|are)\b|\btemperatur[ae] (a|ad|di|oggi|domani|stasera)\b/,
  /\bnotizi[ae]\b|\bultime news\b|\bquotazion[ei]\b|\bprezzo (del|della|dell|dei|delle)\b|\bin borsa\b|\bchi ha vinto\b|\brisultat[oi] (della|del|di)\b|\btraffico\b|\bin ritardo\b|\borari[o]? (del|dei) (treno|treni|bus)\b/,
  // French
  /\bmeteo\b|\bquel temps\b|\bprevisions?\b|\bpleu(t|vra|voir)\b|\bneige(ra)?\b|\bactualites?\b|\bnouvelles\b|\bcours (du|de la|de l)\b|\bprix (du|de la|de l|des)\b|\bqui a gagne\b|\btrafic\b|\bhoraires?\b/,
  // English
  /\bweather\b|\bforecast\b|\bwill it (rain|snow)\b|\bnews\b|\bstock price\b|\bprice of\b|\bwho won\b|\bscore\b|\btraffic\b|\btimetable\b/,
]

export function needsLiveInfo(text) {
  const q = plain(text)
  return LIVE.some((re) => re.test(q))
}
