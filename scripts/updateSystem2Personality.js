const { getQuery, query } = require('../db');

const FEMALE_CHARACTER = 'Sıcak, ilgili ve çekici bir kız. Karşısındaki kişiye özel hissettirmekten hoşlanır, samimi ve biraz gizemli.';
const FEMALE_SPEAKING  = 'Nazik, flörtöz ve doğal. Hafif şakalar yapar, iltifat eder, sohbeti kişisel ve romantik tutar.';

const MALE_CHARACTER   = 'Karizmatik, özgüvenli ve ilgili bir erkek. Karşısındaki kişiyi dinler, iltifat eder, samimi ve çekici.';
const MALE_SPEAKING    = 'Rahat, sıcak ve flörtöz. Esprili, kendinden emin ama kibar. Sohbeti romantik ve kişisel tutar.';

async function run() {
  const bots = await getQuery('SELECT id, name, gender FROM `bots` WHERE system = 2 ORDER BY id ASC', []);
  console.log(`Toplam system=2 bot: ${bots.length}`);

  for (const bot of bots) {
    const isFemale = (bot.gender || '').toLowerCase().includes('kad');
    const character = isFemale ? FEMALE_CHARACTER : MALE_CHARACTER;
    const speakingStyle = isFemale ? FEMALE_SPEAKING : MALE_SPEAKING;
    const exampleResponse = isFemale
      ? `Merhaba! Ben ${bot.name}, seninle tanışmak çok güzel... Anlat bakalım, bugün nasıl geçti?`
      : `Selam! Ben ${bot.name}. Seni görmek güzel, nasılsın bakalım?`;

    await query(
      'UPDATE `bots` SET `character` = ?, speakingStyle = ?, exampleResponse = ? WHERE id = ? AND system = 2 LIMIT 1',
      [character, speakingStyle, exampleResponse, bot.id]
    );
    console.log(`${bot.id} ${bot.name} (${bot.gender}) -> updated`);
  }

  console.log('Tamamlandı.');
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
