// Sistem karakterlerinin (system 1/2) isimlerini dile özgü hale getirir.
// Kullanıcıların oluşturduğu karakterler (system=0) bu haritada bulunmaz;
// haritada olmayan her isim olduğu gibi döner (değiştirilmez).
//
// Anahtar: bots.name (DB'deki kanonik isim). Değer: 12 dilde karşılık.
// Diller: tr, en, de, fr, pt, it, es, zh, ja, ru, hi, ko

const SUPPORTED_LANGS = ['tr', 'en', 'de', 'fr', 'pt', 'it', 'es', 'zh', 'ja', 'ru', 'hi', 'ko'];

function normalizeLang(raw) {
    const lang = String(raw || 'en').toLowerCase().split(/[-_]/)[0];
    return SUPPORTED_LANGS.includes(lang) ? lang : 'en';
}

// Kadın karakterler
const FEMALE = {
    Aden:      { tr: 'Eda',      en: 'Aden',      de: 'Lena',      fr: 'Adèle',     pt: 'Aida',      it: 'Ada',       es: 'Adaia',     zh: '艾登',       ja: 'エイデン',     ru: 'Аида',       hi: 'आदिति',     ko: '에이든' },
    Alin:      { tr: 'Alin',     en: 'Aline',     de: 'Aline',     fr: 'Aline',     pt: 'Alina',     it: 'Alina',     es: 'Alina',     zh: '艾琳',       ja: 'アリン',       ru: 'Алина',      hi: 'आलिया',     ko: '아린' },
    Aria:      { tr: 'Aslı',     en: 'Aria',      de: 'Marie',     fr: 'Manon',     pt: 'Ana',       it: 'Arianna',   es: 'Aria',      zh: '艾莉雅',     ja: 'アリア',       ru: 'Арина',      hi: 'आर्या',      ko: '아리아' },
    Aurora:    { tr: 'Şafak',    en: 'Aurora',    de: 'Aurora',    fr: 'Aurore',    pt: 'Aurora',    it: 'Aurora',    es: 'Aurora',    zh: '奥萝拉',     ja: 'オーロラ',     ru: 'Аврора',     hi: 'उषा',       ko: '오로라' },
    Ava:       { tr: 'Ada',      en: 'Ava',       de: 'Ava',       fr: 'Ava',       pt: 'Ava',       it: 'Ava',       es: 'Ava',       zh: '艾娃',       ja: 'エヴァ',       ru: 'Ева',        hi: 'अवा',       ko: '에이바' },
    Avery:     { tr: 'Ayşe',     en: 'Avery',     de: 'Emilia',    fr: 'Avery',     pt: 'Aveline',   it: 'Avery',     es: 'Avery',     zh: '艾芙丽',     ja: 'エイヴリー',   ru: 'Авелина',    hi: 'आवेरी',     ko: '에이버리' },
    Clara:     { tr: 'Berrak',   en: 'Clara',     de: 'Klara',     fr: 'Claire',    pt: 'Clara',     it: 'Chiara',    es: 'Clara',     zh: '克拉拉',     ja: 'クララ',       ru: 'Клара',      hi: 'क्लारा',     ko: '클라라' },
    Cora:      { tr: 'Kayra',    en: 'Cora',      de: 'Cora',      fr: 'Cora',      pt: 'Cora',      it: 'Cora',      es: 'Cora',      zh: '蔻拉',       ja: 'コーラ',       ru: 'Кора',       hi: 'कोरा',      ko: '코라' },
    Duru:      { tr: 'Duru',     en: 'Clara',     de: 'Klara',     fr: 'Claire',    pt: 'Clara',     it: 'Chiara',    es: 'Clara',     zh: '杜茹',       ja: 'ドゥル',       ru: 'Дара',       hi: 'दुरु',       ko: '두루' },
    Elena:     { tr: 'Elif',     en: 'Helen',     de: 'Helena',    fr: 'Hélène',    pt: 'Elena',     it: 'Elena',     es: 'Elena',     zh: '埃莱娜',     ja: 'エレナ',       ru: 'Елена',      hi: 'एलेना',     ko: '엘레나' },
    Esme:      { tr: 'Esma',     en: 'Esme',      de: 'Esme',      fr: 'Esmée',     pt: 'Esme',      it: 'Esma',      es: 'Esme',      zh: '艾斯梅',     ja: 'エスメ',       ru: 'Эсма',       hi: 'एस्मे',     ko: '에스메' },
    Freya:     { tr: 'Ferya',    en: 'Freya',     de: 'Freya',     fr: 'Freya',     pt: 'Freia',     it: 'Freya',     es: 'Freya',     zh: '芙蕾雅',     ja: 'フレイヤ',     ru: 'Фрейя',      hi: 'फ्रेया',    ko: '프레야' },
    'İlay':    { tr: 'İlay',     en: 'Ellie',     de: 'Lea',       fr: 'Léa',       pt: 'Lia',       it: 'Ilaria',    es: 'Elia',      zh: '伊蕾',       ja: 'イライ',       ru: 'Илая',       hi: 'इलाया',     ko: '일라이' },
    Iris:      { tr: 'Ece',      en: 'Iris',      de: 'Iris',      fr: 'Iris',      pt: 'Íris',      it: 'Iris',      es: 'Iris',      zh: '艾瑞丝',     ja: 'アイリス',     ru: 'Ирис',       hi: 'आइरिस',     ko: '아이리스' },
    Isla:      { tr: 'Nehir',    en: 'Isla',      de: 'Isla',      fr: 'Isla',      pt: 'Isla',      it: 'Isla',      es: 'Isla',      zh: '艾拉',       ja: 'アイラ',       ru: 'Исла',       hi: 'इस्ला',     ko: '아일라' },
    Ivy:       { tr: 'Defne',    en: 'Ivy',       de: 'Ivy',       fr: 'Ivy',       pt: 'Ivi',       it: 'Edera',     es: 'Hiedra',    zh: '艾薇',       ja: 'アイビー',     ru: 'Айви',       hi: 'आइवी',      ko: '아이비' },
    Jade:      { tr: 'Yade',     en: 'Jade',      de: 'Jade',      fr: 'Jade',      pt: 'Jade',      it: 'Giada',     es: 'Jade',      zh: '翡翠',       ja: 'ジェイド',     ru: 'Джейд',      hi: 'जेड',       ko: '제이드' },
    Lina:      { tr: 'Lina',     en: 'Lina',      de: 'Lina',      fr: 'Line',      pt: 'Lina',      it: 'Lina',      es: 'Lina',      zh: '莉娜',       ja: 'リナ',         ru: 'Лина',       hi: 'लीना',      ko: '리나' },
    Luna:      { tr: 'Ayça',     en: 'Luna',      de: 'Luna',      fr: 'Luna',      pt: 'Luna',      it: 'Luna',      es: 'Luna',      zh: '露娜',       ja: 'ルナ',         ru: 'Луна',       hi: 'लूना',      ko: '루나' },
    Lyra:      { tr: 'Lir',      en: 'Lyra',      de: 'Lyra',      fr: 'Lyra',      pt: 'Lira',      it: 'Lira',      es: 'Lira',      zh: '莉拉',       ja: 'ライラ',       ru: 'Лира',       hi: 'लायरा',     ko: '라이라' },
    Maya:      { tr: 'Maya',     en: 'Maya',      de: 'Maja',      fr: 'Maya',      pt: 'Maia',      it: 'Maia',      es: 'Maya',      zh: '玛雅',       ja: 'マヤ',         ru: 'Майя',       hi: 'माया',      ko: '마야' },
    Mila:      { tr: 'Mila',     en: 'Mila',      de: 'Mila',      fr: 'Mila',      pt: 'Mila',      it: 'Mila',      es: 'Mila',      zh: '米拉',       ja: 'ミラ',         ru: 'Мила',       hi: 'मीला',      ko: '밀라' },
    Mina:      { tr: 'Mina',     en: 'Mina',      de: 'Mina',      fr: 'Mina',      pt: 'Mina',      it: 'Mina',      es: 'Mina',      zh: '米娜',       ja: 'ミナ',         ru: 'Мина',       hi: 'मीना',      ko: '미나' },
    'Miraç':   { tr: 'Miraç',    en: 'Grace',     de: 'Mira',      fr: 'Mira',      pt: 'Mira',      it: 'Mira',      es: 'Mira',      zh: '米拉琪',     ja: 'ミラー',       ru: 'Мира',       hi: 'मीरा',      ko: '미라' },
    Nora:      { tr: 'Nur',      en: 'Nora',      de: 'Nora',      fr: 'Nora',      pt: 'Nora',      it: 'Nora',      es: 'Nora',      zh: '诺拉',       ja: 'ノラ',         ru: 'Нора',       hi: 'नोरा',      ko: '노라' },
    Nova:      { tr: 'Nova',     en: 'Nova',      de: 'Nova',      fr: 'Nova',      pt: 'Nova',      it: 'Nova',      es: 'Nova',      zh: '诺瓦',       ja: 'ノヴァ',       ru: 'Нова',       hi: 'नोवा',      ko: '노바' },
    Selin:     { tr: 'Selin',    en: 'Selena',    de: 'Selina',    fr: 'Céline',    pt: 'Selena',    it: 'Selina',    es: 'Selena',    zh: '瑟琳',       ja: 'セリン',       ru: 'Селина',     hi: 'सेलिना',    ko: '셀린' },
    Sena:      { tr: 'Sena',     en: 'Serena',    de: 'Serena',    fr: 'Séréna',    pt: 'Serena',    it: 'Serena',    es: 'Serena',    zh: '塞娜',       ja: 'セナ',         ru: 'Сена',       hi: 'सेना',      ko: '세나' },
    Seraphina: { tr: 'Sera',     en: 'Seraphina', de: 'Seraphina', fr: 'Séraphine', pt: 'Serafina',  it: 'Serafina',  es: 'Serafina',  zh: '瑟拉菲娜',   ja: 'セラフィナ',   ru: 'Серафима',   hi: 'सेराफिना',  ko: '세라피나' },
    Sienna:    { tr: 'İpek',     en: 'Sienna',    de: 'Sienna',    fr: 'Sienna',    pt: 'Siena',     it: 'Siena',     es: 'Siena',     zh: '西恩娜',     ja: 'シエナ',       ru: 'Сиена',      hi: 'सिएना',     ko: '시에나' },
    Sloane:    { tr: 'Sıla',     en: 'Sloane',    de: 'Sloane',    fr: 'Sloane',    pt: 'Sloane',    it: 'Sloane',    es: 'Sloane',    zh: '斯隆',       ja: 'スローン',     ru: 'Слоан',      hi: 'स्लोन',     ko: '슬로운' },
    Thea:      { tr: 'Tuana',    en: 'Thea',      de: 'Thea',      fr: 'Théa',      pt: 'Teia',      it: 'Tea',       es: 'Tea',       zh: '西娅',       ja: 'テア',         ru: 'Тея',        hi: 'थिया',      ko: '테아' },
    Violet:    { tr: 'Menekşe',  en: 'Violet',    de: 'Viola',     fr: 'Violette',  pt: 'Violeta',   it: 'Viola',     es: 'Violeta',   zh: '紫罗兰',     ja: 'ヴァイオレット', ru: 'Виолетта',  hi: 'वायलेट',    ko: '바이올렛' },
    Yelda:     { tr: 'Yelda',    en: 'Yelda',     de: 'Yelda',     fr: 'Yelda',     pt: 'Ilda',      it: 'Ilda',      es: 'Yelda',     zh: '耶尔达',     ja: 'イェルダ',     ru: 'Ельда',      hi: 'येल्दा',    ko: '옐다' },
    Zara:      { tr: 'Zehra',    en: 'Zara',      de: 'Zara',      fr: 'Zara',      pt: 'Zara',      it: 'Zara',      es: 'Zara',      zh: '扎拉',       ja: 'ザラ',         ru: 'Зара',       hi: 'ज़ारा',      ko: '자라' },
};

// Erkek karakterler
const MALE = {
    Adrian:    { tr: 'Adem',     en: 'Adrian',    de: 'Adrian',    fr: 'Adrien',    pt: 'Adriano',   it: 'Adriano',   es: 'Adrián',    zh: '阿德里安',   ja: 'エイドリアン', ru: 'Адриан',     hi: 'एड्रियन',   ko: '에이드리안' },
    Alaric:    { tr: 'Alp',      en: 'Alaric',    de: 'Alarich',   fr: 'Alaric',    pt: 'Alarico',   it: 'Alarico',   es: 'Alarico',   zh: '阿拉里克',   ja: 'アラリック',   ru: 'Аларих',     hi: 'अलारिक',    ko: '알라릭' },
    Arin:      { tr: 'Arin',     en: 'Aaron',     de: 'Aaron',     fr: 'Aaron',     pt: 'Arão',      it: 'Arrigo',    es: 'Arón',      zh: '阿林',       ja: 'アリン',       ru: 'Арин',       hi: 'अरिन',      ko: '아린' },
    Arthur:    { tr: 'Artun',    en: 'Arthur',    de: 'Artur',     fr: 'Arthur',    pt: 'Artur',     it: 'Arturo',    es: 'Arturo',    zh: '亚瑟',       ja: 'アーサー',     ru: 'Артур',      hi: 'आर्थर',     ko: '아서' },
    Baris:     { tr: 'Barış',    en: 'Brian',     de: 'Boris',     fr: 'Boris',     pt: 'Bruno',     it: 'Bruno',     es: 'Bruno',     zh: '巴里斯',     ja: 'バルシュ',     ru: 'Борис',      hi: 'बारिश',     ko: '바리스' },
    Caspian:   { tr: 'Kaya',     en: 'Caspian',   de: 'Kaspar',    fr: 'Gaspard',   pt: 'Cáspio',    it: 'Caspio',    es: 'Caspio',    zh: '卡斯宾',     ja: 'カスピアン',   ru: 'Каспиан',    hi: 'कैस्पियन',  ko: '카스피안' },
    Dante:     { tr: 'Deniz',    en: 'Dante',     de: 'Dante',     fr: 'Dante',     pt: 'Dante',     it: 'Dante',     es: 'Dante',     zh: '但丁',       ja: 'ダンテ',       ru: 'Данте',      hi: 'दांते',     ko: '단테' },
    Doruk:     { tr: 'Doruk',    en: 'Dominic',   de: 'Dominik',   fr: 'Dominique', pt: 'Domingos',  it: 'Domenico',  es: 'Domingo',   zh: '多鲁克',     ja: 'ドルク',       ru: 'Доминик',    hi: 'दोरुक',     ko: '도루크' },
    Elias:     { tr: 'İlyas',    en: 'Elias',     de: 'Elias',     fr: 'Élias',     pt: 'Elias',     it: 'Elia',      es: 'Elías',     zh: '埃利亚斯',   ja: 'イライアス',   ru: 'Илья',       hi: 'एलियास',    ko: '엘리아스' },
    Eren:      { tr: 'Eren',     en: 'Ryan',      de: 'Erik',      fr: 'Ryan',      pt: 'Érico',     it: 'Errico',    es: 'Erin',      zh: '埃伦',       ja: 'エレン',       ru: 'Эрен',       hi: 'एरेन',      ko: '에렌' },
    Ethan:     { tr: 'Ethem',    en: 'Ethan',     de: 'Ethan',     fr: 'Ethan',     pt: 'Etan',      it: 'Etan',      es: 'Ethan',     zh: '伊桑',       ja: 'イーサン',     ru: 'Итан',       hi: 'एथन',       ko: '이든' },
    Felix:     { tr: 'Ferit',    en: 'Felix',     de: 'Felix',     fr: 'Félix',     pt: 'Félix',     it: 'Felice',    es: 'Félix',     zh: '菲利克斯',   ja: 'フェリックス', ru: 'Феликс',     hi: 'फेलिक्स',   ko: '펠릭스' },
    Gideon:    { tr: 'Gökhan',   en: 'Gideon',    de: 'Gideon',    fr: 'Gédéon',    pt: 'Gideão',    it: 'Gedeone',   es: 'Gedeón',    zh: '吉迪恩',     ja: 'ギデオン',     ru: 'Гидеон',     hi: 'गिदोन',     ko: '기드온' },
    Julian:    { tr: 'Yalın',    en: 'Julian',    de: 'Julian',    fr: 'Julien',    pt: 'Julião',    it: 'Giuliano',  es: 'Julián',    zh: '朱利安',     ja: 'ジュリアン',   ru: 'Юлиан',      hi: 'जूलियन',    ko: '줄리안' },
    Kaelen:    { tr: 'Kaan',     en: 'Kaelen',    de: 'Kaelen',    fr: 'Kaelan',    pt: 'Kaelen',    it: 'Caleno',    es: 'Kaelen',    zh: '凯伦',       ja: 'ケイレン',     ru: 'Кейлен',     hi: 'कैलेन',     ko: '카일런' },
    Killian:   { tr: 'Kağan',    en: 'Killian',   de: 'Kilian',    fr: 'Killian',   pt: 'Quiliano',  it: 'Chiliano',  es: 'Kilian',    zh: '基利安',     ja: 'キリアン',     ru: 'Киллиан',    hi: 'किलियन',    ko: '킬리안' },
    Kuzey:     { tr: 'Kuzey',    en: 'Kai',       de: 'Kai',       fr: 'Kaï',       pt: 'Caio',      it: 'Caio',      es: 'Kai',       zh: '库泽伊',     ja: 'クゼイ',       ru: 'Кузей',      hi: 'कुज़े',      ko: '쿠제이' },
    Leo:       { tr: 'Aslan',    en: 'Leo',       de: 'Leo',       fr: 'Léo',       pt: 'Leo',       it: 'Leo',       es: 'Leo',       zh: '里奥',       ja: 'レオ',         ru: 'Лео',        hi: 'लियो',      ko: '레오' },
    Lucian:    { tr: 'Işık',     en: 'Lucian',    de: 'Lucian',    fr: 'Lucien',    pt: 'Luciano',   it: 'Luciano',   es: 'Luciano',   zh: '卢西恩',     ja: 'ルシアン',     ru: 'Лукиан',     hi: 'लूसियन',    ko: '루시안' },
    Marcus:    { tr: 'Mert',     en: 'Marcus',    de: 'Markus',    fr: 'Marc',      pt: 'Marcos',    it: 'Marco',     es: 'Marcos',    zh: '马库斯',     ja: 'マーカス',     ru: 'Маркус',     hi: 'मार्कस',    ko: '마커스' },
    Roman:     { tr: 'Roman',    en: 'Roman',     de: 'Roman',     fr: 'Romain',    pt: 'Romano',    it: 'Romano',    es: 'Román',     zh: '罗曼',       ja: 'ローマン',     ru: 'Роман',      hi: 'रोमन',      ko: '로만' },
    Silas:     { tr: 'Sinan',    en: 'Silas',     de: 'Silas',     fr: 'Silas',     pt: 'Silas',     it: 'Sila',      es: 'Silas',     zh: '塞拉斯',     ja: 'サイラス',     ru: 'Сайлас',     hi: 'सिलास',     ko: '사일러스' },
    Soren:     { tr: 'Soner',    en: 'Soren',     de: 'Sören',     fr: 'Sören',     pt: 'Sören',     it: 'Sören',     es: 'Sören',     zh: '索伦',       ja: 'ソーレン',     ru: 'Сёрен',      hi: 'सोरेन',     ko: '소렌' },
    Victor:    { tr: 'Zafer',    en: 'Victor',    de: 'Viktor',    fr: 'Victor',    pt: 'Vítor',     it: 'Vittorio',  es: 'Víctor',    zh: '维克多',     ja: 'ヴィクター',   ru: 'Виктор',     hi: 'विक्टर',    ko: '빅터' },
};

const NAME_MAP = { ...FEMALE, ...MALE };

// Küçük harfe indirgenmiş fallback eşleme (case-insensitive eşleşme için)
const NAME_MAP_LOWER = {};
for (const key of Object.keys(NAME_MAP)) {
    NAME_MAP_LOWER[key.toLocaleLowerCase('tr')] = NAME_MAP[key];
    NAME_MAP_LOWER[key.toLowerCase()] = NAME_MAP[key];
}

/**
 * Sistem karakteri ismini hedef dile göre döndürür.
 * Haritada olmayan isimler (ör. kullanıcı karakterleri) olduğu gibi döner.
 */
function localizeName(name, lang) {
    const raw = String(name || '').trim();
    if (!raw) return raw;
    const entry =
        NAME_MAP[raw] ||
        NAME_MAP_LOWER[raw.toLocaleLowerCase('tr')] ||
        NAME_MAP_LOWER[raw.toLowerCase()];
    if (!entry) return raw;
    const l = normalizeLang(lang);
    return entry[l] || entry.en || raw;
}

module.exports = {
    localizeName,
    NAME_MAP,
};
