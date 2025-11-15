const router = require('express').Router();
const middleware = require('../middleware/checkAuth')
const { getQuery , query} = require('../db')
const axios = require('axios')
const multer = require('multer');
const FormData  = require("form-data");

function guidGenerator() {
    var S4 = function() {
       return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
    };
    return (S4()+S4()+"-"+S4()+"-"+S4()+"-"+S4()+"-"+S4()+S4()+S4());
}



router.post('/create-chat',middleware,async (req,res)=>{
   const {  userId , botId, started_at, last_message_at} = req.body;

  var result = await getQuery("SELECT * FROM `coversations` WHERE userId = ? AND botId = ?",[userId,botId]);
  if (result.length === 0) {
    const chatCreated = await query("INSERT INTO `coversations` ( `userId`, `botId`, `current_chat_state` , `lastMessage`, `last_message_at` , `started_at`) VALUES (?, ?, ?, ?, ?,?)",[userId,botId,"normal",null,null,null]);
      if (chatCreated === true) {
          var resp = await getQuery("SELECT * FROM `coversations` WHERE userId = ? AND botId = ?",[userId,botId]);
          return await res.status(200).json({
            "msg": "Conversation Created",
            "conversationData": resp[0],
            "success": true
          })
      } else {
             return await res.status(400).json({
            "msg": "Error when conversation creating",
            "success": false
          })
      }
  } else {
       return await res.status(200).json({
            "msg": "Conversation Data",
            "conversationData": result[0],
            "success": true
          })
  }


})




router.post('/get-messages',middleware, async(req,res)=>{
    const {conversationId} = req.body;
   let messages = await getQuery("SELECT * FROM `messages` WHERE conversationId = ?",[conversationId]);
   return res.status(200).json(messages)
})

router.post('/listen-messages',middleware, async(req,res)=>{
    const {conversationId} = req.body;
   let convData = await getQuery("SELECT `current_chat_state` FROM `coversations` WHERE id = ?",[conversationId]);
   let messages = await getQuery("SELECT * FROM `messages` WHERE conversationId = ? ORDER BY created_at DESC",[conversationId]);
   return res.status(200).json({
    "conversation_state": convData[0]["current_chat_state"],
    "messages": messages
   })
})



router.post('/get-conversations', middleware, async (req, res) => {
  try {
    const { userId } = req.body;

    // 1️⃣ Kullanıcının tüm conversation kayıtlarını al (tarihe göre sıralı - en yeni önce)
    const convData = await getQuery(
      "SELECT * FROM `coversations` WHERE userId = ? ORDER BY COALESCE(last_message_at, started_at, id) DESC", 
      [userId]
    );

    // Eğer hiç yoksa
    if (!convData || convData.length === 0) {
      return res.status(200).json([]);
    }

    // 2️⃣ Her conversation için bot verisini al
    const responseData = [];
    for (const conv of convData) {
      const botData = await getQuery("SELECT * FROM `bots` WHERE id = ?", [conv.botId]);
      responseData.push({
        conversationData: conv,
        botData: botData[0] || null
      });
    }

    // 3️⃣ Sonuçları döndür
    res.status(200).json(responseData);

  } catch (error) {
    console.error("get-conversations error:", error);
    res.status(500).json({ msg: "Server error" });
  }
});


router.post('/search-conversations', middleware, async (req, res) => {
  try {
    const { userId, searchQuery } = req.body;

    if (!searchQuery || searchQuery.trim() === '') {
      return res.status(400).json({
        msg: "Search query is required",
        success: false
      });
    }

    const searchTerm = `%${searchQuery}%`;

    // 1️⃣ Kullanıcının conversation kayıtlarını al
    const convData = await getQuery(
      "SELECT * FROM `coversations` WHERE userId = ? ORDER BY COALESCE(last_message_at, started_at, id) DESC", 
      [userId]
    );

    if (!convData || convData.length === 0) {
      return res.status(200).json([]);
    }

    // 2️⃣ Her conversation için bot verisini al ve arama kriterine göre filtrele
    const responseData = [];
    for (const conv of convData) {
      const botData = await getQuery("SELECT * FROM `bots` WHERE id = ?", [conv.botId]);
      
      if (botData && botData[0]) {
        const bot = botData[0];
        const lastMessage = conv.lastMessage || '';
        
        // Bot adı veya son mesajda arama yap (case-insensitive)
        if (
          bot.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          lastMessage.toLowerCase().includes(searchQuery.toLowerCase())
        ) {
          responseData.push({
            conversationData: conv,
            botData: bot
          });
        }
      }
    }

    // 3️⃣ Sonuçları döndür
    res.status(200).json(responseData);

  } catch (error) {
    console.error("search-conversations error:", error);
    res.status(500).json({ 
      msg: "Server error",
      success: false 
    });
  }
});




router.post('/send-message',middleware,async (req,res)=>{
   const {   sender, message, conversationId, botId} = req.body;
   const id = guidGenerator();
  var result = await query("INSERT INTO `messages` (`conversationId`, `sender`, `message`, `created_at`) VALUES (?, ?, ?, ?);",[conversationId,"user",message,null]);
  if (sender === 'user') {
await axios.post("http://89.252.179.227:5678/webhook/start-chat",{
    sender: "user",
    message: message,
    conversation: conversationId
    })
  }

  if (result === true) {
    res.status(200).json({
        "msg": "sent",
        "id": id
    });
  } else {
        res.status(500).json({
        "msg": "SQL"
    });
  }
})


function getRandomName () {
  // Rastgele string üretici
// Uzunluğu ve karakter setini isteğe göre değiştirebilirsin

const length = 12; // kaç karakterlik string istiyorsan
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

let result = '';
for (let i = 0; i < length; i++) {
  result += chars.charAt(Math.floor(Math.random() * chars.length));
}

return result;

}

const upload = multer({ storage: multer.memoryStorage() });

router.post('/send-audio-message', upload.single('file'), async (req, res) => {
  try {
    // 📦 1. Gelen dosyayı kontrol et
    if (!req.file) {
      return res.status(400).json({ error: 'Ses dosyası yüklenmedi.' });
    }

    const fileBuffer = req.file.buffer;
    const fileName = req.file.originalname || `${Date.now()}.m4a`;
    const conversation = req.body.conversation;
    const sender = req.sender || 'user';
    const randomId = getRandomName();

    console.log(`conversationId: ${conversation}`);

    // 📡 2. CDN URL’leri
    const CDNURL = `https://storage.bunnycdn.com/fakefriendstorage/${randomId}.m4a`;
    const CDNFILEURL = `https://fakefriend.b-cdn.net/${randomId}.m4a`;

    // 🟢 3. BunnyCDN'e direkt dosyayı yükle (formData DEĞİL)
    await axios.put(CDNURL, fileBuffer, {
      headers: {
        'AccessKey': '68664abb-b19e-47e7-acd67dba78a5-e90a-4386',
        'Content-Type': 'audio/m4a', // uygun content-type
      },
      maxBodyLength: Infinity,
    });

    console.log('✅ Dosya BunnyCDN’e yüklendi.');



    // 🎙️ 5. ElevenLabs Speech-to-Text çağrısı
    const form = new FormData();
    form.append('file', fileBuffer, fileName);
    form.append('model_id', 'scribe_v1');

    const elevenResponse = await axios.post(
      'https://api.elevenlabs.io/v1/speech-to-text',
      form,
      {
        headers: {
          ...form.getHeaders(),
          'xi-api-key': 'sk_2f6bb270166b14978aef45a02395d595e8661799dc110ce9',
        },
        maxBodyLength: Infinity,
      }
    );

    const text = elevenResponse.data.text || '';
        // 💾 4. Veritabanına kaydet
    await query(
      'INSERT INTO `messages` (`conversationId`, `sender`, `message`, `created_at`, `message_type`) VALUES (?, ?, ?, NOW(), ?)',
      [conversation, sender, JSON.stringify({text:text,url: CDNFILEURL}), 'voice']
    );


    console.log('🗣️ ElevenLabs sonucu:', text);

    // 🔁 6. Webhook’a sonucu gönder
    await axios.post(
      'http://89.252.179.227:5678/webhook/voice-message',
      {
        voiceText: text,
        conversationId: conversation,
        sender: 'user',
      },
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );

    // 🟢 7. API cevabı
    res.json({
      success: true,
      transcribedText: text,
      fileUrl: CDNFILEURL,
    });
  } catch (err) {
    console.error('❌ Hata:', err.message);
    res.status(500).json({
      error: `Forward sırasında hata oluştu: ${err.message}`,
    });
  }
});


// Report Conversation
router.post('/report-conversation', middleware, async (req, res) => {
  try {
    const { userId, conversationId, botId, reason, description } = req.body;

    if (!userId || !conversationId || !reason || !description) {
      return res.status(400).json({ 
        msg: "Missing required fields", 
        success: false 
      });
    }

    // Insert report into database
    await getQuery(
      "INSERT INTO `reports` (`userId`, `conversationId`, `botId`, `reason`, `description`, `status`, `created_at`) VALUES (?, ?, ?, ?, ?, 'pending', NOW())",
      [userId, conversationId, botId, reason, description]
    );

    res.status(200).json({ 
      msg: "Report submitted successfully", 
      success: true 
    });
  } catch (error) {
    console.error("report-conversation error:", error);
    res.status(500).json({ 
      msg: "Server error", 
      success: false 
    });
  }
});

// Delete Conversation
router.post('/delete-conversation', middleware, async (req, res) => {
  try {
    const { conversationId, userId } = req.body;

    if (!conversationId || !userId) {
      return res.status(400).json({ 
        msg: "Missing required fields", 
        success: false 
      });
    }

    // Verify conversation belongs to user
    const conversation = await getQuery(
      "SELECT * FROM `coversations` WHERE id = ? AND userId = ?",
      [conversationId, userId]
    );

    if (!conversation || conversation.length === 0) {
      return res.status(404).json({ 
        msg: "Conversation not found or unauthorized", 
        success: false 
      });
    }

    // Delete all messages in the conversation
    await getQuery(
      "DELETE FROM `messages` WHERE conversationId = ?",
      [conversationId]
    );

    // Delete the conversation
    await getQuery(
      "DELETE FROM `coversations` WHERE id = ?",
      [conversationId]
    );

    res.status(200).json({ 
      msg: "Conversation deleted successfully", 
      success: true 
    });
  } catch (error) {
    console.error("delete-conversation error:", error);
    res.status(500).json({ 
      msg: "Server error", 
      success: false 
    });
  }
});


module.exports = router;