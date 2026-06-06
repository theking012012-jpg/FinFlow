// ════════════════════════════════════════════
// sendPrompt STUB — replaced by host when embedded
// ════════════════════════════════════════════
if(typeof sendPrompt==='undefined'){
  window.sendPrompt=function(msg){ console.log('[FinFlow] sendPrompt:',msg); };
}

// ════════════════════════════════════════════
// MULTI-CURRENCY ENGINE
// ════════════════════════════════════════════
// ── ALL WORLD CURRENCIES (rates vs USD, Apr 2026) ─────────────────────────
const CURRENCIES = {
  USD:{symbol:'$',     flag:'🇺🇸',name:'US Dollar',             rate:1},
  EUR:{symbol:'€',     flag:'🇪🇺',name:'Euro',                  rate:0.92},
  GBP:{symbol:'£',     flag:'🇬🇧',name:'British Pound',         rate:0.79},
  JPY:{symbol:'¥',     flag:'🇯🇵',name:'Japanese Yen',          rate:154.2},
  CNY:{symbol:'¥',     flag:'🇨🇳',name:'Chinese Yuan',          rate:7.24},
  INR:{symbol:'₹',     flag:'🇮🇳',name:'Indian Rupee',          rate:83.5},
  CAD:{symbol:'C$',    flag:'🇨🇦',name:'Canadian Dollar',       rate:1.37},
  AUD:{symbol:'A$',    flag:'🇦🇺',name:'Australian Dollar',     rate:1.54},
  CHF:{symbol:'Fr',    flag:'🇨🇭',name:'Swiss Franc',           rate:0.90},
  HKD:{symbol:'HK$',   flag:'🇭🇰',name:'Hong Kong Dollar',      rate:7.83},
  SGD:{symbol:'S$',    flag:'🇸🇬',name:'Singapore Dollar',      rate:1.35},
  SEK:{symbol:'kr',    flag:'🇸🇪',name:'Swedish Krona',         rate:10.42},
  NOK:{symbol:'kr',    flag:'🇳🇴',name:'Norwegian Krone',       rate:10.58},
  DKK:{symbol:'kr',    flag:'🇩🇰',name:'Danish Krone',          rate:6.88},
  NZD:{symbol:'NZ$',   flag:'🇳🇿',name:'New Zealand Dollar',    rate:1.64},
  MXN:{symbol:'$',     flag:'🇲🇽',name:'Mexican Peso',          rate:17.15},
  BRL:{symbol:'R$',    flag:'🇧🇷',name:'Brazilian Real',        rate:5.05},
  ARS:{symbol:'$',     flag:'🇦🇷',name:'Argentine Peso',        rate:878},
  CLP:{symbol:'$',     flag:'🇨🇱',name:'Chilean Peso',          rate:954},
  COP:{symbol:'$',     flag:'🇨🇴',name:'Colombian Peso',        rate:3955},
  PEN:{symbol:'S/',    flag:'🇵🇪',name:'Peruvian Sol',          rate:3.75},
  VES:{symbol:'Bs',    flag:'🇻🇪',name:'Venezuelan Bolívar',    rate:36.5},
  UYU:{symbol:'$U',    flag:'🇺🇾',name:'Uruguayan Peso',        rate:38.8},
  KRW:{symbol:'₩',     flag:'🇰🇷',name:'South Korean Won',      rate:1340},
  IDR:{symbol:'Rp',    flag:'🇮🇩',name:'Indonesian Rupiah',     rate:15950},
  MYR:{symbol:'RM',    flag:'🇲🇾',name:'Malaysian Ringgit',     rate:4.72},
  THB:{symbol:'฿',     flag:'🇹🇭',name:'Thai Baht',             rate:35.1},
  PHP:{symbol:'₱',     flag:'🇵🇭',name:'Philippine Peso',       rate:58.2},
  VND:{symbol:'₫',     flag:'🇻🇳',name:'Vietnamese Dong',       rate:25180},
  TWD:{symbol:'NT$',   flag:'🇹🇼',name:'Taiwan Dollar',         rate:32.4},
  PKR:{symbol:'₨',     flag:'🇵🇰',name:'Pakistani Rupee',       rate:278},
  BDT:{symbol:'৳',     flag:'🇧🇩',name:'Bangladeshi Taka',      rate:110},
  LKR:{symbol:'₨',     flag:'🇱🇰',name:'Sri Lankan Rupee',      rate:312},
  NPR:{symbol:'₨',     flag:'🇳🇵',name:'Nepalese Rupee',        rate:133},
  MMK:{symbol:'K',     flag:'🇲🇲',name:'Myanmar Kyat',          rate:2098},
  KHR:{symbol:'៛',     flag:'🇰🇭',name:'Cambodian Riel',        rate:4096},
  ZAR:{symbol:'R',     flag:'🇿🇦',name:'South African Rand',    rate:18.65},
  NGN:{symbol:'₦',     flag:'🇳🇬',name:'Nigerian Naira',        rate:1610},
  KES:{symbol:'KSh',   flag:'🇰🇪',name:'Kenyan Shilling',       rate:129.5},
  GHS:{symbol:'₵',     flag:'🇬🇭',name:'Ghanaian Cedi',         rate:15.4},
  ETB:{symbol:'Br',    flag:'🇪🇹',name:'Ethiopian Birr',        rate:57.8},
  TZS:{symbol:'TSh',   flag:'🇹🇿',name:'Tanzanian Shilling',    rate:2630},
  UGX:{symbol:'USh',   flag:'🇺🇬',name:'Ugandan Shilling',      rate:3760},
  RWF:{symbol:'Fr',    flag:'🇷🇼',name:'Rwandan Franc',         rate:1330},
  MAD:{symbol:'د.م.',  flag:'🇲🇦',name:'Moroccan Dirham',       rate:9.95},
  DZD:{symbol:'دج',    flag:'🇩🇿',name:'Algerian Dinar',        rate:135},
  TND:{symbol:'د.ت',   flag:'🇹🇳',name:'Tunisian Dinar',        rate:3.12},
  EGP:{symbol:'£',     flag:'🇪🇬',name:'Egyptian Pound',        rate:48.6},
  AED:{symbol:'د.إ',   flag:'🇦🇪',name:'UAE Dirham',            rate:3.67},
  SAR:{symbol:'﷼',     flag:'🇸🇦',name:'Saudi Riyal',           rate:3.75},
  QAR:{symbol:'﷼',     flag:'🇶🇦',name:'Qatari Rial',           rate:3.64},
  KWD:{symbol:'د.ك',   flag:'🇰🇼',name:'Kuwaiti Dinar',         rate:0.307},
  BHD:{symbol:'.د.ب',  flag:'🇧🇭',name:'Bahraini Dinar',        rate:0.376},
  OMR:{symbol:'﷼',     flag:'🇴🇲',name:'Omani Rial',            rate:0.385},
  JOD:{symbol:'JD',    flag:'🇯🇴',name:'Jordanian Dinar',       rate:0.709},
  ILS:{symbol:'₪',     flag:'🇮🇱',name:'Israeli Shekel',        rate:3.70},
  TRY:{symbol:'₺',     flag:'🇹🇷',name:'Turkish Lira',          rate:32.5},
  IRR:{symbol:'﷼',     flag:'🇮🇷',name:'Iranian Rial',          rate:42250},
  IQD:{symbol:'ع.د',   flag:'🇮🇶',name:'Iraqi Dinar',           rate:1310},
  RUB:{symbol:'₽',     flag:'🇷🇺',name:'Russian Ruble',         rate:92.5},
  UAH:{symbol:'₴',     flag:'🇺🇦',name:'Ukrainian Hryvnia',     rate:39.8},
  PLN:{symbol:'zł',    flag:'🇵🇱',name:'Polish Zloty',          rate:3.98},
  CZK:{symbol:'Kč',    flag:'🇨🇿',name:'Czech Koruna',          rate:23.2},
  HUF:{symbol:'Ft',    flag:'🇭🇺',name:'Hungarian Forint',      rate:363},
  RON:{symbol:'lei',   flag:'🇷🇴',name:'Romanian Leu',          rate:4.59},
  BGN:{symbol:'лв',    flag:'🇧🇬',name:'Bulgarian Lev',         rate:1.80},
  HRK:{symbol:'kn',    flag:'🇭🇷',name:'Croatian Kuna',         rate:6.92},
  RSD:{symbol:'din',   flag:'🇷🇸',name:'Serbian Dinar',         rate:108},
  MKD:{symbol:'ден',   flag:'🇲🇰',name:'Macedonian Denar',      rate:56.8},
  ALL:{symbol:'L',     flag:'🇦🇱',name:'Albanian Lek',          rate:94.5},
  BAM:{symbol:'KM',    flag:'🇧🇦',name:'Bosnia Convertible Mark',rate:1.80},
  MDL:{symbol:'L',     flag:'🇲🇩',name:'Moldovan Leu',          rate:17.8},
  GEL:{symbol:'₾',     flag:'🇬🇪',name:'Georgian Lari',         rate:2.68},
  AMD:{symbol:'֏',     flag:'🇦🇲',name:'Armenian Dram',         rate:388},
  AZN:{symbol:'₼',     flag:'🇦🇿',name:'Azerbaijani Manat',     rate:1.70},
  KZT:{symbol:'₸',     flag:'🇰🇿',name:'Kazakhstani Tenge',     rate:448},
  UZS:{symbol:'сўм',   flag:'🇺🇿',name:'Uzbekistani Som',       rate:12800},
  MNT:{symbol:'₮',     flag:'🇲🇳',name:'Mongolian Tögrög',      rate:3450},
  TTD:{symbol:'TT$',   flag:'🇹🇹',name:'TT Dollar',             rate:6.80},
  JMD:{symbol:'J$',    flag:'🇯🇲',name:'Jamaican Dollar',        rate:157.2},
  BBD:{symbol:'Bds$',  flag:'🇧🇧',name:'Barbadian Dollar',       rate:2.00},
  XCD:{symbol:'EC$',   flag:'🌴', name:'East Caribbean Dollar',  rate:2.70},
  GYD:{symbol:'G$',    flag:'🇬🇾',name:'Guyanese Dollar',        rate:209.5},
  BSD:{symbol:'B$',    flag:'🇧🇸',name:'Bahamian Dollar',        rate:1.00},
  HTG:{symbol:'G',     flag:'🇭🇹',name:'Haitian Gourde',         rate:131},
  DOP:{symbol:'RD$',   flag:'🇩🇴',name:'Dominican Peso',         rate:58.5},
  CUP:{symbol:'$',     flag:'🇨🇺',name:'Cuban Peso',             rate:24},
  BMD:{symbol:'$',     flag:'🇧🇲',name:'Bermudian Dollar',       rate:1.00},
  KYD:{symbol:'$',     flag:'🇰🇾',name:'Cayman Islands Dollar',  rate:0.833},
  AWG:{symbol:'ƒ',     flag:'🇦🇼',name:'Aruban Florin',          rate:1.79},
  SRD:{symbol:'$',     flag:'🇸🇷',name:'Surinamese Dollar',      rate:36.5},
  PAB:{symbol:'B/.',   flag:'🇵🇦',name:'Panamanian Balboa',      rate:1.00},
  CRC:{symbol:'₡',     flag:'🇨🇷',name:'Costa Rican Colón',      rate:517},
  GTQ:{symbol:'Q',     flag:'🇬🇹',name:'Guatemalan Quetzal',     rate:7.74},
  HNL:{symbol:'L',     flag:'🇭🇳',name:'Honduran Lempira',       rate:24.7},
  NIO:{symbol:'C$',    flag:'🇳🇮',name:'Nicaraguan Córdoba',     rate:36.7},
  MZN:{symbol:'MT',    flag:'🇲🇿',name:'Mozambican Metical',     rate:63.8},
  ZMW:{symbol:'ZK',    flag:'🇿🇲',name:'Zambian Kwacha',         rate:26.5},
  BWP:{symbol:'P',     flag:'🇧🇼',name:'Botswanan Pula',         rate:13.6},
  NAD:{symbol:'$',     flag:'🇳🇦',name:'Namibian Dollar',        rate:18.65},
  MUR:{symbol:'₨',     flag:'🇲🇺',name:'Mauritian Rupee',        rate:45.8},
  SCR:{symbol:'₨',     flag:'🇸🇨',name:'Seychellois Rupee',      rate:14.2},
  MVR:{symbol:'Rf',    flag:'🇲🇻',name:'Maldivian Rufiyaa',      rate:15.4},
  BND:{symbol:'$',     flag:'🇧🇳',name:'Brunei Dollar',          rate:1.35},
  PGK:{symbol:'K',     flag:'🇵🇬',name:'Papua New Guinean Kina', rate:3.85},
  FJD:{symbol:'$',     flag:'🇫🇯',name:'Fijian Dollar',          rate:2.27},
  WST:{symbol:'T',     flag:'🇼🇸',name:'Samoan Tālā',            rate:2.76},
  TOP:{symbol:'T$',    flag:'🇹🇴',name:'Tongan Paʻanga',         rate:2.36},
  SBD:{symbol:'$',     flag:'🇸🇧',name:'Solomon Islands Dollar', rate:8.44},
  VUV:{symbol:'Vt',    flag:'🇻🇺',name:'Vanuatu Vatu',           rate:120},
  XPF:{symbol:'Fr',    flag:'🇵🇫',name:'CFP Franc',              rate:110},
  XOF:{symbol:'Fr',    flag:'🌍', name:'West African CFA Franc', rate:602},
  XAF:{symbol:'Fr',    flag:'🌍', name:'Central African CFA Franc',rate:602},
  GNF:{symbol:'Fr',    flag:'🇬🇳',name:'Guinean Franc',          rate:8620},
  SLL:{symbol:'Le',    flag:'🇸🇱',name:'Sierra Leonean Leone',   rate:20950},
  LRD:{symbol:'$',     flag:'🇱🇷',name:'Liberian Dollar',        rate:194},
  GMD:{symbol:'D',     flag:'🇬🇲',name:'Gambian Dalasi',         rate:71.5},
  SZL:{symbol:'E',     flag:'🇸🇿',name:'Swazi Lilangeni',        rate:18.65},
  LSL:{symbol:'L',     flag:'🇱🇸',name:'Lesotho Loti',           rate:18.65},
  AOA:{symbol:'Kz',    flag:'🇦🇴',name:'Angolan Kwanza',         rate:895},
  CDF:{symbol:'Fr',    flag:'🇨🇩',name:'Congolese Franc',        rate:2850},
  BIF:{symbol:'Fr',    flag:'🇧🇮',name:'Burundian Franc',        rate:2890},
  DJF:{symbol:'Fr',    flag:'🇩🇯',name:'Djiboutian Franc',       rate:177.7},
  ERN:{symbol:'Nfk',   flag:'🇪🇷',name:'Eritrean Nakfa',         rate:15},
  SDG:{symbol:'£',     flag:'🇸🇩',name:'Sudanese Pound',         rate:601},
  SOS:{symbol:'Sh',    flag:'🇸🇴',name:'Somali Shilling',        rate:571},
  KMF:{symbol:'Fr',    flag:'🇰🇲',name:'Comorian Franc',         rate:452},
  MGA:{symbol:'Ar',    flag:'🇲🇬',name:'Malagasy Ariary',        rate:4560},
  MWK:{symbol:'MK',    flag:'🇲🇼',name:'Malawian Kwacha',        rate:1730},
  ZWL:{symbol:'$',     flag:'🇿🇼',name:'Zimbabwean Dollar',      rate:361},
  LYD:{symbol:'ل.د',   flag:'🇱🇾',name:'Libyan Dinar',           rate:4.84},
  MRU:{symbol:'UM',    flag:'🇲🇷',name:'Mauritanian Ouguiya',    rate:39.7},
  CVE:{symbol:'$',     flag:'🇨🇻',name:'Cape Verdean Escudo',    rate:101.5},
  STN:{symbol:'Db',    flag:'🇸🇹',name:'São Tomé Dobra',         rate:22.6},
  SYP:{symbol:'£',     flag:'🇸🇾',name:'Syrian Pound',           rate:13000},
  LBP:{symbol:'£',     flag:'🇱🇧',name:'Lebanese Pound',         rate:89500},
  YER:{symbol:'﷼',     flag:'🇾🇪',name:'Yemeni Rial',            rate:250},
  AFN:{symbol:'؋',     flag:'🇦🇫',name:'Afghan Afghani',         rate:71.5},
  KGS:{symbol:'с',     flag:'🇰🇬',name:'Kyrgystani Som',         rate:89.2},
  TJS:{symbol:'SM',    flag:'🇹🇯',name:'Tajikistani Somoni',     rate:10.95},
  TMT:{symbol:'T',     flag:'🇹🇲',name:'Turkmenistani Manat',    rate:3.50},
  MOP:{symbol:'P',     flag:'🇲🇴',name:'Macanese Pataca',        rate:8.06},
  LAK:{symbol:'₭',     flag:'🇱🇦',name:'Laotian Kip',            rate:21900},
  BTN:{symbol:'Nu',    flag:'🇧🇹',name:'Bhutanese Ngultrum',     rate:83.5},
  ISK:{symbol:'kr',    flag:'🇮🇸',name:'Icelandic Króna',        rate:138},
  GIP:{symbol:'£',     flag:'🇬🇮',name:'Gibraltar Pound',        rate:0.79},
  JEP:{symbol:'£',     flag:'🇯🇪',name:'Jersey Pound',           rate:0.79},
  FOK:{symbol:'kr',    flag:'🇫🇴',name:'Faroese Króna',          rate:6.88},
  IMP:{symbol:'£',     flag:'🇮🇲',name:'Manx Pound',             rate:0.79},
  GGP:{symbol:'£',     flag:'🇬🇬',name:'Guernsey Pound',         rate:0.79},
};
// Make the full currency table available globally so cross-script FX helpers
// (_safeFX, fxConvert, etc.) always find the complete rate table.
window.CURRENCIES = CURRENCIES;

// ── COUNTRY → CURRENCY MAP (auto-select on country pick) ──────────────────
const COUNTRY_CURRENCY = {
  'United States':'USD','United Kingdom':'GBP','Eurozone':'EUR',
  'Japan':'JPY','China':'CNY','India':'INR','Canada':'CAD','Australia':'AUD',
  'Switzerland':'CHF','Hong Kong':'HKD','Singapore':'SGD','Sweden':'SEK',
  'Norway':'NOK','Denmark':'DKK','New Zealand':'NZD','Mexico':'MXN',
  'Brazil':'BRL','Argentina':'ARS','Chile':'CLP','Colombia':'COP',
  'Peru':'PEN','Venezuela':'VES','Uruguay':'UYU','South Korea':'KRW',
  'Indonesia':'IDR','Malaysia':'MYR','Thailand':'THB','Philippines':'PHP',
  'Vietnam':'VND','Taiwan':'TWD','Pakistan':'PKR','Bangladesh':'BDT',
  'Sri Lanka':'LKR','Nepal':'NPR','Myanmar':'MMK',
  'South Africa':'ZAR','Nigeria':'NGN','Kenya':'KES','Ghana':'GHS',
  'Ethiopia':'ETB','Tanzania':'TZS','Uganda':'UGX','Rwanda':'RWF',
  'Morocco':'MAD','Algeria':'DZD','Tunisia':'TND','Egypt':'EGP',
  'UAE':'AED','Saudi Arabia':'SAR','Qatar':'QAR','Kuwait':'KWD',
  'Bahrain':'BHD','Oman':'OMR','Jordan':'JOD','Israel':'ILS',
  'Turkey':'TRY','Russia':'RUB','Ukraine':'UAH','Poland':'PLN',
  'Czech Republic':'CZK','Hungary':'HUF','Romania':'RON','Bulgaria':'BGN',
  'Serbia':'RSD','Georgia':'GEL','Armenia':'AMD','Azerbaijan':'AZN',
  'Kazakhstan':'KZT','Uzbekistan':'UZS','Mongolia':'MNT',
  'Trinidad & Tobago':'TTD','Jamaica':'JMD','Barbados':'BBD',
  'Antigua & Barbuda':'XCD','Dominica':'XCD','Grenada':'XCD',
  'St Kitts & Nevis':'XCD','St Lucia':'XCD','St Vincent':'XCD',
  'Guyana':'GYD','Bahamas':'BSD','Haiti':'HTG','Dominican Republic':'DOP',
  'Cuba':'CUP','Bermuda':'BMD','Cayman Islands':'KYD','Aruba':'AWG',
  'Suriname':'SRD','Panama':'PAB','Costa Rica':'CRC','Guatemala':'GTQ',
  'Honduras':'HNL','Nicaragua':'NIO',
  'Mozambique':'MZN','Zambia':'ZMW','Botswana':'BWP','Namibia':'NAD',
  'Mauritius':'MUR','Seychelles':'SCR','Maldives':'MVR','Brunei':'BND',
  'Papua New Guinea':'PGK','Fiji':'FJD',
  'Cameroon':'XAF','Senegal':'XOF','Côte d\'Ivoire':'XOF',
  'Angola':'AOA','DR Congo':'CDF','Libya':'LYD','Sudan':'SDG',
  'Somalia':'SOS','Eritrea':'ERN','Djibouti':'DJF','Comoros':'KMF',
  'Madagascar':'MGA','Malawi':'MWK','Cape Verde':'CVE',
  'Syria':'SYP','Lebanon':'LBP','Yemen':'YER','Afghanistan':'AFN',
  'Kyrgyzstan':'KGS','Tajikistan':'TJS','Turkmenistan':'TMT',
  'Macau':'MOP','Laos':'LAK','Bhutan':'BTN','Iceland':'ISK',
};

let activeCurrency = 'USD';
let _currencySearch = '';

function toggleCurrencyMenu(){
  const m = document.getElementById('currency-menu');
  const isOpen = m.style.display !== 'none';
  closeAllDropdowns();
  if(!isOpen){ buildCurrencyMenu(''); m.style.display='block'; }
}

function buildCurrencyMenu(search){
  const list = document.getElementById('currency-list');
  const entries = Object.entries(CURRENCIES)
    .filter(([code,c])=> !search ||
      code.toLowerCase().includes(search.toLowerCase()) ||
      c.name.toLowerCase().includes(search.toLowerCase())
    )
    .sort(([a],[b])=>{
      // Pin active to top, then common currencies, then alphabetical
      const priority = ['USD','EUR','GBP','JPY','CAD','AUD','CHF','TTD','XCD','JMD','BBD','GYD'];
      const ai = priority.indexOf(a), bi = priority.indexOf(b);
      if(ai>-1&&bi>-1) return ai-bi;
      if(ai>-1) return -1; if(bi>-1) return 1;
      return a.localeCompare(b);
    });

  list.innerHTML = `
    <div style="padding:6px 8px;border-bottom:1px solid var(--bd)">
      <input class="finput" placeholder="Search currencies…" style="font-size:12px;padding:5px 8px"
        value="${search}" oninput="buildCurrencyMenu(this.value)"
        onclick="event.stopPropagation()" id="currency-search-input">
    </div>
    <div style="max-height:240px;overflow-y:auto">
    ${entries.map(([code,c])=>`
      <div onclick="setCurrency('${code}')" style="display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;transition:background .1s;font-size:12.5px;
        background:${activeCurrency===code?'var(--bg2)':''}"
        onmouseenter="this.style.background='var(--bg2)'" onmouseleave="this.style.background='${activeCurrency===code?'var(--bg2)':''}'"
      >
        <span style="font-size:14px;width:20px;text-align:center;flex-shrink:0">${c.flag}</span>
        <span style="font-weight:600;color:var(--t1);width:36px;flex-shrink:0">${code}</span>
        <span style="color:var(--t3);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.name}</span>
        <span style="font-family:var(--font-mono);font-size:10.5px;color:var(--t3);flex-shrink:0">${code==='USD'?'base':'×'+c.rate.toFixed(2)}</span>
        ${activeCurrency===code?'<span style="color:var(--acc);font-size:12px;flex-shrink:0">✓</span>':''}
      </div>`).join('')}
    ${entries.length===0?'<div style="padding:12px;text-align:center;color:var(--t3);font-size:12px">No currencies found</div>':''}
    </div>`;
}

// ── COUNTRY SEARCH FOR ADD BUSINESS MODAL ─────────────────────────────────
function showCountryDropdown(){ filterCountries(document.getElementById('nb-country-input').value); }

function filterCountries(q){
  const dd = document.getElementById('nb-country-dropdown');
  const countries = Object.keys(COUNTRY_CURRENCY).sort();
  const filtered = q ? countries.filter(c=>c.toLowerCase().includes(q.toLowerCase())) : countries;
  dd.style.display = 'block';
  dd.innerHTML = filtered.slice(0,30).map(country=>{
    const code = COUNTRY_CURRENCY[country];
    const cur  = CURRENCIES[code];
    return `<div onclick="selectCountry('${country.replace(/'/g,"\\'")}','${code}')"
      style="display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;font-size:12.5px;transition:background .1s"
      onmouseenter="this.style.background='var(--bg2)'" onmouseleave="this.style.background=''">
      <span style="font-size:14px">${cur?.flag||'🌐'}</span>
      <span style="flex:1;color:var(--t1)">${country}</span>
      <span style="font-family:var(--font-mono);font-size:11px;color:var(--acc);font-weight:600">${code}</span>
    </div>`;
  }).join('') + (filtered.length===0?'<div style="padding:10px;color:var(--t3);font-size:12px;text-align:center">No matches</div>':'');
}

function selectCountry(country, currencyCode){
  document.getElementById('nb-country-input').value = country;
  document.getElementById('nb-country').value = country;
  document.getElementById('nb-currency').value = currencyCode;
  document.getElementById('nb-country-dropdown').style.display = 'none';
  // Show currency chip
  const cur = CURRENCIES[currencyCode];
  const chip = document.getElementById('nb-currency-chip');
  document.getElementById('nb-chip-flag').textContent = cur?.flag||'🌐';
  document.getElementById('nb-chip-text').textContent = `${currencyCode} — ${cur?.name||currencyCode}`;
  document.getElementById('nb-chip-rate').textContent = currencyCode==='USD'?'base':'1 '+currencyCode+' = '+(1/cur.rate).toFixed(4)+' USD';
  document.getElementById('nb-currency-preview').textContent = currencyCode;
  chip.style.display = 'flex';
  document.getElementById('nb-currency-override').style.display = 'none';
}

function overrideCurrency(){
  document.getElementById('nb-currency-override').style.display = 'block';
  filterCurrencyOverride('');
}

function filterCurrencyOverride(q){
  const dd = document.getElementById('nb-override-dropdown');
  const entries = Object.entries(CURRENCIES)
    .filter(([code,c])=>!q||code.toLowerCase().includes(q.toLowerCase())||c.name.toLowerCase().includes(q.toLowerCase()))
    .slice(0,20);
  dd.innerHTML = entries.map(([code,c])=>`
    <div onclick="pickOverrideCurrency('${code}')"
      style="display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer;font-size:12px;transition:background .1s"
      onmouseenter="this.style.background='var(--bg1)'" onmouseleave="this.style.background=''">
      <span>${c.flag}</span><span style="font-weight:600;color:var(--t1)">${code}</span>
      <span style="color:var(--t3);flex:1">${c.name}</span>
    </div>`).join('');
}

function pickOverrideCurrency(code){
  document.getElementById('nb-currency').value = code;
  const cur = CURRENCIES[code];
  document.getElementById('nb-chip-flag').textContent = cur?.flag||'🌐';
  document.getElementById('nb-chip-text').textContent = `${code} — ${cur?.name||code} (overridden)`;
  document.getElementById('nb-chip-rate').textContent = code==='USD'?'base':'1 '+code+' = '+(1/cur.rate).toFixed(4)+' USD';
  document.getElementById('nb-currency-preview').textContent = code;
  document.getElementById('nb-currency-override').style.display = 'none';
  document.getElementById('nb-currency-chip').style.display = 'flex';
}

// Close country dropdown on outside click
document.addEventListener('click', e=>{
  const dd = document.getElementById('nb-country-dropdown');
  if(dd && !dd.contains(e.target) && e.target.id!=='nb-country-input') dd.style.display='none';
});

function setCurrency(code){
  activeCurrency = code;
  const c = CURRENCIES[code];
  currencySymbol = c.symbol;
  document.getElementById('currency-flag').textContent = c.flag;
  document.getElementById('currency-code-label').textContent = code;
  // Update per-business default currency display
  const biz = businesses.find(b=>b.id===activeBizId);
  if(biz) biz.displayCurrency = code;
  // display-currency preference is in-memory only; entities are persisted via API
  document.getElementById('currency-menu').style.display='none';
  // Also sync personal finance display currency
  if(typeof setPersCurrency === 'function') setPersCurrency(code);
  refreshAllPeriodData();
  notify(`Display currency: ${c.flag} ${code}`);
}

// fxConvert defined in multi-entity block below

// ════════════════════════════════════════════
// MULTI-BUSINESS ENGINE
// ════════════════════════════════════════════
const BIZ_COLORS = ['var(--acc)','var(--purple)','var(--teal)','var(--amber)','var(--green)','var(--red)'];
const BIZ_ICONS  = ['📊','🏗','💻','🛒','🍽','🏥','🏠','📦'];

let businesses = []; // loaded from DB entities
let activeBizId = null;

function toggleBizMenu(e){
  e.stopPropagation();
  const m = document.getElementById('biz-menu');
  const isOpen = m.style.display !== 'none';
  closeAllDropdowns();
  if(!isOpen){ buildBizMenu(); m.style.display='block'; }
}

function renderBusinessSwitcher(){
  // Update the brand header with active business
  const active = businesses.find(b=>b.active) || businesses[0];
  if(!active) return;
  activeBizId = active.id;
  const nameEl = document.getElementById('sb-brand-name');
  const badgeEl = document.getElementById('biz-currency-badge');
  if(nameEl) nameEl.textContent = active.name;
  if(badgeEl) badgeEl.textContent = active.currency + ' · Pro';
}

function buildBizMenu(){
  const list = document.getElementById('biz-list');
  list.innerHTML = businesses.map(b=>`
    <div onclick="switchBusiness('${b.id}')" style="display:flex;align-items:center;gap:9px;padding:8px 10px;cursor:pointer;transition:background .1s;
      background:${b.id===activeBizId?'var(--bg2)':''}"
      onmouseenter="this.style.background='var(--bg2)'" onmouseleave="this.style.background='${b.id===activeBizId?'var(--bg2)':''}'"
    >
      <div style="width:28px;height:28px;border-radius:8px;background:${b.color};opacity:.15;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;position:relative">
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:7">${b.icon}</div>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;font-weight:${b.id===activeBizId?600:400};color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(b.name)}</div>
        <div style="font-size:11px;color:var(--t3)">${esc(b.industry)} · ${esc(b.currency)}</div>
      </div>
      ${b.id===activeBizId?'<span style="color:var(--acc);font-size:14px;flex-shrink:0">✓</span>':''}
    </div>`).join('');
}

function switchBusiness(id){
  activeBizId = id;
  const biz = businesses.find(b=>b.id===id);
  if(!biz) return;
  document.getElementById('biz-menu').style.display='none';
  // Update UI
  document.getElementById('sb-brand-name').textContent = biz.name;
  document.getElementById('biz-currency-badge').textContent = biz.currency + ' · Pro';
  // Switch display currency
  if(typeof setCurrency==='function') setCurrency(biz.displayCurrency || biz.currency);
  // Switch entity via DB - use _dbId
  const entityIdx = biz._dbId ? ENTITIES.findIndex(e=>e._dbId===biz._dbId) : ENTITIES.findIndex(e=>e.name===biz.name);
  if(entityIdx >= 0){
    window.switchEntity(entityIdx);
  }
}

function flashTopbar(color){
  const tb = document.querySelector('.topbar');
  if(!tb) return;
  tb.style.transition = 'border-color .3s';
  tb.style.borderBottomColor = color;
  setTimeout(()=>{ tb.style.borderBottomColor=''; }, 1200);
}

function openAddBizModal(e){
  if(e) e.stopPropagation();
  document.getElementById('biz-menu').style.display='none';
  openCreateBusinessPage('dashboard');
}

function openCreateBusinessPage(fromPage){
  window._cbPrev = fromPage || 'entities';
  ['nb-name','nb-tax-id','nb-address','nb-website','nb-user-name','nb-user-initials','nb-email','nb-phone'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  const cur=document.getElementById('nb-currency'); if(cur) cur.value='USD';
  const ind=document.getElementById('nb-industry'); if(ind) ind.selectedIndex=0;
  const fy=document.getElementById('nb-fiscal');   if(fy)  fy.selectedIndex=0;
  const isFirst=typeof ENTITIES==='undefined'||ENTITIES.length===0;
  const profileSec=document.getElementById('cb-profile-section');
  if(profileSec) profileSec.style.display=isFirst?'':'none';
  const cancelBtn=document.getElementById('cb-cancel-btn');
  if(cancelBtn) cancelBtn.style.display=isFirst?'none':'';
  showPage('create-business', null);
}

function nbAutoInitials(){
  const name=(document.getElementById('nb-user-name')||{}).value||'';
  const parts=name.trim().split(/\s+/);
  const initials=(parts.length>=2?parts[0][0]+parts[parts.length-1][0]:name.slice(0,2)).toUpperCase();
  const el=document.getElementById('nb-user-initials'); if(el&&!el._manual) el.value=initials;
}

async function submitCreateBusiness(){
  const name=(document.getElementById('nb-name')||{}).value.trim();
  if(!name){ notify('Please enter a business name'); return; }
  const currency=(document.getElementById('nb-currency')||{}).value||'USD';
  const industry=(document.getElementById('nb-industry')||{}).value||'Other';
  const isFirst=typeof ENTITIES==='undefined'||ENTITIES.length===0;
  const color='#c9a84c';
  const tag=isFirst?'Parent':'Subsidiary';
  try {
    const res=await fetch('/api/entities',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({name,currency,color,tag,sort_order:typeof ENTITIES!=='undefined'?ENTITIES.length:0})});
    if(!res.ok) throw new Error((await res.json()).error);
    const profile={
      business_name: name,
      industry,
      currency,
      tax_id:        (document.getElementById('nb-tax-id')||{}).value||'',
      fiscal_year:   (document.getElementById('nb-fiscal')||{}).value||'January',
      address:       (document.getElementById('nb-address')||{}).value||'',
      website:       (document.getElementById('nb-website')||{}).value||'',
    };
    if(isFirst){
      profile.name  =(document.getElementById('nb-user-name')||{}).value||'';
      profile.email =(document.getElementById('nb-email')||{}).value||'';
      profile.phone =(document.getElementById('nb-phone')||{}).value||'';
    }
    await fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(profile)});
    if(typeof loadEntitiesFromDB==='function') await loadEntitiesFromDB();
    notify('Business "'+esc(name)+'" created ✦');
    showPage('dashboard', null);
  } catch(e){ notify('Error: '+(e.message||'Failed to create business')); }
}

function closeAllDropdowns(){
  const bm = document.getElementById('biz-menu'); if(bm) bm.style.display='none';
  const cm = document.getElementById('currency-menu'); if(cm) cm.style.display='none';
}

// Close dropdowns on outside click
document.addEventListener('click', closeAllDropdowns);

// ════════════════════════════════════════════
// PATCH S() to apply FX conversion
// (runs after original S() is defined at bottom of script)
// ════════════════════════════════════════════
function patchSFormatter(){
  const origS = window.S;
  if(!origS) return;
  window.S = function(n){
    const converted = typeof fxConvert === 'function' ? fxConvert(n) : (parseFloat(n)||0);
    // Use CURRENCIES symbol instead of currencySymbol so it stays in sync
    const sym = CURRENCIES[activeCurrency]?.symbol || '$';
    const abs = Math.abs(converted);
    let fmt;
    if(abs>=1000000)      fmt=sym+(converted/1000000).toFixed(1)+'M';
    else if(abs>=1000)    fmt=sym+(converted/1000).toFixed(1)+'K';
    else                  fmt=sym+Math.round(converted).toLocaleString();
    return fmt;
  };
}


const ROLES = {
  owner:      {label:'Owner',     color:'var(--acc)',   nav:null},       // null = all
  accountant: {label:'Accountant',color:'var(--purple)',
               nav:['dashboard','manual-journals','chart-of-accounts','reports','transaction-locking','banking']},
  bookkeeper: {label:'Bookkeeper',color:'var(--teal)',
               nav:['dashboard','banking','invoices','expenses','bills','customers','vendors','payroll']},
};
let currentRole = 'owner';
let currentUserPlan = 'pro';

function showLoginForm(){
  document.getElementById('login-form-panel').style.display='';
  document.getElementById('register-form-panel').style.display='none';
  document.getElementById('forgot-form-panel').style.display='none';
  document.getElementById('login-screen-subtitle').textContent='Sign in to your workspace';
}
function showRegister(){
  document.getElementById('login-form-panel').style.display='none';
  document.getElementById('register-form-panel').style.display='';
  document.getElementById('forgot-form-panel').style.display='none';
  document.getElementById('login-screen-subtitle').textContent='Create your free account';
}
function showForgotPassword(){
  document.getElementById('login-form-panel').style.display='none';
  document.getElementById('register-form-panel').style.display='none';
  document.getElementById('forgot-form-panel').style.display='';
  document.getElementById('login-screen-subtitle').textContent='Password recovery';
}
function _setUserDisplay(u){
  if(!u) return;
  var n=document.getElementById('sb-user-name');
  if(n && u.name) n.textContent=u.name;
  var e=document.getElementById('settings-user-email');
  if(e) e.textContent=u.email||'';
}

async function doLogin(){
  const email = document.getElementById('login-email')?.value?.trim();
  const pw    = document.getElementById('login-pw')?.value;
  const errEl = document.getElementById('login-error');
  if(errEl) errEl.textContent='';
  if(!email||!pw){ if(errEl) errEl.textContent='Email and password required.'; return; }
  const btn = document.getElementById('login-btn');
  if(btn){ btn.disabled=true; btn.textContent='Signing in…'; }
  try{
    const res = await fetch('/api/auth/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:pw})});
    const data = await res.json();
    if(!res.ok){ if(errEl) errEl.textContent=data.error||'Sign-in failed.'; return; }
    const r = 'owner';
    currentRole = r;
    sessionStorage.setItem('ff_role', r);
    applyRole(r);
    document.getElementById('login-screen').style.display='none';
    window.CURRENT_USER = data.user || {};
    _setUserDisplay(data.user);
    injectRoleBadge(r);
    if(data.user?.plan){
      currentUserPlan = data.user.plan;
      const planEl = document.getElementById('sb-user-plan');
      if(planEl) planEl.textContent = data.user.plan.charAt(0).toUpperCase()+data.user.plan.slice(1)+' plan';
    }
    notify('Welcome back' + (data.user?.name ? ', '+data.user.name : '') + ' ✴');
    window._ffAuthed = true;
    window.dispatchEvent(new Event('ff:authed'));
    if(typeof bootFinFlowAPI === 'function') bootFinFlowAPI();
    await loadEntitiesFromDB();
    if(typeof loadBankingFromDB === 'function') await loadBankingFromDB();
  }catch(e){
    if(errEl) errEl.textContent='Network error — is the server running?';
  }finally{
    if(btn){ btn.disabled=false; btn.textContent='Sign in →'; }
  }
}

async function doRegister(){
  const name  = document.getElementById('reg-name')?.value?.trim();
  const email = document.getElementById('reg-email')?.value?.trim();
  const pw    = document.getElementById('reg-pw')?.value;
  const errEl = document.getElementById('register-error');
  if(errEl) errEl.textContent='';
  if(!email||!pw){ if(errEl) errEl.textContent='Email and password required.'; return; }
  const btn = document.getElementById('register-btn');
  if(btn){ btn.disabled=true; btn.textContent='Creating account…'; }
  try{
    const res = await fetch('/api/auth/register',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email,password:pw})});
    const data = await res.json();
    if(!res.ok){ if(errEl) errEl.textContent=data.error||'Registration failed.'; return; }
    const plan = new URLSearchParams(window.location.search).get('plan');
    if(plan && (plan==='pro'||plan==='business')){
      try{
        const sr = await fetch('/api/stripe/checkout',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan})});
        const sd = await sr.json();
        if(sd.url){ window.location.href = sd.url; return; }
      }catch(e){}
    }
    const r = 'owner';
    currentRole = r;
    sessionStorage.setItem('ff_role', r);
    applyRole(r);
    document.getElementById('login-screen').style.display='none';
    window.CURRENT_USER = data.user || {};
    _setUserDisplay(data.user);
    injectRoleBadge(r);
    if(data.user?.plan){
      currentUserPlan = data.user.plan;
      const planEl = document.getElementById('sb-user-plan');
      if(planEl) planEl.textContent = data.user.plan.charAt(0).toUpperCase()+data.user.plan.slice(1)+' plan';
    }
    notify('Account created ✴ Welcome to FinFlow!');
    window._ffAuthed = true;
    window.dispatchEvent(new Event('ff:authed'));
    if(typeof bootFinFlowAPI === 'function') bootFinFlowAPI();
    await loadEntitiesFromDB();
    if(typeof loadBankingFromDB === 'function') await loadBankingFromDB();
  }catch(e){
    if(errEl) errEl.textContent='Network error — is the server running?';
  }finally{
    if(btn){ btn.disabled=false; btn.textContent='Create account →'; }
  }
}

async function doForgotPassword(){
  const email = document.getElementById('forgot-email')?.value?.trim();
  const msgEl = document.getElementById('forgot-msg');
  const btn   = document.getElementById('forgot-btn');
  if(!email){ if(msgEl){ msgEl.style.color='var(--red,#e05454)'; msgEl.textContent='Email required.'; } return; }
  if(btn){ btn.disabled=true; btn.textContent='Sending…'; }
  try{
    await fetch('/api/auth/forgot-password',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
    if(msgEl){ msgEl.style.color='var(--green)'; msgEl.textContent='If that email exists, a reset link is on its way.'; }
  }catch(e){
    if(msgEl){ msgEl.style.color='var(--red,#e05454)'; msgEl.textContent='Network error. Try again.'; }
  }finally{
    if(btn){ btn.disabled=false; btn.textContent='Send reset link →'; }
  }
}

window.logoutUser = async function(){
  try{ await fetch('/api/auth/logout',{method:'POST',credentials:'include'}); }catch(e){}
  window.location.href='/';
};

function applyRole(role){
  const allowed = ROLES[role].nav;
  if(!allowed) return; // owner sees everything
  // Hide nav items not in allowed list
  document.querySelectorAll('.nav-item[onclick*="showPage"],.nav-group-header').forEach(el=>{
    const match = (el.getAttribute('onclick')||'').match(/showPage\('([^']+)'/);
    if(!match) return;
    const page = match[1];
    el.style.display = allowed.some(a=>page.startsWith(a.split('-')[0]))||allowed.includes(page) ? '' : 'none';
  });
  // Hide payroll salary details from accountant
  if(role === 'accountant'){
    document.querySelectorAll('#payroll-list .payroll-gross, #payroll-list .payroll-net').forEach(el=>el.textContent='••••');
  }
}

function injectRoleBadge(role){
  const existing = document.getElementById('role-badge');
  if(existing) existing.remove();
  const badge = document.createElement('div');
  badge.id = 'role-badge';
  badge.style.cssText = `
    display:inline-flex;align-items:center;gap:6px;padding:4px 10px;
    border-radius:20px;border:1px solid ${ROLES[role]?.color||'#888'};
    background:rgba(0,0,0,.2);font-size:11px;color:${ROLES[role]?.color||'#888'};
    font-weight:500;cursor:pointer;margin-right:4px;
  `;
  badge.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:${ROLES[role]?.color||'#888'}"></span>${ROLES[role]?.label||role} <span style="opacity:.5;font-size:10px">▾</span>`;
  badge.title = 'Click to switch role (demo)';
  badge.onclick = () => {
    document.getElementById('login-screen').style.display = 'flex';
    // reset role radio to current
    const radio = document.querySelector(`input[name="login-role"][value="${currentRole}"]`);
    if(radio) radio.checked = true;
  };
  const tr = document.querySelector('.topbar-right');
  if(tr) tr.insertBefore(badge, tr.firstChild);
}

// ════════════════════════════════════════════
// ② PERSISTENCE — DB-only, no localStorage
// ════════════════════════════════════════════
// All data lives in PostgreSQL. lsSave/lsLoad are no-ops so any legacy
// call sites do nothing. persistAll/loadPersistedData are also no-ops.
function lsSave(){}
function lsLoad(key, fallback){ return fallback; }
function persistAfter(origFn){ return origFn; }
function persistAll(){}
function loadPersistedData(){}

// CSV export — page-aware, exports the data from whichever page is currently active
window.exportAllCSV = function(){
  const activePage = Array.from(document.querySelectorAll('.page'))
    .find(el => el.classList.contains('active') || (el.style.display && el.style.display !== 'none'))?.id || '';

  let rows = [], filename = 'finflow-export.csv';

  const q = v => '"' + String(v == null ? '' : v).replace(/"/g,'""') + '"';
  const toCSV = r => r.map(q).join(',');

  if (activePage.includes('invoice')) {
    const inv = window.userInvoices || [];
    rows = [['Client','Amount','Status','Due Date','Notes'],
      ...inv.map(i => [i.client||'', Number(i.amount||0).toFixed(2), i.status||'', i.due||i.due_date||'', i.notes||''])];
    filename = 'invoices.csv';
  } else if (activePage.includes('expense')) {
    const exp = window.bizExpenses || bizExpenses || [];
    rows = [['Description','Category','Amount','Date','Tax Deductible'],
      ...exp.map(e => [e.desc||e.description||'', e.cat||e.category||'', Number(e.amount||0).toFixed(2), e.date||e.expense_date||'', (e.ded||e.deductible)?'Yes':'No'])];
    filename = 'expenses.csv';
  } else if (activePage.includes('payroll')) {
    const emps = [...(window.ownerPayroll ? [{...window.ownerPayroll, isOwner:true}] : []), ...(window.payrollEmployees||[])];
    rows = [['Name','Role','Type','Gross','Tax Rate','Net Pay'],
      ...emps.map(e => [(e.fname||'')+' '+(e.lname||''), e.role||'', e.type||e.emp_type||'', Number(e.gross||0).toFixed(2), (e.taxRate||e.tax_rate||0)+'%', Math.round((e.gross||0)*(1-(e.taxRate||e.tax_rate||0)/100))])];
    filename = 'payroll.csv';
  } else if (activePage.includes('customer')) {
    const custs = window.customers || customers || [];
    rows = [['First Name','Last Name','Company','Email','Phone','Revenue','Status'],
      ...custs.map(c => [c.fname||'', c.lname||'', c.company||'', c.email||'', c.phone||'', Number(c.revenue||0).toFixed(2), c.status||''])];
    filename = 'customers.csv';
  } else if (activePage.includes('inventor')) {
    const inv = window.inventory || inventory || [];
    rows = [['Product','SKU','Units','Max Units','Cost','Stock Status'],
      ...inv.map(i => [i.name||'', i.sku||'', i.units||0, i.max||i.max_units||0, Number(i.cost||0).toFixed(2), i.low?'Low Stock':'OK'])];
    filename = 'inventory.csv';
  } else if (activePage.includes('item')) {
    const items = window.userItems || window.allItems || [];
    rows = [['Name','Type','Price','Status'],
      ...items.map(i => [i.name||'', i.type||'', Number(i.price||i.rate||0).toFixed(2), i.status||''])];
    filename = 'items.csv';
  } else if (activePage.includes('vendor')) {
    const vendors = window.allVendors || [];
    rows = [['Vendor','Contact','Email','Phone','Balance'],
      ...vendors.map(v => [v.name||'', v.contact||'', v.email||'', v.phone||'', Number(v.balance||0).toFixed(2)])];
    filename = 'vendors.csv';
  } else if (activePage.includes('quote')) {
    const quotes = window._quotes || window.allQuotes || [];
    rows = [['Client','Amount','Status','Valid Until','Notes'],
      ...quotes.map(q => [q.client||'', Number(q.amount||0).toFixed(2), q.status||'', q.valid_until||'', q.notes||''])];
    filename = 'quotes.csv';
  } else if (activePage.includes('bill')) {
    const bills = window.allBills || [];
    rows = [['Vendor','Amount','Status','Due Date'],
      ...bills.map(b => [b.vendor||b.vendor_name||'', Number(b.amount||0).toFixed(2), b.status||'', b.due_date||''])];
    filename = 'bills.csv';
  } else {
    // Generic — scrape the visible table
    const activePg = document.querySelector('.page.active') || document.querySelector('[id="'+activePage+'"]');
    const table = activePg?.querySelector('table, .data-table');
    if (table) {
      rows = Array.from(table.querySelectorAll('tr')).map(tr =>
        Array.from(tr.querySelectorAll('th,td')).map(td => td.textContent.trim()));
      filename = (activePage.replace('page-','') || 'export') + '.csv';
    } else {
      notify('Nothing to export on this page.', true);
      return;
    }
  }

  if (rows.length <= 1) { notify('No data to export.', true); return; }
  const csv = rows.map(toCSV).join('\r\n');
  const blob = new Blob(['﻿' + csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {href:url, download:filename});
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  notify('Exported ' + filename + ' ✦');
};

window.exportAuditCSV = async function(){
  try {
    const res = await fetch('/api/audit-log?limit=10000', {credentials:'include'});
    if (!res.ok) { notify('Could not load audit log.', true); return; }
    const data = await res.json();
    const entries = Array.isArray(data) ? data : (data.rows || []);
    if (!entries.length) { notify('No audit entries to export.', true); return; }
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g,'""') + '"';
    const rows = [['TIMESTAMP','ACTION','TABLE','RECORD ID'],
      ...entries.map(e => [e.created_at||'', e.action||'', e.table_name||'', e.record_id||''])];
    const csv = rows.map(r => r.map(q).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const filename = 'finflow-audit-' + new Date().toISOString().slice(0,10) + '.csv';
    const a = Object.assign(document.createElement('a'), {href:url, download:filename});
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    notify('Exported ' + filename + ' ✦');
  } catch(e) { notify('Export failed: ' + e.message, true); }
};

// ════════════════════════════════════════════
// ③ BANK RECONCILIATION ENGINE
// ════════════════════════════════════════════
let reconState = {clearedIds: [], lastReconDate: null, lastReconBal: null};

function openReconcileModal(){
  // Build transaction list
  const list = document.getElementById('recon-txn-list');
  list.innerHTML = bankTxns.map((t,i)=>`
    <label style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--bd);cursor:pointer;transition:background .1s" onmouseenter="this.style.background='var(--bg2)'" onmouseleave="this.style.background=''">
      <input type="checkbox" data-idx="${i}" style="accent-color:var(--acc);flex-shrink:0"
        ${reconState.clearedIds.includes(i)?'checked':''} onchange="updateReconSummary()">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;color:var(--t1);font-weight:500">${esc(t.desc||'')}</div>
        <div style="font-size:11px;color:var(--t3)">${esc(t.cat||'')} · ${esc(t.date||'')}</div>
      </div>
      <span style="font-family:var(--font-mono);font-size:13px;font-weight:600;flex-shrink:0;color:${t.type==='credit'?'var(--green)':'var(--red)'}">
        ${t.type==='credit'?'+':'-'}$${Math.abs(t.amount).toLocaleString()}
      </span>
    </label>`).join('');
  if(reconState.lastReconBal){
    document.getElementById('recon-stmt-bal').value = reconState.lastReconBal;
  }
  updateReconSummary();
  document.getElementById('reconcile-modal').classList.remove('hidden');
}

function updateReconSummary(){
  const stmtBal = parseFloat(document.getElementById('recon-stmt-bal').value) || 0;
  const bookBal = (typeof bankTxns!=='undefined'?bankTxns:window.bankTxns||[]).reduce((s,t)=>s+(parseFloat(t.amount)||0),0);
  const checked = [...document.querySelectorAll('#recon-txn-list input[type=checkbox]:checked')];
  const clearedSum = checked.reduce((sum, cb)=>{
    const idx = parseInt(cb.dataset.idx);
    return sum + bankTxns[idx].amount;
  }, 0);
  const adjustedBook = bookBal - clearedSum;
  const diff = stmtBal - adjustedBook;
  const diffEl = document.getElementById('recon-diff');
  const statusEl = document.getElementById('recon-status');
  diffEl.textContent = (diff === 0 ? '$0.00' : (diff > 0 ? '+' : '') + '$' + Math.abs(diff).toFixed(2));
  diffEl.style.color = diff === 0 ? 'var(--green)' : 'var(--amber)';
  if(diff === 0 && stmtBal > 0){
    statusEl.innerHTML = '<span class="badge b-green">✓ Balanced</span>';
  } else if(stmtBal > 0){
    statusEl.innerHTML = `<span class="badge b-amber">${checked.length} cleared</span>`;
  } else {
    statusEl.innerHTML = '';
  }
  document.getElementById('recon-sub').textContent =
    `Main Checking ****4821 · ${checked.length} of ${bankTxns.length} transactions cleared`;
}

function finishReconciliation(){
  const checked = [...document.querySelectorAll('#recon-txn-list input[type=checkbox]:checked')];
  const diff = parseFloat(document.getElementById('recon-diff').textContent.replace(/[^0-9.-]/g,''));
  if(isNaN(diff) || Math.abs(diff) > 0.01){
    notify('Difference must be $0.00 to finish reconciliation','error'); return;
  }
  reconState.clearedIds = checked.map(cb => parseInt(cb.dataset.idx));
  reconState.lastReconDate = new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  reconState.lastReconBal = document.getElementById('recon-stmt-bal').value;
  // reconState stored in-memory only — no localStorage
  closeModal('reconcile-modal');
  notify('Reconciliation complete — Main Checking ✓');
}

// ════════════════════════════════════════════
// ④ DOUBLE-ENTRY JOURNAL WITH LIVE COA
// ════════════════════════════════════════════
let journalEntries = []; // loaded from API by renderJournalsLive()
const COA_ACCOUNTS = [
  {code:'1010',name:'Checking Account',    type:'Asset'},
  {code:'1020',name:'Savings Account',     type:'Asset'},
  {code:'1100',name:'Accounts Receivable', type:'Asset'},
  {code:'1200',name:'Inventory',           type:'Asset'},
  {code:'1500',name:'Equipment',           type:'Asset'},
  {code:'2000',name:'Accounts Payable',    type:'Liability'},
  {code:'2100',name:'Credit Card',         type:'Liability'},
  {code:'2200',name:'Tax Payable',         type:'Liability'},
  {code:"3000",name:"Owner's Equity",      type:'Equity'},
  {code:'3100',name:'Retained Earnings',   type:'Equity'},
  {code:'4000',name:'Service Revenue',     type:'Revenue'},
  {code:'4100',name:'Product Sales',       type:'Revenue'},
  {code:'5000',name:'Salaries & Wages',    type:'Expense'},
  {code:'5100',name:'Rent',                type:'Expense'},
  {code:'5200',name:'Software Subscriptions',type:'Expense'},
  {code:'5300',name:'Marketing',           type:'Expense'},
];

// Base balances (before posted journal entries) — all zero; set opening balances via journal entries
const COA_BASE = {
  '1010':0,'1020':0,'1100':0,'1200':0,'1500':0,
  '2000':0,'2100':0,'2200':0,
  '3000':0,'3100':0,
  '4000':0,'4100':0,
  '5000':0,'5100':0,'5200':0,'5300':0,
};

function computeCoaBalances(){
  const bal = {...COA_BASE};
  journalEntries.filter(je=>je.status==='Posted').forEach(je=>{
    je.lines.forEach(line=>{
      if(!bal[line.code]) bal[line.code] = 0;
      const acct = COA_ACCOUNTS.find(a=>a.code===line.code);
      if(!acct) return;
      // Normal balance: Assets/Expenses increase with Debit; Liabilities/Equity/Revenue with Credit
      const isDebitNormal = ['Asset','Expense'].includes(acct.type);
      bal[line.code] += isDebitNormal ? (line.dr - line.cr) : (line.cr - line.dr);
    });
  });
  return bal;
}

function openJournalEntryModal(){
  // Restore lines to 2 blank rows
  window._jeLines = [{code:'',dr:0,cr:0},{code:'',dr:0,cr:0}];
  renderJELines();
  document.getElementById('je-date').value = new Date().toISOString().slice(0,10);
  document.getElementById('je-notes').value = '';
  updateJETotals();
  document.getElementById('journal-entry-modal').classList.remove('hidden');
}

function renderJELines(){
  const container = document.getElementById('je-lines');
  container.innerHTML = window._jeLines.map((line,i)=>`
    <div style="display:grid;grid-template-columns:1fr 90px 90px 28px;gap:6px;margin-bottom:5px" id="je-line-${i}">
      <select class="finput" style="font-size:12px" onchange="jeLineChange(${i},'code',this.value)">
        <option value="">— Select account —</option>
        ${COA_ACCOUNTS.map(a=>`<option value="${a.code}" ${line.code===a.code?'selected':''}>${a.code} ${a.name}</option>`).join('')}
      </select>
      <input class="finput" type="number" placeholder="0.00" style="font-size:12px" value="${line.dr||''}"
        oninput="jeLineChange(${i},'dr',parseFloat(this.value)||0)" min="0">
      <input class="finput" type="number" placeholder="0.00" style="font-size:12px" value="${line.cr||''}"
        oninput="jeLineChange(${i},'cr',parseFloat(this.value)||0)" min="0">
      <button class="btn btn-ghost btn-sm" style="padding:4px;font-size:16px;line-height:1" onclick="removeJELine(${i})" ${window._jeLines.length<=2?'disabled':''}>×</button>
    </div>`).join('');
}

function jeLineChange(idx, field, val){
  window._jeLines[idx][field] = val;
  updateJETotals();
}
function addJELine(){
  window._jeLines.push({code:'',dr:0,cr:0});
  renderJELines();
  updateJETotals();
}
function removeJELine(idx){
  if(window._jeLines.length <= 2) return;
  window._jeLines.splice(idx,1);
  renderJELines();
  updateJETotals();
}

function updateJETotals(){
  const lines = window._jeLines;
  const totalDr = lines.reduce((s,l)=>s+(l.dr||0),0);
  const totalCr = lines.reduce((s,l)=>s+(l.cr||0),0);
  document.getElementById('je-total-dr').textContent = '$'+totalDr.toLocaleString(undefined,{minimumFractionDigits:2});
  document.getElementById('je-total-cr').textContent = '$'+totalCr.toLocaleString(undefined,{minimumFractionDigits:2});
  const balanced = Math.abs(totalDr - totalCr) < 0.01 && totalDr > 0;
  const balEl = document.getElementById('je-balanced');
  balEl.textContent = balanced ? '✓ Balanced' : 'Not balanced';
  balEl.style.color = balanced ? 'var(--green)' : 'var(--amber)';
  document.getElementById('je-post-btn').disabled = !balanced;
}

function saveJournalEntry(status){
  const lines = window._jeLines.filter(l=>l.code && (l.dr>0||l.cr>0));
  if(lines.length < 2){ notify('Add at least 2 lines','error'); return; }
  const totalDr = lines.reduce((s,l)=>s+(l.dr||0),0);
  const totalCr = lines.reduce((s,l)=>s+(l.cr||0),0);
  if(status==='Posted' && Math.abs(totalDr-totalCr)>0.01){
    notify('Debits must equal credits to post','error'); return;
  }
  const ref = 'JE-' + String(journalEntries.length + 43).padStart(4,'0');
  const entry = {
    date: document.getElementById('je-date').value,
    notes: document.getElementById('je-notes').value || 'Manual journal entry',
    ref,
    debit: totalDr,
    credit: totalCr,
    status,
    lines,
  };
  journalEntries.unshift(entry);
  renderJournals();
  renderCOA(); // refresh balances
  closeModal('journal-entry-modal');
  notify(`Journal entry ${ref} ${status.toLowerCase()}`);
}

// ════════════════════════════════════════════
// PATCH renderJournals to include live entries
// ════════════════════════════════════════════
const _origRenderJournals = renderJournals;

// ════════════════════════════════════════════
// PATCH renderCOA to use live balances
// ════════════════════════════════════════════

async function renderCOALive(){
  const l=document.getElementById('coa-list');if(!l)return;
  try{
    const res=await fetch('/api/chart-of-accounts',{credentials:'include'});
    if(!res.ok)throw new Error();
    const accounts=await res.json();

    // Update KPI cards with real data
    const assets = accounts.filter(a=>a.type==='Asset').reduce((s,a)=>s+(parseFloat(a.balance)||0),0);
    const liabs  = accounts.filter(a=>a.type==='Liability').reduce((s,a)=>s+(parseFloat(a.balance)||0),0);
    const equity = assets - liabs;
    const S = n=>'$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0});
    const setEl = (id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    setEl('coa-count', accounts.length);
    setEl('coa-assets', S(assets));
    setEl('coa-liabs',  S(liabs));
    setEl('coa-equity', S(equity));

    if(!accounts || !accounts.length){
      l.innerHTML='<div style="padding:1.5rem;text-align:center;color:var(--t3);font-size:13px">No accounts yet. Click "+ New account" to add your chart of accounts.</div>';
      return;
    }
    const grouped={};
    accounts.forEach(a=>{if(!grouped[a.type])grouped[a.type]=[];grouped[a.type].push(a);});
    l.innerHTML=Object.entries(grouped).map(([type,accs])=>`
      <div style="margin-bottom:1rem">
        <div style="font-size:11px;font-weight:700;color:var(--acc);text-transform:uppercase;letter-spacing:.1em;padding:.5rem 0;border-bottom:1px solid var(--bd)">${type}</div>
        ${accs.map(a=>`
        <div style="display:grid;grid-template-columns:60px 1fr 90px 70px;gap:8px;padding:7px 0;border-bottom:1px solid var(--bd);font-size:12.5px">
          <span style="color:var(--t3);font-family:var(--font-mono)">${esc(a.code||'')}</span>
          <span style="color:var(--t1)">${esc(a.name||'')}</span>
          <span style="font-family:var(--font-mono);text-align:right;color:var(--t1)">$${(a.balance||0).toLocaleString()}</span>
          <span style="color:var(--t3);text-align:right">${a.nature||''}</span>
        </div>`).join('')}
      </div>`).join('');
  }catch(e){
    if(!coaData.length){
      l.innerHTML='<div style="padding:2rem;text-align:center;color:var(--t3)">Could not load chart of accounts. Please refresh.</div>';
      return;
    }
    const balances=computeCoaBalances();
    l.innerHTML=coaData.map(section=>`
      <div style="margin-bottom:1rem">
        <div style="font-size:11px;font-weight:700;color:var(--acc);text-transform:uppercase;letter-spacing:.1em;padding:.5rem 0;border-bottom:1px solid var(--bd)">${section.type}</div>
        ${section.accounts.map(a=>{
          const liveBalance=balances[a.code]??a.balance;
          const changed=liveBalance!==a.balance;
          return `<div style="display:grid;grid-template-columns:60px 1fr 90px 70px;gap:8px;padding:7px 0;border-bottom:1px solid var(--bd);font-size:12.5px">
            <span style="color:var(--t3);font-family:var(--font-mono)">${a.code}</span>
            <span style="color:var(--t1)">${a.name}</span>
            <span style="font-family:var(--font-mono);text-align:right;color:${changed?'var(--acc)':'var(--t1)'};font-weight:${changed?600:400}">$${liveBalance.toLocaleString()}${changed?'<span style="font-size:10px;color:var(--acc);margin-left:3px">●</span>':''}</span>
            <span style="color:var(--t3);text-align:right">${a.nature}</span>
          </div>`;
        }).join('')}
      </div>`).join('');
  }
}

async function renderJournalsLive(){
  const l=document.getElementById('journals-list');if(!l)return;
  l.innerHTML='<div style="padding:1rem;text-align:center;color:var(--t3);font-size:13px">Loading…</div>';
  try{
    const res=await fetch('/api/journals',{credentials:'include'});
    if(!res.ok)throw new Error();
    const journals=await res.json();

    // Update KPI cards with real data
    const S = n=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0});
    const setEl = (id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    const totalDebits  = journals.reduce((s,j)=>s+(parseFloat(j.debit)||0),0);
    const totalCredits = journals.reduce((s,j)=>s+(parseFloat(j.credit)||0),0);
    const draftCount   = journals.filter(j=>j.status!=='Posted').length;
    setEl('jnl-count',   journals.length);
    setEl('jnl-debits',  S(totalDebits));
    setEl('jnl-credits', S(totalCredits));
    setEl('jnl-drafts',  draftCount);
    const balEl = document.getElementById('jnl-balance-label');
    if(balEl) balEl.textContent = Math.abs(totalDebits-totalCredits)<0.01 ? 'Balanced' : 'Unbalanced';

    if(!journals.length){l.innerHTML='<div style="padding:1rem;text-align:center;color:var(--t3);font-size:13px">No journal entries yet.</div>';return;}
    l.innerHTML=journals.map(j=>`
      <div class="table-row" style="grid-template-columns:90px 1fr 80px 80px 80px 70px">
        <span style="color:var(--t3)">${esc(j.date||'')}</span>
        <span style="font-weight:500">${esc(j.notes||j.description||'')}</span>
        <span style="color:var(--t3)">${esc(j.ref||'')}</span>
        <span style="font-family:var(--font-mono);color:var(--red)">$${(j.debit||0).toLocaleString()}</span>
        <span style="font-family:var(--font-mono);color:var(--green)">$${(j.credit||0).toLocaleString()}</span>
        <span><span class="badge ${(j.status||'Draft')==='Posted'?'b-green':'b-amber'}">${esc(j.status||'Draft')}</span></span>
      </div>`).join('');
  }catch(e){
    const allEntries=[...journalEntries,...journalsData.map(j=>({...j,lines:null}))];
    l.innerHTML=allEntries.map(j=>`
      <div class="table-row" style="grid-template-columns:90px 1fr 80px 80px 80px 70px">
        <span style="color:var(--t3)">${esc(j.date||'')}</span><span style="font-weight:500">${esc(j.notes||'')}</span>
        <span style="color:var(--t3)">${esc(j.ref||'')}</span>
        <span style="font-family:var(--font-mono);color:var(--red)">$${(j.debit||0).toLocaleString()}</span>
        <span style="font-family:var(--font-mono);color:var(--green)">$${(j.credit||0).toLocaleString()}</span>
        <span><span class="badge ${j.status==='Posted'?'b-green':'b-amber'}">${j.status}</span></span>
      </div>`).join('');
  }
}

// Override the static render functions with live ones
window.renderCOA = renderCOALive;
window.renderJournals = renderJournalsLive;

// ════════════════════════════════════════════
// INIT — run after DOM is ready
// ════════════════════════════════════════════
function initEnhancements(){
  loadPersistedData();
  // Init business switcher
  const activeBiz = businesses.find(b=>b.id===activeBizId) || businesses[0];
  if(activeBiz){
    document.getElementById('sb-brand-name').textContent = activeBiz.name;
    document.getElementById('biz-currency-badge').textContent = `${activeBiz.currency} · Pro`;
    activeCurrency = activeBiz.displayCurrency || activeBiz.currency;
    currencySymbol = CURRENCIES[activeCurrency]?.symbol || '$';
    document.getElementById('currency-flag').textContent  = CURRENCIES[activeCurrency]?.flag || '🇺🇸';
    document.getElementById('currency-code-label').textContent = activeCurrency;
  }
  // Patch S() to apply FX
  patchSFormatter();
  // Style login radio labels on change
  document.querySelectorAll('input[name="login-role"]').forEach(radio=>{
    radio.addEventListener('change',()=>{
      document.querySelectorAll('input[name="login-role"]').forEach(r=>{
        r.closest('label').style.borderColor = r.checked ? 'var(--acc)' : 'var(--bd)';
      });
    });
  });
  // Pre-highlight checked
  const checked = document.querySelector('input[name="login-role"]:checked');
  if(checked) checked.closest('label').style.borderColor = 'var(--acc)';
  // Always verify server session before firing ff:authed — avoids 401 race
  // when sessionStorage has ff_role but the cookie has expired server-side.
  fetch('/api/me', {credentials:'include'}).then(async r => {
    if (!r.ok) { sessionStorage.removeItem('ff_role'); return; }
    const data = await r.json();
    window.CURRENT_USER = data.user;
    _setUserDisplay(data.user);
    const role = sessionStorage.getItem('ff_role') || 'owner';
    currentRole = role;
    applyRole(role);
    sessionStorage.setItem('ff_role', role);
    document.getElementById('login-screen').style.display = 'none';
    injectRoleBadge(role);
    window._ffAuthed = true;
    window.dispatchEvent(new Event('ff:authed'));
    if(typeof loadEntitiesFromDB === 'function') await loadEntitiesFromDB();
    if(typeof loadBankingFromDB === 'function') loadBankingFromDB();
  }).catch(()=>{});
}

// ── AUTO SESSION CHECK ON LOAD ──────────────────────────────────────────────
// Session restoration is handled by initEnhancements() — duplicate removed (H-15).

// ════════════════════════════════════════════
// PATCH saveCustomer / saveInvoice / etc to persist
// ════════════════════════════════════════════
// (Called after original functions are defined — see bottom of script)


function computeMonthFull(){
  var fyStart=(document.getElementById('s-fy')||{}).value||'January';
  var mNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
  var fyStartIdx=Math.max(0,mNames.indexOf(fyStart));
  var today=new Date();
  var todayYear=today.getFullYear();
  var todayMonth=today.getMonth();
  var fyStartYear=(todayMonth>=fyStartIdx)?todayYear:todayYear-1;
  var result=[];
  for(var i=0;i<12;i++){
    var d=new Date(fyStartYear,fyStartIdx+i,1);
    result.push(d.toLocaleString('en-US',{month:'short',year:'numeric'}));
  }
  return result;
}
var MONTH_FULL=computeMonthFull();
var MONTHS=MONTH_FULL.map(function(m){return m.split(' ')[0];});
// ══════════════════════════════════════════════════════════════
// ENTITY DATA — each entity has its own financials, invoices,
// expenses, payroll, customers & inventory
// ══════════════════════════════════════════════════════════════
const ENTITY_DATA = {
  0: { REV: new Array(12).fill(0), EXP: new Array(12).fill(0), invoices: [], expenses: [], inventory: [], customers: [], payroll: [], srcPct:[0.25,0.2,0.3,0.25] },
  1: { REV: new Array(12).fill(0), EXP: new Array(12).fill(0), invoices: [], expenses: [], inventory: [], customers: [], payroll: [], srcPct:[0.25,0.2,0.3,0.25] },
  2: { REV: new Array(12).fill(0), EXP: new Array(12).fill(0), invoices: [], expenses: [], inventory: [], customers: [], payroll: [], srcPct:[0.25,0.2,0.3,0.25] },
};
// Active entity index (mirrors ENTITIES active flag)
let activeEntityIdx = 0;

// Live data pointers — these get swapped on entity switch
let REV    = new Array(12).fill(0);
let EXP    = new Array(12).fill(0);
let PROFIT = new Array(12).fill(0);
const EXP_SAL  = new Array(12).fill(0);
const EXP_RENT = new Array(12).fill(0);
const EXP_SW   = new Array(12).fill(0);
const EXP_MKT  = new Array(12).fill(0);
// Revenue source arrays - populated from real invoice data grouped by client
let SRC_RETAILCO  = new Array(12).fill(0);
let SRC_TECHSTART = new Array(12).fill(0);
let SRC_STRIPE    = new Array(12).fill(0);
let SRC_CONSULT   = new Array(12).fill(0);
// Top clients derived from real invoices - set by loadEntityData()
let _topClients = []; // [{label, monthly, total}]

// Load entity data into live pointers
let _loadEntityDataRunning = false;
async function loadEntityData(idx){
  if (_loadEntityDataRunning) { console.warn('[Entity] loadEntityData already running, skipping'); return; }
  _loadEntityDataRunning = true;
  activeEntityIdx = idx;
  // Zero out chart data immediately so stale data doesn't show
  const z = new Array(12).fill(0);
  if(typeof REV !== 'undefined') REV.splice(0,12,...z);
  if(typeof EXP !== 'undefined') EXP.splice(0,12,...z);
  if(typeof PROFIT !== 'undefined') PROFIT.splice(0,12,...z);

  const _clrEl = id => { const el = document.getElementById(id); if(el) el.innerHTML = ''; };

  try {
    // Pass entity_id explicitly — don't rely on session
    const _entityObj = ENTITIES[idx] || ENTITIES.find(e=>e.active);
    const _eid = _entityObj?._dbId;
    if (!_eid) { console.warn('[Entity] No _dbId found for idx', idx); _loadEntityDataRunning = false; return; }
    const _eq = '?entity_id='+_eid;
    console.log('[Entity] Loading data for entity_id='+_eid+' ('+_entityObj?.name+')');
    const [invRes, expRes, custRes, invtRes, payRes] = await Promise.all([
      fetch('/api/invoices'+_eq,   {credentials:'include'}),
      fetch('/api/expenses'+_eq,   {credentials:'include'}),
      fetch('/api/customers'+_eq,  {credentials:'include'}),
      fetch('/api/inventory'+_eq,  {credentials:'include'}),
      fetch('/api/payroll'+_eq,    {credentials:'include'}),
    ]);
    const invoices   = invRes.ok   ? (await invRes.json()  || []) : [];
    const expenses   = expRes.ok   ? (await expRes.json()  || []) : [];
    const custs      = custRes.ok  ? (await custRes.json() || []) : [];
    const invt       = invtRes.ok  ? (await invtRes.json() || []) : [];
    const payroll    = payRes.ok   ? (await payRes.json()  || []) : [];

    // Atomically swap global arrays now that all data has arrived
    userInvoices.length = 0;
    bizExpenses.length = 0;
    customers.length = 0;
    inventory.length = 0;
    payrollEmployees.length = 0;
    ownerPayroll = null;
    window.ownerPayroll = null;
    _clrEl('invoice-list'); _clrEl('expense-list'); _clrEl('customer-list');
    _clrEl('inventory-list'); _clrEl('payroll-list');

    // Replace userInvoices
    userInvoices = invoices.map(r=>({
      _dbId:r.id, client:r.client, amount:r.amount,
      due: r.due_date ? new Date(r.due_date).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : 'TBD',
      due_date:r.due_date, status:r.status, notes:r.notes||'',
      color: r.status?.toLowerCase()==='overdue'?'var(--red)':'var(--t2)',
    }));

    // Replace bizExpenses
    bizExpenses = expenses.map(r=>({
      _dbId:r.id, desc:r.description, cat:r.category,
      amount:r.amount, ded:r.deductible,
      date: r.expense_date ? new Date(r.expense_date).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : 'Today',
    }));

    // Replace customers
    customers = custs.map(c=>({...c, _dbId:c.id}));

    // Replace inventory
    inventory = invt.map(r=>({_dbId:r.id, sku:r.sku, name:r.name, units:r.units, max:r.max_units||200, cost:r.cost, low:!!r.low_stock}));

    // Update payroll — always reset employees per entity (no stale cross-entity rows)
    payrollEmployees = (payroll||[]).filter(r=>!r.is_owner).map(r=>({
      _dbId:r.id, fname:r.fname, lname:r.lname, role:r.role||'', type:r.emp_type||'Full-time',
      gross:r.gross, taxRate:r.tax_rate, net:Math.round(r.gross*(1-r.tax_rate/100)),
      initials:((r.fname||'')[0]+((r.lname||'')[0]||'')).toUpperCase(), avClass:r.av_class||'av-blue', isOwner:false,
    }));
    window.payrollEmployees = payrollEmployees;

    // Restore owner payroll PER-ENTITY — index by the entity idx we're loading
    const ownerRow = (payroll||[]).find(r=>r.is_owner);
    if(typeof ownerPayrollByEntity === 'undefined') window.ownerPayrollByEntity = window.ownerPayrollByEntity || {};
    if(ownerRow){
      const _entity = ENTITIES[idx];
      const owner = {
        _dbId:    ownerRow.id,
        fname:    ownerRow.fname,
        lname:    ownerRow.lname || '',
        role:     ownerRow.role || 'CEO / Founder',
        type:     ownerRow.emp_type || 'owner',
        gross:    parseFloat(ownerRow.gross) || 0,
        taxRate:  parseFloat(ownerRow.tax_rate) || 0,
        net:      Math.round((parseFloat(ownerRow.gross)||0)*(1-(parseFloat(ownerRow.tax_rate)||0)/100)),
        initials: ((ownerRow.fname||'')[0]+((ownerRow.lname||'')[0]||'')).toUpperCase(),
        avClass:  ownerRow.av_class || 'av-blue',
        currency: _entity?.currency || 'USD',
        entityName: _entity?.name || 'Entity',
        isOwner:  true,
      };
      ownerPayrollByEntity[idx] = owner;
      window.ownerPayrollByEntity = ownerPayrollByEntity;
      // Sync compat pointer if this is the active entity
      if (ENTITIES[idx]?.active) {
        ownerPayroll = owner;
        window.ownerPayroll = owner;
      }
      console.log('[loadEntityData] Restored owner payroll for entity idx', idx, '('+_entity?.name+'):', owner.fname, owner.lname, '| gross:', owner.gross);
    } else {
      // No owner record for this entity — clear any stale mapping for this idx
      if (ownerPayrollByEntity[idx]) {
        delete ownerPayrollByEntity[idx];
        if (ENTITIES[idx]?.active) { ownerPayroll = null; window.ownerPayroll = null; }
      }
    }

    // Sync to Personal Finance (salary income line + banner)
    if (typeof syncAllPayrollsToPersonal === 'function') {
      try { syncAllPayrollsToPersonal(); } catch(e) { console.warn('[loadEntityData] syncAllPayrollsToPersonal failed:', e.message); }
    }

    // Store globally for dashboard wiring — MUST update before calling updateDashboard
    window._realInvoices = invoices || [];
    window._realExpenses = expenses || [];

    // Rebuild monthly chart arrays from real data — aligned to fiscal year
    const _fyMonths=['January','February','March','April','May','June','July','August','September','October','November','December'];
    const _fyName=(document.getElementById('s-fy')||{}).value||'January';
    const _fyStartIdx=Math.max(0,_fyMonths.indexOf(_fyName));
    const _today=new Date();
    const _fyStartYear=(_today.getMonth()>=_fyStartIdx)?_today.getFullYear():_today.getFullYear()-1;
    const monthlyRev = new Array(12).fill(0);
    const monthlyExp = new Array(12).fill(0);
    invoices.forEach(inv => {
      if(inv.status !== 'paid') return;
      const d = inv.due_date ? new Date(inv.due_date) : null;
      if(!d) return;
      const mIdx = (d.getMonth() - _fyStartIdx) + (d.getFullYear() - _fyStartYear) * 12;
      if(mIdx >= 0 && mIdx < 12) monthlyRev[mIdx] += parseFloat(inv.amount)||0;
    });
    expenses.forEach(exp => {
      const d = exp.expense_date ? new Date(exp.expense_date) : null;
      if(!d) return;
      const mIdx = (d.getMonth() - _fyStartIdx) + (d.getFullYear() - _fyStartYear) * 12;
      if(mIdx >= 0 && mIdx < 12) monthlyExp[mIdx] += parseFloat(exp.amount)||0;
    });
    // Add owner monthly gross spread evenly across all 12 months in opex
    const ownerMonthlyGross = (ownerPayrollByEntity[idx]?.gross) || 0;
    if (ownerMonthlyGross > 0) {
      for (let i = 0; i < 12; i++) monthlyExp[i] += ownerMonthlyGross;
    }

    REV.splice(0,12,...monthlyRev);
    EXP.splice(0,12,...monthlyExp);
    for(let i=0;i<12;i++) PROFIT[i] = REV[i]-EXP[i];

    const _safeRender = (fn) => { try { if(typeof fn==='function') fn(); } catch(e) { console.warn('render error:', e.message); } };
    _safeRender(renderInvoices);
    _safeRender(renderExpenses);
    _safeRender(renderCustomers);
    _safeRender(renderInventory);
    _safeRender(renderPayroll);
    _safeRender(updateDashboard);
    _safeRender(buildCharts);

    // Refresh dashboard wiring KPIs with correct entity data
    if(typeof window._bootDashboardWiring==='function') {
      try { await window._bootDashboardWiring(); } catch(e) {}
    }
    // Also refresh banking for this entity
    if(typeof loadBankingFromDB==='function') loadBankingFromDB();

    // Build _topClients from real paid invoices grouped by client name
    const _clientTotals = {};
    invoices.filter(i=>i.status?.toLowerCase()==='paid').forEach(i=>{
      const c = i.client||'Other';
      _clientTotals[c] = (_clientTotals[c]||0) + (parseFloat(i.amount)||0);
    });
    _topClients = Object.entries(_clientTotals)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,4)
      .map(([label,total])=>({label,total}));

    console.log('[Entity] Loaded real data — invoices:'+invoices.length+' expenses:'+expenses.length+' top clients:'+_topClients.length);
  } catch(e){ console.warn('[Entity] loadEntityData failed:', e.message); } finally {
    MONTH_FULL=computeMonthFull();
    MONTHS=MONTH_FULL.map(function(m){return m.split(' ')[0];});
    _loadEntityDataRunning=false;
  }
}
window.loadEntityData = loadEntityData; // expose for medium.js payroll reload hook

const INVOICES_BASE = []; // populated from DB via loadEntityData

// Start with empty arrays — loadEntityData fills these from the real API
let bizExpenses = [];
// Inventory
let inventory = [];
// Customers
let customers = [];
let nextCustId = 10;
const AVATAR_COLORS = ['av-blue','av-green','av-purple','av-amber','av-red','av-teal'];
// Payroll
let payrollEmployees = [];
let ownerPayrollByEntity = {};
let ownerPayroll = null;
let activeOwnerEntityIdx = 0;
// Personal
let spending = [];
let goals = [];
let persTransactions = [];
let basePersonalIncome = 0;
let baseNetWorth = 0;
// User invoices — populated from DB via loadEntityData
let userInvoices = [];
let nextInvId = 100;
// Period state
let darkMode = true;
let currentPeriod = 'year';
let currentMonthIdx = 11; // April
let charts = {};
let currencySymbol = '$';

// ════════════════════════════════════════════
// UTILS
// ════════════════════════════════════════════
function S(n,s=false){
  const showCents=document.getElementById('s-cents')?.checked;
  const abs=Math.abs(Number(n));
  const fmt=showCents?abs.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):Math.round(abs).toLocaleString();
  const str=currencySymbol+fmt;
  return s?(n>=0?'+'+str:'-'+str):str;
}
function sum(arr,s,e){return arr.slice(s,e).reduce((a,v)=>a+v,0)}
function pct(a,b){if(!b)return 0;return Math.round((a-b)/Math.abs(b)*100)}
function chg(cur,prev,invert=false){
  if(prev==null)return{txt:'Full year total',cls:'neutral'};
  const p=pct(cur,prev);
  const good=invert?p<=0:p>=0;
  return{txt:(p>=0?'↑ ':'↓ ')+Math.abs(p)+'% vs prior period',cls:good?'up':'dn'};
}
function getInitials(f,l){return((f||'')[0]||'').toUpperCase()+((l||'')[0]||'').toUpperCase()}
function notify(msg,isError=false){
  const el=document.getElementById('notif');
  const icon=document.getElementById('notif-icon');
  const prog=document.getElementById('notif-progress');
  document.getElementById('notif-text').textContent=msg;
  el.className='notif'+(isError?' error':'');
  icon.style.background=isError?'var(--red-bg)':'var(--green-bg)';
  icon.style.color=isError?'var(--red)':'var(--green)';
  icon.innerHTML=isError?'<svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>':'<svg viewBox="0 0 12 12"><polyline points="2,6 5,9 10,3"/></svg>';
  if(prog){prog.style.background=isError?'var(--red)':'var(--green)';prog.style.transition='none';prog.style.transform='scaleX(1)';requestAnimationFrame(()=>{requestAnimationFrame(()=>{prog.style.transition='transform 3.2s linear';prog.style.transform='scaleX(0)';})})}
  clearTimeout(el._t);clearTimeout(el._t2);
  el._t2=setTimeout(()=>{el.classList.add('hiding');el._t=setTimeout(()=>el.className='notif hidden',260);},3400);
}
let _modalFocusCleanup = null;
function closeModal(id){
  document.getElementById(id).classList.add('hidden');
  if(_modalFocusCleanup){ _modalFocusCleanup(); _modalFocusCleanup = null; }
}
function openModal(id){
  const el = document.getElementById(id);
  el.classList.remove('hidden');
  // Apply focus trap to the inner .modal element (first child that is the panel)
  const panel = el.querySelector('.modal') || el;
  if(window.trapFocus){ if(_modalFocusCleanup) _modalFocusCleanup(); _modalFocusCleanup = window.trapFocus(panel); }
}
function emptyState(icon,title,desc,ctaLabel,ctaFn){
  return`<div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 16 16">${icon}</svg></div><h3>${title}</h3><p>${desc}</p>${ctaLabel?`<button class="btn btn-primary btn-sm" onclick="${ctaFn}">${ctaLabel}</button>`:''}</div>`;
}

// ════════════════════════════════════════════
// PERIOD DATA
// ════════════════════════════════════════════
function getPeriodData(){
  if(currentPeriod==='month'){
    const i=currentMonthIdx, p=Math.max(0,i-1);
    return{
      rev:REV[i],exp:EXP[i],profit:PROFIT[i],
      prevRev:REV[p],prevExp:EXP[p],prevProfit:PROFIT[p],
      labels:[MONTHS[i]],revArr:[REV[i]],expArr:[EXP[i]],
      sal:EXP_SAL[i],rent:EXP_RENT[i],sw:EXP_SW[i],mkt:EXP_MKT[i],
      srcRC:0,srcTS:0,srcST:0,srcCO:0,
      months:1, label:MONTH_FULL[i]
    };
  } else if(currentPeriod==='quarter'){
    const s=9,e=12,ps=6,pe=9;
    return{
      rev:sum(REV,s,e),exp:sum(EXP,s,e),profit:sum(PROFIT,s,e),
      prevRev:sum(REV,ps,pe),prevExp:sum(EXP,ps,pe),prevProfit:sum(PROFIT,ps,pe),
      labels:MONTHS.slice(s,e),revArr:REV.slice(s,e),expArr:EXP.slice(s,e),
      sal:sum(EXP_SAL,s,e),rent:EXP_RENT[0]*3,sw:sum(EXP_SW,s,e),mkt:sum(EXP_MKT,s,e),
      srcRC:0,srcTS:0,srcST:0,srcCO:0,
      months:3, label:'Q4 · Feb–Apr 2026'
    };
  } else {
    return{
      rev:sum(REV,0,12),exp:sum(EXP,0,12),profit:sum(PROFIT,0,12),
      prevRev:null,prevExp:null,prevProfit:null,
      labels:MONTHS,revArr:REV,expArr:EXP,
      sal:sum(EXP_SAL,0,12),rent:EXP_RENT[0]*12,sw:sum(EXP_SW,0,12),mkt:sum(EXP_MKT,0,12),
      srcRC:0,srcTS:0,srcST:0,srcCO:0,
      months:12, label:'Full Year · '+MONTH_FULL[0]+' – '+MONTH_FULL[11]
    };
  }
}

// ════════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════════
function showPage(id, el){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const pg=document.getElementById('page-'+id);
  if(pg)pg.classList.add('active');
  if(el)el.classList.add('active');
  const titles={
    dashboard:'Dashboard',cashflow:'Cash flow',customers:'Customers',invoices:'Invoices',
    expenses:'Expenses',payroll:'Payroll',inventory:'Inventory',connections:'API Connections',
    personal:'Personal Finance',ai:'AI Insights',settings:'Settings',
    items:'Items',banking:'Banking',quotes:'Quotes','sales-receipts':'Sales Receipts',
    'payments-received':'Payments Received','recurring-invoices':'Recurring Invoices',
    'credit-notes':'Credit Notes',vendors:'Vendors',bills:'Bills','payments-made':'Payments Made',
    'recurring-bills':'Recurring Bills','vendor-credits':'Vendor Credits',
    projects:'Projects',timesheet:'Timesheet','manual-journals':'Manual Journals',
    'chart-of-accounts':'Chart of Accounts','transaction-locking':'Transaction Locking',
    reports:'Reports',documents:'Documents',templates:'Templates',
    investments:'Investments',
    'create-business':'Create Business',
  };
  document.getElementById('pageTitle').textContent=titles[id]||id;
  // Page-specific renders — every call typeof-guarded so a missing wiring
  // file (or a render function loaded later via deferred IIFE) never throws
  // ReferenceError and crashes the rest of showPage. The cascade-fail was
  // what was nuking sibling KPI updates further down the function.
  const _call = (fn) => { try { fn(); } catch (e) { console.warn('[showPage] render error for', id, ':', e.message); } };
  if(id==='investments'&&typeof renderInvestments==='function')_call(renderInvestments);
  if(id==='cashflow'&&typeof renderCashflow==='function')_call(renderCashflow);
  if(id==='customers'&&typeof renderCustomers==='function')_call(renderCustomers);
  if(id==='payroll'&&typeof renderPayroll==='function')_call(renderPayroll);
  if(id==='personal'&&typeof renderPersonal==='function')_call(renderPersonal);
  if(id==='invoices'&&typeof renderInvoices==='function')_call(renderInvoices);
  if(id==='expenses'&&typeof renderExpenses==='function')_call(renderExpenses);
  if(id==='inventory'&&typeof renderInventory==='function')_call(renderInventory);
  if(id==='connections'&&typeof connRenderAll==='function')_call(connRenderAll);
  if(id==='ai'&&typeof updateAI==='function')_call(updateAI);
  if(id==='items'&&typeof renderItems==='function')_call(renderItems);
  if(id==='banking'&&typeof renderBanking==='function')_call(renderBanking);
  if(id==='quotes'&&typeof renderQuotes==='function')_call(renderQuotes);
  if(id==='sales-receipts'&&typeof renderReceipts==='function')_call(renderReceipts);
  if(id==='payments-received'&&typeof renderPaymentsReceived==='function')_call(renderPaymentsReceived);
  if(id==='recurring-invoices'&&typeof renderRecurringInvoices==='function')_call(renderRecurringInvoices);
  if(id==='credit-notes'&&typeof renderCreditNotes==='function')_call(renderCreditNotes);
  if(id==='vendors'&&typeof renderVendors==='function')_call(renderVendors);
  if(id==='bills'&&typeof renderBills==='function')_call(renderBills);
  if(id==='payments-made'&&typeof renderPaymentsMade==='function')_call(renderPaymentsMade);
  if(id==='recurring-bills'&&typeof renderRecurringBills==='function')_call(renderRecurringBills);
  if(id==='vendor-credits'&&typeof renderVendorCredits==='function')_call(renderVendorCredits);
  if(id==='projects'&&typeof renderProjects==='function')_call(renderProjects);
  if(id==='timesheet'&&typeof renderTimesheet==='function')_call(renderTimesheet);
  if(id==='manual-journals'&&typeof renderJournals==='function')_call(renderJournals);
  if(id==='chart-of-accounts'&&typeof renderCOA==='function')_call(renderCOA);
  if(id==='transaction-locking'&&typeof renderLockHistory==='function')_call(renderLockHistory);
  if(id==='reports'&&typeof renderReports==='function')_call(renderReports);
  if(id==='documents'&&typeof renderDocuments==='function')_call(renderDocuments);
  if(id==='templates'&&typeof renderTemplates==='function')_call(renderTemplates);
  // Trigger bar animations on the new page
  setTimeout(()=>{ if(pg) animateBarsOnPage(pg); },80);
  // Animate metric counters
  setTimeout(()=>{ if(pg) animateCounters(pg); },60);
}

// ── ANIMATED PROGRESS BARS ────────────────────────────────────────────────
function animateBarsOnPage(page){
  const fills=page.querySelectorAll('.bar-fill,.stock-fill');
  fills.forEach(el=>{
    const inlineW=el.style.width;
    if(!inlineW||inlineW==='0%')return;
    el.style.setProperty('--bar-w',inlineW);
    el.style.width='0%';
    el.closest('.bar-row,.inv-item-row')?.classList.remove('bars-animated');
    requestAnimationFrame(()=>{
      requestAnimationFrame(()=>{el.style.width=inlineW;});
    });
  });
}

// ── ANIMATED METRIC COUNTERS ──────────────────────────────────────────────
function animateCounter(el,target,prefix='',suffix='',duration=600){
  if(!el)return;
  const start=performance.now();
  const startVal=0;
  const isFloat=String(target).includes('.');
  function tick(now){
    const elapsed=now-start;
    const progress=Math.min(elapsed/duration,1);
    const ease=1-Math.pow(1-progress,3);// ease-out cubic
    const current=startVal+(target-startVal)*ease;
    el.textContent=prefix+(isFloat?current.toFixed(1):Math.round(current).toLocaleString())+suffix;
    if(progress<1)requestAnimationFrame(tick);
    else el.textContent=prefix+(isFloat?target.toFixed(1):Math.round(target).toLocaleString())+suffix;
  }
  requestAnimationFrame(tick);
}

function animateCounters(page){
  page.querySelectorAll('.mc-val').forEach(el=>{
    const text=el.textContent.trim();
    // Match $1,234 or $1.2M or 52% or 9.5h etc
    const mDollar=text.match(/^\$?([\d,]+)$/);
    const mPct=text.match(/^(\d+)%$/);
    const mHours=text.match(/^([\d.]+)h$/);
    const mGB=text.match(/^([\d.]+)\s*GB$/);
    if(mDollar){const v=parseInt(mDollar[1].replace(/,/g,''));animateCounter(el,v,text.startsWith('$')?'$':'','',700);}
    else if(mPct){const v=parseInt(mPct[1]);animateCounter(el,v,'','%',600);}
    else if(mHours){const v=parseFloat(mHours[1]);animateCounter(el,v,'','h',500);}
    else if(mGB){const v=parseFloat(mGB[1]);animateCounter(el,v,'','  GB',500);}
  });
}

// ════════════════════════════════════════════
// PERIOD SWITCHER
// ════════════════════════════════════════════
function setPeriod(el, p){
  currentPeriod=p;
  ['pMonth','pQ','pY'].forEach(id=>{
    const b=document.getElementById(id);
    b.style.borderColor='var(--bd2)';b.style.color='var(--t2)';
  });
  el.style.borderColor='var(--acc)';el.style.color='var(--acc)';
  // Show/hide month navigator
  document.getElementById('month-nav').style.display=p==='month'?'flex':'none';
  refreshAllPeriodData();
}
function shiftMonth(dir){
  currentMonthIdx=Math.max(0,Math.min(11,currentMonthIdx+dir));
  document.getElementById('month-nav-label').textContent=MONTH_FULL[currentMonthIdx];
  document.getElementById('month-next').disabled=currentMonthIdx===11;
  refreshAllPeriodData();
}
function refreshAllPeriodData(){
  // Brief skeleton flash on chart containers
  document.querySelectorAll('.canvas-wrap').forEach(el=>{el.classList.add('loading')});
  setTimeout(()=>document.querySelectorAll('.canvas-wrap').forEach(el=>el.classList.remove('loading')),220);
  const d=getPeriodData();
  // Update period label in topbar
  document.getElementById('period-label').textContent=d.label;
  updateDashboard(d);
  updateCashflow(d);
  updateExpenses(d);
  updateInvoices(d);
  updateCharts(d);
  updateAI(d);
}

// ════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════
function updateDashboard(d=getPeriodData()){
  document.getElementById('d-rev').textContent=S(d.rev);
  document.getElementById('d-exp').textContent=S(d.exp);
  document.getElementById('d-profit').textContent=S(d.profit);
  document.getElementById('d-chart-title').textContent='Revenue vs Expenses — '+d.label;
  const rc=chg(d.rev,d.prevRev);
  const ec=chg(d.exp,d.prevExp,true);
  const pc=chg(d.profit,d.prevProfit);
  set('d-rev-chg',rc.txt,rc.cls);
  set('d-exp-chg',ec.txt,ec.cls);
  set('d-profit-chg',pc.txt,pc.cls);
  // Outstanding — show month vs year context
  if(currentPeriod==='year'){
    // Outstanding from real invoices
    const _outstanding = (window.userInvoices||[]).filter(i=>i.status?.toLowerCase()!=='paid').reduce((s,i)=>s+(parseFloat(i.amount)||0),0);
    const _overdue = (window.userInvoices||[]).filter(i=>i.status?.toLowerCase()==='overdue');
    const _overdueAmt = _overdue.reduce((s,i)=>s+(parseFloat(i.amount)||0),0);
    document.getElementById('d-outstanding').textContent=S(_outstanding);
    const _odEl = document.getElementById('d-outstanding-chg');
    if(_odEl){ _odEl.textContent = _overdue.length ? _overdue.length+' overdue · '+S(_overdueAmt) : 'All invoices paid'; _odEl.className = _overdue.length ? 'mc-change dn' : 'mc-change up'; }
  }
  // Expense bars
  const maxE=d.sal;
  document.getElementById('exp-sal').textContent=S(d.sal);
  document.getElementById('exp-rent').textContent=S(d.rent);
  document.getElementById('exp-sw').textContent=S(d.sw);
  document.getElementById('exp-mkt').textContent=S(d.mkt);
  const _maxExpAmt=Math.max(d.sal||0,d.rent||0,d.sw||0,d.mkt||0,1);
  const _sb=function(id,amt){const el=document.getElementById(id);if(!el)return;const w=Math.round(amt/_maxExpAmt*100)+'%';el.style.setProperty('width',w,'important');el.style.setProperty('--bar-w',w);};
  _sb('exp-sal-bar',d.sal||0);_sb('exp-rent-bar',d.rent||0);_sb('exp-sw-bar',d.sw||0);_sb('exp-mkt-bar',d.mkt||0);
  // Business transactions (period-contextual)
  // Build real transactions from DB data
  const _allTxns = [
    ...((window.userInvoices||[]).slice(0,5).map(i=>({name:i.client, cat:'Revenue · '+i.status, amt:parseFloat(i.amount)||0, type:'income'}))),
    ...((window.bizExpenses||[]).slice(0,5).map(e=>({name:e.desc||e.description, cat:'Expense · '+(e.cat||e.category||'Other'), amt:parseFloat(e.amount)||0, type:'expense'}))),
  ];
  const txns = _allTxns
  document.getElementById('d-txns').innerHTML=txns.map(t=>`
    <div class="tx-row">
      <div class="tx-left">
        <div class="tx-icon ${t.type==='income'?'av-green':'av-red'}"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">${t.type==='income'?'<polyline points="1,8 6,3 10,7 15,2"/><polyline points="10,2 15,2 15,7"/>':'<polyline points="1,5 5,10 9,7 15,13"/><polyline points="10,13 15,13 15,8"/>'}</svg></div>
        <div><div class="tx-name">${esc(t.name||'')}</div><div class="tx-cat">${esc(t.cat||'')}</div></div>
      </div>
      <div class="tx-amt ${t.type==='income'?'up':'dn'}">${t.type==='income'?'+':'-'}${S(t.amt)}</div>
    </div>`).join('');
  // Rebuild river diagram with current period data
  setTimeout(()=>buildRiver(d),50);
}
function set(id,txt,cls=''){const el=document.getElementById(id);if(el){el.textContent=txt;if(cls)el.className='mc-change '+cls}}

// ════════════════════════════════════════════
// CASH FLOW
// ════════════════════════════════════════════
function updateCashflow(d=getPeriodData()){
  document.getElementById('cf-in').textContent=S(d.rev);
  document.getElementById('cf-out').textContent=S(d.exp);
  document.getElementById('cf-net').textContent=S(d.profit);
  document.getElementById('cf-avg').textContent=S(Math.round(d.profit/d.months));
  document.getElementById('cf-avg-lbl').textContent=d.months===1?'Net this month':'Avg monthly net';
  const fixed=Math.round(d.exp*.738);const variable=d.exp-fixed;
  document.getElementById('cf-fixed').textContent=S(fixed);
  document.getElementById('cf-variable').textContent=S(variable);
  const runway=d.exp>0?Math.round(d.rev/d.exp*d.months*1.2):Infinity;
  document.getElementById('cf-runway').textContent=isFinite(runway)?Math.round(runway/d.months*10)/10+' months':'∞ months';
  // Income sources bars
  // Income sources — built from real invoice data grouped by client
  const _src_colors = ['var(--green)','#7db87d','#7db87d99','#7db87d66'];
  const _srcList = _topClients.length ? _topClients.slice(0,4) : [];
  const _maxSrc = _srcList.length ? _srcList[0].total : 1;
  document.getElementById('cf-sources').innerHTML = _srcList.length
    ? _srcList.map((s,i)=>{const pct=d.rev>0?Math.round(s.total/d.rev*100):0;return`<div class="bar-row"><span class="bar-label">${esc(s.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${_src_colors[i]||'var(--green)'}"></div></div><span class="bar-val">${S(s.total)}</span></div>`;}).join('')
    : '<div style="color:var(--t3);font-size:12px;padding:8px 0">No revenue data yet</div>';
  // Change indicators
  const ic=chg(d.rev,d.prevRev);const ec=chg(d.exp,d.prevExp,true);
  set('cf-in-chg',ic.txt,ic.cls);set('cf-out-chg',ec.txt,ec.cls);
}
function renderCashflow(){updateCashflow()}

// ════════════════════════════════════════════
// INVOICES
// ════════════════════════════════════════════
function updateInvoices(d=getPeriodData()){
  if(!userInvoices) userInvoices=[];
  // Use actual totals from real data, no multiplier
  const totalBilled=userInvoices.reduce((a,i)=>a+(parseFloat(i.amount)||0),0);
  const collected=userInvoices.filter(i=>i.status?.toLowerCase()==='paid').reduce((a,i)=>a+(parseFloat(i.amount)||0),0);
  const outstanding=userInvoices.filter(i=>i.status?.toLowerCase()!=='paid').reduce((a,i)=>a+(parseFloat(i.amount)||0),0);
  const overdue=userInvoices.filter(i=>i.status?.toLowerCase()==='overdue').reduce((a,i)=>a+(parseFloat(i.amount)||0),0);
  const pctCollected=totalBilled>0?Math.round(collected/totalBilled*100):0;
  document.getElementById('inv-billed').textContent=S(totalBilled);
  document.getElementById('inv-billed-lbl').textContent=d.label;
  document.getElementById('inv-billed-lbl').className='mc-change neutral';
  document.getElementById('inv-paid').textContent=S(collected);
  document.getElementById('inv-paid-pct').textContent=pctCollected+'% collected';
  document.getElementById('inv-out').textContent=S(outstanding);
  document.getElementById('inv-over').textContent=S(overdue);
  document.getElementById('inv-table-title').textContent='Invoices — '+d.label;
  const overdueCount=userInvoices.filter(i=>i.status?.toLowerCase()==='overdue').length;
  document.getElementById('badge-inv').textContent=overdueCount;
  document.getElementById('badge-inv').style.display=overdueCount>0?'':'none';
}
function renderInvoices(){
  updateInvoices();
  if(!userInvoices) userInvoices=[];
  const badgeCls={'paid':'b-green','pending':'b-amber','overdue':'b-red','partial':'b-blue'};
  document.getElementById('invoice-list').innerHTML=userInvoices.map((inv,idx)=>{
    const paid=parseFloat(inv.amount_paid)||0;
    const total=parseFloat(inv.amount)||0;
    const paidStr=paid>0?S(paid):'—';
    const statusLabel=inv.status==='partial'?`partial (${S(paid)} of ${S(total)})`:inv.status;
    return`<div class="table-row inv-cols">
      <span>${esc(inv.client)}</span>
      <span style="font-weight:600;font-family:var(--font-mono)">${esc(S(inv.amount))}</span>
      <span style="font-family:var(--font-mono);color:${paid>0?'var(--green)':'var(--t3)'}">${paidStr}</span>
      <span style="color:${esc(inv.color)}">${esc(inv.due)}</span>
      <span class="table-actions" style="display:flex;gap:4px;flex-wrap:wrap">
        <span class="badge ${badgeCls[inv.status]||'b-amber'}">${esc(statusLabel)}</span>
        ${inv.status!=='paid'?`<button class="btn btn-ghost btn-sm inv-remind-btn" style="font-size:10px;padding:3px 7px" data-idx="${Number(idx)}" data-id="${inv.id||''}" data-client="${esc(inv.client)}" data-amount="${esc(S(inv.amount))}">Record Payment</button>`:''}
        ${inv.status==='overdue'?`<button class="btn btn-ghost btn-sm inv-remind-btn-r" style="font-size:10px;padding:3px 7px" data-idx="${Number(idx)}" data-client="${esc(inv.client)}" data-amount="${esc(S(inv.amount))}">Remind ↗</button>`:''}
      </span>
    </div>`;
  }).join('');
  // Record Payment button delegation
  document.getElementById('invoice-list').querySelectorAll('.inv-remind-btn').forEach(btn=>{
    btn.onclick=function(){
      const invId=this.getAttribute('data-id');
      const invIdx=this.getAttribute('data-idx');
      openRecordPaymentModal(invId||invIdx,this.getAttribute('data-client'),this.getAttribute('data-amount'));
    };
  });
}
// Event delegation for invoice remind buttons — no user data embedded in onclick
document.addEventListener('click', function(e){
  const btn = e.target.closest('.inv-remind-btn');
  if(!btn) return;
  const client = btn.getAttribute('data-client') || 'the client';
  const amount = btn.getAttribute('data-amount') || 'the outstanding amount';
  sendPrompt(`Write a professional overdue invoice reminder for ${client} — amount due: ${amount}`);
});
function markInvoicePaid(idx){
  userInvoices[idx].status='paid';
  userInvoices[idx].color='var(--t2)';
  renderInvoices();
  notify('Invoice marked as paid');
}
function openInvoiceModal(){
  const _sv=(id,v)=>{const el=document.getElementById(id); if(el) el.value=v;};
  _sv('inv-client','');
  _sv('inv-amount','');
  _sv('inv-due','');
  _sv('inv-status','pending');
  _sv('inv-desc','');
  openModal('invoice-modal');
}
function saveInvoice(){
  const client=sanitizeText(document.getElementById('inv-client').value,200);
  const amountRaw=validateAmount(document.getElementById('inv-amount').value);
  if(!client){notify('Client name is required',true);return;}
  if(amountRaw===null||amountRaw<=0){notify('A valid positive amount is required',true);return;}
  if(currentUserPlan==='pro'&&(userInvoices||[]).length>=50){
    if(typeof showUpgradeModal==='function') showUpgradeModal('invoice_limit');
    return;
  }
  const amount=amountRaw;
  const due=document.getElementById('inv-due').value;
  const status=document.getElementById('inv-status').value;
  const dueStr=due?new Date(due).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'TBD';
  if(!userInvoices) userInvoices = [];
  userInvoices.push({client,amount,due:dueStr,color:status==='overdue'?'var(--red)':'var(--t2)',status});
  closeModal('invoice-modal');
  renderInvoices();
  notify(`Invoice created for ${client}`);
}

// ════════════════════════════════════════════
// EXPENSES
// ════════════════════════════════════════════
function updateExpenses(d=getPeriodData()){
  // Use real bizExpenses if available
  const realExp = window.bizExpenses || [];
  if(realExp.length > 0){
    const total = realExp.reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
    const ded   = realExp.filter(e=>e.ded==='yes').reduce((s,e)=>s+(parseFloat(e.amount)||0),0)
                + realExp.filter(e=>e.ded==='half').reduce((s,e)=>s+(parseFloat(e.amount)||0)*0.5,0);
    const cats  = {};
    realExp.forEach(e=>{ cats[e.cat]=(cats[e.cat]||0)+(parseFloat(e.amount)||0); });
    const sorted = Object.entries(cats).sort((a,b)=>b[1]-a[1]);
    document.getElementById('ex-total').textContent=S(total);
    document.getElementById('ex-biz').textContent=S(total);
    document.getElementById('ex-biz-pct').textContent='Business expenses';
    // Top category name (label only — amount/% shown in ex-top-pct below)
    const _exTopEl = document.getElementById('ex-top');
    if(_exTopEl) _exTopEl.textContent = sorted[0]?.[0] || '—';
    const _exTopPctEl = document.getElementById('ex-top-pct');
    if(_exTopPctEl && sorted[0]) _exTopPctEl.textContent = S(sorted[0][1]) + ' · ' + Math.round(sorted[0][1]/total*100) + '%';
    document.getElementById('ex-biz-pct').className='mc-change neutral';
    document.getElementById('ex-ded').textContent=S(ded);
    const taxSaving=Math.round(ded*.25);
    document.getElementById('ex-ded-save').textContent='Saving ~'+S(taxSaving)+' tax';
    document.getElementById('ex-ded-save').className='mc-change up';
    // Category bars — update label, fill width, and amount from real data
    const _catBarIds=[['ex-sal'],['ex-rent'],['ex-sw2'],['ex-other']];
    const _maxAmt=sorted[0]?.[1]||1;
    _catBarIds.forEach(([elId],i)=>{
      const el=document.getElementById(elId); if(!el) return;
      const row=el.closest?.('.bar-row');
      if(sorted[i]){
        const[cat,amt]=sorted[i];
        el.textContent=S(amt);
        if(row){const lbl=row.querySelector('.bar-label');if(lbl)lbl.textContent=cat;const fill=row.querySelector('.bar-fill');if(fill)fill.style.width=Math.round(amt/_maxAmt*100)+'%';}
      }else{
        el.textContent='—';
        if(row){const lbl=row.querySelector('.bar-label');if(lbl)lbl.textContent='—';const fill=row.querySelector('.bar-fill');if(fill)fill.style.width='0%';}
      }
    });
    return;
  }
  document.getElementById('ex-total').textContent=S(d.exp);
  document.getElementById('ex-biz').textContent=S(Math.round(d.exp*.85));
  document.getElementById('ex-biz-pct').textContent='85% of total';
  document.getElementById('ex-biz-pct').className='mc-change neutral';
  document.getElementById('ex-ded').textContent=S(Math.round(d.exp*.68));
  const taxSaving=Math.round(d.exp*.68*.25);
  document.getElementById('ex-ded-save').textContent='Saving ~'+S(taxSaving)+' tax';
  document.getElementById('ex-ded-save').className='mc-change up';
  const ec=chg(d.exp,d.prevExp,true);
  set('ex-total-chg',ec.txt,ec.cls);
  document.getElementById('ex-sal').textContent=S(d.sal);
  document.getElementById('ex-rent').textContent=S(d.rent);
  document.getElementById('ex-sw2').textContent=S(d.sw);
  document.getElementById('ex-other').textContent=S(d.mkt);
}
function renderExpenses(){
  updateExpenses();
  if(!bizExpenses) bizExpenses=[];
  document.getElementById('expense-list').innerHTML=bizExpenses.slice(0,6).map(e=>`
    <div class="tx-row">
      <div><div class="tx-name">${esc(e.desc)}</div><div class="tx-cat">${esc(e.cat)} · ${esc(e.date)}${e.ded!=='no'?' · '+(e.ded==='half'?'50%':'100%')+' deductible':''}</div></div>
      <div class="tx-amt dn">-${S(e.amount)}</div>
    </div>`).join('');
}
function openExpenseModal(){
  const _sv=(id,v)=>{const el=document.getElementById(id); if(el) el.value=v;};
  _sv('bexp-desc','');
  _sv('bexp-amount','');
  openModal('expense-modal');
}
function saveExpense(){
  const desc=sanitizeText(document.getElementById('bexp-desc').value,300);
  const amountRaw=validateAmount(document.getElementById('bexp-amount').value);
  if(!desc){notify('Description is required',true);return;}
  if(amountRaw===null||amountRaw<=0){notify('A valid positive amount is required',true);return;}
  const amount=amountRaw;
  if(!bizExpenses) bizExpenses = [];
  bizExpenses.unshift({desc,cat:document.getElementById('bexp-cat').value,amount,ded:document.getElementById('bexp-ded').value,date:'Today'});
  closeModal('expense-modal');
  renderExpenses();
  notify('Expense logged');
}

// ════════════════════════════════════════════
// INVENTORY
// ════════════════════════════════════════════
function renderInventory(){
  if(!inventory) inventory=[];
  const lowCount=inventory.filter(i=>i.low).length;
  document.getElementById('badge-inv2').textContent=lowCount;
  document.getElementById('badge-inv2').style.display=lowCount>0?'':'none';
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  set('inv-skus',inventory.length);
  set('inv-lowstock',lowCount);
  const totalVal=inventory.reduce((s,i)=>s+(i.units||0)*(i.cost||0),0);
  set('inv-value',S(totalVal));
  document.getElementById('inventory-list').innerHTML=inventory.map((item,idx)=>{
    const pct=Math.min(100,Math.round(item.units/item.max*100));
    const col=pct<10?'var(--red)':pct<20?'var(--amber)':'var(--green)';
    const val=item.units*item.cost;
    const cogsVal=item.cogs!=null?S(item.cogs):'—';
    return`<div class="inv-item-row">
      <span style="color:var(--t3);font-family:var(--font-mono)">${esc(item.sku)}</span>
      <span>${esc(item.name)}</span>
      <span style="color:${item.low?'var(--red)':'var(--t1)'}">${item.units} units${item.low?' ⚠':''}</span>
      <div class="stock-bar"><div class="stock-fill" style="width:${pct}%;background:${col}"></div></div>
      <span style="color:${item.low?'var(--red)':'var(--t1)'};">${S(val)}</span>
      <span style="text-align:right;font-family:var(--font-mono);color:var(--t2)">${cogsVal}</span>
      <span class="table-actions" style="display:flex;gap:4px">
        <button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 7px" onclick="openStockInModal(${idx})">+ In</button>
        <button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 7px" onclick="openStockOutModal(${idx})">- Out</button>
        <button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 7px" onclick="restockItem(${idx})">Restock</button>
      </span>
    </div>`;
  }).join('');
}
function restockItem(idx){
  if(idx<0||idx>=inventory.length)return;
  notify('Use the Stock In modal to restock this item.');
  return;
}
function openProductModal(){openModal('product-modal')}
function saveProduct(){
  const name=sanitizeText(document.getElementById('prod-name').value,200);
  if(!name){notify('Product name is required',true);return;}
  const unitsRaw=parseInt(document.getElementById('prod-units').value)||0;
  const units=Math.max(0,Math.min(unitsRaw,1000000));
  const costRaw=validateAmount(document.getElementById('prod-cost').value);
  const cost=costRaw!==null?costRaw:0;
  const thresh=Math.max(0,parseInt(document.getElementById('prod-thresh').value)||20);
  const sku='#'+String(1048+(inventory||[]).length).padStart(4,'0');
  if(!inventory) inventory=[];
  inventory.push({sku,name,units,max:Math.max(units*2,100),cost,low:units<thresh});
  closeModal('product-modal');
  renderInventory();
  notify(`${name} added to inventory`);
}

// ════════════════════════════════════════════
// PAYROLL
// ════════════════════════════════════════════
function renderPayroll(){
  if(typeof autoSetPayrollJurisdiction==='function') autoSetPayrollJurisdiction();
  const allEmps=ownerPayroll?[{...ownerPayroll,isOwner:true},...(payrollEmployees||[])]:( payrollEmployees||[]);
  const totalGross=allEmps.reduce((a,e)=>a+(parseFloat(e.gross)||0),0);
  const totalTax=allEmps.reduce((a,e)=>a+Math.round((parseFloat(e.gross)||0)*(parseFloat(e.taxRate)||0)/100),0);
  document.getElementById('pr-total').textContent=S(totalGross);
  document.getElementById('pr-headcount').textContent=allEmps.length+' employee'+(allEmps.length!==1?'s':'');
  document.getElementById('pr-tax').textContent=S(totalTax);
  if(ownerPayroll){
    document.getElementById('pr-owner-net').textContent=S(ownerPayroll.net);
    document.getElementById('pr-owner-label').textContent='Your net salary';
    document.getElementById('owner-cta').style.display='none';
    document.getElementById('payroll-link-card').style.display='flex';
    document.getElementById('link-net-display').textContent=S(ownerPayroll.net)+'/mo';
  } else {
    document.getElementById('pr-owner-net').textContent='—';
    document.getElementById('pr-owner-label').textContent='Not on payroll';
    document.getElementById('owner-cta').style.display='block';
    document.getElementById('payroll-link-card').style.display='none';
  }
  document.getElementById('payroll-list').innerHTML=allEmps.map(e=>{
    const net=Math.round(e.gross*(1-e.taxRate/100));
    const tax=Math.round(e.gross*e.taxRate/100);
    return`<div class="payroll-row">
      <div class="emp-info">
        <div class="emp-init ${e.avClass||'av-blue'}">${e.initials||getInitials(e.fname,e.lname)}</div>
        <div><div class="emp-name">${esc(e.fname)} ${esc(e.lname)}${e.isOwner?` <span class="badge b-blue" style="font-size:9px">You</span>`:''}</div><div class="emp-role">${esc(e.type||'Full-time')}</div></div>
      </div>
      <span style="color:var(--t2);font-size:12px">${esc(e.role)}</span>
      <span style="font-family:var(--font-mono)">${S(e.gross)}</span>
      <span style="color:var(--red);font-family:var(--font-mono)">${e.taxRate>0?'-'+S(tax):'—'}</span>
      <span style="font-weight:600;font-family:var(--font-mono);color:${e.isOwner?'var(--acc)':'var(--t1)'}">${S(net)}</span>
      ${e.isOwner
        ?`<button class="btn-icon" onclick="openOwnerModal()" title="Edit" style="border:none;background:none;color:var(--acc)"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M11 2l3 3L5 14H2v-3z"/></svg></button>`
        :`<button onclick="openEditEmployee(${e._dbId||e.id||0})" style="background:none;border:none;cursor:pointer;color:var(--t3);padding:4px;font-size:14px;line-height:1" title="Edit employee">✏</button>`}
    </div>`;
  }).join('');
}
function previewOwnerNet(){
  const g=Number(document.getElementById('own-gross').value)||0;
  const t=Number(document.getElementById('own-taxrate').value)||0;
  const entity = ENTITIES[activeOwnerEntityIdx];
  const sym = entity ? (window.CURRENCIES[entity.currency]?.symbol||'$') : '$';
  document.getElementById('own-net-preview').value=g>0?(sym+Math.round(g*(1-t/100)).toLocaleString()):'—';
  updateOwnerEntitySummary();
}

function getActiveEntityOwnerPayroll(){
  return ownerPayrollByEntity[activeOwnerEntityIdx] || null;
}

function calcTotalOwnerNetUSD(){
  const _entities = (typeof ENTITIES !== 'undefined' ? ENTITIES : null) || window.ENTITIES || [];
  return Object.entries(ownerPayrollByEntity).reduce((total, [idx, ep])=>{
    if(!ep) return total;
    const entity = _entities[parseInt(idx)];
    const cur = ep.currency || entity?.currency || 'USD';
    return total + _safeFX(ep.net, cur, 'USD');
  }, 0);
}

function updateOwnerEntitySummary(){
  const summaryEl = document.getElementById('owner-entity-summary');
  const totalEl = document.getElementById('owner-total-net');
  if(!summaryEl) return;

  // Get current unsaved value for active entity
  const pendingGross = Number(document.getElementById('own-gross')?.value)||0;
  const pendingTax = Number(document.getElementById('own-taxrate')?.value)||0;
  const pendingNet = pendingGross > 0 ? Math.round(pendingGross*(1-pendingTax/100)) : 0;

  summaryEl.innerHTML = ENTITIES.map((e,i)=>{
    const ep = i === activeOwnerEntityIdx && pendingNet > 0
      ? {net: pendingNet, gross: pendingGross, taxRate: pendingTax}
      : ownerPayrollByEntity[i];
    const cur = window.CURRENCIES[e.currency] || {symbol:'$'};
    const netUSD = ep ? Math.round(_safeFX(ep.net, e.currency, 'USD')) : 0;
    const badge = ep
      ? `<span style="color:var(--green);font-family:var(--font-mono);font-size:12px">${cur.symbol}${ep.net.toLocaleString()}/mo</span><span style="font-size:10px;color:var(--t3);margin-left:4px">(≈$${netUSD.toLocaleString()} USD)</span>`
      : `<span style="color:var(--t3);font-size:11px">Not added</span>`;
    return `<div style="display:flex;align-items:center;justify-content:space-between;font-size:12px">
      <span style="display:flex;align-items:center;gap:6px">
        <span style="width:20px;height:20px;border-radius:4px;background:${e.color};display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#0e0b08;flex-shrink:0">${esc(e.name.slice(0,2).toUpperCase())}</span>
        <span style="color:var(--t2)">${esc(e.name)}</span>
        <span style="font-size:9px;color:var(--t3)">${e.currency}</span>
      </span>
      ${badge}
    </div>`;
  }).join('');

  // Total in USD
  let totalUSD = calcTotalOwnerNetUSD();
  // Add pending (active entity) contribution if not yet saved
  if(pendingNet > 0 && !ownerPayrollByEntity[activeOwnerEntityIdx]){
    const activeCur = ENTITIES[activeOwnerEntityIdx]?.currency || 'USD';
    totalUSD += _safeFX(pendingNet, activeCur, 'USD');
  }
  if(totalEl) totalEl.textContent = totalUSD > 0 ? ('$'+Math.round(totalUSD).toLocaleString()+' USD/mo') : '—';
}

function renderOwnerModalTabs(){
  const tabs = document.getElementById('owner-entity-tabs');
  const curLabel = document.getElementById('owner-entity-currency-label');
  if(!tabs) return;
  tabs.innerHTML = ENTITIES.map((e,i)=>{
    const ep = ownerPayrollByEntity[i];
    const active = i === activeOwnerEntityIdx;
    return `<button onclick="switchOwnerEntityTab(${i})" style="flex:1;padding:5px 6px;border:none;border-radius:calc(var(--radius) - 1px);font-size:11.5px;font-family:var(--font);cursor:pointer;transition:all .15s;background:${active?'var(--bg1)':'transparent'};color:${active?'var(--t1)':'var(--t3)'};font-weight:${active?'500':'400'};display:flex;align-items:center;justify-content:center;gap:5px">
      <span style="width:16px;height:16px;border-radius:3px;background:${e.color};display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:#0e0b08;flex-shrink:0">${esc(e.name.slice(0,2).toUpperCase())}</span>
      ${esc(e.name.split(' ')[0])}
      ${ep ? '<span style="width:5px;height:5px;border-radius:50%;background:var(--green);flex-shrink:0"></span>' : ''}
    </button>`;
  }).join('');

  const entity = ENTITIES[activeOwnerEntityIdx];
  const cur = window.CURRENCIES[entity?.currency] || {symbol:'$',name:'USD'};
  if(curLabel) curLabel.textContent = `Entering salary in ${entity?.currency || 'USD'} (${cur.name}) — automatically converted to USD in Personal Finance`;

  const symEl = document.getElementById('own-currency-sym');
  if(symEl) symEl.textContent = `(${cur.symbol})`;
}

window.switchOwnerEntityTab = function(idx){
  // AUTO-SAVE current tab before switching (if gross is filled in)
  const curFname = document.getElementById('own-fname')?.value?.trim()||'';
  const curLname = document.getElementById('own-lname')?.value?.trim()||'';
  const curGross = Number(document.getElementById('own-gross')?.value||0);
  const curTax   = Number(document.getElementById('own-taxrate')?.value||0);
  const curRole  = document.getElementById('own-role')?.value||'CEO / Founder';
  const curType  = document.getElementById('own-type')?.value||'owner';

  if(curFname && curGross > 0){
    const curEntity = ENTITIES[activeOwnerEntityIdx];
    const existing = ownerPayrollByEntity[activeOwnerEntityIdx] || {};
    ownerPayrollByEntity[activeOwnerEntityIdx] = {
      _dbId: existing._dbId,
      fname: curFname, lname: curLname,
      role: curRole, type: curType,
      gross: curGross, taxRate: curTax,
      net: Math.round(curGross*(1-curTax/100)),
      currency: curEntity?.currency||'USD',
      initials: getInitials(curFname,curLname),
      avClass: 'av-blue',
      entityName: curEntity?.name||'Entity'
    };
  }

  // Switch to new tab
  activeOwnerEntityIdx = idx;
  const ep = ownerPayrollByEntity[idx];

  // Populate fields — use saved data if exists, else carry over name/role from previous tab
  if(ep){
    document.getElementById('own-fname').value  = ep.fname;
    document.getElementById('own-lname').value  = ep.lname;
    document.getElementById('own-role').value   = ep.role;
    document.getElementById('own-type').value   = ep.type;
    document.getElementById('own-gross').value  = ep.gross;
    document.getElementById('own-taxrate').value = ep.taxRate;
    document.getElementById('owner-remove-btn').style.display = 'inline-flex';
  } else {
    // Carry over name and role from previous tab — only clear the salary
    document.getElementById('own-fname').value  = curFname;
    document.getElementById('own-lname').value  = curLname;
    document.getElementById('own-role').value   = curRole;
    document.getElementById('own-type').value   = curType;
    document.getElementById('own-gross').value  = '';
    document.getElementById('own-net-preview').value = '—';
    document.getElementById('owner-remove-btn').style.display = 'none';
  }

  renderOwnerModalTabs();
  previewOwnerNet();
  updateOwnerEntitySummary();
};

function openOwnerPayrollModal(){
  activeOwnerEntityIdx = ENTITIES.findIndex(e=>e.active);
  if(activeOwnerEntityIdx < 0) activeOwnerEntityIdx = 0;

  const ep = ownerPayrollByEntity[activeOwnerEntityIdx];
  const hasAny = Object.keys(ownerPayrollByEntity).length > 0;
  document.getElementById('owner-modal-title').textContent = hasAny ? 'Your payroll — all entities' : 'Add yourself to payroll';

  // Get user's real name from sidebar footer
  const userNameEl = document.getElementById('sb-user-name');
  const userName = (userNameEl?.textContent||'').trim().split(' ');
  const defaultFirst = userName[0]||'';
  const defaultLast  = userName.slice(1).join(' ')||'';

  if(ep){
    document.getElementById('own-fname').value   = ep.fname;
    document.getElementById('own-lname').value   = ep.lname;
    document.getElementById('own-role').value    = ep.role;
    document.getElementById('own-type').value    = ep.type;
    document.getElementById('own-gross').value   = ep.gross;
    document.getElementById('own-taxrate').value = ep.taxRate;
    document.getElementById('owner-remove-btn').style.display = 'inline-flex';
  } else {
    document.getElementById('own-fname').value   = defaultFirst;
    document.getElementById('own-lname').value   = defaultLast;
    document.getElementById('own-role').value    = 'CEO / Founder';
    document.getElementById('own-type').value    = 'owner';
    document.getElementById('own-gross').value   = '';
    document.getElementById('own-net-preview').value = '—';
    document.getElementById('own-taxrate').value = '20';
    document.getElementById('owner-remove-btn').style.display = 'none';
  }

  renderOwnerModalTabs();
  updateOwnerEntitySummary();
  previewOwnerNet();
  openModal('owner-modal');
}

function saveOwnerPayroll(){
  const fname   = document.getElementById('own-fname')?.value?.trim()||'';
  const lname   = document.getElementById('own-lname')?.value?.trim()||'';
  const gross   = Number(document.getElementById('own-gross')?.value||0);
  const taxRate = Number(document.getElementById('own-taxrate')?.value||0);
  const role    = document.getElementById('own-role')?.value||'CEO / Founder';
  const type    = document.getElementById('own-type')?.value||'owner';

  if(!fname){ notify('Please enter your first name', true); return; }

  // Save current tab if it has a salary filled in
  if(gross > 0){
    const entity = ENTITIES[activeOwnerEntityIdx];
    const existing = ownerPayrollByEntity[activeOwnerEntityIdx] || {};
    ownerPayrollByEntity[activeOwnerEntityIdx] = {
      _dbId: existing._dbId, // preserve so medium.js does PUT, not POST (no dupes)
      fname, lname, role, type,
      gross, taxRate,
      net: Math.round(gross*(1-taxRate/100)),
      currency: entity?.currency||'USD',
      initials: getInitials(fname,lname),
      avClass: 'av-blue',
      entityName: entity?.name||'Entity'
    };
  }

  // Require at least one entity to have a salary
  const savedCount = Object.keys(ownerPayrollByEntity).length;
  if(savedCount === 0){
    notify('Enter a salary for at least one entity', true);
    return;
  }

  // Sync ownerPayroll compat pointer to currently active entity
  ownerPayroll = ownerPayrollByEntity[ENTITIES.findIndex(e=>e.active)] || Object.values(ownerPayrollByEntity)[0] || null;

  syncAllPayrollsToPersonal();
  closeModal('owner-modal');
  renderPayroll();

  const entityNames = Object.entries(ownerPayrollByEntity).map(([i])=>ENTITIES[i]?.name||'Entity').join(', ');
  notify(`Payroll saved for ${entityNames} — Personal Finance synced ✦`);
}

function removeOwnerFromPayroll(){
  const entity = ENTITIES[activeOwnerEntityIdx];
  delete ownerPayrollByEntity[activeOwnerEntityIdx];
  // Update compat pointer
  const activeIdx = ENTITIES.findIndex(e=>e.active);
  ownerPayroll = ownerPayrollByEntity[activeIdx] || Object.values(ownerPayrollByEntity)[0] || null;
  syncAllPayrollsToPersonal();
  renderOwnerModalTabs();
  updateOwnerEntitySummary();
  // Clear form for this tab
  document.getElementById('own-gross').value = '';
  document.getElementById('own-net-preview').value = '—';
  document.getElementById('owner-remove-btn').style.display = 'none';
  renderPayroll();
  notify(`Removed from ${entity?.name||'entity'} payroll ✦`);
}

function autoSetPayrollJurisdiction(){
  const active = (window.ENTITIES||ENTITIES||[]).find(e=>e.active);
  const cur = (active?.currency||'USD').toUpperCase();
  const MAP = {USD:'US',GBP:'GB',EUR:'OTHER',CAD:'CA',AUD:'OTHER',NZD:'OTHER',SGD:'OTHER',TTD:'TT',ZAR:'OTHER',JMD:'JM',BBD:'BB',MXN:'MX',COP:'CO'};
  const jur = MAP[cur] || 'US';
  ['payroll-jurisdiction','tax-prev-jur'].forEach(id=>{
    const sel = document.getElementById(id);
    if (sel && !sel._userSet) {
      const opt = Array.from(sel.options).find(o=>o.value===jur);
      if (opt) sel.value = jur;
    }
  });
}

window.openEditEmployee = function(id){
  const emp = (window.payrollEmployees||[]).find(e=>(e._dbId||e.id)===id);
  if(!emp) return;
  document.getElementById('edit-emp-id').value = id;
  document.getElementById('edit-emp-name').value = ((emp.fname||'')+' '+(emp.lname||'')).trim();
  document.getElementById('edit-emp-role').value = emp.role||'';
  document.getElementById('edit-emp-type').value = emp.type||emp.emp_type||'Full-time';
  document.getElementById('edit-emp-gross').value = emp.gross||0;
  document.getElementById('edit-emp-tax').value = emp.taxRate||emp.tax_rate||0;
  document.getElementById('modal-edit-employee').style.display='flex';
};

window.closeEditEmployee = function(){
  document.getElementById('modal-edit-employee').style.display='none';
};

window.saveEditEmployee = async function(){
  const id = parseInt(document.getElementById('edit-emp-id').value);
  const role = (document.getElementById('edit-emp-role').value||'').trim().slice(0,100);
  const emp_type = document.getElementById('edit-emp-type').value;
  const gross = parseFloat(document.getElementById('edit-emp-gross').value)||0;
  const tax_rate = parseFloat(document.getElementById('edit-emp-tax').value)||0;
  if(!id) return;
  const btn = document.querySelector('#modal-edit-employee .btn-primary');
  btn.disabled=true; btn.textContent='Saving…';
  try{
    const res = await fetch('/api/payroll/'+id,{
      method:'PUT', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({role,emp_type,gross,tax_rate})
    });
    if(!res.ok) throw new Error(await res.text());
    const emp = (window.payrollEmployees||[]).find(e=>(e._dbId||e.id)===id);
    if(emp){ emp.role=role; emp.type=emp_type; emp.gross=gross; emp.taxRate=tax_rate; }
    window.closeEditEmployee();
    if(typeof renderPayroll==='function') renderPayroll();
    notify('Employee updated ✦');
  }catch(e){
    alert('Failed to save: '+e.message);
  }finally{
    btn.disabled=false; btn.textContent='Save changes';
  }
};

function syncAllPayrollsToPersonal(){
  const entries = Object.entries(ownerPayrollByEntity);
  const totalUSD = calcTotalOwnerNetUSD();
  basePersonalIncome = entries.length > 0 ? Math.round(totalUSD) : 0;

  // Replace salary transactions with one per entity
  persTransactions = persTransactions.filter(t=>!(t.cat==='Income' && t.desc.startsWith('Salary —')));
  entries.forEach(([idx, ep])=>{
    const _ents = (typeof ENTITIES!=='undefined'?ENTITIES:null)||window.ENTITIES||[];
    const entity = _ents[parseInt(idx)];
    const entCurKey = ep.currency || entity?.currency || 'USD';
    const cur = ((typeof CURRENCIES!=='undefined'?CURRENCIES:null)||window.CURRENCIES||{})[entCurKey] || {symbol:'$'};
    const _txCur = ep.currency || entity?.currency || 'USD';
    const netUSD = Math.round(_safeFX(ep.net, _txCur, 'USD'));
    persTransactions.unshift({
      desc:`Salary — ${entity?.name||'Entity'} (April)`,
      cat:'Income',
      amount: netUSD,
      type:'income',
      date:'Apr 30'
    });
  });

  // Update payroll page banner — show entity name + owner name for clarity
  const _bannerEnts = (typeof ENTITIES!=='undefined'?ENTITIES:null)||window.ENTITIES||[];
  const banner = document.getElementById('pers-payroll-banner');
  if(banner){
    banner.style.display = entries.length > 0 ? 'flex' : 'none';
    const salaryEl = document.getElementById('pers-salary-source');
    if(salaryEl){
      if(entries.length === 1){
        const [_idx0, _ep0] = entries[0];
        const _ent0 = _bannerEnts[parseInt(_idx0)];
        salaryEl.textContent = `${_ent0?.name||'Entity'} — ${_ep0.fname} ${_ep0.lname} · ${SP(totalUSD)}/mo net (${persCurrency})`;
      } else {
        salaryEl.textContent = `${entries.length} entities · ${SP(totalUSD)}/mo combined net (${persCurrency})`;
      }
    }
  }

  // Per-entity breakdown — always show for 1 or more entities (not just 2+)
  const breakdownEl = document.getElementById('pers-payroll-breakdown');
  if(breakdownEl){
    if(entries.length >= 1){
      breakdownEl.style.display = 'block';
      const _dispCur = ((typeof CURRENCIES!=='undefined'?CURRENCIES:null)||window.CURRENCIES||{})[persCurrency] || {symbol:'$', rate:1};
      breakdownEl.innerHTML = entries.map(([idx,ep])=>{
        const entity = _bannerEnts[parseInt(idx)];
        const _fromCur2 = ep.currency || entity?.currency || 'USD';
        const entCur = ((typeof CURRENCIES!=='undefined'?CURRENCIES:null)||window.CURRENCIES||{})[_fromCur2] || {symbol:'$'};
        const netDisp = Math.round(_safeFX(ep.net, _fromCur2, persCurrency));
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:11.5px;border-bottom:1px solid var(--bd)">
          <span style="display:flex;align-items:center;gap:5px">
            <span style="width:14px;height:14px;border-radius:3px;background:${entity?.color||'var(--acc)'};display:inline-block;flex-shrink:0"></span>
            <span style="color:var(--t1);font-weight:500">${entity?.name||'Entity'}</span>
            <span style="color:var(--t3);font-size:10px">${ep.fname} ${ep.lname} · ${entity?.currency||'USD'}</span>
          </span>
          <span style="font-family:var(--font-mono);color:var(--green)">${entCur.symbol}${ep.net.toLocaleString()}/mo <span style="color:var(--t3);font-size:10px">≈ ${_dispCur.symbol}${netDisp.toLocaleString()}</span></span>
        </div>`;
      }).join('') + (entries.length > 1 ? `<div style="display:flex;justify-content:space-between;padding:5px 0 0;font-size:12.5px;font-weight:600">
        <span style="color:var(--t2)">Total (${persCurrency})</span>
        <span style="color:var(--acc);font-family:var(--font-mono)">${_dispCur.symbol}${Math.round(totalUSD * _dispCur.rate).toLocaleString()}/mo</span>
      </div>` : '');
    } else {
      breakdownEl.style.display = 'none';
    }
  }

  // Update payroll page link metrics
  const prNet = document.getElementById('pr-owner-net');
  const prLabel = document.getElementById('pr-owner-label');
  const linkNet = document.getElementById('link-net-display');
  const _dispCurPayroll = ((typeof CURRENCIES!=='undefined'?CURRENCIES:null)||window.CURRENCIES||{})[persCurrency] || {symbol:'$', rate:1};
  const totalDisp = Math.round(totalUSD * _dispCurPayroll.rate);
  if(prNet) prNet.textContent = _dispCurPayroll.symbol + totalDisp.toLocaleString();
  if(prLabel) prLabel.textContent = entries.length > 1
    ? `${entries.length} entities combined`
    : entries.length === 1 ? (entries[0][1]?.entityName||'Entity') : 'Not on payroll';
  if(linkNet) linkNet.textContent = _dispCurPayroll.symbol + totalDisp.toLocaleString() + '/mo';

  baseNetWorth = 0; // computed from real transactions in loadPersonalFinance()
  renderPersonal();
}
// openOwnerModal — all call sites now route to the full multi-entity modal
function openOwnerModal(){
  openOwnerPayrollModal();
}

// Safe fxConvert wrapper — works even if fxConvert not yet defined
function _safeFX(amount, from, to){
  // Use local CURRENCIES const (same script block) — window.CURRENCIES may not be set yet
  const r = (typeof CURRENCIES !== 'undefined' ? CURRENCIES : null) || window.CURRENCIES;
  if(!r || !r[from] || !r[to]) return amount;
  if(from === to) return amount;
  return (amount / r[from].rate) * r[to].rate;
}

function syncPayrollToPersonal(netPay,fname,lname){
  // Legacy shim — use syncAllPayrollsToPersonal instead
  syncAllPayrollsToPersonal();
}
window.syncPayrollToPersonal = syncAllPayrollsToPersonal;

// ════════════════════════════════════════════
// PERSONAL
// ════════════════════════════════════════════
function refreshPersonal(){renderPersonal()}

// Personal finance display currency (all values stored in USD, displayed in persCurrency)
let persCurrency = 'USD';

function setPersCurrency(code){
  persCurrency = code;
  // Update button states
  document.querySelectorAll('.pers-cur-btn').forEach(b=>{
    b.classList.toggle('active-preset', b.dataset.code===code);
  });
  // Update rate label
  const lbl = document.getElementById('pers-fx-label');
  const cur = window.CURRENCIES?.[code];
  if(lbl){
    lbl.textContent = (code!=='USD' && cur)
      ? `1 USD = ${cur.rate.toFixed(cur.rate<1?4:cur.rate>100?0:2)} ${code}`
      : '';
  }
  // Fast path — only update numeric values, skip full DOM rebuild
  _updatePersCurrencyValues();
  // Re-render payroll banner & breakdown with new currency
  if(typeof syncAllPayrollsToPersonal === 'function') syncAllPayrollsToPersonal();
}

// Convert USD amount to persCurrency and format with symbol
function SP(usdAmount){
  const _cur_map = (typeof CURRENCIES !== 'undefined' ? CURRENCIES : null) || window.CURRENCIES || {};
  const cur = _cur_map[persCurrency] || {symbol:'$', rate:1};
  const converted = usdAmount * cur.rate;
  const abs = Math.abs(converted);
  const formatted = abs >= 1000
    ? cur.symbol + (abs/1000).toFixed(1) + 'K'
    : cur.symbol + Math.round(abs).toLocaleString();
  return formatted;
}

// Fast currency-only update — rewrites numbers without rebuilding DOM lists
function _updatePersCurrencyValues(){
  const incomeUSD    = basePersonalIncome;
  const totalSpendUSD = spending.reduce((a,s)=>a+s.amount,0);
  const surplusUSD   = incomeUSD - totalSpendUSD;
  const target       = parseInt(document.getElementById('s-savings-target')?.value)||40;
  const savingsRate  = incomeUSD>0 ? Math.round(surplusUSD/incomeUSD*100) : 0;
  const nwUSD        = Math.round(baseNetWorth+(surplusUSD*2));
  const nwChgUSD     = Math.round(surplusUSD);
  const entityCount  = Object.keys(ownerPayrollByEntity).length;

  const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  set('pers-income',  SP(incomeUSD));
  set('pers-spend',   SP(totalSpendUSD));
  set('pers-nw',      SP(nwUSD));
  set('pers-nw-chg',  '+'+SP(nwChgUSD)+' this month');
  set('pers-spend-total', SP(totalSpendUSD));
  set('p-cf-income',  '+'+SP(incomeUSD));
  const _cfIn=document.getElementById('p-cf-income'); if(_cfIn) _cfIn.style.color=incomeUSD>0?'var(--green)':'var(--t2)';
  set('p-cf-spend',   '-'+SP(totalSpendUSD));
  const _cfSp=document.getElementById('p-cf-spend');  if(_cfSp) _cfSp.style.color=totalSpendUSD>0?'var(--red)':'var(--t2)';
  set('p-cf-surplus', SP(surplusUSD));
  const _cfSu=document.getElementById('p-cf-surplus'); if(_cfSu) _cfSu.style.color=surplusUSD>0?'var(--acc)':surplusUSD<0?'var(--red)':'var(--t2)';
  set('pers-income-src', entityCount>1?`${entityCount} entities · combined (${persCurrency})`:entityCount===1?`From payroll · after tax (${persCurrency})`:`After tax (${persCurrency})`);
  // Update bar values only (not widths — those are ratio-based, unchanged)
  const barVals = document.querySelectorAll('#spending-bars .bar-val');
  spending.forEach((s,i)=>{ if(barVals[i]) barVals[i].textContent=SP(s.amount); });
  // Update goal amounts
  const goalVals = document.querySelectorAll('#goals-list .goal-val');
  goals.forEach((g,i)=>{ if(goalVals[i]) goalVals[i].textContent=SP(g.current)+(g.target?' / '+SP(g.target):''); });
  _renderPersTxList();
  renderPersonalSections();
}

function renderPersonal(){
  const cur = window.CURRENCIES?.[persCurrency] || {symbol:'$', rate:1};
  const rate = cur.rate;

  // Income is stored in USD (basePersonalIncome)
  const incomeUSD = basePersonalIncome;
  // Spending is stored in USD — convert for display
  const totalSpendUSD = spending.reduce((a,s)=>a+s.amount,0);
  const surplusUSD = incomeUSD - totalSpendUSD;

  const target = parseInt(document.getElementById('s-savings-target')?.value)||40;
  const savingsRate = incomeUSD>0 ? Math.round(surplusUSD/incomeUSD*100) : 0;
  const nwUSD = Math.round(baseNetWorth+(surplusUSD*2));
  const nwChgUSD = Math.round(surplusUSD);

  document.getElementById('pers-income').textContent = SP(incomeUSD);
  document.getElementById('pers-spend').textContent  = SP(totalSpendUSD);
  document.getElementById('pers-savings').textContent = savingsRate+'%';
  document.getElementById('pers-savings-vs').textContent = (savingsRate>=target?'Above ':'Below ')+target+'% target';
  document.getElementById('pers-savings-vs').className = 'mc-change '+(savingsRate>=target?'up':'dn');
  document.getElementById('pers-nw').textContent   = SP(nwUSD);
  document.getElementById('pers-nw-chg').textContent = '+'+SP(nwChgUSD)+' this month';
  document.getElementById('pers-nw-chg').className = 'mc-change '+(nwChgUSD>0?'up':'dn');

  const entityCount = Object.keys(ownerPayrollByEntity).length;
  const _incSrcEl = document.getElementById('pers-income-src');
  if(_incSrcEl){
    if(entityCount === 0){
      _incSrcEl.textContent = `After tax (${persCurrency})`;
    } else {
      const _pEnts = (typeof ENTITIES!=='undefined'?ENTITIES:null)||window.ENTITIES||[];
      const _lineItems = Object.entries(ownerPayrollByEntity).map(([idx,ep])=>{
        const ent = _pEnts[parseInt(idx)];
        return `${ent?.name||'Entity'}: ${SP(_safeFX(ep.net, ep.currency||ent?.currency||'USD', 'USD'))}`;
      });
      _incSrcEl.textContent = _lineItems.join(' · ') + (entityCount>1 ? ' · Total' : ' net');
    }
  }

  // Payroll banner
  const banner = document.getElementById('pers-payroll-banner');
  if(banner) banner.style.display = entityCount>0 ? 'flex' : 'none';

  // Cash flow
  document.getElementById('p-cf-income').textContent  = '+'+SP(incomeUSD);
  document.getElementById('p-cf-income').style.color  = incomeUSD > 0 ? 'var(--green)' : 'var(--t2)';
  document.getElementById('p-cf-spend').textContent   = '-'+SP(totalSpendUSD);
  document.getElementById('p-cf-spend').style.color   = totalSpendUSD > 0 ? 'var(--red)' : 'var(--t2)';
  document.getElementById('p-cf-surplus').textContent = SP(surplusUSD);
  document.getElementById('p-cf-surplus').style.color = surplusUSD > 0 ? 'var(--acc)' : surplusUSD < 0 ? 'var(--red)' : 'var(--t2)';
  document.getElementById('p-cf-rate').textContent    = savingsRate+'%';
  document.getElementById('pers-spend-total').textContent = SP(totalSpendUSD);

  // Spending bars
  const maxSpend = Math.max(...spending.map(s=>s.amount), 1);
  const _spFooter = document.getElementById('spending-footer-row');
  const _spEditBtn = document.getElementById('spending-edit-btn');
  if(window._persSpendEditMode){
    // Inline edit mode — show amount inputs per category
    document.getElementById('spending-bars').innerHTML = (spending.length === 0
      ? '<div style="font-size:12px;color:var(--t3);padding:.5rem">No categories yet — add expense transactions first.</div>'
      : spending.map((s,i)=>`
          <div class="bar-row" style="gap:8px">
            <span class="bar-label" style="flex:1">${s.label}</span>
            <input class="finput" id="sinput-${i}" type="number" value="${s.amount}" style="width:90px;padding:3px 8px;font-size:12px">
          </div>`).join('')
    ) + '<div style="margin-top:.6rem;text-align:right"><button class="btn btn-primary btn-sm" onclick="saveSpendingInline()">Save</button></div>';
    if(_spFooter) _spFooter.style.display='none';
    if(_spEditBtn) _spEditBtn.textContent='Cancel';
  } else {
    if(_spEditBtn) _spEditBtn.textContent='Edit';
    if(spending.length === 0){
      document.getElementById('spending-bars').innerHTML = '<div style="font-size:12px;color:var(--t3);text-align:center;padding:.75rem">No spending recorded yet — add a transaction to get started.</div>';
      if(_spFooter) _spFooter.style.display = 'none';
    } else {
      document.getElementById('spending-bars').innerHTML = spending.map(s=>`
        <div class="bar-row">
          <span class="bar-label">${s.label}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.round(s.amount/maxSpend*100)}%;background:${s.color}"></div></div>
          <span class="bar-val">${SP(s.amount)}</span>
        </div>`).join('');
      if(_spFooter) _spFooter.style.display = '';
    }
  }

  // Goals (convert from USD)
  const goalColors = ['var(--green)','var(--acc)','var(--acc-light)','var(--amber)','var(--purple)','var(--teal)'];
  document.getElementById('goals-list').innerHTML = goals.length===0
    ? '<div style="font-size:12px;color:var(--t3);text-align:center;padding:.75rem">No goals yet — add one above</div>'
    : goals.map((g,i)=>{
        const p = g.target>0 ? Math.min(100,Math.round(g.current/g.target*100)) : 100;
        const m = g.monthly>0&&g.current<g.target ? Math.ceil((g.target-g.current)/g.monthly) : null;
        g.color = g.color||goalColors[i%goalColors.length];
        return `<div class="goal">
          <div class="goal-header">
            <span class="goal-name">${g.name}</span>
            <span class="goal-val">${SP(g.current)}${g.target?' / '+SP(g.target):''}</span>
          </div>
          <div class="goal-track"><div class="goal-fill bar-fill" style="width:${p}%;background:${g.color}"></div></div>
          <div class="goal-sub">${p}%${m?' — ~'+m+' months remaining':' — goal reached!'}</div>
        </div>`;
      }).join('');

  // Transactions
  _renderPersTxList();

  renderPersonalSections();
  updateHealthScore(savingsRate, incomeUSD, surplusUSD);
  if(typeof prefillPersSalaryCard==='function') prefillPersSalaryCard();
}
// ── Spending inline edit ──────────────────────────────────────────────
window._persSpendEditMode = false;
function openSpendingModal(){ toggleSpendingEdit(); } // keep old name working
function saveSpending(){ saveSpendingInline(); }      // keep old name working

function toggleSpendingEdit(){
  window._persSpendEditMode = !window._persSpendEditMode;
  renderPersonal();
}

function saveSpendingInline(){
  spending.forEach((s,i)=>{
    const v=Number(document.getElementById('sinput-'+i)?.value)||0;
    spending[i].amount=v;
  });
  window._persSpendEditMode=false;
  renderPersonal();
  notify('Spending updated');
}

function openGoalModal(){document.getElementById('goal-name').value='';document.getElementById('goal-current').value='';document.getElementById('goal-target').value='';document.getElementById('goal-monthly').value='';openModal('goal-modal')}
function saveGoal(){
  const name=document.getElementById('goal-name').value.trim();
  if(!name){notify('Goal name required',true);return;}
  goals.push({name,current:Number(document.getElementById('goal-current').value)||0,target:Number(document.getElementById('goal-target').value)||0,monthly:Number(document.getElementById('goal-monthly').value)||0});
  closeModal('goal-modal');renderPersonal();notify('Goal added');
}

// ── Transaction modal ─────────────────────────────────────────────────
function openTransactionModal(type){
  document.getElementById('tx-desc').value='';
  document.getElementById('tx-amount').value='';
  document.getElementById('tx-date').value=new Date().toISOString().slice(0,10);
  if(type){
    const sel=document.getElementById('tx-type');
    if(sel) sel.value=type;
    // Auto-set a sensible default category
    const catSel=document.getElementById('tx-cat-sel');
    if(catSel && type==='income') catSel.value='Other Income';
    if(catSel && type==='expense') catSel.value='Other';
  }
  openModal('transaction-modal');
}

async function saveTransaction(){
  const desc=document.getElementById('tx-desc').value.trim();
  const amount=Number(document.getElementById('tx-amount').value);
  if(!desc||!amount||Number(amount)<=0){notify('Valid positive amount required');return;}
  const cat=document.getElementById('tx-cat-sel').value;
  const type=document.getElementById('tx-type').value;
  const txDate=document.getElementById('tx-date')?.value||new Date().toISOString().slice(0,10);
  try{
    const res=await fetch('/api/personal-transactions',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({description:desc,category:cat,amount,tx_type:type,tx_date:txDate})});
    if(!res.ok) throw new Error((await res.json()).error||'Failed');
    closeModal('transaction-modal');
    if(typeof loadPersonalFinance==='function') await loadPersonalFinance();
    notify('Transaction added ✦');
  }catch(e){notify('Error: '+(e.message||'Failed to save'));}
}

// ── Personal salary card ──────────────────────────────────────────────
function persPreviewNet(){
  const gross=parseFloat(document.getElementById('pers-sal-gross')?.value)||0;
  const tax=parseFloat(document.getElementById('pers-sal-tax')?.value)||20;
  const net=Math.round(gross*(1-tax/100));
  const el=document.getElementById('pers-sal-net-preview');
  if(el) el.textContent=gross>0?SP(net)+'/mo':'—';
}

function prefillPersSalaryCard(){
  const activeIdx=typeof ENTITIES!=='undefined'?ENTITIES.findIndex(e=>e.active):-1;
  const ep=activeIdx>=0?(ownerPayrollByEntity[activeIdx]||null):null;
  const syncLabel=document.getElementById('pers-salary-sync-label');
  const grossEl=document.getElementById('pers-sal-gross');
  const taxEl=document.getElementById('pers-sal-tax');
  if(ep&&ep.gross>0){
    if(grossEl) grossEl.value=ep.gross;
    if(taxEl) taxEl.value=ep.taxRate||20;
    if(syncLabel) syncLabel.style.display='';
  }else{
    if(syncLabel) syncLabel.style.display='none';
  }
  persPreviewNet();
}

async function savePersonalSalary(){
  const gross=parseFloat(document.getElementById('pers-sal-gross')?.value)||0;
  const taxRate=parseFloat(document.getElementById('pers-sal-tax')?.value)||20;
  if(!gross){notify('Please enter a salary amount');return;}
  const activeIdx=typeof ENTITIES!=='undefined'?ENTITIES.findIndex(e=>e.active):-1;
  const entity=activeIdx>=0?ENTITIES[activeIdx]:null;
  const rawName=(document.getElementById('s-name')?.value||'').trim()||'Owner';
  const parts=rawName.split(' ');
  const fname=parts[0]||'Owner';
  const lname=parts.slice(1).join(' ')||'';
  const payload={fname,lname,gross,tax_rate:taxRate,is_owner:true,entity_id:entity?._dbId||null,role:'CEO / Founder',emp_type:'owner',av_class:'av-blue'};
  try{
    // Always fetch fresh DB state — in-memory ownerPayrollByEntity may be stale after page load
    let existingId=null;
    try{
      const chk=await fetch('/api/personal-salary',{credentials:'include'});
      if(chk.ok){const chkRows=await chk.json();if(chkRows.length>0)existingId=chkRows[0].id;}
    }catch(_){}
    let saved;
    if(existingId){
      const r=await fetch('/api/payroll/'+existingId,{method:'PUT',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(payload)});
      if(!r.ok) throw new Error((await r.json()).error||'Failed');
      saved=await r.json();
    }else{
      const r=await fetch('/api/payroll',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(payload)});
      if(!r.ok) throw new Error((await r.json()).error||'Failed');
      saved=await r.json();
    }
    if(activeIdx>=0){
      ownerPayrollByEntity[activeIdx]={
        _dbId:saved.id,fname,lname,
        gross,taxRate,
        net:Math.round(gross*(1-taxRate/100)),
        currency:entity?.currency||'USD',
        initials:((fname[0]||'')+(lname[0]||'')).toUpperCase(),
        avClass:'av-blue',
        entityName:entity?.name||'Entity',
      };
      window.ownerPayrollByEntity=ownerPayrollByEntity;
      if(entity?.active){ownerPayroll=ownerPayrollByEntity[activeIdx];window.ownerPayroll=ownerPayroll;}
    }
    // Immediately update UI — don't wait for API round-trip
    basePersonalIncome=Math.round(gross*(1-taxRate/100));
    if(typeof renderPersonal==='function') renderPersonal();
    if(typeof syncAllPayrollsToPersonal==='function') syncAllPayrollsToPersonal();
    if(typeof loadPersonalFinance==='function') await loadPersonalFinance();
    prefillPersSalaryCard();
    window.finflow?.refresh(['payroll','dashboard']);
    notify('Salary saved ✦');
  }catch(e){notify('Error: '+(e.message||'Failed to save salary'));}
}

function payrollCardPreviewNet(){
  const gross=parseFloat(document.getElementById('payroll-cta-gross')?.value)||0;
  const tax=parseFloat(document.getElementById('payroll-cta-tax')?.value)||20;
  const net=Math.round(gross*(1-tax/100));
  const el=document.getElementById('payroll-cta-net');
  if(el) el.textContent=gross>0?'Net: '+S(net)+'/mo':'';
}

async function saveOwnerPayrollCard(){
  const fname=(document.getElementById('payroll-cta-fname')?.value||'').trim();
  const lname=(document.getElementById('payroll-cta-lname')?.value||'').trim();
  const gross=parseFloat(document.getElementById('payroll-cta-gross')?.value)||0;
  const taxRate=parseFloat(document.getElementById('payroll-cta-tax')?.value)||20;
  const role=(document.getElementById('payroll-cta-role')?.value||'Owner').trim();
  if(!fname){notify('Please enter your first name');return;}
  if(!gross){notify('Please enter your monthly salary');return;}
  const activeIdx=typeof ENTITIES!=='undefined'?ENTITIES.findIndex(e=>e.active):-1;
  const entity=activeIdx>=0?ENTITIES[activeIdx]:null;
  const existing=activeIdx>=0?(ownerPayrollByEntity[activeIdx]||null):null;
  const payload={fname,lname,gross,tax_rate:taxRate,is_owner:true,entity_id:entity?._dbId||null,role,emp_type:'owner',av_class:'av-blue'};
  try{
    let saved;
    if(existing?._dbId){
      const r=await fetch('/api/payroll/'+existing._dbId,{method:'PUT',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(payload)});
      if(!r.ok) throw new Error((await r.json()).error||'Failed');
      saved=await r.json();
    }else{
      const r=await fetch('/api/payroll',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(payload)});
      if(!r.ok) throw new Error((await r.json()).error||'Failed');
      saved=await r.json();
    }
    if(activeIdx>=0){
      ownerPayrollByEntity[activeIdx]={
        _dbId:saved.id,fname,lname,role,
        gross,taxRate,
        net:Math.round(gross*(1-taxRate/100)),
        currency:entity?.currency||'USD',
        initials:((fname[0]||'')+(lname[0]||'')).toUpperCase(),
        avClass:'av-blue',
        entityName:entity?.name||'Entity',
      };
      window.ownerPayrollByEntity=ownerPayrollByEntity;
      ownerPayroll=ownerPayrollByEntity[activeIdx];
      window.ownerPayroll=ownerPayroll;
    }
    if(typeof syncAllPayrollsToPersonal==='function') syncAllPayrollsToPersonal();
    if(typeof loadPersonalFinance==='function') await loadPersonalFinance();
    if(typeof renderPayroll==='function') renderPayroll();
    notify('Payroll saved — Personal Finance synced ✦');
  }catch(e){notify('Error: '+(e.message||'Failed to save'));}
}

function openAddEmployeeModal(){
  const _sv=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v;};
  _sv('emp-fname',''); _sv('emp-lname',''); _sv('emp-jobtitle','');
  _sv('emp-type','Full-time'); _sv('emp-gross',''); _sv('emp-taxrate','20'); _sv('emp-startdate','');
  const prev=document.getElementById('emp-net-preview');
  if(prev) prev.textContent='—';
  openModal('add-employee-modal');
}

function previewEmpNet(){
  const gross=parseFloat(document.getElementById('emp-gross')?.value)||0;
  const tax=parseFloat(document.getElementById('emp-taxrate')?.value)||0;
  const net=Math.round(gross*(1-tax/100));
  const el=document.getElementById('emp-net-preview');
  if(el) el.textContent=gross>0?'$'+net.toLocaleString():'—';
}

async function saveNewEmployee(){
  const fname=(document.getElementById('emp-fname')?.value||'').trim();
  const lname=(document.getElementById('emp-lname')?.value||'').trim();
  const role=(document.getElementById('emp-jobtitle')?.value||'').trim();
  const empType=document.getElementById('emp-type')?.value||'Full-time';
  const gross=parseFloat(document.getElementById('emp-gross')?.value)||0;
  const taxRate=parseFloat(document.getElementById('emp-taxrate')?.value)||0;
  if(!fname){notify('First name is required');return;}
  if(!gross){notify('Monthly gross salary is required');return;}
  const colors=['av-blue','av-green','av-purple','av-amber','av-teal'];
  const avClass=colors[Math.floor(Math.random()*colors.length)];
  const activeIdx=typeof ENTITIES!=='undefined'?ENTITIES.findIndex(e=>e.active):-1;
  const entity=activeIdx>=0?ENTITIES[activeIdx]:null;
  try{
    const r=await fetch('/api/payroll',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',
      body:JSON.stringify({fname,lname,role,emp_type:empType,gross,tax_rate:taxRate,is_owner:false,av_class:avClass,entity_id:entity?._dbId||null})});
    if(!r.ok) throw new Error((await r.json()).error||'Failed to save');
    const saved=await r.json();
    const net=Math.round(gross*(1-taxRate/100));
    const initials=((fname[0]||'')+(lname[0]||'')).toUpperCase();
    payrollEmployees.push({_dbId:saved.id,fname,lname,role,type:empType,gross,taxRate,net,initials,avClass,isOwner:false});
    window.payrollEmployees=payrollEmployees;
    closeModal('add-employee-modal');
    renderPayroll();
    notify(fname+' '+lname+' added to payroll ✦');
  }catch(e){notify('Error: '+(e.message||'Failed to save employee'));}
}

function _renderPersTxList(){
  const filter=window._persTxFilter||'all';
  const txs=persTransactions.filter(t=>filter==='all'||t.type===filter);
  const el=document.getElementById('pers-transactions');
  if(!el) return;
  if(txs.length===0){
    el.innerHTML='<div style="font-size:12px;color:var(--t3);text-align:center;padding:.75rem">No transactions yet — add your first one above</div>';
    const balRow=document.getElementById('pers-tx-balance');
    if(balRow) balRow.style.display='none';
    return;
  }
  let running=0;
  el.innerHTML=txs.map(t=>{
    running+=t.type==='income'?t.amount:-t.amount;
    return `<div class="tx-row" style="align-items:center">
      <div class="tx-left" style="flex:1;min-width:0">
        <div class="tx-icon ${t.type==='income'?'av-green':'av-red'}">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            ${t.type==='income'?'<polyline points="1,8 6,3 10,7 15,2"/><polyline points="10,2 15,2 15,7"/>':'<polyline points="1,5 5,10 9,7 15,13"/><polyline points="10,13 15,13 15,8"/>'}
          </svg>
        </div>
        <div><div class="tx-name">${esc(t.desc)}</div><div class="tx-cat">${esc(t.cat)} · ${esc(t.date)}</div></div>
      </div>
      <div class="tx-amt ${t.type==='income'?'up':'dn'}" style="margin-right:8px">${t.type==='income'?'+':'-'}${SP(t.amount)}</div>
      ${t._dbId?`<button onclick="deletePersonalTransaction(${t._dbId})" style="background:none;border:none;cursor:pointer;color:var(--t3);padding:2px 4px;font-size:11px;line-height:1" title="Delete">✕</button>`:''}
    </div>`;
  }).join('');
  const balRow=document.getElementById('pers-tx-balance');
  const balVal=document.getElementById('pers-tx-balance-val');
  if(balRow){balRow.style.display='';}
  if(balVal){balVal.textContent=SP(Math.abs(running));balVal.style.color=running>=0?'var(--green)':'var(--red)';}
}

window._persSideIncome=0;
window._persPeriod='year';
window._persTxFilter='all';
window._allPersTxs=[];

function _persPeriodRange(){
  const now=new Date();
  const y=now.getFullYear(),m=now.getMonth();
  if(window._persPeriod==='month'){
    return{from:new Date(y,m,1),to:now};
  }else if(window._persPeriod==='quarter'){
    const qStart=new Date(y,Math.floor(m/3)*3,1);
    return{from:qStart,to:now};
  }
  return{from:new Date(y,0,1),to:now};
}

function setPersPeriod(period){
  window._persPeriod=period;
  document.querySelectorAll('.pers-period-btn').forEach(b=>{
    b.classList.toggle('active-preset',b.dataset.period===period);
  });
  _applyPersFilter();
}

function setPersTxFilter(filter){
  window._persTxFilter=filter;
  document.querySelectorAll('.pers-tx-filter-btn').forEach(b=>{
    b.classList.toggle('active-preset',b.dataset.filter===filter);
  });
  _renderPersTxList();
}

function _applyPersFilter(){
  const{from,to}=_persPeriodRange();
  const CAT_GROUP={'Rent/Mortgage':'Housing','Groceries':'Food','Dining out':'Food','Transport':'Transport','Entertainment':'Entertainment','Healthcare':'Healthcare','Shopping':'Shopping','Subscriptions':'Subscriptions','Other':'Other','Income':'Other'};
  const CAT_COLOR={Housing:'var(--acc)',Food:'var(--green)',Transport:'var(--teal)',Entertainment:'var(--purple)',Healthcare:'var(--red)',Shopping:'var(--amber)',Subscriptions:'var(--acc2)',Other:'var(--t3)'};
  persTransactions=window._allPersTxs.filter(t=>{
    const d=new Date(t.date);return d>=from&&d<=to;
  });
  const catTotals={};
  persTransactions.filter(t=>t.type==='expense').forEach(t=>{const c=CAT_GROUP[t.cat]||'Other';catTotals[c]=(catTotals[c]||0)+t.amount;});
  spending=Object.entries(catTotals).map(([label,amount])=>({label,amount,color:CAT_COLOR[label]||'var(--t3)',budget:0}));
  const sideIncome=persTransactions.filter(t=>t.type==='income').reduce((a,t)=>a+t.amount,0);
  window._persSideIncome=sideIncome;
  const totalInc=basePersonalIncome+sideIncome;
  const totalExp=spending.reduce((a,s)=>a+s.amount,0);
  baseNetWorth=Math.max(0,totalInc-totalExp);
  renderPersonal();
}

async function deletePersonalTransaction(dbId){
  try{
    const res=await fetch('/api/personal-transactions/'+dbId,{method:'DELETE',credentials:'include'});
    if(!res.ok) throw new Error('Failed');
    await loadPersonalFinance();
    notify('Transaction deleted');
  }catch(e){notify('Error: '+(e.message||'Failed to delete'));}
}

async function loadPersonalFinance(){
  console.log('[PersFinance] starting loadPersonalFinance');
  try{
    const r=await fetch('/api/personal-transactions',{credentials:'include'});
    if(!r.ok){
      console.warn('[PersFinance] /api/personal-transactions returned',r.status,'— continuing without transactions');
    } else {
      const txs=await r.json();
      window._allPersTxs=txs.map(t=>({_dbId:t.id,desc:t.description||'',cat:t.category||'Other',amount:parseFloat(t.amount)||0,type:t.tx_type||'expense',date:(t.tx_date||t.created_at||'').slice(0,10)}));
    }
    try{
      const prRes=await fetch('/api/personal-salary',{credentials:'include'});
      const ownerRows=await prRes.json();
      console.log('[PersFinance] ownerRows:',ownerRows);
      if(Array.isArray(ownerRows)&&ownerRows.length>0){
        basePersonalIncome=ownerRows.reduce((sum,r)=>{
          const gross=parseFloat(r.gross)||0;
          const tax=parseFloat(r.tax_rate)||0;
          const net=Math.round(gross*(1-tax/100));
          console.log('[PersFinance] owner row — gross:',gross,'tax:',tax,'net:',net);
          return sum+net;
        },0);
        console.log('[PersFinance] basePersonalIncome set to:',basePersonalIncome);
      }
    }catch(prErr){console.warn('[Personal] Salary fetch failed:',prErr.message);}
    _applyPersFilter();
  }catch(e){console.warn('[Personal] Load failed:',e.message);}
}
window.loadPersonalFinance=loadPersonalFinance;

function renderPersonalSections(){
  const salary=basePersonalIncome;
  const sideIncome=window._persSideIncome||0;
  const totalInc=salary+sideIncome;
  const totalExp=spending.reduce((a,s)=>a+s.amount,0);

  // Income sources
  const inEl=document.getElementById('income-sources-list');
  if(inEl){
    if(totalInc===0){
      inEl.innerHTML='<div style="font-size:12px;color:var(--t3);text-align:center;padding:.75rem">No income recorded — add payroll or income transactions</div>';
    }else{
      const rows=[];
      if(salary>0) rows.push({label:'Salary (payroll)',amount:salary,color:'var(--acc)'});
      if(sideIncome>0) rows.push({label:'Side income / freelance',amount:sideIncome,color:'var(--green)'});
      inEl.innerHTML=rows.map(r=>`<div class="bar-row"><span class="bar-label">${r.label}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round(r.amount/totalInc*100)}%;background:${r.color}"></div></div><span class="bar-val">${SP(r.amount)}</span></div>`).join('')
        +'<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--bd);display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--t2)">Total income</span><span style="color:var(--t1);font-weight:600;font-family:var(--font-mono)">'+SP(totalInc)+'</span></div>';
    }
  }

  // Budget vs Actual
  const budgetTarget=parseInt(document.getElementById('s-budget')?.value)||0;
  const usedPct=budgetTarget>0?Math.min(100,Math.round(totalExp/budgetTarget*100)):0;
  const variance=budgetTarget-totalExp;
  const bvEl=document.getElementById('budget-vs-actual-list');
  if(bvEl){
    if(totalExp===0&&budgetTarget===0){
      bvEl.innerHTML='<div style="font-size:12px;color:var(--t3);text-align:center;padding:.75rem">Set a budget in Settings and add transactions to track</div>';
    }else{
      bvEl.innerHTML=`
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:8px"><span style="color:var(--t2)">Monthly budget</span><span style="font-family:var(--font-mono);font-weight:600;color:var(--t1)">${SP(budgetTarget)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:10px"><span style="color:var(--t2)">Actual spending</span><span style="font-family:var(--font-mono);font-weight:600;color:var(--t1)">${SP(totalExp)}</span></div>
        <div class="bar-track" style="margin-bottom:6px"><div class="bar-fill" style="width:${usedPct}%;background:${usedPct>90?'var(--red)':usedPct>70?'var(--amber)':'var(--green)'}"></div></div>
        <div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--t3);margin-bottom:10px"><span>${usedPct}% used</span>${budgetTarget>0?`<span>${SP(budgetTarget)} limit</span>`:''}</div>
        <div style="height:1px;background:var(--bd);margin-bottom:10px"></div>
        <div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--t1);font-weight:500">Variance</span><span style="font-family:var(--font-mono);font-weight:700;color:${variance>=0?'var(--green)':'var(--red)'}">${variance>=0?'+':''}${SP(variance)}</span></div>`;
    }
  }

  // Net worth breakdown
  const cashAssets=Math.max(0,totalInc-totalExp);
  const invValue=typeof holdings!=='undefined'?holdings.reduce((a,h)=>a+((h.price||0)*(h.shares||0)),0):0;
  const totalAssets=cashAssets+invValue;
  const totalLiab=Math.max(0,totalExp-totalInc);
  const netWorth=totalAssets-totalLiab;
  const nwEl=document.getElementById('nw-breakdown-list');
  const nwSub=document.getElementById('nw-sub');
  if(nwSub) nwSub.textContent=SP(Math.abs(netWorth))+(netWorth<0?' deficit':' total');
  if(nwEl){
    if(totalAssets===0&&totalLiab===0){
      nwEl.innerHTML='<div style="font-size:12px;color:var(--t3);text-align:center;padding:.75rem">No data yet — add payroll, transactions, or investments</div>';
    }else{
      nwEl.innerHTML=`<div style="display:flex;flex-direction:column;gap:4px">
        <div style="font-size:10px;color:var(--t3);font-weight:600;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Assets</div>
        ${cashAssets>0?`<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:3px 0"><span style="color:var(--t2)">Cash savings</span><span style="color:var(--green);font-family:var(--font-mono)">${SP(cashAssets)}</span></div>`:''}
        ${invValue>0?`<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:3px 0"><span style="color:var(--t2)">Investment portfolio</span><span style="color:var(--green);font-family:var(--font-mono)">${SP(invValue)}</span></div>`:''}
        ${totalAssets===0?`<div style="font-size:12px;color:var(--t3);padding:3px 0">$0</div>`:''}
        <div style="height:1px;background:var(--bd);margin:6px 0"></div>
        <div style="font-size:10px;color:var(--t3);font-weight:600;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Liabilities</div>
        ${totalLiab>0?`<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:3px 0"><span style="color:var(--t2)">Excess spending</span><span style="color:var(--red);font-family:var(--font-mono)">-${SP(totalLiab)}</span></div>`:`<div style="font-size:12px;color:var(--t3);padding:3px 0">$0</div>`}
        <div style="height:1px;background:var(--bd);margin:6px 0"></div>
        <div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0"><span style="color:var(--t1);font-weight:600">Net worth</span><span style="font-family:var(--font-mono);font-weight:700;color:${netWorth>=0?'var(--acc)':'var(--red)'}">${netWorth>=0?'':'-'}${SP(Math.abs(netWorth))}</span></div>
      </div>`;
    }
  }

  // Expense categories breakdown (raw categories, not grouped buckets)
  const CAT_COLORS_RAW={'Rent/Mortgage':'var(--acc)','Groceries':'var(--green)','Dining out':'var(--teal)','Transport':'var(--teal)','Subscriptions':'var(--acc2)','Healthcare':'var(--red)','Entertainment':'var(--purple)','Shopping':'var(--amber)','Other':'var(--t3)'};
  const catEl=document.getElementById('expense-cat-list');
  if(catEl){
    const rawCats={};
    persTransactions.filter(t=>t.type==='expense').forEach(t=>{rawCats[t.cat]=(rawCats[t.cat]||0)+t.amount;});
    const catEntries=Object.entries(rawCats).sort((a,b)=>b[1]-a[1]);
    if(catEntries.length===0){
      catEl.innerHTML='<div style="font-size:12px;color:var(--t3);text-align:center;padding:.75rem">No expenses recorded yet</div>';
    }else{
      const catMax=Math.max(...catEntries.map(e=>e[1]),1);
      catEl.innerHTML=catEntries.map(([label,amount])=>`
        <div class="bar-row">
          <span class="bar-label">${label}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.round(amount/catMax*100)}%;background:${CAT_COLORS_RAW[label]||'var(--t3)'}"></div></div>
          <span class="bar-val">${SP(amount)}</span>
        </div>`).join('')
        +'<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--bd);display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--t2)">Total</span><span style="color:var(--t1);font-weight:600;font-family:var(--font-mono)">'+SP(totalExp)+'</span></div>';
    }
  }

  // Tax estimate
  const taxEl=document.getElementById('tax-estimate-list');
  if(taxEl){
    const monthlyInc=basePersonalIncome+(window._persSideIncome||0);
    if(monthlyInc===0){
      taxEl.innerHTML='<div style="font-size:12px;color:var(--t3);text-align:center;padding:.75rem">Add income to see tax estimate</div>';
    }else{
      const taxRate=parseFloat(document.getElementById('own-taxrate')?.value)||20;
      const annualGross=monthlyInc*12;
      const estTax=Math.round(annualGross*taxRate/100);
      const netAfterTax=annualGross-estTax;
      const monthlyTakeHome=Math.round(netAfterTax/12);
      taxEl.innerHTML=`
        <div style="display:flex;justify-content:space-between;font-size:12.5px;padding:3px 0"><span style="color:var(--t2)">Gross annual income</span><span style="font-family:var(--font-mono);font-weight:600;color:var(--t1)">${SP(annualGross)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;padding:3px 0"><span style="color:var(--t2)">Est. tax (${taxRate}%)</span><span style="font-family:var(--font-mono);font-weight:600;color:var(--red)">-${SP(estTax)}</span></div>
        <div style="height:1px;background:var(--bd);margin:8px 0"></div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;padding:3px 0"><span style="color:var(--t2)">Net after tax</span><span style="font-family:var(--font-mono);font-weight:600;color:var(--green)">${SP(netAfterTax)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0 3px"><span style="color:var(--t1);font-weight:600">Monthly take-home</span><span style="font-family:var(--font-mono);font-weight:700;color:var(--acc)">${SP(monthlyTakeHome)}</span></div>`;
    }
  }
}

// ════════════════════════════════════════════
// INVESTMENTS
// ════════════════════════════════════════════
let holdings=[];
const INV_PERIOD_DATA={
  '1m':{portPts:[100,101.2,100.8,102.1,103.4,102.9,104.2,105.1,104.8,106.3,107.0,106.5,107.8,108.2,108.9,110.1,109.7,110.5,111.2,110.8,112.1,113.0,112.4,113.8,114.2,115.0,114.8,116.1,115.7,116.9,117.4],sp500:[100,101.0,100.5,101.8,102.9,102.3,103.5,104.2,103.9,105.0,105.8,105.2,106.1,106.8,107.3,108.2,107.8,108.9,109.5,109.1,110.2,111.0,110.5,111.6,112.0,112.8,112.4,113.5,113.0,113.8,114.2]},
  '3m':{portPts:[100,101.8,103.2,102.4,104.8,106.1,105.3,107.5,108.9,108.1,110.4,111.8,110.9,113.2,114.5,113.6,115.9,117.2,116.3,118.6,119.9,119.0,121.3,122.6,121.8,123.1,122.4,124.7,125.9,125.1,117.4],sp500:[100,101.5,102.8,102.0,104.1,105.3,104.6,106.7,107.9,107.2,109.2,110.5,109.8,111.8,113.0,112.4,114.2,115.5,114.8,116.8,118.0,117.4,119.3,120.5,119.9,121.0,120.4,122.3,123.5,122.9,114.2]},
  'ytd':{portPts:[100,102.1,104.5,103.8,106.2,108.4,107.6,110.1,112.3,111.5,113.9,116.2,115.3,117.8,120.1,119.2,121.7,123.9,123.1,125.6,127.9,127.0,129.4,131.7,130.9,133.3,132.4,134.8,137.1,136.2,117.4],sp500:[100,101.8,103.9,103.2,105.4,107.4,106.7,108.9,110.9,110.3,112.3,114.2,113.5,115.4,117.4,116.7,118.6,120.6,119.9,121.8,123.8,123.2,125.0,127.0,126.3,128.2,127.6,129.5,131.5,130.8,114.2]},
  '1y':{portPts:[100,103.2,97.4,105.8,110.2,108.4,115.6,112.1,118.9,122.4,119.8,127.2,124.6,131.1,128.5,135.9,133.2,140.6,138.0,145.4,142.7,150.1,147.5,154.9,152.2,159.6,157.0,164.4,161.7,169.1,117.4],sp500:[100,102.8,96.4,104.5,108.7,106.9,113.8,110.4,116.9,120.1,117.6,124.8,122.2,128.5,125.9,132.3,129.7,136.2,133.6,140.1,137.4,143.9,141.3,147.8,145.1,151.6,148.9,155.4,152.7,159.2,114.2]}
};
let invPeriod='1m';
let invPerfChart=null;
let invDonutChart=null;

function S2(n){if(n>=1e6)return'$'+(n/1e6).toFixed(2)+'M';if(n>=1e3)return'$'+(n/1e3).toFixed(1)+'K';return'$'+Math.round(n).toLocaleString();}

function calcPortfolio(){
  let totalValue=0,totalCost=0,totalDiv=0,dayChg=0;
  holdings.forEach(h=>{
    totalValue+=h.price*h.shares;
    totalCost+=h.cost*h.shares;
    totalDiv+=(h.div||0)*h.shares;
    dayChg+=(h.price*0.0031)*h.shares; // simulated day change ~0.31%
  });
  return{totalValue,totalCost,totalGain:totalValue-totalCost,totalDiv,dayChg};
}

function renderInvestments(){
  const{totalValue,totalCost,totalGain,totalDiv,dayChg}=calcPortfolio();
  const gainPct=totalCost>0?((totalGain/totalCost)*100).toFixed(1):0;
  const dayPct=totalValue > 0 ? (dayChg/totalValue*100).toFixed(2) : '0.00';
  const gainPos=totalGain>=0;

  // Metrics
  document.getElementById('inv-total-val').textContent=S2(totalValue);
  const tChg=document.getElementById('inv-total-chg');tChg.textContent=(gainPos?'▲ ':'▼ ')+Math.abs(gainPct)+'% all time';tChg.className='mc-change '+(gainPos?'up':'dn');
  document.getElementById('inv-gain').textContent=(gainPos?'+':'')+S2(totalGain);
  const gLbl=document.getElementById('inv-gain-lbl');gLbl.textContent=(gainPos?'▲ ':'▼ ')+Math.abs(gainPct)+'% return';gLbl.className='mc-change '+(gainPos?'up':'dn');
  document.getElementById('inv-day-chg').textContent=(dayChg>=0?'+':'')+S2(dayChg);
  const dLbl=document.getElementById('inv-day-lbl');dLbl.textContent=(dayChg>=0?'▲ ':'▼ ')+Math.abs(dayPct)+'% today';dLbl.className='mc-change '+(dayChg>=0?'up':'dn');
  document.getElementById('inv-yield').textContent=S2(totalDiv);

  // Holdings list
  document.getElementById('inv-asset-count').textContent=holdings.length;
  document.getElementById('inv-holdings-list').innerHTML=holdings.map((h,i)=>{
    const val=h.price*h.shares;
    const cost=h.cost*h.shares;
    const gl=val-cost;
    const glPct=cost>0?((gl/cost)*100).toFixed(1):0;
    const pos=gl>=0;
    const colors=['#c9a84c','#5aaa9e','#9e8fbf','#7db87d','#d4964a','#c46a5a','#5a4e3a'];
    const bg=h.color||colors[i%colors.length];
    return`<div class="inv-holding-row">
      <div class="inv-ticker-badge" style="background:${bg}22;color:${bg};border-color:${bg}44;font-size:9px">${esc(h.ticker.slice(0,4))}</div>
      <div>
        <div style="font-weight:500;font-size:12.5px">${esc(h.name)} <span class="badge b-blue" style="font-size:9px;padding:1px 5px">${esc(h.type)}</span></div>
        <div style="font-size:11px;color:var(--t3)">${(val/totalValue*100).toFixed(1)}% of portfolio</div>
        <div class="inv-alloc-bar"><div class="inv-alloc-fill" style="width:${(val/totalValue*100).toFixed(1)}%;background:${bg}"></div></div>
      </div>
      <div style="text-align:right;font-family:var(--font-mono)">$${h.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
      <div style="text-align:right;color:var(--t2)">${h.shares}</div>
      <div style="text-align:right;font-family:var(--font-mono);font-weight:500">${S2(val)}</div>
      <div style="text-align:right;font-family:var(--font-mono);color:var(--t3)">${S2(cost)}</div>
      <div style="text-align:right">
        <span class="inv-perf-chip ${pos?'inv-perf-up':'inv-perf-dn'}">${pos?'▲':'▼'} ${Math.abs(glPct)}%</span>
      </div>
    </div>`;
  }).join('');

  // Donut chart
  buildInvDonut(holdings,totalValue);
  buildInvPerfChart(invPeriod);
  updateInvAI(totalValue,totalGain,gainPct,totalDiv);
  updateNetWorthPanel(totalValue);

  // Performance card — populate from real portfolio gain (no hardcoded benchmarks).
  // S&P 500 / 60/40 stay as dashes unless a benchmark API is wired in.
  const _perfPort = document.getElementById('biz-perf-port');
  const _perfSum  = document.getElementById('biz-perf-summary');
  if (_perfPort) {
    if (holdings.length === 0) {
      _perfPort.textContent = '—';
      _perfPort.style.color = 'var(--t3)';
      if (_perfSum) _perfSum.textContent = 'No holdings yet — add positions to see performance.';
    } else {
      const pct = parseFloat(gainPct) || 0;
      const pos = pct >= 0;
      _perfPort.textContent = (pos ? '+' : '') + pct.toFixed(1) + '%';
      _perfPort.style.color = pos ? 'var(--green)' : 'var(--red)';
      _perfPort.style.fontWeight = '600';
      if (_perfSum) _perfSum.textContent = 'Unrealised ' + (pos ? 'gain' : 'loss') + ': ' + (pos ? '+' : '') + S2(totalGain) + ' on ' + S2(totalCost) + ' cost basis.';
    }
  }
}

function buildInvDonut(hs,totalValue){
  const canvas=document.getElementById('invDonut');
  if(!canvas||typeof Chart==='undefined'||canvas.offsetWidth===0||canvas.offsetParent===null)return;
  const ctx=canvas.getContext('2d');
  const vals=hs.map(h=>h.price*h.shares);
  const colors=hs.map(h=>h.color||'#c9a84c');
  if(invDonutChart){invDonutChart.destroy();}
  invDonutChart=new Chart(ctx,{
    type:'doughnut',
    data:{datasets:[{data:vals,backgroundColor:colors.map(c=>c+'cc'),borderColor:colors,borderWidth:1.5,hoverBorderWidth:2}],
          labels:hs.map(h=>h.ticker)},
    options:{responsive:false,cutout:'68%',plugins:{legend:{display:false},tooltip:{
      backgroundColor:'rgba(22,18,13,0.95)',titleColor:'#f2e8d5',bodyColor:'#9e8e73',padding:8,cornerRadius:6,
      callbacks:{label:ctx=>`${ctx.label}: ${(ctx.raw/totalValue*100).toFixed(1)}%`}
    }}}
  });
  // Legend
  const leg=document.getElementById('inv-legend');
  if(leg)leg.innerHTML=hs.map(h=>`
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
      <span style="width:8px;height:8px;border-radius:2px;background:${h.color};flex-shrink:0"></span>
      <span style="font-size:11px;color:var(--t2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.ticker)}</span>
      <span style="font-size:11px;font-weight:600;color:var(--t1);font-family:var(--font-mono)">${(h.price*h.shares/totalValue*100).toFixed(1)}%</span>
    </div>`).join('');
}

function buildInvPerfChart(period){
  const canvas=document.getElementById('invPerfChart');
  if(!canvas||typeof Chart==='undefined'||canvas.offsetWidth===0||canvas.offsetParent===null)return;
  const retEl=document.getElementById('inv-perf-return');
  // No holdings → show empty state (no fake benchmark data)
  if(!holdings || holdings.length===0){
    if(retEl) retEl.textContent='No data — add holdings to see performance';
    if(invPerfChart){ invPerfChart.destroy(); invPerfChart=null; }
    const ctx=canvas.getContext('2d');
    if(ctx){ ctx.clearRect(0,0,canvas.width,canvas.height); }
    return;
  }
  const{portPts,sp500}=INV_PERIOD_DATA[period];
  const n=portPts.length;
  const labels=Array.from({length:n},(_,i)=>i===0?'Start':i===n-1?'Now':'');
  const portReturn=((portPts[n-1]-100)).toFixed(1);
  const spReturn=((sp500[n-1]-100)).toFixed(1);
  if(retEl)retEl.textContent=`Portfolio +${portReturn}% vs S&P +${spReturn}%`;
  const{tc,gc}=chartDefaults();
  if(invPerfChart){invPerfChart.destroy();}
  const portCtx=canvas.getContext('2d');
  if(!portCtx)return;
  const portGrad=portCtx.createLinearGradient(0,0,0,130);
  portGrad.addColorStop(0,'rgba(201,168,76,0.2)');portGrad.addColorStop(1,'rgba(201,168,76,0)');
  invPerfChart=new Chart(canvas,{
    type:'line',
    data:{labels,datasets:[
      {label:'Portfolio',data:portPts,borderColor:'#c9a84c',borderWidth:2,fill:true,backgroundColor:portGrad,tension:0.4,pointRadius:0,pointHoverRadius:4},
      {label:'S&P 500',data:sp500,borderColor:'#9e8fbf',borderWidth:1.5,fill:false,tension:0.4,pointRadius:0,pointHoverRadius:4,borderDash:[4,3]}
    ]},
    options:{responsive:true,maintainAspectRatio:false,animation:{duration:200},
      plugins:{legend:{display:false},tooltip:{backgroundColor:'rgba(22,18,13,0.95)',titleColor:'#f2e8d5',bodyColor:'#9e8e73',padding:8,cornerRadius:6,callbacks:{label:c=>`${c.dataset.label}: +${(c.raw-100).toFixed(1)}%`}}},
      scales:{x:{display:false},y:{grid:{color:gc},ticks:{color:tc,font:{size:10},callback:v=>'+'+(v-100).toFixed(0)+'%'},border:{display:false}}}
    }
  });
}

function setInvPeriod(p,btn){
  invPeriod=p;
  ['1m','3m','ytd','1y'].forEach(k=>{
    const el=document.getElementById('inv-per-'+k);
    if(el){el.style.background='';el.style.borderColor='';el.style.color='';}
  });
  if(btn){btn.style.background='var(--acc-bg)';btn.style.borderColor='var(--acc)';btn.style.color='var(--acc)';}
  buildInvPerfChart(p);
}

function updateInvAI(totalValue,totalGain,gainPct,totalDiv){
  const top=holdings.slice().sort((a,b)=>b.price*b.shares-a.price*a.shares).slice(0,2);
  const topPct=top.reduce((s,h)=>s+h.price*h.shares,0)/totalValue*100;
  const yieldPct=(totalDiv/totalValue*100).toFixed(1);
  const i1=document.getElementById('inv-ai-1');
  const i2=document.getElementById('inv-ai-2');
  const i3=document.getElementById('inv-ai-3');
  if (holdings.length === 0) {
    if(i1)i1.textContent='No holdings yet. Add positions to see performance insights.';
    if(i2)i2.textContent='';
    if(i3)i3.textContent='';
    return;
  }
  const gPos = parseFloat(gainPct) >= 0;
  if(i1)i1.textContent=`Your portfolio is ${gPos?'up':'down'} ${Math.abs(gainPct)}% on a ${S2(totalValue-totalGain)} cost basis. Unrealised ${gPos?'gain':'loss'}: ${gPos?'+':''}$${Math.round(totalGain).toLocaleString()}.`;
  if(i2)i2.textContent=`${top.map(h=>h.ticker).join(' & ')} together represent ${topPct.toFixed(0)}% of portfolio value — consider diversifying if concentration risk concerns you.`;
  if(i3 && totalDiv>0)i3.textContent=`Dividend income of $${Math.round(totalDiv).toLocaleString()}/yr adds a ${yieldPct}% yield.`;
  else if(i3)i3.textContent='No dividend-paying positions in this portfolio.';
}

function updateNetWorthPanel(portValue){
  const cash=284320;
  const other=84000;
  const total=cash+portValue+other;
  const max=Math.max(cash,portValue,other);
  const el=document.getElementById('nw-port-val');if(el)el.textContent=S2(portValue);
  const pb=document.getElementById('nw-port-bar');if(pb)pb.style.width=(portValue/max*100).toFixed(0)+'%';
  const cb=document.getElementById('nw-cash-bar');if(cb)cb.style.width=(cash/max*100).toFixed(0)+'%';
  const ob=document.getElementById('nw-other-bar');if(ob)ob.style.width=(other/max*100).toFixed(0)+'%';
  const td=document.getElementById('nw-total-display');if(td)td.textContent=S2(total);
  const pp=document.getElementById('nw-port-pct');if(pp)pp.textContent=(portValue/total*100).toFixed(0)+'%';
  // Also update personal net worth if available
  const pnw=document.getElementById('pers-nw');
  if(pnw)pnw.textContent=S2(total);
}

function openAddHoldingModal(){
  ['h-ticker','h-name','h-shares','h-cost','h-price','h-div'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  openModal('holding-modal');
}
function saveHolding(){
  const ticker=(document.getElementById('h-ticker').value||'').trim().toUpperCase();
  const name=(document.getElementById('h-name').value||'').trim()||ticker;
  const shares=parseFloat(document.getElementById('h-shares').value)||0;
  const cost=parseFloat(document.getElementById('h-cost').value)||0;
  const price=parseFloat(document.getElementById('h-price').value)||cost;
  const div=parseFloat(document.getElementById('h-div').value)||0;
  const type=document.getElementById('h-type').value||'Stock';
  if(!ticker||!shares){notify('Ticker and shares are required',true);return;}
  const colors=['#c9a84c','#5aaa9e','#9e8fbf','#7db87d','#d4964a','#c46a5a','#5a4e3a'];
  holdings.push({ticker,name,type,shares,cost,price,div,color:colors[holdings.length%colors.length]});
  closeModal('holding-modal');
  renderInvestments();
  notify(`${ticker} added to portfolio ✦`);
}

function openRebalanceModal(){
  const{totalValue}=calcPortfolio();
  const targets={Stock:60,ETF:20,Bond:10,Cash:5,Crypto:3,Other:2};
  const actual={};
  holdings.forEach(h=>{actual[h.type]=(actual[h.type]||0)+h.price*h.shares;});
  const html=Object.entries(targets).map(([type,tgt])=>{
    const act=actual[type]||0;
    const actPct=totalValue>0?(act/totalValue*100).toFixed(1):0;
    const diff=(parseFloat(actPct)-tgt).toFixed(1);
    const over=parseFloat(diff)>0;
    return`<div class="inv-rebalance-row">
      <span style="flex:1;font-weight:500">${type}</span>
      <span style="color:var(--t2);width:60px;text-align:right">${actPct}%</span>
      <span style="color:var(--t3);width:60px;text-align:right">→ ${tgt}%</span>
      <span style="width:70px;text-align:right;color:${over?'var(--amber)':parseFloat(diff)<-2?'var(--red)':'var(--green)'}">
        ${parseFloat(diff)===0?'On target':over?'▲ +'+Math.abs(diff)+'%':'▼ '+Math.abs(diff)+'%'}
      </span>
    </div>`;
  }).join('');
  const rb=document.getElementById('rebalance-content');
  if(rb)rb.innerHTML=`<div style="display:flex;gap:8px;padding:0 0 6px;font-size:10px;color:var(--t3);font-weight:600;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid var(--bd);margin-bottom:2px">
    <span style="flex:1">Type</span><span style="width:60px;text-align:right">Current</span><span style="width:60px;text-align:right">Target</span><span style="width:70px;text-align:right">Variance</span>
  </div>${html}<div style="margin-top:12px;font-size:11.5px;color:var(--t2);padding-top:8px;border-top:1px solid var(--bd)">Target allocation is a suggested default. Ask the AI to customise it for your risk profile.</div>`;
  openModal('rebalance-modal');
}

// ════════════════════════════════════════════
// AI INSIGHTS
// ════════════════════════════════════════════
function updateAI(d=getPeriodData()){
  document.getElementById('ai-period-label').textContent=d.label;
  const margin=d.rev > 0 ? Math.round(d.profit/d.rev*100) : 0;
  const insights=currentPeriod==='year'?[
    `Full year revenue: ${S(d.rev)} — a 38% annualised growth rate vs the prior year.`,
    `Best month: ${MONTH_FULL[11]} at ${S(REV[11])}. Weakest: ${MONTH_FULL[0]} at ${S(REV[0])}. Strong scaling trend.`,
    `Net profit margin: ${margin}%. Annual profit: ${S(d.profit)}. Business is ${d.profit<0?'running at a loss':margin>=20?'highly profitable':margin>=10?'profitable':'breaking even'}.`,

    d.rev > 0 ? `Payroll-to-revenue: ${Math.round(d.sal/d.rev*100)}% — ${Math.round(d.sal/d.rev*100)<=40?'healthy':'high'}. Industry avg for your size is 35–40%.` : `Add paid invoices to calculate your payroll-to-revenue ratio.`,
    `Webcam 4K Ultra (9 units) and Ergonomic Mouse (4 units) are critically low on stock.`,
  ]:currentPeriod==='quarter'?[
    `Q4 revenue: ${S(d.rev)} — your strongest quarter. Net profit: ${S(d.profit)} (${margin}% margin).`,
    `Monthly average profit in Q4: ${S(Math.round(d.profit/3))} — up from ${S(Math.round(sum(PROFIT,6,9)/3))} in Q3.`,
    _topClients.length ? `Top client this quarter: ${_topClients[0].label} at ${S(_topClients[0].total)} (${d.rev>0?Math.round(_topClients[0].total/d.rev*100):0}% of revenue).` : `Add invoices to see client revenue breakdown.`,
    `Payroll cost Q4: ${S(d.sal)} — at ${Math.round(d.sal/d.rev*100)}% of revenue, below industry average.`,

    `90-day forecast: ${S(PROFIT[9]+PROFIT[10]+PROFIT[11]+28000+30200+32100)} net positive across Q4 + 3 forecast months.`,
  ]:[
    `${MONTH_FULL[currentMonthIdx]} revenue: ${S(d.rev)} — ${margin}% profit margin.`,
    `Expenses this month: ${S(d.exp)}. Largest cost: salaries at ${S(d.sal)} (${Math.round(d.sal/d.exp*100)}%).`,
    `Net profit: ${S(d.profit)} — ${currentMonthIdx>0?`${pct(d.profit,PROFIT[currentMonthIdx-1])>0?'up':'down'} ${Math.abs(pct(d.profit,PROFIT[currentMonthIdx-1]))}% vs last month`:'first month on record'}.`,
    _topClients.length ? `Top client this month: ${_topClients[0].label} at ${S(_topClients[0].total)} (${d.rev>0?Math.round(_topClients[0].total/d.rev*100):0}% of revenue).` : `Add invoices to track client revenue.`,
    `Tax withheld on payroll: ${S(Math.round(d.exp*.16))}. Estimated quarterly tax liability: ${S(Math.round(d.profit*.25))}.`,
    `Inventory alert: 2 products below reorder threshold. Restock before end of month.`,
  ];
  document.getElementById('ai-insights-list').innerHTML=insights.map(t=>`<div class="ai-insight">${esc(t)}</div>`).join('');
  document.getElementById('ai-period-label').textContent=d.label;
}
function updateHealthScore(savingsRate=0,income=0,surplus=0){
  const d=getPeriodData();
  const profitMargin=d.rev > 0 ? Math.round(d.profit/d.rev*100) : 0;
  const cfScore=Math.min(100,Math.round(60+profitMargin*.8));
  const prScore=Math.min(100,Math.round(55+profitMargin));
  const arBalance=typeof userInvoices!=='undefined'?userInvoices.filter(i=>i.status?.toLowerCase()!=='paid').reduce((s,i)=>s+(parseFloat(i.amount)||0),0):0;
  const recScore=d.rev>0?Math.max(40,100-Math.round(arBalance/d.rev*100*5)):50;
  const grScore=REV[0]>0?Math.min(100,Math.round(70+Math.max(0,REV[11]-REV[0])/REV[0]*50)):50;
  const _scores=[cfScore,prScore,recScore,grScore].filter(s=>!isNaN(s));
  const overall=_scores.length?Math.round(_scores.reduce((a,b)=>a+b,0)/_scores.length):0;
  const el=document.getElementById('health-score');
  if(el)el.textContent=overall;
  const lbl=document.getElementById('health-label');
  if(lbl)lbl.textContent=`out of 100 — ${overall>=90?'Excellent':overall>=80?'Good':overall>=70?'Fair':'Needs attention'}`;
  setBar('hs-cf',cfScore,'hs-cf-v');setBar('hs-pr',prScore,'hs-pr-v');setBar('hs-rec',recScore,'hs-rec-v');setBar('hs-gr',grScore,'hs-gr-v');
}
function setBar(barId,score,valId){
  const bar=document.getElementById(barId);if(bar)bar.style.width=score+'%';
  const val=document.getElementById(valId);if(val)val.textContent=score+'/100';
  if(bar)bar.style.background=score>=80?'var(--green)':score>=60?'var(--amber)':'var(--red)';
}

// ════════════════════════════════════════════
// CUSTOMERS
// ════════════════════════════════════════════
function renderCustomers(filter=''){
  if(!customers) customers=[];
  const q=filter.toLowerCase();
  const filtered=customers.filter(c=>(c.fname+' '+c.lname+' '+c.company+' '+c.email).toLowerCase().includes(q));
  document.getElementById('cust-total').textContent=customers.length;
  document.getElementById('cust-active').textContent=customers.filter(c=>c.status==='active').length;
  document.getElementById('cust-revenue').textContent=S(customers.reduce((a,c)=>a+Number(c.revenue),0));
  if(!filtered.length){document.getElementById('customers-list').innerHTML=`<div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 16 16"><circle cx="5.5" cy="5" r="2.5"/><path d="M1 13c0-2.5 2-4.5 4.5-4.5"/><circle cx="11.5" cy="5" r="2.5"/><path d="M15 13c0-2.5-2-4.5-4.5-4.5"/></svg></div><h3>No customers found</h3><p>Try a different search term, or add your first customer to get started.</p><button class="btn btn-primary btn-sm" onclick="openCustomerModal()">+ Add customer</button></div>`;return;}
  document.getElementById('customers-list').innerHTML=filtered.map(c=>{
    const av=AVATAR_COLORS[(parseInt(c.id)||0)%AVATAR_COLORS.length];
    const ini=getInitials(c.fname,c.lname);
    const badge={active:'b-green',inactive:'b-purple',prospect:'b-amber'}[c.status]||'b-blue';
    return`<div class="cust-row" onclick="openCustomerModal(${Number(c.id)})">
      <div class="cust-avatar ${esc(av)}">${esc(ini)}</div>
      <div><div class="cust-name">${esc(c.fname)} ${esc(c.lname)}</div><div class="cust-email">${esc(c.email)}</div></div>
      <span style="font-size:12px;color:var(--t2)">${esc(c.company||'—')}</span>
      <span style="font-family:var(--font-mono);font-weight:600">${esc(S(c.revenue))}</span>
      <span><span class="badge ${esc(badge)}">${esc(c.status)}</span></span>
      <span class="table-actions"><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openCustomerModal(${Number(c.id)})">Edit</button></span>
    </div>`;
  }).join('');
}
function filterCustomers(){renderCustomers(document.getElementById('cust-search').value)}
function openCustomerModal(id=null){
  const del=document.getElementById('cust-delete-btn');
  if(id){
    const c=customers.find(x=>x.id===id);if(!c)return;
    document.getElementById('cust-modal-title').textContent='Edit customer';
    document.getElementById('cust-modal-sub').textContent='Update the details below';
    document.getElementById('cust-edit-id').value=id;
    document.getElementById('cust-fname').value=c.fname;document.getElementById('cust-lname').value=c.lname;
    document.getElementById('cust-company').value=c.company;document.getElementById('cust-email').value=c.email;
    document.getElementById('cust-phone').value=c.phone;document.getElementById('cust-revenue-val').value=c.revenue;
    document.getElementById('cust-status').value=c.status;document.getElementById('cust-notes').value=c.notes;
    const ind=document.getElementById('cust-industry');for(let o of ind.options){if(o.value===c.industry){o.selected=true;break;}}
    del.style.display='inline-flex';
  } else {
    document.getElementById('cust-modal-title').textContent='Add customer';
    document.getElementById('cust-modal-sub').textContent='Fill in the customer details';
    document.getElementById('cust-edit-id').value='';
    ['cust-fname','cust-lname','cust-company','cust-email','cust-phone','cust-notes'].forEach(i=>document.getElementById(i).value='');
    document.getElementById('cust-revenue-val').value='';document.getElementById('cust-status').value='active';
    del.style.display='none';
  }
  openModal('customer-modal');
}
function saveCustomer(){
  const fname=sanitizeText(document.getElementById('cust-fname').value,100);
  const lname=sanitizeText(document.getElementById('cust-lname').value,100);
  const email=document.getElementById('cust-email').value.trim().toLowerCase().slice(0,254);
  if(!fname||!lname){notify('First name and last name are required',true);return;}
  if(!email||!validateEmail(email)){notify('A valid email address is required',true);return;}
  const revRaw=validateAmount(document.getElementById('cust-revenue-val').value);
  const data={
    fname,lname,email,
    company:sanitizeText(document.getElementById('cust-company').value,200),
    industry:document.getElementById('cust-industry').value,
    phone:sanitizePhone(document.getElementById('cust-phone').value),
    revenue:revRaw!==null?revRaw:0,
    status:document.getElementById('cust-status').value,
    notes:sanitizeText(document.getElementById('cust-notes').value,1000)
  };
  const editId=document.getElementById('cust-edit-id').value;
  if(editId){const idx=customers.findIndex(c=>c.id===Number(editId));if(idx>-1)customers[idx]={...customers[idx],...data};notify('Customer updated');}
  else{data.id=nextCustId++;customers.push(data);notify('Customer added');}
  closeModal('customer-modal');renderCustomers(document.getElementById('cust-search').value);
}
function deleteCustomer(){
  const id=Number(document.getElementById('cust-edit-id').value);
  if(!id)return;
  if(!confirm('Delete this customer? This cannot be undone.'))return;
  customers=customers.filter(c=>c.id!==id);
  closeModal('customer-modal');renderCustomers();notify('Customer deleted');
}

// ════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════
function updateBrandName(){document.getElementById('sb-brand-name').textContent=document.getElementById('s-biz-name').value||'FinFlow'}
function updateUserName(){document.getElementById('sb-user-name').textContent=document.getElementById('s-user-name').value||'User'}
function updateUserAvatar(){document.getElementById('sb-user-avatar').textContent=document.getElementById('s-user-initials').value.toUpperCase()||'?'}
function updateCurrency(){
  const map={USD:'$',EUR:'€',GBP:'£',TTD:'TT$',CAD:'C$',AUD:'A$'};
  currencySymbol=map[document.getElementById('s-currency').value]||'$';
  refreshAllPeriodData();notify('Currency updated to '+document.getElementById('s-currency').value);
}
function toggleCompact(){
  document.getElementById('sidebar').classList.toggle('compact',document.getElementById('s-compact').checked);
}
async function saveSettings(){
  const v = id => (document.getElementById(id)||{}).value;
  const c = id => !!document.getElementById(id)?.checked;
  const b = {
    name:          v('s-user-name'),
    currency:      v('s-currency'),
    business_name: v('s-biz-name'),
    industry:      v('s-industry'),
    address:       v('s-address'),
    email:         v('s-email'),
    phone:         v('s-phone'),
    website:       v('s-website'),
    tax_id:        v('s-tax-id'),
    fiscal_year:   v('s-fy'),
    dark_mode:     c('s-dark') ? 1 : 0,
    show_cents:    c('s-cents') ? 1 : 0,
    notif_email:   c('s-email-alerts') ? 1 : 0,
  };
  try {
    await fetch('/api/settings', { method:'PUT', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(b) });
    if (window.CURRENT_USER && b.name) window.CURRENT_USER.name = b.name;
    notify('Settings saved ✦');
  } catch(e) { notify('Failed to save settings'); }
}

function openAddEntityModal(){
  if(currentUserPlan==='pro'&&typeof ENTITIES!=='undefined'&&ENTITIES.length>=1){
    if(typeof showUpgradeModal==='function') showUpgradeModal('entity');
    return;
  }
  openCreateBusinessPage('entities');
}

async function changePassword(){
  const cur = document.getElementById('s-cur-pw')?.value;
  const nw  = document.getElementById('s-new-pw')?.value;
  if(!cur||!nw){ notify('Both fields required'); return; }
  try {
    const res = await fetch('/api/auth/change-password', { method:'PUT', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({currentPassword:cur, newPassword:nw}) });
    const d = await res.json();
    if(!res.ok) throw new Error(d.error);
    document.getElementById('s-cur-pw').value='';
    document.getElementById('s-new-pw').value='';
    notify('Password updated ✦');
  } catch(e){ notify('Error: '+(e.message||'Failed')); }
}

function openDeleteAccountModal(){
  document.getElementById('del-acct-pw').value='';
  document.getElementById('delete-account-modal').classList.remove('hidden');
}

async function confirmDeleteAccount(){
  const pw = document.getElementById('del-acct-pw')?.value;
  if(!pw){ notify('Password required'); return; }
  try {
    const res = await fetch('/api/auth/account', { method:'DELETE', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({password:pw}) });
    const d = await res.json();
    if(!res.ok) throw new Error(d.error);
    closeModal('delete-account-modal');
    notify('Account deleted. Redirecting…');
    setTimeout(()=>{ window.location.href='/'; }, 1500);
  } catch(e){ notify('Error: '+(e.message||'Failed to delete account')); }
}
function connectAPI(platform){document.getElementById(platform+'-modal-inline').style.display='block'}
function saveConnection(platform){
  document.getElementById(platform+'-modal-inline').style.display='none';
  document.getElementById(platform+'-dot').className='dot dot-green';
  document.getElementById(platform+'-status').textContent='Connected';
  document.getElementById(platform+'-status').style.color='var(--green)';
  document.getElementById(platform+'-btn').textContent='Manage';
  document.getElementById(platform+'-btn').onclick=null;
  notify(platform.charAt(0).toUpperCase()+platform.slice(1)+' connected successfully');
}

// ════════════════════════════════════════════
// THEME
// ════════════════════════════════════════════
function toggleTheme(){
  darkMode=!darkMode;
  document.getElementById('app').classList.toggle('light-mode',!darkMode);
  document.getElementById('themeBtn').textContent=darkMode?'☀ Light':'☾ Dark';
  const s=document.getElementById('s-dark');if(s)s.checked=darkMode;
  // Rebuild charts with correct gradients for new theme
  if(charts.overview){charts.overview.destroy();delete charts.overview;}
  if(charts.cash){charts.cash.destroy();delete charts.cash;}
  loadChartJS(function(){buildCharts();buildCashChart();updateCharts();});
  setTimeout(()=>buildRiver(getPeriodData()),60);
}

// ════════════════════════════════════════════
// CHARTS
// ════════════════════════════════════════════
function chartDefaults(){return{tc:darkMode?'#9e8e73':'#6b5c42',gc:darkMode?'rgba(201,168,76,0.06)':'rgba(0,0,0,0.05)'}}

function buildCharts(){
  if(typeof Chart==='undefined'){console.warn('Chart.js not loaded — charts skipped');return;}
  // Destroy ALL orphaned Chart instances (prevents "instance 0" ghost conflict on re-render)
  Object.keys(Chart.instances).forEach(key=>{try{Chart.instances[key].destroy();}catch(e){}});
  // Destroy existing charts to prevent canvas reuse error
  if(window.charts){
    Object.values(window.charts).forEach(c=>{try{if(c&&typeof c.destroy==='function')c.destroy();}catch(e){}});
    window.charts={};
  }
  const{tc,gc}=chartDefaults();
  const _oc=document.getElementById('overviewChart');
  if(!_oc||_oc.offsetWidth===0||_oc.offsetParent===null)return;
  const ctx=_oc.getContext('2d');
  if(!ctx)return;
  // Gradient fill for revenue bars
  const revGrad=ctx.createLinearGradient(0,0,0,180);
  revGrad.addColorStop(0,'rgba(201,168,76,0.95)');
  revGrad.addColorStop(1,'rgba(201,168,76,0.55)');
  const expGrad=ctx.createLinearGradient(0,0,0,180);
  expGrad.addColorStop(0,darkMode?'rgba(58,46,30,0.9)':'rgba(180,160,120,0.5)');
  expGrad.addColorStop(1,darkMode?'rgba(35,29,22,0.6)':'rgba(200,185,155,0.25)');
  charts.overview=new Chart(ctx,{
    type:'bar',
    data:{labels:MONTHS,datasets:[
      {label:'Revenue', data:REV, backgroundColor:revGrad,borderRadius:5,borderSkipped:false,hoverBackgroundColor:'#e4c97a'},
      {label:'Expenses',data:EXP, backgroundColor:expGrad,borderRadius:5,borderSkipped:false,hoverBackgroundColor:darkMode?'rgba(80,60,35,0.9)':'rgba(210,195,165,0.7)'}
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,
      animation:{duration:250,easing:'easeOutQuart'},
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:darkMode?'rgba(22,18,13,0.95)':'rgba(255,252,245,0.97)',
          borderColor:darkMode?'rgba(201,168,76,0.3)':'rgba(158,122,42,0.2)',
          borderWidth:1,
          titleColor:darkMode?'#f2e8d5':'#1e1810',
          bodyColor:darkMode?'#9e8e73':'#6b5c42',
          padding:10,cornerRadius:6,
          callbacks:{label:ctx=>S(ctx.raw)}
        }
      },
      scales:{
        x:{grid:{color:gc},ticks:{color:tc,font:{size:11,family:'Jost'}},border:{display:false}},
        y:{grid:{color:gc},ticks:{color:tc,font:{size:11,family:'Jost'},callback:v=>'$'+Math.round(v/1000)+'k'},border:{display:false}}
      }
    }
  });
}

function buildCashChart(){
  if(typeof Chart==='undefined'){console.warn('Chart.js not loaded — cash chart skipped');return;}
  const{tc,gc}=chartDefaults();
  const _cc=document.getElementById('cashChart');
  if(!_cc||_cc.offsetWidth===0||_cc.offsetParent===null)return;
  const ctx=_cc.getContext('2d');
  if(!ctx)return;
  const _recentProfit=PROFIT.filter(v=>v!==0);
  const _hasData=_recentProfit.length>0;
  const _avgP=_hasData?_recentProfit.slice(-3).reduce((a,b)=>a+b,0)/Math.min(_recentProfit.slice(-3).length,3):0;
  const labels=[...MONTHS,'May \'26*','Jun \'26*','Jul \'26*'];
  const actual=[...PROFIT,null,null,null];
  const forecast=[...PROFIT.map(()=>null),_hasData?PROFIT[11]:null,_hasData?Math.round(_avgP*1.02):null,_hasData?Math.round(_avgP*1.04):null,_hasData?Math.round(_avgP*1.06):null];
  // Gradient fill under profit line
  const profitGrad=ctx.createLinearGradient(0,0,0,160);
  profitGrad.addColorStop(0,'rgba(201,168,76,0.22)');
  profitGrad.addColorStop(0.7,'rgba(201,168,76,0.04)');
  profitGrad.addColorStop(1,'rgba(201,168,76,0)');
  if(charts.cash){charts.cash.destroy();}
  charts.cash=new Chart(ctx,{
    type:'line',
    data:{labels,datasets:[
      {label:'Net profit',data:actual,  borderColor:'#c9a84c',borderWidth:2,backgroundColor:profitGrad,fill:true,tension:0.42,pointRadius:4,pointHoverRadius:6,pointBackgroundColor:'#c9a84c',pointBorderColor:darkMode?'#16120d':'#fff',pointBorderWidth:2},
      {label:'Forecast', data:forecast, borderColor:'#7db87d',borderWidth:2,borderDash:[6,4],tension:0.42,pointRadius:4,pointHoverRadius:6,pointBackgroundColor:'#7db87d',pointBorderColor:darkMode?'#16120d':'#fff',pointBorderWidth:2,fill:false}
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,
      animation:{duration:250,easing:'easeOutQuart'},
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:darkMode?'rgba(22,18,13,0.95)':'rgba(255,252,245,0.97)',
          borderColor:darkMode?'rgba(201,168,76,0.3)':'rgba(158,122,42,0.2)',
          borderWidth:1,
          titleColor:darkMode?'#f2e8d5':'#1e1810',
          bodyColor:darkMode?'#9e8e73':'#6b5c42',
          padding:10,cornerRadius:6,
          callbacks:{label:ctx=>ctx.raw!=null?S(Math.round(ctx.raw)):''}
        }
      },
      scales:{
        x:{grid:{color:gc},ticks:{color:tc,font:{size:11,family:'Jost'}},border:{display:false}},
        y:{grid:{color:gc},ticks:{color:tc,font:{size:11,family:'Jost'},callback:v=>'$'+Math.round(v/1000)+'k'},border:{display:false}}
      }
    }
  });
}

function updateCharts(d=getPeriodData()){
  if(!charts.overview)return;
  const{tc,gc}=chartDefaults();
  // Overview chart — show selected period data
  let labels,rev,exp;
  if(currentPeriod==='quarter'){
    labels=MONTHS.slice(9,12);rev=REV.slice(9,12);exp=EXP.slice(9,12);
  } else if(currentPeriod==='month'){
    labels=[MONTHS[currentMonthIdx]];rev=[REV[currentMonthIdx]];exp=[EXP[currentMonthIdx]];
  } else {
    labels=MONTHS;rev=REV;exp=EXP;
  }
  charts.overview.data.labels=labels;
  charts.overview.data.datasets[0].data=rev;
  charts.overview.data.datasets[1].data=exp;
  charts.overview.options.scales.x.ticks.color=tc;charts.overview.options.scales.y.ticks.color=tc;
  charts.overview.options.scales.x.grid.color=gc;charts.overview.options.scales.y.grid.color=gc;
  charts.overview.options.plugins.tooltip.callbacks.label=ctx=>S(ctx.raw);
  charts.overview.update();
  // Cash chart always shows full year + forecast
  if(charts.cash){
    charts.cash.options.scales.x.ticks.color=tc;charts.cash.options.scales.y.ticks.color=tc;
    charts.cash.options.scales.x.grid.color=gc;charts.cash.options.scales.y.grid.color=gc;
    charts.cash.update();
  }
}

// ════════════════════════════════════════════
// PDF EXPORT
// ════════════════════════════════════════════
function exportPDF(){
  const title = document.getElementById('pageTitle')?.textContent || document.querySelector('.page.active .card-title')?.textContent || 'FinFlow Report';
  const orig = document.title;
  document.title = title + ' — FinFlow';
  window.print();
  document.title = orig;
}

// ════════════════════════════════════════════
// NAV GROUPS (collapsible)
// ════════════════════════════════════════════
window.toggleGroup = function(name) {
  var grp = document.getElementById('nav-group-' + name);
  var arr = document.getElementById('arr-' + name);
  var hdr = document.getElementById('grp-' + name);
  if (!grp) return;
  var isOpen = grp.classList.contains('open');
  if (!isOpen) {
    grp.classList.add('open');
    grp.style.height = '';
    if (arr) arr.classList.add('open');
    if (hdr) { hdr.classList.add('active'); hdr.setAttribute('aria-expanded', 'true'); }
    // Scroll sidebar to show the header of the opened group
    setTimeout(function(){
      var hdrEl = document.getElementById('grp-' + name);
      if (hdrEl) hdrEl.scrollIntoView({behavior:'smooth', block:'start'});
    }, 50);
  } else {
    grp.classList.remove('open');
    grp.style.height = '';
    if (arr) arr.classList.remove('open');
    if (hdr) { hdr.classList.remove('active'); hdr.setAttribute('aria-expanded', 'false'); }
  }
};

// ════════════════════════════════════════════
// ITEMS PAGE
// ════════════════════════════════════════════
const itemsData=[];
let itemsFilter='all';
function renderItems(filter=itemsFilter){
  itemsFilter=filter;
  const list=document.getElementById('items-list');if(!list)return;
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  set('items-total',itemsData.length);
  set('items-active',itemsData.filter(i=>i.status==='Active').length);
  set('items-lowstock',itemsData.filter(i=>i.status==='Low Stock').length);
  const filtered=itemsData.filter(i=>filter==='all'||i.type.toLowerCase()===filter);
  if(!filtered.length){list.innerHTML='<div style="padding:1.5rem;text-align:center;color:var(--t3);font-size:13px">No items yet. Click + New item to add your products and services.</div>';return;}
  list.innerHTML=filtered.map((i,idx)=>`
    <div class="table-row" style="grid-template-columns:1fr 80px 80px 70px 80px 60px">
      <span style="font-weight:500">${esc(i.name)}<br><span style="font-size:11px;color:var(--t3)">${esc(i.sku)}</span></span>
      <span><span class="badge ${i.type==='Service'?'b-blue':'b-purple'}">${esc(i.type)}</span></span>
      <span style="font-family:var(--font-mono)">$${esc(i.price)}<span style="font-size:10px;color:var(--t3)">/${esc(i.unit)}</span></span>
      <span style="color:var(--t2)">${i.stock!==null?esc(i.stock)+' units':'—'}</span>
      <span><span class="badge ${i.status==='Active'?'b-green':i.status==='Low Stock'?'b-amber':'b-red'}">${esc(i.status)}</span></span>
      <div class="table-actions"><button class="btn btn-ghost btn-sm" data-item-name="${esc(i.name)}" onclick="notify('Edit item: '+this.dataset.itemName)">Edit</button></div>
    </div>`).join('');
}
function filterItems(f){itemsFilter=f;renderItems(f);}
function filterItemsBySearch(v){
  const list=document.getElementById('items-list');if(!list)return;
  const q=v.toLowerCase();
  const filtered=itemsData.filter(i=>i.name.toLowerCase().includes(q)||i.sku.toLowerCase().includes(q));
  list.innerHTML=filtered.map(i=>`<div class="table-row" style="grid-template-columns:1fr 80px 80px 70px 80px 60px"><span style="font-weight:500">${esc(i.name)}</span><span><span class="badge ${i.type==='Service'?'b-blue':'b-purple'}">${esc(i.type)}</span></span><span style="font-family:var(--font-mono)">$${esc(i.price)}</span><span>${i.stock!==null?esc(i.stock):'—'}</span><span><span class="badge ${i.status==='Active'?'b-green':'b-amber'}">${esc(i.status)}</span></span><div class="table-actions"><button class="btn btn-ghost btn-sm">Edit</button></div></div>`).join('');
}
function openNewItemModal(){notify('New Item modal — add your products & services');}

// ════════════════════════════════════════════
// BANKING PAGE
// ════════════════════════════════════════════
const bankAccounts=[]; // populated from DB via loadBankingFromDB()
let bankTxns=[];

async function loadBankingFromDB(){
  try {
    const res = await fetch('/api/banking',{credentials:'include'});
    if(!res.ok) return;
    const rows = await res.json();
    bankTxns = rows.map(r=>({
      _dbId: r.id,
      desc: r.description,
      amount: Math.abs(r.amount),
      type: r.type==='credit'?'credit':'debit',
      date: r.date ? new Date(r.date).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : 'Today',
      cat: r.category||'Other',
    }));
    if(typeof renderBanking==='function') renderBanking();
  } catch(e){ console.warn('[Banking] Load failed:',e.message); }
}

async function saveBankTxn(desc, amount, type, cat){
  try {
    const res = await fetch('/api/banking',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({desc, amount, type, cat, date:new Date().toISOString().slice(0,10)})});
    if(!res.ok) throw new Error('Save failed');
    await loadBankingFromDB();
    window.finflow?.refresh(['banking','dashboard','reports']);
  } catch(e){ if(typeof notify==='function') notify('Error saving transaction'); }
}
function renderBanking(){
  // KPI cards: Total Balance · Inflow (MTD) · Outflow (MTD) · Uncategorized
  const _bkSet = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  const _bkTotal = (bankAccounts||[]).reduce((s,a)=>s+(parseFloat(a.balance)||0),0);
  const _now = new Date(), _ym = _now.getFullYear()+'-'+String(_now.getMonth()+1).padStart(2,'0');
  const _bkMtd = (bankTxns||[]).filter(t => (t.date||'').startsWith(_ym));
  const _bkIn  = _bkMtd.filter(t => t.type==='credit').reduce((s,t)=>s+Math.abs(parseFloat(t.amount)||0),0);
  const _bkOut = _bkMtd.filter(t => t.type!=='credit').reduce((s,t)=>s+Math.abs(parseFloat(t.amount)||0),0);
  const _bkUncat = (bankTxns||[]).filter(t => !t.cat || /uncategor/i.test(t.cat)).length;
  _bkSet('bank-total-bal', S(_bkTotal));
  _bkSet('bank-inflow',    S(_bkIn));
  _bkSet('bank-outflow',   S(_bkOut));
  _bkSet('bank-uncat',     _bkUncat);
  window._refreshDashboardUI?.();
  const al=document.getElementById('bank-accounts-list');
  if(al)al.innerHTML=bankAccounts.map(a=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bd)">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:36px;height:36px;border-radius:var(--radius);background:var(--acc-bg);border:1px solid var(--acc2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--acc)">🏦</div>
        <div><div style="font-size:13px;font-weight:500;color:var(--t1)">${a.name}</div><div style="font-size:11px;color:var(--t3)">${a.bank} · ****${a.last4}</div></div>
      </div>
      <div style="text-align:right"><div style="font-size:14px;font-weight:600;font-family:var(--font-mono);color:var(--t1)">$${a.balance.toLocaleString()}</div><div style="font-size:10px;color:var(--t3)">${a.type} · ${a.updated}</div></div>
    </div>`).join('');
  const tl=document.getElementById('bank-txns-list');
  if(tl)tl.innerHTML=bankTxns.map(t=>`
    <div class="tx-row">
      <div class="tx-left">
        <div class="tx-icon" style="background:${t.type==='credit'?'var(--green-bg)':'var(--red-bg)'};color:${t.type==='credit'?'var(--green)':'var(--red)'}"><svg viewBox="0 0 16 16"><line x1="8" y1="3" x2="8" y2="13"/><polyline points="${t.type==='credit'?'4,9 8,13 12,9':'4,7 8,3 12,7'}"/></svg></div>
        <div><div class="tx-name">${esc(t.desc||'')}</div><div class="tx-cat">${esc(t.cat||'')} · ${esc(t.date||'')}</div></div>
      </div>
      <span class="tx-amt" style="color:${t.type==='credit'?'var(--green)':'var(--red)'}">${t.type==='credit'?'+':''}$${Math.abs(t.amount).toLocaleString()}</span>
    </div>`).join('');
}
function openAddAccountModal(){notify('Connect or add a bank account');}
function openAddTxnModal(){notify('Add manual transaction');}

// ════════════════════════════════════════════
// QUOTES, RECEIPTS, PAYMENTS RECEIVED, RECURRING INVOICES, CREDIT NOTES
// → fully wired in finflow-api-wiring-stubs.js and finflow-api-wiring-final5.js
// ════════════════════════════════════════════

// ════════════════════════════════════════════
// VENDORS, BILLS, PAYMENTS MADE, RECURRING BILLS, VENDOR CREDITS
// → fully wired in finflow-api-wiring-stubs.js and finflow-api-wiring-final5.js
// ════════════════════════════════════════════
// ════════════════════════════════════════════
// PROJECTS PAGE
// ════════════════════════════════════════════
const projectsData=[]; // populated from API by finflow-api-wiring-extra.js
function renderProjects(){
  const l=document.getElementById('projects-list');if(!l)return;
  l.innerHTML=projectsData.map(p=>`
    <div style="padding:10px 0;border-bottom:1px solid var(--bd)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div><div style="font-size:13px;font-weight:500;color:var(--t1)">${p.name}</div><div style="font-size:11px;color:var(--t3)">${p.client} · ${p.hours}h logged</div></div>
        <div style="display:flex;align-items:center;gap:12px">
          <div style="text-align:right"><div style="font-size:11px;color:var(--t3)">Billed / Budget</div><div style="font-size:12px;font-weight:600;font-family:var(--font-mono)">$${p.billed.toLocaleString()} / $${p.budget.toLocaleString()}</div></div>
          <span class="badge ${p.status==='Completed'?'b-green':'b-blue'}">${p.status}</span>
        </div>
      </div>
      <div class="bar-track" style="height:4px"><div class="bar-fill" style="width:${p.progress}%;background:${p.status==='Completed'?'var(--green)':'var(--acc)'}"></div></div>
    </div>`).join('');
}
function openNewProjectModal(){notify('New project modal');}

// ════════════════════════════════════════════
// TIMESHEET PAGE
// ════════════════════════════════════════════
const timesheetData=[]; // populated from API by finflow-api-wiring-extra.js
function renderTimesheet(){
  const l=document.getElementById('timesheet-list');if(!l)return;
  l.innerHTML=timesheetData.map(t=>`
    <div class="table-row" style="grid-template-columns:1fr 100px 80px 70px 70px 70px">
      <span style="font-weight:500">${t.employee}</span>
      <span style="color:var(--t2)">${t.project}</span>
      <span style="color:var(--t3)">${t.date}</span>
      <span style="font-family:var(--font-mono)">${t.hours} hrs</span>
      <span style="font-family:var(--font-mono);color:${t.billable>0?'var(--green)':'var(--t3)'}">${t.billable} hrs</span>
      <span style="font-family:var(--font-mono)">$${t.rate}/hr</span>
    </div>`).join('');
}
function openLogTimeModal(){notify('Log time entry');}

// ════════════════════════════════════════════
// MANUAL JOURNALS PAGE
// ════════════════════════════════════════════
const journalsData=[]; // populated from API by renderJournalsLive()
function renderJournals(){
  const l=document.getElementById('journals-list');if(!l)return;
  l.innerHTML=journalsData.map(j=>`
    <div class="table-row" style="grid-template-columns:90px 1fr 80px 80px 80px 70px">
      <span style="color:var(--t3)">${esc(j.date||'')}</span>
      <span style="font-weight:500">${esc(j.notes||'')}</span>
      <span style="color:var(--t3)">${esc(j.ref||'')}</span>
      <span style="font-family:var(--font-mono);color:var(--red)">$${(j.debit||0).toLocaleString()}</span>
      <span style="font-family:var(--font-mono);color:var(--green)">$${(j.credit||0).toLocaleString()}</span>
      <span><span class="badge ${j.status==='Posted'?'b-green':'b-amber'}">${j.status}</span></span>
    </div>`).join('');
}
function openNewJournalModal(){openJournalEntryModal();}

// ════════════════════════════════════════════
// CHART OF ACCOUNTS PAGE — empty until user creates accounts
// (Data loaded from /api/chart-of-accounts if/when wired by extra scripts.)
// ════════════════════════════════════════════
const coaData=[]; // populated by API wiring; no hardcoded demo data
function renderCOA(){
  const l=document.getElementById('coa-list');if(!l)return;
  if(!coaData.length){
    l.innerHTML='<div style="padding:1.5rem;text-align:center;color:var(--t3);font-size:13px">No accounts yet. Click "+ New account" to add your chart of accounts.</div>';
    return;
  }
  l.innerHTML=coaData.map(section=>`
    <div style="margin-bottom:1rem">
      <div style="font-size:11px;font-weight:700;color:var(--acc);text-transform:uppercase;letter-spacing:.1em;padding:.5rem 0;border-bottom:1px solid var(--bd)">${section.type}</div>
      ${section.accounts.map(a=>`
        <div style="display:grid;grid-template-columns:60px 1fr 80px 70px;gap:8px;padding:7px 0;border-bottom:1px solid var(--bd);font-size:12.5px">
          <span style="color:var(--t3);font-family:var(--font-mono)">${a.code}</span>
          <span style="color:var(--t1)">${a.name}</span>
          <span style="font-family:var(--font-mono);text-align:right;color:var(--t1)">$${(a.balance||0).toLocaleString()}</span>
          <span style="color:var(--t3);text-align:right">${a.nature}</span>
        </div>`).join('')}
    </div>`).join('');
}
function openNewAccountModal(){
  let m=document.getElementById('coa-new-modal');
  if(!m){
    m=document.createElement('div');
    m.id='coa-new-modal';
    m.className='modal-overlay hidden';
    m.innerHTML=`<div class="modal" style="max-width:380px">
      <div class="modal-header">
        <div><div class="modal-title">New account</div><div class="modal-sub">Add a chart-of-accounts entry</div></div>
        <button class="modal-close" onclick="document.getElementById('coa-new-modal').classList.add('hidden')"><svg viewBox="0 0 14 14"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg></button>
      </div>
      <div class="field-group">
        <div class="field-wrap"><label class="field-label">Code *</label><input class="finput" id="coa-code" placeholder="e.g. 1010"></div>
        <div class="field-wrap"><label class="field-label">Name *</label><input class="finput" id="coa-name" placeholder="e.g. Checking Account"></div>
      </div>
      <div class="field-group">
        <div class="field-wrap"><label class="field-label">Category *</label>
          <select class="finput" id="coa-cat">
            <option value="Assets">Assets</option>
            <option value="Liabilities">Liabilities</option>
            <option value="Equity">Equity</option>
            <option value="Revenue">Revenue</option>
            <option value="Expenses">Expenses</option>
          </select>
        </div>
        <div class="field-wrap"><label class="field-label">Nature</label>
          <select class="finput" id="coa-nature"><option value="Debit">Debit</option><option value="Credit">Credit</option></select>
        </div>
      </div>
      <div class="field-wrap"><label class="field-label">Opening balance</label><input class="finput" id="coa-balance" type="number" min="0" step="0.01" value="0"></div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="document.getElementById('coa-new-modal').classList.add('hidden')">Cancel</button>
        <button class="btn btn-primary" onclick="saveNewAccount()">Add account</button>
      </div>
    </div>`;
    document.body.appendChild(m);
  }
  document.getElementById('coa-code').value='';
  document.getElementById('coa-name').value='';
  document.getElementById('coa-cat').value='Assets';
  document.getElementById('coa-nature').value='Debit';
  document.getElementById('coa-balance').value='0';
  m.classList.remove('hidden');
}
async function saveNewAccount(){
  const code=document.getElementById('coa-code').value.trim();
  const name=document.getElementById('coa-name').value.trim();
  const category=document.getElementById('coa-cat').value;
  const nature=document.getElementById('coa-nature').value;
  const balance=parseFloat(document.getElementById('coa-balance').value)||0;
  if(!code||!name){notify('Code and name are required',true);return;}
  try{
    const r=await fetch('/api/chart-of-accounts',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,name,category,nature,balance})});
    if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||'API error');}
    document.getElementById('coa-new-modal').classList.add('hidden');
    notify('Account added ✦');
    window.finflow?.refresh(['journal','dashboard','reports','chart-of-accounts']);
    if(typeof renderCOA==='function')renderCOA();
  }catch(e){notify('Could not add account — '+e.message,true);}
}

// ════════════════════════════════════════════
// TRANSACTION LOCKING PAGE
// ════════════════════════════════════════════
const lockHistory=[]; // lock history loaded from /api/lock-settings
async function renderLockHistory(){
  const l=document.getElementById('lock-history');if(!l)return;
  try {
    const res=await fetch('/api/lock-settings',{credentials:'include'});
    if(!res.ok){l.innerHTML='';return;}
    const s=await res.json();
    if(s.enabled&&s.lock_date){
      document.getElementById('lock-enabled').checked=true;
      document.getElementById('lock-config').style.display='block';
      document.getElementById('lock-status-display').style.display='block';
      document.getElementById('lock-date').value=s.lock_date;
      document.getElementById('lock-date-display').textContent=new Date(s.lock_date+' 00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
    }
    // Show audit log entries related to lock
    const auditRes=await fetch('/api/audit-log?type=lock_settings&limit=10',{credentials:'include'});
    if(!auditRes.ok){l.innerHTML='';return;}
    const {rows}=await auditRes.json();
    l.innerHTML=rows.length?rows.map(h=>`
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--bd);font-size:12.5px">
        <div><span style="font-weight:500;color:var(--t1)">${esc(h.action)}</span></div>
        <div style="text-align:right;color:var(--t3)">${new Date(h.created_at).toLocaleDateString()}</div>
      </div>`).join(''):'<div style="padding:1rem;color:var(--t3);font-size:13px">No lock history yet</div>';
  } catch(e){l.innerHTML='';}
}
function toggleLocking(){
  const enabled=document.getElementById('lock-enabled').checked;
  document.getElementById('lock-config').style.display=enabled?'block':'none';
  document.getElementById('lock-status-display').style.display=enabled?'block':'none';
  if(enabled){
    const d=document.getElementById('lock-date').value||'2026-03-31';
    document.getElementById('lock-date-display').textContent=new Date(d).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  }
}
async function saveLockSettings(){
  const d=document.getElementById('lock-date').value;
  const pw=document.getElementById('lock-password').value;
  const enabled=document.getElementById('lock-enabled').checked;
  try {
    await fetch('/api/lock-settings',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({enabled,lock_date:d,password:pw||undefined})});
    if(enabled&&d) document.getElementById('lock-date-display').textContent=new Date(d+' 00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
    notify('Lock settings saved ✦');
    renderLockHistory();
  } catch(e){ notify('Failed to save lock settings'); }
}

// ════════════════════════════════════════════
// REPORTS PAGE
// ════════════════════════════════════════════
const reportsData=[
  {name:'Profit & Loss Statement',desc:'Income vs expenses for a period',icon:'📊'},
  {name:'Balance Sheet',desc:'Assets, liabilities and equity',icon:'⚖️'},
  {name:'Cash Flow Statement',desc:'Cash inflows and outflows',icon:'💰'},
  {name:'Accounts Receivable',desc:'Outstanding customer balances',icon:'📥'},
  {name:'Accounts Payable',desc:'Outstanding vendor balances',icon:'📤'},
  {name:'Sales by Customer',desc:'Revenue breakdown by client',icon:'👥'},
  {name:'Expense Report',desc:'Spending by category and vendor',icon:'🧾'},
  {name:'Payroll Summary',desc:'Staff costs and deductions',icon:'👔'},
];
const taxReportsData=[
  {name:'VAT Return',desc:'Tax collected and paid',icon:'🏛️'},
  {name:'Income Tax Estimate',desc:'Estimated quarterly taxes',icon:'📋'},
  {name:'1099 / W-2 Summary',desc:'Contractor and employee forms',icon:'📄'},
  {name:'Tax-Deductible Expenses',desc:'All deductible business costs',icon:'✅'},
];
async function renderReports(){
  const l=document.getElementById('reports-list');if(!l)return;
  // Fetch real totals for report summary
  let revenue=0,expenses=0,invoiceCount=0;
  try {
    const [invRes,expRes]=await Promise.all([
      fetch('/api/invoices',{credentials:'include'}),
      fetch('/api/expenses',{credentials:'include'}),
    ]);
    if(invRes.ok){const inv=await invRes.json();revenue=inv.filter(i=>i.status?.toLowerCase()==='paid').reduce((s,i)=>s+(i.amount||0),0);invoiceCount=inv.length;}
    if(expRes.ok){const exp=await expRes.json();expenses=exp.reduce((s,e)=>s+(e.amount||0),0);}
  } catch(e){}
  const profit=revenue-expenses;
  // Update stat cards
  const mc1=document.querySelector('#page-reports .mc-val');
  if(mc1)mc1.textContent=(reportsData.length+taxReportsData.length);
  l.innerHTML=reportsData.map(r=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--bd)">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:18px">${r.icon}</span>
        <div><div style="font-size:13px;font-weight:500;color:var(--t1)">${r.name}</div><div style="font-size:11px;color:var(--t3)">${r.desc}</div></div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="generateReport('${r.name}',${revenue},${expenses},${profit})">Generate ↗</button>
    </div>`).join('');
  const t=document.getElementById('tax-reports-list');if(!t)return;
  t.innerHTML=taxReportsData.map(r=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--bd)">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:18px">${r.icon}</span>
        <div><div style="font-size:13px;font-weight:500;color:var(--t1)">${r.name}</div><div style="font-size:11px;color:var(--t3)">${r.desc}</div></div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="generateReport('${r.name}',${revenue},${expenses},${profit})">Generate ↗</button>
    </div>`).join('');
}

async function generateReport(name,revenue,expenses,profit){
  const fmt=n=>'$'+(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.style.zIndex='1100';
  overlay.innerHTML=`<div class="modal" style="max-width:560px">
    <div class="modal-header"><div><div class="modal-title">${esc(name)}</div><div class="modal-sub">Generated ${new Date().toLocaleDateString()}</div></div>
    <button class="modal-close" onclick="this.closest('.modal-overlay').remove()"><svg viewBox="0 0 14 14"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg></button></div>
    <div id="_rpt-body"><div style="padding:2rem;text-align:center;color:var(--t3);font-size:13px">Loading…</div></div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="this.closest('.modal-overlay').remove()">Close</button><button class="btn btn-primary" onclick="notify('Export as PDF coming soon ✦')">Export PDF</button></div>
  </div>`;
  document.body.appendChild(overlay);
  const body=overlay.querySelector('#_rpt-body');
  const rowStyle='display:flex;justify-content:space-between;padding:4px 0;font-size:13px;border-bottom:1px solid var(--bd)';
  const hdr=label=>`<div style="font-size:11px;color:var(--t3);font-weight:600;text-transform:uppercase;letter-spacing:.08em;padding:8px 0 4px">${label}</div>`;
  try{
    if(name==='Profit & Loss Statement'){
      const d=await fetch('/api/reports/profit-loss',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json());
      const rows=(d.rows||[]).map(r=>`<div style="${rowStyle}"><span style="color:var(--t2)">${esc(r.month||'')}</span><span style="font-family:var(--font-mono);color:${r.netProfit>=0?'var(--green)':'var(--red)'}">${fmt(r.netProfit)}</span></div>`).join('');
      body.innerHTML=`${hdr('Revenue')}${(d.rows||[]).map(r=>`<div style="${rowStyle}"><span style="color:var(--t2)">${esc(r.month||'')}</span><span style="color:var(--green);font-family:var(--font-mono)">${fmt(r.revenue)}</span></div>`).join('')}
        <div style="${rowStyle};font-weight:600"><span>Total Revenue</span><span style="color:var(--green);font-family:var(--font-mono)">${fmt(d.totalRevenue)}</span></div>
        ${hdr('Expenses')}${(d.rows||[]).map(r=>`<div style="${rowStyle}"><span style="color:var(--t2)">${esc(r.month||'')}</span><span style="color:var(--red);font-family:var(--font-mono)">${fmt(r.expenses)}</span></div>`).join('')}
        <div style="${rowStyle};font-weight:600"><span>Total Expenses</span><span style="color:var(--red);font-family:var(--font-mono)">${fmt(d.totalExpenses)}</span></div>
        <div style="margin-top:10px;padding-top:8px;border-top:2px solid var(--bd);display:flex;justify-content:space-between;font-size:14px;font-weight:700"><span>Net Profit</span><span style="color:${(d.netProfit||0)>=0?'var(--green)':'var(--red)'};font-family:var(--font-mono)">${fmt(d.netProfit)}</span></div>`;
    } else if(name==='Balance Sheet'){
      const d=await fetch('/api/reports/balance-sheet',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json());
      body.innerHTML=`${hdr('Assets')}
        <div style="${rowStyle}"><span style="color:var(--t2)">Cash & Equivalents</span><span style="font-family:var(--font-mono);color:var(--green)">${fmt(d.cash)}</span></div>
        <div style="${rowStyle}"><span style="color:var(--t2)">Accounts Receivable</span><span style="font-family:var(--font-mono);color:var(--green)">${fmt(d.accountsReceivable)}</span></div>
        <div style="${rowStyle};font-weight:600"><span>Total Assets</span><span style="font-family:var(--font-mono);color:var(--green)">${fmt(d.totalAssets)}</span></div>
        ${hdr('Liabilities')}
        <div style="${rowStyle}"><span style="color:var(--t2)">Accounts Payable</span><span style="font-family:var(--font-mono);color:var(--red)">${fmt(d.accountsPayable)}</span></div>
        <div style="${rowStyle};font-weight:600"><span>Total Liabilities</span><span style="font-family:var(--font-mono);color:var(--red)">${fmt(d.totalLiabilities)}</span></div>
        <div style="margin-top:10px;padding-top:8px;border-top:2px solid var(--bd);display:flex;justify-content:space-between;font-size:14px;font-weight:700"><span>Equity</span><span style="color:${(d.equity||0)>=0?'var(--green)':'var(--red)'};font-family:var(--font-mono)">${fmt(d.equity)}</span></div>`;
    } else if(name==='Cash Flow Statement'){
      const d=await fetch('/api/reports/cash-flow',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json());
      const rows=(d.rows||[]).map(r=>`<div style="${rowStyle}"><span style="color:var(--t2)">${esc(r.month||'')}</span><span style="color:var(--t2);font-family:var(--font-mono)">${fmt(r.inflow)} in / ${fmt(r.outflow)} out</span><span style="font-family:var(--font-mono);color:${r.net>=0?'var(--green)':'var(--red)'}">${fmt(r.net)}</span></div>`).join('');
      body.innerHTML=`${hdr('Monthly Cash Flow')}${rows||'<div style="padding:8px 0;color:var(--t3);font-size:12px">No data yet</div>'}
        <div style="margin-top:10px;padding-top:8px;border-top:2px solid var(--bd);display:flex;justify-content:space-between;font-size:13px;font-weight:600"><span>Net Cash Flow</span><span style="color:${((d.totalInflow||0)-(d.totalOutflow||0))>=0?'var(--green)':'var(--red)'};font-family:var(--font-mono)">${fmt((d.totalInflow||0)-(d.totalOutflow||0))}</span></div>`;
    } else {
      body.innerHTML=`<div style="padding:1.5rem;text-align:center;color:var(--t3);font-size:13px">${esc(name)} report is not yet available.</div>`;
    }
  }catch(err){
    body.innerHTML=`<div style="padding:1.5rem;text-align:center;color:var(--red);font-size:13px">Error loading report: ${esc(err.message||'unknown error')}</div>`;
  }
}

// ════════════════════════════════════════════
// DOCUMENTS PAGE
// ════════════════════════════════════════════
const documentsData=[]; // not used — renderDocuments() fetches from /api/documents
let docsFilter='all';
let _docsCache=[];
async function renderDocuments(){
  const l=document.getElementById('documents-list');if(!l)return;
  l.innerHTML='<div style="padding:1rem;text-align:center;color:var(--t3);font-size:13px">Loading…</div>';
  try{
    const res=await fetch('/api/documents',{credentials:'include'});
    if(!res.ok)throw new Error();
    _docsCache=await res.json();
  }catch(e){_docsCache=[];}
  const filtered=docsFilter==='all'?_docsCache:_docsCache.filter(d=>d.type===docsFilter);
  if(!filtered.length){l.innerHTML='<div style="padding:1rem;text-align:center;color:var(--t3);font-size:13px">No documents yet. Click Upload to add your first file.</div>';return;}
  l.innerHTML=filtered.map(d=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bd)">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:32px;height:32px;border-radius:var(--radius);background:var(--acc-bg);border:1px solid var(--acc2);display:flex;align-items:center;justify-content:center;font-size:14px">${(d.name||'').endsWith('.pdf')?'📄':'📊'}</div>
        <div><div style="font-size:13px;font-weight:500;color:var(--t1)">${d.name||''}</div><div style="font-size:11px;color:var(--t3)">${d.size||''} · ${d.uploaded_at?d.uploaded_at.slice(0,10):''} · ${d.type||''}</div></div>
      </div>
      <div style="display:flex;gap:6px">
        <span class="badge b-blue">${d.type||'file'}</span>
        <button class="btn btn-ghost btn-sm" onclick="downloadDoc(${d.id})" title="Download">↓</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteDoc(${d.id})" title="Delete">✕</button>
      </div>
    </div>`).join('');
}
function filterDocs(f){docsFilter=f;renderDocuments();}
async function downloadDoc(id){window.open('/api/documents/'+id+'/download','_blank');}
async function deleteDoc(id){
  if(!confirm('Delete this document?'))return;
  const res=await fetch('/api/documents/'+id,{method:'DELETE',credentials:'include'});
  if(res.ok){ renderDocuments(); window.finflow?.refresh(['documents','dashboard']); }else notify('Delete failed');
}
function openUploadModal(){
  let m=document.getElementById('doc-upload-modal');
  if(!m){
    m=document.createElement('div');
    m.id='doc-upload-modal';
    m.className='modal-overlay';
    m.innerHTML=`<div class="modal" style="width:420px">
      <div class="modal-header"><span class="modal-title">Upload Document</span><button class="modal-close" onclick="closeModal('doc-upload-modal')">✕</button></div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
        <div><label class="field-label">File (max 5 MB)</label><input type="file" id="doc-file-input" class="finput" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv,.docx"></div>
        <div><label class="field-label">Document type</label>
          <select id="doc-type-input" class="finput"><option>invoice</option><option>receipt</option><option>contract</option><option>quote</option><option>report</option><option>other</option></select></div>
        <div><label class="field-label">Notes (optional)</label><input id="doc-notes-input" class="finput" placeholder="e.g. Linked to INV-0042"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal('doc-upload-modal')">Cancel</button><button class="btn btn-primary" onclick="uploadDocument()">Upload</button></div>
    </div>`;
    document.body.appendChild(m);
  }
  const fi=document.getElementById('doc-file-input');if(fi)fi.value='';
  const ni=document.getElementById('doc-notes-input');if(ni)ni.value='';
  m.style.display='flex';
}
async function uploadDocument(){
  const fileInput=document.getElementById('doc-file-input');
  if(!fileInput||!fileInput.files.length){notify('Please select a file');return;}
  const file=fileInput.files[0];
  if(file.size>5*1024*1024){notify('File must be under 5 MB');return;}
  const reader=new FileReader();
  reader.onload=async function(e){
    const b64=e.target.result.split(',')[1];
    try{
      const res=await fetch('/api/documents',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name:file.name,type:document.getElementById('doc-type-input').value,
          size:Math.round(file.size/1024)+' KB',notes:document.getElementById('doc-notes-input').value,
          file_data:b64,media_type:file.type})});
      if(!res.ok){const d=await res.json();notify(d.error||'Upload failed');return;}
      closeModal('doc-upload-modal');renderDocuments();window.finflow?.refresh(['documents','dashboard']);notify('Document uploaded ✦');
    }catch(e){notify('Upload failed');}
  };
  reader.readAsDataURL(file);
}

// ════════════════════════════════════════════
// ════════════════════════════════════════════
// TEMPLATES PAGE
// ════════════════════════════════════════════
const invTemplatesData=[
  {id:'classic',name:'Classic Professional',type:'Invoice',preview:'Clean two-column layout',default:true,
   accentColor:'#c8a44a',font:'serif'},
  {id:'minimal', name:'Modern Minimal',type:'Invoice',preview:'Bold header, clean lines',default:false,
   accentColor:'#5aaa9e',font:'sans'},
  {id:'receipt', name:'Compact Receipt',type:'Invoice',preview:'Single page receipt format',default:false,
   accentColor:'#9e8fbf',font:'mono'},
  {id:'retainer',name:'Retainer Agreement',type:'Quote',preview:'Multi-page quote with terms',default:true,
   accentColor:'#c8a44a',font:'serif'},
];
const emailTemplatesData=[
  {name:'Invoice Reminder (7 days)',trigger:'Auto — 7 days after due'},
  {name:'Payment Received',trigger:'Auto — on payment'},
  {name:'Quote Follow-up',trigger:'Auto — 3 days after sending'},
  {name:'Welcome — New Client',trigger:'Manual'},
  {name:'Overdue Notice',trigger:'Auto — 14 days overdue'},
  {name:'Monthly Statement',trigger:'Auto — 1st of month'},
];

// Per-template settings (logo, color, poweredBy)
const templateSettings = {};

function getTemplateSetting(id, key, fallback){
  return (templateSettings[id]||{})[key] ?? fallback;
}
function setTemplateSetting(id, key, value){
  if(!templateSettings[id]) templateSettings[id]={};
  templateSettings[id][key]=value;
}

function renderTemplates(){
  const il=document.getElementById('inv-templates-list');
  if(il)il.innerHTML=invTemplatesData.map(t=>`
    <div style="padding:10px 0;border-bottom:1px solid var(--bd)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <div style="min-width:0">
          <div style="font-size:13px;font-weight:500;color:var(--t1)">${t.name} ${t.default?'<span class="badge b-green" style="font-size:9px">Default</span>':''}</div>
          <div style="font-size:11px;color:var(--t3)">${t.type} · ${t.preview}</div>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0">
          <button class="btn btn-ghost btn-sm" onclick="openTemplatePreview('${t.id}')">Preview</button>
          <button class="btn btn-primary btn-sm" onclick="openTemplateEditor('${t.id}')">Edit</button>
        </div>
      </div>
    </div>`).join('');
  const el=document.getElementById('email-templates-list');
  if(el)el.innerHTML=emailTemplatesData.map(t=>`
    <div style="padding:9px 0;border-bottom:1px solid var(--bd)">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div><div style="font-size:13px;font-weight:500;color:var(--t1)">${t.name}</div><div style="font-size:11px;color:var(--t3)">${t.trigger}</div></div>
        <button class="btn btn-ghost btn-sm" onclick="openEmailTemplateEditor('${t.name}')">Edit</button>
      </div>
    </div>`).join('');
}

// ── INVOICE HTML RENDERER ─────────────────────────────────────────
function buildInvoiceHTML(templateId, logoDataURL, settings){
  const t = invTemplatesData.find(x=>x.id===templateId) || invTemplatesData[0];
  const acc = settings.accentColor || t.accentColor;
  const bizName = document.getElementById('s-biz-name')?.value || 'FinFlow Inc.';
  const bizEmail = document.getElementById('s-email')?.value || '';
  const poweredBy = settings.poweredBy !== false;
  const logoHTML = logoDataURL
    ? `<img src="${logoDataURL}" style="max-height:52px;max-width:160px;object-fit:contain">`
    : `<div style="font-size:22px;font-weight:700;color:${acc};font-family:Georgia,serif;font-style:italic">${bizName}</div>`;

  const items = [
    {desc:'Product design & strategy',qty:1,rate:4800,total:4800},
    {desc:'Frontend development (40h)',qty:40,rate:120,total:4800},
    {desc:'QA testing & delivery',qty:1,rate:900,total:900},
  ];
  const subtotal = items.reduce((s,i)=>s+i.total,0);
  const tax = Math.round(subtotal*0.125);
  const total = subtotal+tax;

  const itemRows = items.map(i=>`
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #eee;color:#333">${i.desc}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:center;color:#666">${i.qty}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right;color:#666">$${i.rate.toLocaleString()}</td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;color:#333;font-weight:500">$${i.total.toLocaleString()}</td>
    </tr>`).join('');

  const poweredByHTML = poweredBy
    ? `<div style="text-align:center;margin-top:32px;padding-top:16px;border-top:1px solid #eee">
        <span style="font-size:10px;color:#bbb;letter-spacing:.08em">POWERED BY </span>
        <span style="font-size:10px;font-weight:700;color:${acc};letter-spacing:.06em;font-family:Georgia,serif;font-style:italic">FinFlow</span>
       </div>` : '';

  if(t.id==='receipt'){
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:monospace;background:#fff;padding:24px;max-width:420px;margin:0 auto;color:#222;font-size:12px}
    .hdr{text-align:center;border-bottom:2px dashed #ccc;padding-bottom:12px;margin-bottom:12px}
    .row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #eee}
    .total{font-size:15px;font-weight:700;border-top:2px dashed #ccc;padding-top:8px;margin-top:4px}
    </style></head><body>
    <div class="hdr">${logoHTML}<div style="margin-top:8px;font-size:10px;color:#888">${bizEmail}</div>
    <div style="margin-top:8px;font-size:11px;font-weight:700">RECEIPT #INV-1042</div>
    <div style="font-size:10px;color:#888">April 28, 2026 · TechCorp Inc.</div></div>
    ${items.map(i=>`<div class="row"><span>${i.desc}</span><span>$${i.total.toLocaleString()}</span></div>`).join('')}
    <div class="row" style="color:#888;margin-top:4px"><span>Subtotal</span><span>$${subtotal.toLocaleString()}</span></div>
    <div class="row" style="color:#888"><span>Tax (12.5%)</span><span>$${tax.toLocaleString()}</span></div>
    <div class="row total"><span>TOTAL</span><span style="color:${acc}">$${total.toLocaleString()}</span></div>
    <div style="text-align:center;margin-top:16px;font-size:10px;color:#aaa">Thank you for your business</div>
    ${poweredByHTML}
    </body></html>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:${t.font==='mono'?'monospace':t.font==='sans'?'Arial,sans-serif':"Georgia,'Times New Roman',serif"};background:#fff;padding:48px;color:#222}
  table{width:100%;border-collapse:collapse}th{padding:8px 0;border-bottom:2px solid ${acc};text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#888;font-weight:600}
  </style></head><body>
  ${t.id==='minimal'
    ? `<div style="background:${acc};padding:28px 32px;margin:-48px -48px 36px;display:flex;align-items:center;justify-content:space-between">
        <div>${logoHTML}</div>
        <div style="text-align:right;color:#fff"><div style="font-size:24px;font-weight:800;letter-spacing:-.02em">INVOICE</div><div style="opacity:.8;font-size:13px">#INV-1042</div></div>
       </div>`
    : `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:36px">
        <div>${logoHTML}</div>
        <div style="text-align:right">
          <div style="font-size:28px;font-weight:300;color:${acc};letter-spacing:.04em;font-style:italic">INVOICE</div>
          <div style="font-size:12px;color:#888;margin-top:4px">#INV-1042 · April 28, 2026</div>
        </div>
       </div>`}
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:32px">
    <div>
      <div style="font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">From</div>
      <div style="font-weight:600;font-size:14px">${bizName}</div>
      <div style="color:#888;font-size:12px;margin-top:4px">${bizEmail}<br>New York, NY 10001</div>
    </div>
    <div>
      <div style="font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Bill to</div>
      <div style="font-weight:600;font-size:14px">TechCorp Inc.</div>
      <div style="color:#888;font-size:12px;margin-top:4px">accounts@techcorp.io<br>San Francisco, CA 94102</div>
    </div>
  </div>
  <table>
    <thead><tr><th>Description</th><th style="text-align:center;width:60px">Qty</th><th style="text-align:right;width:80px">Rate</th><th style="text-align:right;width:90px">Amount</th></tr></thead>
    <tbody>${itemRows}</tbody>
  </table>
  <div style="display:flex;justify-content:flex-end;margin-top:24px">
    <div style="width:220px">
      <div style="display:flex;justify-content:space-between;padding:6px 0;color:#888;font-size:13px"><span>Subtotal</span><span>$${subtotal.toLocaleString()}</span></div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;color:#888;font-size:13px"><span>Tax (12.5%)</span><span>$${tax.toLocaleString()}</span></div>
      <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:2px solid ${acc};font-weight:700;font-size:16px"><span>Total</span><span style="color:${acc}">$${total.toLocaleString()}</span></div>
    </div>
  </div>
  <div style="margin-top:36px;padding:16px;background:#f9f9f9;border-radius:6px;font-size:12px;color:#888">
    <strong style="color:#333">Payment terms:</strong> Due within 30 days · Bank transfer or card accepted via client portal
  </div>
  ${poweredByHTML}
  </body></html>`;
}

// ── TEMPLATE PREVIEW MODAL ────────────────────────────────────────
window.openTemplatePreview = function(id){
  const t = invTemplatesData.find(x=>x.id===id);
  if(!t) return;
  const logo = getTemplateSetting(id,'logo',null);
  const settings = {
    accentColor: getTemplateSetting(id,'accentColor', t.accentColor),
    poweredBy: getTemplateSetting(id,'poweredBy', true),
  };
  const html = buildInvoiceHTML(id, logo, settings);

  const existing = document.getElementById('tmpl-preview-overlay');
  if(existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'tmpl-preview-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:3000;display:flex;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(4px)';
  overlay.innerHTML=`
    <div style="background:var(--bg1);border:1px solid var(--bd2);border-radius:var(--radius-xl);width:100%;max-width:780px;max-height:90vh;display:flex;flex-direction:column;box-shadow:var(--shadow-lg);overflow:hidden">
      <div style="padding:.85rem 1.25rem;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
        <div style="font-size:14px;font-weight:500;color:var(--t1)">Preview — ${t.name}</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost btn-sm" onclick="openTemplateEditor('${id}');document.getElementById('tmpl-preview-overlay').remove()">Edit template</button>
          <button class="btn btn-ghost btn-sm" onclick="printTemplate('${id}')">⬇ Download PDF</button>
          <button onclick="document.getElementById('tmpl-preview-overlay').remove()" style="padding:5px 10px;background:none;border:1px solid var(--bd2);border-radius:var(--radius);cursor:pointer;color:var(--t2);font-family:var(--font);font-size:12px">✕ Close</button>
        </div>
      </div>
      <div style="flex:1;overflow:auto;background:#e8e8e8;padding:16px">
        <iframe id="tmpl-preview-frame" title="Invoice template preview" style="width:100%;min-height:700px;border:none;border-radius:6px;box-shadow:0 4px 24px rgba(0,0,0,.2);background:#fff" srcdoc="${html.replace(/"/g,'&quot;')}"></iframe>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e=>{ if(e.target===overlay) overlay.remove(); });
};

window.printTemplate = function(id){
  const t = invTemplatesData.find(x=>x.id===id);
  const logo = getTemplateSetting(id,'logo',null);
  const settings = {
    accentColor: getTemplateSetting(id,'accentColor', t?.accentColor||'#c8a44a'),
    poweredBy: getTemplateSetting(id,'poweredBy', true),
  };
  const html = buildInvoiceHTML(id, logo, settings);
  const win = window.open('','_blank');
  if(win){ win.document.write(html); win.document.close(); setTimeout(()=>win.print(),500); }
};

// ── TEMPLATE EDITOR MODAL ─────────────────────────────────────────
window.openTemplateEditor = function(id){
  const t = invTemplatesData.find(x=>x.id===id);
  if(!t) return;

  const existing = document.getElementById('tmpl-editor-overlay');
  if(existing) existing.remove();

  const currentLogo = getTemplateSetting(id,'logo',null);
  const currentColor = getTemplateSetting(id,'accentColor', t.accentColor);
  const currentPoweredBy = getTemplateSetting(id,'poweredBy', true);

  const overlay = document.createElement('div');
  overlay.id = 'tmpl-editor-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:3000;display:flex;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(4px)';
  overlay.innerHTML=`
    <div style="background:var(--bg1);border:1px solid var(--bd2);border-radius:var(--radius-xl);width:100%;max-width:820px;max-height:92vh;display:flex;flex-direction:column;box-shadow:var(--shadow-lg);overflow:hidden">
      <div style="padding:.85rem 1.25rem;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
        <div style="font-size:14px;font-weight:500;color:var(--t1)">Edit — ${t.name}</div>
        <button onclick="document.getElementById('tmpl-editor-overlay').remove()" style="padding:5px 10px;background:none;border:1px solid var(--bd2);border-radius:var(--radius);cursor:pointer;color:var(--t2);font-family:var(--font);font-size:12px">✕ Close</button>
      </div>
      <div style="display:grid;grid-template-columns:280px 1fr;flex:1;overflow:hidden">

        <!-- LEFT: SETTINGS PANEL -->
        <div style="border-right:1px solid var(--bd);padding:1.25rem;overflow-y:auto;display:flex;flex-direction:column;gap:1.25rem">

          <!-- LOGO UPLOAD -->
          <div>
            <div style="font-size:11px;font-weight:600;color:var(--t2);text-transform:uppercase;letter-spacing:.1em;margin-bottom:.65rem">Your logo</div>
            <div id="logo-preview-${id}" style="min-height:64px;background:var(--bg2);border:2px dashed var(--bd2);border-radius:var(--radius);display:flex;align-items:center;justify-content:center;margin-bottom:8px;overflow:hidden;cursor:pointer;transition:border-color .15s" onclick="document.getElementById('logo-file-${id}').click()" onmouseover="this.style.borderColor='var(--acc)'" onmouseout="this.style.borderColor='var(--bd2)'">
              ${currentLogo
                ? `<img src="${currentLogo}" alt="Business logo" width="220" height="56" style="max-height:56px;max-width:220px;object-fit:contain;padding:8px">`
                : `<div style="text-align:center;color:var(--t3);font-size:12px;padding:12px"><div style="font-size:20px;margin-bottom:4px">🖼</div>Click to upload logo</div>`}
            </div>
            <input type="file" id="logo-file-${id}" accept="image/*" style="display:none" onchange="handleLogoUpload('${id}',this)">
            <div style="display:flex;gap:6px">
              <button class="btn btn-ghost btn-sm" style="flex:1;justify-content:center" onclick="document.getElementById('logo-file-${id}').click()">Upload logo</button>
              <button class="btn btn-ghost btn-sm" onclick="removeLogo('${id}')" style="color:var(--red)">Remove</button>
            </div>
            <div style="font-size:10.5px;color:var(--t3);margin-top:6px">PNG or SVG recommended · Max 2MB · Transparent background works best</div>
          </div>

          <!-- ACCENT COLOUR -->
          <div>
            <div style="font-size:11px;font-weight:600;color:var(--t2);text-transform:uppercase;letter-spacing:.1em;margin-bottom:.65rem">Accent colour</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
              ${['#c8a44a','#5aaa9e','#9e8fbf','#7db87d','#b86050','#3266ad','#222222'].map(c=>`
                <div onclick="setTemplateColor('${id}','${c}')" title="${c}" style="width:26px;height:26px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${c===currentColor?'var(--t1)':'transparent'};transition:border .15s;flex-shrink:0" id="color-swatch-${id}-${c.replace('#','')}"></div>`).join('')}
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <input type="color" id="color-picker-${id}" aria-label="Accent colour" value="${currentColor}" oninput="setTemplateColor('${id}',this.value)" style="width:32px;height:32px;border:1px solid var(--bd2);border-radius:var(--radius);cursor:pointer;background:none;padding:1px">
              <input class="finput" id="color-hex-${id}" value="${currentColor}" placeholder="#c8a44a" style="font-family:var(--font-mono);font-size:12px" oninput="setTemplateColor('${id}',this.value)">
            </div>
          </div>

          <!-- POWERED BY -->
          <div>
            <div style="font-size:11px;font-weight:600;color:var(--t2);text-transform:uppercase;letter-spacing:.1em;margin-bottom:.65rem">Branding</div>
            <div style="display:flex;align-items:center;justify-content:space-between;padding:.65rem .85rem;background:var(--bg2);border:1px solid var(--bd);border-radius:var(--radius)">
              <div>
                <div style="font-size:12.5px;font-weight:500;color:var(--t1)">Powered by FinFlow</div>
                <div style="font-size:11px;color:var(--t3)">Shown at the bottom of the invoice</div>
              </div>
              <label class="toggle">
                <input type="checkbox" id="powered-by-${id}" aria-label="Show Powered by FinFlow on invoice" ${currentPoweredBy?'checked':''} onchange="setTemplatePoweredBy('${id}',this.checked)">
                <div class="toggle-track"></div>
                <div class="toggle-thumb"></div>
              </label>
            </div>
            <div style="margin-top:8px;padding:.65rem .85rem;background:var(--acc-bg);border:1px solid var(--acc2);border-radius:var(--radius)">
              <div style="font-size:11px;color:var(--acc);font-style:italic">Preview of footer badge:</div>
              <div style="margin-top:4px;font-size:11px;color:#888;letter-spacing:.06em">POWERED BY <span style="font-weight:700;color:${currentColor};font-family:Georgia,serif;font-style:italic">FinFlow</span></div>
            </div>
          </div>

          <!-- SAVE -->
          <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="saveTemplateSettings('${id}')">Save &amp; update preview</button>
        </div>

        <!-- RIGHT: LIVE PREVIEW -->
        <div style="background:#e8e8e8;padding:16px;overflow-y:auto;display:flex;flex-direction:column;gap:8px">
          <div style="font-size:11px;color:#888;text-align:center">Live preview — updates as you edit</div>
          <iframe id="tmpl-edit-preview-${id}" title="Invoice template edit preview" style="width:100%;min-height:640px;border:none;border-radius:6px;box-shadow:0 4px 24px rgba(0,0,0,.2);background:#fff"
            srcdoc="${buildInvoiceHTML(id, currentLogo, {accentColor:currentColor,poweredBy:currentPoweredBy}).replace(/"/g,'&quot;')}"></iframe>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e=>{ if(e.target===overlay) overlay.remove(); });
};

// ── TEMPLATE EDITOR ACTIONS ───────────────────────────────────────
window.handleLogoUpload = function(id, input){
  const file = input.files[0];
  if(!file) return;
  if(file.size > 2*1024*1024){ notify('Logo must be under 2MB', true); return; }
  const reader = new FileReader();
  reader.onload = e=>{
    const dataURL = e.target.result;
    setTemplateSetting(id,'logo',dataURL);
    // Update preview box
    const prev = document.getElementById('logo-preview-'+id);
    if(!dataURL || !dataURL.startsWith('data:image/')) { notify('Invalid image file', true); return; }
    if(prev) prev.innerHTML=`<img src="${dataURL}" alt="Uploaded logo" width="220" height="56" style="max-height:56px;max-width:220px;object-fit:contain;padding:8px">`;
    refreshEditorPreview(id);
    notify('Logo uploaded ✦');
  };
  reader.readAsDataURL(file);
};

window.removeLogo = function(id){
  setTemplateSetting(id,'logo',null);
  const prev = document.getElementById('logo-preview-'+id);
  if(prev) prev.innerHTML=`<div style="text-align:center;color:var(--t3);font-size:12px;padding:12px"><div style="font-size:20px;margin-bottom:4px">🖼</div>Click to upload logo</div>`;
  refreshEditorPreview(id);
  notify('Logo removed');
};

window.setTemplateColor = function(id, color){
  if(!/^#[0-9a-fA-F]{3,6}$/.test(color)) return;
  setTemplateSetting(id,'accentColor',color);
  const hex = document.getElementById('color-hex-'+id);
  const picker = document.getElementById('color-picker-'+id);
  if(hex) hex.value=color;
  if(picker) picker.value=color;
  // Update swatch borders
  document.querySelectorAll(`[id^="color-swatch-${id}-"]`).forEach(sw=>{
    sw.style.border = sw.style.background===color ? '2px solid var(--t1)' : '2px solid transparent';
  });
  // Update powered-by preview text color
  const badge = document.getElementById('tmpl-editor-overlay')?.querySelector('[style*="FinFlow"]');
  if(badge) badge.style.color=color;
  refreshEditorPreview(id);
};

window.setTemplatePoweredBy = function(id, checked){
  setTemplateSetting(id,'poweredBy',checked);
  refreshEditorPreview(id);
};

function refreshEditorPreview(id){
  const t = invTemplatesData.find(x=>x.id===id);
  if(!t) return;
  const logo = getTemplateSetting(id,'logo',null);
  const settings = {
    accentColor: getTemplateSetting(id,'accentColor', t.accentColor),
    poweredBy: getTemplateSetting(id,'poweredBy', true),
  };
  const html = buildInvoiceHTML(id, logo, settings);
  const frame = document.getElementById('tmpl-edit-preview-'+id);
  if(frame) frame.srcdoc = html;
}

window.saveTemplateSettings = function(id){
  refreshEditorPreview(id);
  notify('Template saved ✦');
};

window.openEmailTemplateEditor = function(name){
  const existing = document.getElementById('email-tmpl-editor');
  if(existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id='email-tmpl-editor';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:3000;display:flex;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(4px)';
  overlay.innerHTML=`
    <div style="background:var(--bg1);border:1px solid var(--bd2);border-radius:var(--radius-xl);width:100%;max-width:560px;box-shadow:var(--shadow-lg);overflow:hidden">
      <div style="padding:.85rem 1.25rem;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:14px;font-weight:500;color:var(--t1)">Edit — ${name}</div>
        <button onclick="document.getElementById('email-tmpl-editor').remove()" style="padding:5px 10px;background:none;border:1px solid var(--bd2);border-radius:var(--radius);cursor:pointer;color:var(--t2);font-family:var(--font);font-size:12px">✕ Close</button>
      </div>
      <div style="padding:1.25rem;display:flex;flex-direction:column;gap:1rem">
        <div class="field-wrap"><label class="field-label">Subject line</label><input class="finput" aria-label="Email subject line" value="Invoice {{invoice_number}} — Payment due {{due_date}}"></div>
        <div class="field-wrap"><label class="field-label">Email body</label>
          <textarea class="finput" aria-label="Email body" rows="7" style="resize:vertical;line-height:1.6">Hi {{client_name}},

Please find your invoice {{invoice_number}} for {{amount}} attached.
Payment is due by {{due_date}}.

You can view and pay your invoice online:
{{portal_link}}

Thank you for your business,
{{business_name}}</textarea>
        </div>
        <div style="font-size:11px;color:var(--t3)">Available variables: {{client_name}} {{invoice_number}} {{amount}} {{due_date}} {{portal_link}} {{business_name}}</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="document.getElementById('email-tmpl-editor').remove();notify('Email template saved ✦')">Save template</button>
          <button class="btn btn-ghost" onclick="notify('Test email sent to your address ✦')">Send test</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
};

function openNewTemplateModal(){
  notify('Template builder — choose a base style to start ✦');
  // Just open the classic editor as a starting point
  setTimeout(()=>openTemplateEditor('classic'),300);
}
function openNewEmailTemplateModal(){ openEmailTemplateEditor('New Email Template'); }

// ════════════════════════════════════════════
// CLOSE MODALS ON OVERLAY CLICK
// ════════════════════════════════════════════
document.querySelectorAll('.modal-overlay').forEach(el=>{
  el.addEventListener('click',function(e){if(e.target===this)this.classList.add('hidden')});
});

// ── Global ESC closes open modal overlays and AI panel ──────────
document.addEventListener('keydown', function(e){
  if(e.key !== 'Escape') return;
  // Close any open modal overlay
  const openOverlay = document.querySelector('.modal-overlay:not(.hidden)');
  if(openOverlay){ openOverlay.classList.add('hidden'); if(_modalFocusCleanup){_modalFocusCleanup();_modalFocusCleanup=null;} return; }
  // Close AI panel
  const aiPanel = document.getElementById('ai-panel');
  if(aiPanel && aiPanel.classList.contains('open')){ aiPanel.classList.remove('open'); return; }
});

// ════════════════════════════════════════════
// RIVER / SANKEY DIAGRAM — HERO ELEMENT
// ════════════════════════════════════════════
function buildRiver(d){
  const wrap=document.getElementById('river-wrap');
  if(!wrap)return;
  if(wrap.offsetWidth===0||wrap.offsetParent===null)return;
  // Guard: skip render if any required input is NaN/undefined/non-finite.
  // Otherwise SVG path math produces NaN coords which Chrome logs as
  // "<path> attribute d: Expected number, ..." spam in the console.
  const _num = v => (typeof v === 'number' && isFinite(v));
  if (!d || ![d.rev,d.exp,d.profit,d.sal,d.rent,d.sw,d.mkt].every(_num)) {
    wrap.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--t3);font-size:12.5px">No cash flow data yet — add invoices and expenses to see the river chart.</div>';
    return;
  }
  const dark=darkMode;
  const W=wrap.clientWidth||wrap.getBoundingClientRect().width||560,H=200;
  const rev=d.rev||0, exp=d.exp||0, profit=d.profit||0;
  const sal=d.sal||0, rent=d.rent||0, sw=d.sw||0, mkt=d.mkt||0;
  // If revenue is zero, ratio math below would divide by zero → NaN. Skip.
  if (rev <= 0 || exp <= 0) {
    wrap.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--t3);font-size:12.5px">Add revenue and expenses to see the cash-flow river.</div>';
    return;
  }
  const other=Math.max(0, exp-sal-rent-sw-mkt);

  // Color palette
  const C={
    rev:'#c9a84c', revLight:'rgba(201,168,76,0.18)',
    profit:'#7db87d', profitLight:'rgba(125,184,125,0.18)',
    exp:'#c46a5a', expLight:'rgba(196,106,90,0.12)',
    sal:'rgba(196,106,90,0.7)',
    rent:'rgba(196,106,90,0.55)',
    sw:'rgba(158,143,191,0.7)',
    mkt:'rgba(90,170,158,0.7)',
    other:'rgba(212,150,74,0.6)',
    text:dark?'#9e8e73':'#6b5c42',
    textBright:dark?'#f2e8d5':'#1e1810',
    bg:dark?'rgba(22,18,13,0)':'rgba(255,252,245,0)',
  };

  // Layout: 4 columns — SOURCE | MID | SPLIT | DESTINATIONS
  const col=[60, W*0.32, W*0.58, W-60];
  const maxH=H-40; // usable height
  const totalH=maxH;

  // Heights proportional to values — clamp to 0 to prevent negative SVG rect heights
  const revH=Math.min(totalH*0.9, totalH);
  const profitH=Math.max(0, Math.round(revH*(profit/rev)));
  const expH=Math.max(0, revH-profitH);

  // Expense breakdown heights — clamp each to prevent negative values
  const salH=Math.max(0, Math.round(expH*(sal/exp)));
  const rentH=Math.max(0, Math.round(expH*(rent/exp)));
  const swH=Math.max(0, Math.round(expH*(sw/exp)));
  const mktH=Math.max(0, Math.round(expH*(mkt/exp)));
  const otherH=Math.max(2, expH-salH-rentH-swH-mktH);

  // Vertical centers
  const revY=H/2;
  const profitY=H/2 - expH/2 - profitH/2 + profitH/2; // top portion
  const expY=H/2 + profitH/2 + expH/2 - expH/2;       // bottom portion

  // Better layout: revenue centered, profit top, expenses bottom
  const revTop=revY-revH/2;
  const profTop=revTop;
  const expTop=revTop+profitH;

  // Destination nodes
  const dests=[
    {label:'Salaries',  val:sal,  h:salH,  color:C.sal},
    {label:'Rent',      val:rent, h:rentH, color:C.rent},
    {label:'Software',  val:sw,   h:swH,   color:C.sw},
    {label:'Marketing', val:mkt,  h:mktH,  color:C.mkt},
    {label:'Other',     val:other,h:otherH,color:C.other},
  ];
  // Stack destinations
  let destY=expTop+profitH-expH; // start from expTop aligned
  // Actually recalc: profit block + expense block stacked from center
  const blockTop=(H-revH)/2;
  const profitBlock={top:blockTop, h:profitH};
  const expBlock={top:blockTop+profitH, h:expH};
  let stackY=expBlock.top;
  dests.forEach(d=>{d.top=stackY;stackY+=d.h;});

  function cubicPath(x1,y1,x2,y2,h1,h2,color,opacity=0.7){
    const mx=(x1+x2)/2;
    const top1=y1, bot1=y1+h1, top2=y2, bot2=y2+h2;
    return `<path d="M${x1},${top1} C${mx},${top1} ${mx},${top2} ${x2},${top2} L${x2},${bot2} C${mx},${bot2} ${mx},${bot1} ${x1},${bot1} Z"
      fill="${color}" opacity="${opacity}" class="river-flow"/>`;
  }

  // Build SVG
  let svg=`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">
  <defs>
    <style>@keyframes ff-ptcl{0%,5%{opacity:0;offset-distance:0%}15%,80%{opacity:.7}95%,100%{opacity:0;offset-distance:100%}}</style>
    <linearGradient id="rg-rev" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.rev}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${C.rev}" stop-opacity="0.5"/>
    </linearGradient>
    <linearGradient id="rg-profit" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.profit}" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="${C.profit}" stop-opacity="0.85"/>
    </linearGradient>`;

  dests.forEach((d,i)=>{
    svg+=`<linearGradient id="rg-d${i}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${d.color}" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="${d.color}" stop-opacity="0.85"/>
    </linearGradient>`;
  });

  svg+=`</defs>`;

  // Revenue node (col 0)
  svg+=`<rect x="${col[0]-14}" y="${profitBlock.top}" width="14" height="${Math.max(0,revH)}" rx="3" fill="${C.rev}" opacity="0.9"/>`;

  // Revenue → mid split (col1): full block
  svg+=cubicPath(col[0],profitBlock.top,col[1],profitBlock.top,revH,revH,'url(#rg-rev)',0.35);

  // Mid split → profit (top) and expenses (bottom)
  // Profit flow
  svg+=cubicPath(col[1],profitBlock.top,col[2],profitBlock.top,profitH,profitH,'url(#rg-profit)',0.55);
  // Expense flow
  svg+=cubicPath(col[1],profitBlock.top+profitH,col[2],expBlock.top,expH,expH,`${C.exp}`,0.22);

  // Profit node at col2
  svg+=`<rect x="${col[2]}" y="${profitBlock.top}" width="12" height="${Math.max(0,profitH)}" rx="3" fill="${C.profit}" opacity="0.85"/>`;

  // Profit → label
  const _lx1=col[2]+12, _lx2=col[3]-4, _ly=profitBlock.top+profitH/2;
  svg+=`<line x1="${_lx1}" y1="${_ly}" x2="${_lx2}" y2="${_ly}" stroke="${C.profit}" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.5"/>`;

  // Expense breakdown flows col2 → col3
  dests.forEach((dest,i)=>{
    const srcTop=expBlock.top + dests.slice(0,i).reduce((a,x)=>a+x.h,0);
    svg+=cubicPath(col[2],srcTop,col[3]-12,dest.top,dest.h,dest.h,`url(#rg-d${i})`,0.6);
    // Destination node bar
    svg+=`<rect x="${col[3]-12}" y="${dest.top}" width="10" height="${Math.max(dest.h,2)}" rx="2" fill="${dest.color}" opacity="0.9"/>`;
  });

  // Animated flow particles — subtle dots traveling along flows
  // Revenue particle
  const revMidY=profitBlock.top+revH/2;
  const profMidY=profitBlock.top+profitH/2;
  const expMidY=expBlock.top+expH/2;
  function flowParticle(x1,y1,x2,y2,color,delay,dur=2.8){
    const mx=(x1+x2)/2;
    return `<circle r="2" fill="${color}" style="offset-path:path('M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}');offset-distance:0%;animation:ff-ptcl ${dur}s ${delay}s infinite linear"></circle>`;
  }

  // Particles on revenue → mid
  for(let i=0;i<4;i++){
    const yOff=(Math.random()-.5)*revH*.6;
    svg+=flowParticle(col[0],revMidY+yOff,col[1],revMidY+yOff,C.rev,i*0.7);
  }
  // Particles on profit flow
  for(let i=0;i<3;i++){
    const yOff=(Math.random()-.5)*profitH*.5;
    svg+=flowParticle(col[1],profMidY+yOff,col[2],profMidY+yOff,C.profit,i*0.9);
  }
  // Particles on expense flows
  dests.forEach((dest,i)=>{
    const srcTop=expBlock.top+dests.slice(0,i).reduce((a,x)=>a+x.h,0);
    const srcMid=srcTop+dest.h/2;
    const dstMid=dest.top+dest.h/2;
    svg+=flowParticle(col[2],srcMid,col[3]-14,dstMid,dest.color,i*0.5);
  });

  // Labels — left
  svg+=`<text x="${col[0]-20}" y="${profitBlock.top+revH/2+4}" text-anchor="end" class="river-node-value" style="font-size:15px;fill:${C.rev}">${S(rev)}</text>
  <text x="${col[0]-20}" y="${profitBlock.top+revH/2-14}" text-anchor="end" class="river-node-label">Revenue</text>`;

  // Label — profit right side
  svg+=`<text x="${col[3]+4}" y="${profitBlock.top+profitH/2+4}" text-anchor="start" class="river-node-value" style="font-size:13px;fill:${C.profit}">${S(profit)}</text>
  <text x="${col[3]+4}" y="${profitBlock.top+profitH/2-12}" text-anchor="start" class="river-node-label" style="fill:${C.profit}">Net profit</text>`;

  // Labels — destinations
  dests.forEach((dest,i)=>{
    if(dest.h>=8){
      const midY=dest.top+dest.h/2;
      svg+=`<text x="${col[3]+4}" y="${midY+4}" text-anchor="start" class="river-node-label">${dest.label}</text>`;
    }
  });

  svg+=`</svg>`;
  wrap.innerHTML=svg;
  document.getElementById('river-sub').textContent=`${S(profit)} net profit · ${Math.round(profit/rev*100)}% margin`;
}
var _heavyInit=function(){
if(!window._ffAuthed){window.addEventListener('ff:authed',_heavyInit,{once:true});return;}
setTimeout(function(){
  var _fns=[
    function(){loadChartJS(function(){buildCharts();buildCashChart();});},
    refreshAllPeriodData,
    renderPayroll,
    renderPersonal,
    renderCustomers,
    renderInventory,
    renderInvoices,
    renderExpenses,
    renderItems,
    renderBanking,
    function(){if(typeof renderQuotes==='function')renderQuotes();},
    function(){if(typeof renderReceipts==='function')renderReceipts();},
    function(){if(typeof renderPaymentsReceived==='function')renderPaymentsReceived();},
    function(){if(typeof renderRecurringInvoices==='function')renderRecurringInvoices();},
    function(){if(typeof renderCreditNotes==='function')renderCreditNotes();},
    function(){if(typeof renderVendors==='function')renderVendors();},
    function(){if(typeof renderBills==='function')renderBills();},
    function(){if(typeof renderPaymentsMade==='function')renderPaymentsMade();},
    function(){if(typeof renderRecurringBills==='function')renderRecurringBills();},
    function(){if(typeof renderVendorCredits==='function')renderVendorCredits();},
    function(){if(typeof renderProjects==='function')renderProjects();},
    function(){if(typeof renderTimesheet==='function')renderTimesheet();},
    function(){if(typeof renderJournals==='function')renderJournals();},
    function(){if(typeof renderCOA==='function')renderCOA();},
    function(){if(typeof renderLockHistory==='function')renderLockHistory();},
    function(){if(typeof renderReports==='function')renderReports();},
    function(){if(typeof renderDocuments==='function')renderDocuments();},
    function(){if(typeof renderTemplates==='function')renderTemplates();}
  ];
  var _hi = 0;
  function _hdrain() {
    if (_hi >= _fns.length) return;
    var fn = _fns[_hi++];
    try { if(typeof fn==='function') fn(); } catch(e){}
    (window.requestIdleCallback || function(cb){ setTimeout(cb,0); })(function(){ _hdrain(); });
  }
  _hdrain();
},0);
};
setTimeout(_heavyInit,0);
// Sales group starts closed - user clicks to open
// Set default month nav label
document.getElementById('month-nav-label').textContent=MONTH_FULL[currentMonthIdx];
// Trigger animations on the initial active page
setTimeout(()=>{
  const activePage=document.querySelector('.page.active');
  if(activePage){animateBarsOnPage(activePage);animateCounters(activePage);}
},200);

// ── RIVER RESIZE OBSERVER — redraws if wrap was 0-width at first paint ────
(function(){
  const wrap=document.getElementById('river-wrap');
  if(!wrap||typeof ResizeObserver==='undefined')return;
  let lastW=0, rafId=null;
  const ro=new ResizeObserver(entries=>{
    // Defer DOM write to next animation frame to avoid ResizeObserver loop
    if(rafId) cancelAnimationFrame(rafId);
    rafId=requestAnimationFrame(()=>{
      const w=entries[0].contentRect.width;
      if(w>0&&Math.abs(w-lastW)>2){lastW=w;buildRiver(getPeriodData());}
    });
  });
  ro.observe(wrap);
})();

// ── PATCH SAVE FUNCTIONS TO PERSIST (removed — data persisted via API) ───

// ── INIT ENHANCEMENTS (login, persistence, reconciliation) ──────────────
initEnhancements();

// ── 3D TILT ON METRIC CARDS ───────────────────────────────────────────────
document.addEventListener('mousemove',e=>{
  document.querySelectorAll('.mc').forEach(card=>{
    const r=card.getBoundingClientRect();
    if(e.clientX<r.left-60||e.clientX>r.right+60||e.clientY<r.top-60||e.clientY>r.bottom+60){
      card.style.transform='';return;
    }
    const cx=r.left+r.width/2, cy=r.top+r.height/2;
    const dx=(e.clientX-cx)/r.width, dy=(e.clientY-cy)/r.height;
    const rx=dy*-6, ry=dx*6;
    card.style.transform=`perspective(400px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-1px)`;
    card.style.transition='transform .08s ease';
  });
});
document.addEventListener('mouseleave',()=>{
  document.querySelectorAll('.mc').forEach(c=>{c.style.transform='';c.style.transition='transform .4s cubic-bezier(.34,1.3,.64,1)';});
});

// ════════════════════════════════════════════
// GAP CLOSERS v6
// ════════════════════════════════════════════
(function injectGapClosers(){

// ── 1. MOBILE RESPONSIVE CSS ─────────────────────────────────────────────
const mobileCSS = document.createElement('style');
mobileCSS.textContent = `
@media (max-width: 700px) {
  .sidebar { display: none !important; }
  .topbar-right #themeBtn { display: none; }
  #currency-picker-wrap { display: none; }
  #pMonth,#pQ,#pY { display: none; }
  #month-nav { display: none !important; }
  .metrics-grid { grid-template-columns: 1fr 1fr !important; gap: 7px; }
  .metrics-grid-3 { grid-template-columns: 1fr 1fr !important; gap: 7px; }
  .two-col { grid-template-columns: 1fr !important; }
  .mc-val { font-size: 26px !important; }
  .mc { padding: .65rem .8rem; }
  .canvas-wrap { height: 140px !important; }
  #river-card { display: none !important; }
  .page-title { font-size: 14px; }
  .period-label { display: none; }
  .field-group { grid-template-columns: 1fr !important; }
  #mobile-bottom-nav {
    display: flex !important;
    position: fixed; bottom: 0; left: 0; right: 0; height: 60px;
    background: var(--bg1); border-top: 1px solid var(--bd2);
    z-index: 500; align-items: stretch;
    padding-bottom: env(safe-area-inset-bottom, 0);
  }
  .mob-nav-item {
    flex: 1; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 3px; cursor: pointer; color: #9e8f7a;
    font-size: 9.5px; font-weight: 500; letter-spacing: .04em;
    transition: color .13s; border: none; background: none; padding: 0;
  }
  .mob-nav-item.active { color: var(--acc); }
  .mob-nav-item svg { width: 20px; height: 20px; stroke: currentColor; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .mobile-fab {
    position: fixed; bottom: 72px; right: 16px; width: 48px; height: 48px;
    border-radius: 50%; background: var(--acc); color: #0e0b08; border: none;
    font-size: 24px; display: flex; align-items: center; justify-content: center;
    box-shadow: 0 4px 20px var(--acc-glow); cursor: pointer; z-index: 501;
    transition: transform .15s cubic-bezier(.34,1.6,.64,1), box-shadow .15s;
  }
  .mobile-fab:active { transform: scale(.93); }
}
@media (min-width: 701px) {
  #mobile-bottom-nav { display: none !important; }
  .mobile-fab { display: none !important; }
}
`;
document.head.appendChild(mobileCSS);

// ── INJECT BOTTOM NAV ────────────────────────────────────────────────────
const bottomNav = document.createElement('nav');
bottomNav.id = 'mobile-bottom-nav';
bottomNav.style.display = 'none';
bottomNav.innerHTML = `
  <button class="mob-nav-item active" id="mob-dashboard" onclick="showPage('dashboard',null);setMobActive('mob-dashboard')">
    <svg viewBox="0 0 16 16"><rect x="1" y="1" width="6.5" height="6.5" rx="1.2"/><rect x="8.5" y="1" width="6.5" height="6.5" rx="1.2"/><rect x="1" y="8.5" width="6.5" height="6.5" rx="1.2"/><rect x="8.5" y="8.5" width="6.5" height="6.5" rx="1.2"/></svg>
    Home
  </button>
  <button class="mob-nav-item" id="mob-invoices" onclick="showPage('invoices',null);setMobActive('mob-invoices')">
    <svg viewBox="0 0 16 16"><rect x="2" y="1" width="12" height="14" rx="1.2"/><line x1="5" y1="5" x2="11" y2="5"/><line x1="5" y1="8" x2="11" y2="8"/><line x1="5" y1="11" x2="9" y2="11"/></svg>
    Invoices
  </button>
  <button class="mob-nav-item" id="mob-expenses" onclick="showPage('expenses',null);setMobActive('mob-expenses')">
    <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5"/><path d="M8 5v6M6 9.5c0 .83.67 1.5 2 1.5s2-.67 2-1.5S9 8 8 8s-2-.67-2-1.5S7 5 8 5s2 .67 2 1.5"/></svg>
    Expenses
  </button>
  <button class="mob-nav-item" id="mob-personal" onclick="showPage('personal',null);setMobActive('mob-personal')">
    <svg viewBox="0 0 16 16"><circle cx="8" cy="5" r="3"/><path d="M2 14c0-3.31 2.69-6 6-6s6 2.69 6 6"/></svg>
    Personal
  </button>
  <button class="mob-nav-item" id="mob-ai" onclick="showPage('ai',null);setMobActive('mob-ai')">
    <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.5"/><line x1="8" y1="1" x2="8" y2="3.5"/><line x1="8" y1="12.5" x2="8" y2="15"/><line x1="1" y1="8" x2="3.5" y2="8"/><line x1="12.5" y1="8" x2="15" y2="8"/></svg>
    AI
  </button>
`;
document.body.appendChild(bottomNav);

window.setMobActive = function(id){
  document.querySelectorAll('.mob-nav-item').forEach(b => b.classList.remove('active'));
  const el = document.getElementById(id);
  if(el) el.classList.add('active');
};

const fab = document.createElement('button');
fab.className = 'mobile-fab';
fab.innerHTML = '+';
fab.title = 'Quick add';
fab.onclick = () => {
  const page = document.querySelector('.page.active');
  const id = page?.id?.replace('page-', '') || 'dashboard';
  if(id==='invoices') openInvoiceModal();
  else if(id==='expenses') openExpenseModal();
  else if(id==='customers') openCustomerModal();
  else if(id==='personal') openTransactionModal();
  else notify('Quick add — choose a section');
};
document.body.appendChild(fab);


// ── 2. ADVISOR NETWORK PAGE ──────────────────────────────────────────────
const connectionsItem = document.querySelector('.nav-item[onclick*="connections"]');
if(connectionsItem){
  const advisorItem = document.createElement('div');
  advisorItem.className = 'nav-item';
  advisorItem.setAttribute('onclick', "showPage('advisors',this)");
  advisorItem.innerHTML = `<svg class="nav-icon" viewBox="0 0 16 16"><circle cx="6" cy="4.5" r="2.5"/><path d="M1 13c0-2.76 2.24-5 5-5"/><circle cx="12" cy="8" r="2"/><path d="M9.5 14c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5"/><path d="M14 6l1.5 1.5L18 5" style="display:none"/><polyline points="14,5 15,6 17,4"/></svg>Find Advisor<span class="badge b-green" style="margin-left:auto;font-size:9px">NEW</span>`;
  connectionsItem.parentNode.insertBefore(advisorItem, connectionsItem.nextSibling);
}

const advisorPage = document.createElement('div');
advisorPage.className = 'page';
advisorPage.id = 'page-advisors';
advisorPage.innerHTML = '<div class="card" style="max-width:480px;margin:3rem auto;text-align:center;padding:2.5rem 2rem"><div style="width:56px;height:56px;border-radius:14px;background:var(--acc-bg);border:1px solid var(--acc2);display:flex;align-items:center;justify-content:center;margin:0 auto 1.25rem;font-size:24px">&#128101;</div><div style="font-family:var(--font-display);font-size:22px;font-style:italic;color:var(--acc-light);margin-bottom:.5rem">Advisor Network &#8212; Coming Soon</div><div style="font-size:13px;color:var(--t2);line-height:1.7;margin-bottom:1.5rem">Connect with certified FinFlow accountants and financial advisors who can review your books, file taxes, and help you scale.</div><span class="badge b-amber" style="font-size:11px;padding:4px 12px">In development</span></div>';
document.querySelector('.content')?.appendChild(advisorPage);

const ADVISORS = [];

window.renderAdvisors = function(){
  const q = (document.getElementById('adv-search')?.value||'').toLowerCase();
  const spec = document.getElementById('adv-filter-specialty')?.value||'';
  const reg = document.getElementById('adv-filter-region')?.value||'';
  const filtered = ADVISORS.filter(a=>{
    const matchQ = !q || (a.name+a.firm+a.location).toLowerCase().includes(q);
    const matchS = !spec || a.specialty===spec;
    const matchR = !reg || a.region===reg;
    return matchQ && matchS && matchR;
  });
  const list = document.getElementById('adv-list');
  if(!list)return;
  list.innerHTML = filtered.map(a=>`
    <div class="advisor-card" onclick="notify('Connecting you with ${esc(a.name||'')}…')">
      <div class="adv-avatar ${a.avClass}">${a.avatar}</div>
      <div style="flex:1;min-width:0">
        <div class="adv-name">${esc(a.name||'')} ${a.verified?'<span style="color:var(--acc);font-size:11px">✦ Certified</span>':''}</div>
        <div class="adv-firm">${esc(a.firm||'')} · ${esc(a.location||'')}</div>
        <div style="font-size:11px;color:var(--t3);margin-top:3px">${a.clients} client businesses</div>
        <div class="adv-tags">${a.tags.map(t=>`<span class="adv-tag">${esc(t||'')}</span>`).join('')}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div class="adv-stars">${'★'.repeat(a.rating)}${'☆'.repeat(5-a.rating)}</div>
        <button class="btn btn-primary btn-sm" style="margin-top:6px" onclick="event.stopPropagation();notify('Message sent to ${esc(a.name||'')}')">Contact</button>
      </div>
    </div>`).join('');
  if(!filtered.length) list.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--t3)">No advisors match your search</div>';
};

window.openAdvisorCertModal = function(){ document.getElementById('adv-cert-modal').classList.remove('hidden'); };
window.submitAdvisorApp = function(){ closeModal('adv-cert-modal'); notify("Application submitted — we'll review within 2 business days ✦"); };


// ── 3. TAX FILING PAGE ───────────────────────────────────────────────────
const reportsItem = document.querySelector('.nav-item[onclick*="reports"]');
if(reportsItem){
  const taxNavItem = document.createElement('div');
  taxNavItem.className = 'nav-item';
  taxNavItem.setAttribute('onclick', "showPage('tax-filing',this)");
  taxNavItem.innerHTML = `<svg class="nav-icon" viewBox="0 0 16 16"><rect x="2" y="1" width="12" height="14" rx="1.2"/><path d="M5 4V2"/><path d="M11 4V2"/><line x1="2" y1="6" x2="14" y2="6"/><line x1="5" y1="9" x2="11" y2="9"/><polyline points="9,12 10.5,13.5 13,11"/></svg>Tax Filing<span class="badge b-green" style="margin-left:auto;font-size:9px">NEW</span>`;
  reportsItem.parentNode.insertBefore(taxNavItem, reportsItem);
}

const taxPage = document.createElement('div');
taxPage.className = 'page';
taxPage.id = 'page-tax-filing';
taxPage.innerHTML = '<div class="card" style="max-width:480px;margin:3rem auto;text-align:center;padding:2.5rem 2rem"><div style="width:56px;height:56px;border-radius:14px;background:var(--acc-bg);border:1px solid var(--acc2);display:flex;align-items:center;justify-content:center;margin:0 auto 1.25rem;font-size:24px">&#127963;</div><div style="font-family:var(--font-display);font-size:22px;font-style:italic;color:var(--acc-light);margin-bottom:.5rem">Tax Filing &#8212; Coming Soon</div><div style="font-size:13px;color:var(--t2);line-height:1.7;margin-bottom:1.5rem">Direct e-file to IRS, HMRC, and other tax authorities. Auto-calculate quarterly estimates, generate W-2s and 1099s, and file in minutes.</div><span class="badge b-amber" style="font-size:11px;padding:4px 12px">Requires tax API integration</span></div>';
document.querySelector('.content')?.appendChild(taxPage);

window.selectJurisdiction = function(el, name){
  document.querySelectorAll('.tax-jurisdiction').forEach(j=>j.classList.remove('selected'));
  el.classList.add('selected');
  const t = document.getElementById('tax-jurisdiction-title');
  if(t) t.textContent = name;
};
window.startTaxFiling = function(){
  notify('Preparing your tax return — AI pre-filling from FinFlow data… ✦');
  setTimeout(()=>{
    const steps = document.querySelectorAll('#tax-steps-list .tax-step');
    steps.forEach((s,i)=>{ s.classList.remove('done','active','pending'); if(i<3) s.classList.add('done'); else if(i===3) s.classList.add('active'); else s.classList.add('pending'); });
    notify('Review your pre-filled return and add your eSign PIN');
  }, 1800);
};

// ── REAL TAX CALCULATION ENGINE ──────────────────────────────────────────
function calcAndRenderTax(){
  // Pull live data from the app's financial arrays
  const annualRev   = typeof sum==='function' && typeof REV!=='undefined'  ? sum(REV,0,12)      : 0;
  const annualSal   = typeof sum==='function' && typeof EXP_SAL!=='undefined' ? sum(EXP_SAL,0,12) : 0;
  const annualRent  = typeof EXP_RENT!=='undefined' ? (EXP_RENT[0]||0)*12  : 0;
  const annualSW    = typeof sum==='function' && typeof EXP_SW!=='undefined'  ? sum(EXP_SW,0,12)  : 0;
  const annualMkt   = typeof sum==='function' && typeof EXP_MKT!=='undefined' ? sum(EXP_MKT,0,12) : 0;

  const totalDeductible = annualSal + annualRent + annualSW + annualMkt;
  const taxableIncome   = Math.max(0, annualRev - totalDeductible);
  const TAX_RATE        = 0.25;
  const annualLiability = Math.round(taxableIncome * TAX_RATE);
  // YTD paid = 3 of 4 quarterly payments (75%)
  const ytdPaid         = Math.round(annualLiability * 0.75);
  const amountDue       = annualLiability - ytdPaid;

  // Format helpers
  const fmt = v => '$' + Math.abs(Math.round(v)).toLocaleString();
  const pct = (part, total) => total > 0 ? Math.round(part / total * 100) : 0;

  const set = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
  set('tax-liability',       fmt(annualLiability));
  set('tax-paid-ytd',        fmt(ytdPaid));
  set('tax-due',             fmt(amountDue));
  set('tax-val-sal',         fmt(annualSal));
  set('tax-val-rent',        fmt(annualRent));
  set('tax-val-sw',          fmt(annualSW));
  set('tax-val-mkt',         fmt(annualMkt));
  set('tax-total-deductible',fmt(totalDeductible));
  set('tax-saving',          fmt(totalDeductible * TAX_RATE));

  // Update bar widths relative to largest category
  const maxCat = Math.max(annualSal, annualRent, annualSW, annualMkt);
  const setBar = (id, v) => { const el=document.getElementById(id); if(el) el.style.width = pct(v, maxCat)+'%'; };
  setBar('tax-bar-sal',  annualSal);
  setBar('tax-bar-rent', annualRent);
  setBar('tax-bar-sw',   annualSW);
  setBar('tax-bar-mkt',  annualMkt);

  // Update filing step 3 with real numbers
  const step3Detail = document.querySelector('#tax-steps-list .tax-step.active div div:last-child');
  if(step3Detail) step3Detail.textContent = fmt(annualLiability)+' federal · '+fmt(amountDue)+' Q4 balance due';
}


// ── 4. INTEGRATION MARKETPLACE UPGRADE ──────────────────────────────────
const connPage = document.getElementById('page-connections');
if(connPage){
  const mpBanner = document.createElement('div');
  mpBanner.innerHTML = `
    <div style="background:linear-gradient(135deg,var(--acc-bg),rgba(30,24,8,.3));border:1px solid var(--acc2);border-radius:var(--radius-lg);padding:1rem 1.25rem;margin-bottom:1rem;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <div style="font-size:13.5px;font-weight:600;color:var(--acc-light);font-family:var(--font-display);letter-spacing:.03em">FinFlow Integration Marketplace</div>
        <div style="font-size:12px;color:var(--t2);margin-top:3px">750+ apps &amp; services · Browse, connect, and automate your entire stack</div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0">
        <button class="btn btn-ghost btn-sm" onclick="notify('Opening full marketplace…')">Browse all 750+ ↗</button>
        <button class="btn btn-primary btn-sm" onclick="notify('Build your own integration via the FinFlow API')">Build an app +</button>
      </div>
    </div>`;
  const hubTop = connPage.querySelector('.conn-hub-topbar');
  if(hubTop) hubTop.parentNode.insertBefore(mpBanner, hubTop.nextSibling);

}

// ── 5. PATCH showPage for new pages ─────────────────────────────────────
const _origShowPage = window.showPage;
window.showPage = function(id, el){
  _origShowPage(id, el);
  const extra = {'advisors':'Advisor Network','tax-filing':'Tax Filing'};
  if(extra[id]) document.getElementById('pageTitle').textContent = extra[id];
  if(id==='advisors') requestAnimationFrame(renderAdvisors);
  if(id==='tax-filing') requestAnimationFrame(calcAndRenderTax);
};

// ── 6. PATCH showPage to close sidebar on mobile ──────────────────────────
const _origShowPage2 = window.showPage;
window.showPage = function(id, el){
  _origShowPage2(id, el);
  if(window.innerWidth <= 768) closeSidebar();
};

})(); // end injectGapClosers
