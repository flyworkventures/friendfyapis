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
   try {
    const { sender, message, conversationId } = req.body;
    const id = guidGenerator();

    if (!conversationId || message == null) {
      return res.status(400).json({
        msg: "conversationId and message are required",
        success: false
      });
    }

    const result = await query(
      "INSERT INTO `messages` (`conversationId`, `sender`, `message`, `created_at`) VALUES (?, ?, ?, ?);",
      [conversationId, "user", message, null]
    );

    if (result !== true) {
      return res.status(500).json({
        msg: "SQL",
        success: false
      });
    }

    if (sender === 'user') {
      try {
        await axios.post("https://n8n.srv1548849.hstgr.cloud/webhook/start-chat", {
          sender: "user",
          message: message,
          conversation: conversationId
        }, {
          timeout: 15000
        });
      } catch (webhookError) {
        // Webhook hata verse bile mesaj kaydi basariliysa 200 donelim.
        console.error("send-message webhook error:", webhookError?.message || webhookError);
      }
    }

    return res.status(200).json({
      msg: "sent",
      id: id,
      success: true
    });
   } catch (error) {
    console.error("send-message error:", error);
    return res.status(500).json({
      msg: "Server error",
      success: false
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
const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic'];

function detectImageMimeFromMagicBytes(buffer) {
  if (!buffer || buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WEBP: RIFF....WEBP
  const riff = buffer.slice(0, 4).toString('ascii');
  const webp = buffer.slice(8, 12).toString('ascii');
  if (riff === 'RIFF' && webp === 'WEBP') {
    return 'image/webp';
  }

  // HEIC/HEIF (ftyp box)
  const ftyp = buffer.slice(4, 8).toString('ascii');
  if (ftyp === 'ftyp') {
    const brand = buffer.slice(8, 12).toString('ascii');
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) {
      return 'image/heic';
    }
  }

  return null;
}

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
      'https://n8n.srv1548849.hstgr.cloud/webhook/voice-message',
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

router.post('/send-image-message', middleware, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'file', maxCount: 1 }
]), async (req, res) => {
  try {
    const requestId = guidGenerator();
    const conversationId = req.body?.conversationId || req.body?.conversation;
    const sender = req.body?.sender || 'user';
    const textMessage = req.body?.message || '';
    console.log(`[send-image-message] route hit | requestId=${requestId} conversationId=${conversationId || 'null'} sender=${sender}`);

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PAYLOAD',
        message: 'conversationId missing',
        requestId
      });
    }

    const uploadedImage = req.files?.image?.[0] || req.files?.file?.[0];
    if (!uploadedImage) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PAYLOAD',
        message: 'image/file is required',
        requestId
      });
    }
    console.log(
      `[send-image-message] file info | requestId=${requestId} originalname=${uploadedImage.originalname || 'unknown'} size=${uploadedImage.size || 0} mime=${uploadedImage.mimetype || 'unknown'}`
    );

    const normalizedMimeType = String(uploadedImage.mimetype || '').toLowerCase();
    const detectedMimeType = detectImageMimeFromMagicBytes(uploadedImage.buffer);
    const resolvedMimeType = ALLOWED_IMAGE_MIME_TYPES.includes(normalizedMimeType)
      ? normalizedMimeType
      : detectedMimeType;

    if (!resolvedMimeType || !ALLOWED_IMAGE_MIME_TYPES.includes(resolvedMimeType)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_FILE_TYPE',
        message: `Unsupported image type. Accepted types: ${ALLOWED_IMAGE_MIME_TYPES.join(', ')}`,
        requestId
      });
    }

    const extensionByMime = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/heic': 'heic'
    };
    const safeExt = extensionByMime[resolvedMimeType] || 'jpg';
    const randomId = getRandomName();
    const cdnUploadUrl = `https://storage.bunnycdn.com/fakefriendstorage/${randomId}.${safeExt}`;
    const cdnFileUrl = `https://fakefriend.b-cdn.net/${randomId}.${safeExt}`;

    try {
      const uploadResponse = await axios.put(cdnUploadUrl, uploadedImage.buffer, {
        headers: {
          AccessKey: '68664abb-b19e-47e7-acd67dba78a5-e90a-4386',
          'Content-Type': resolvedMimeType
        },
        maxBodyLength: Infinity,
        timeout: 20000
      });
      console.log(
        `[send-image-message] cdn upload ok | requestId=${requestId} status=${uploadResponse.status} url=${cdnFileUrl}`
      );
    } catch (uploadError) {
      console.error('send-image-message cdn upload error:', {
        requestId,
        message: uploadError?.message || 'unknown',
        status: uploadError?.response?.status || null,
        data: uploadError?.response?.data || null,
        cdnUploadUrl
      });
      return res.status(502).json({
        success: false,
        error: 'CDN_UPLOAD_FAILED',
        message: 'Image upload failed on upstream provider',
        requestId
      });
    }

    const initialPayload = JSON.stringify({
      imageURL: cdnFileUrl,
      message: textMessage,
      aiExplanation: '',
      date: null
    });

    const insertResult = await getQuery(
      'INSERT INTO `messages` (`conversationId`, `sender`, `message`, `created_at`, `message_type`) VALUES (?, ?, ?, NOW(), ?)',
      [conversationId, sender, initialPayload, 'image']
    );

    const insertedId = insertResult?.insertId || null;
    if (!insertedId) {
      return res.status(500).json({
        success: false,
        error: 'DB_INSERT_FAILED',
        message: 'Image message could not be saved',
        requestId
      });
    }

    let webhookMessage = '';
    let webhookDate = null;
    const webhookPayloadCore = {
      conversationId,
      sender,
      imageURL: cdnFileUrl,
      message: textMessage,
      userMessageID: insertedId
    };
    // n8n akislari farkli parser kullandigi icin alanlari hem root'ta hem body icinde gonder.
    const webhookPayload = {
      ...webhookPayloadCore,
      body: webhookPayloadCore
    };

    let webhookResponse;
    try {
      webhookResponse = await axios.post(
        'https://n8n.srv1548849.hstgr.cloud/webhook/image-message',
        webhookPayload,
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 20000
        }
      );
    } catch (webhookError) {
      console.error('send-image-message webhook error:', {
        requestId,
        message: webhookError?.message || 'unknown',
        status: webhookError?.response?.status || null,
        data: webhookError?.response?.data || null,
        payload: webhookPayload
      });
      return res.status(502).json({
        success: false,
        error: 'WEBHOOK_FAILED',
        message: 'Image uploaded but webhook call failed',
        requestId
      });
    }

    webhookMessage = String(webhookResponse?.data?.message || '');
    webhookDate = webhookResponse?.data?.date || null;

    const enrichedPayload = JSON.stringify({
      imageURL: cdnFileUrl,
      message: textMessage,
      aiExplanation: webhookMessage,
      date: webhookDate
    });
    await getQuery(
      'UPDATE `messages` SET `message` = ? WHERE `id` = ? LIMIT 1',
      [enrichedPayload, insertedId]
    );

    const insertedRows = await getQuery(
      'SELECT id, conversationId, sender, message, message_type, created_at FROM `messages` WHERE id = ? LIMIT 1',
      [insertedId]
    );

    const inserted = insertedRows?.[0];
    if (!inserted) {
      return res.status(500).json({
        success: false,
        error: 'DB_READ_FAILED',
        message: 'Image message saved but could not be loaded',
        requestId
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Image message sent',
      data: {
        id: inserted.id,
        conversationId: inserted.conversationId,
        sender: inserted.sender,
        messageType: inserted.message_type || 'image',
        message: inserted.message,
        createdAt: inserted.created_at instanceof Date
          ? inserted.created_at.toISOString()
          : inserted.created_at,
        requestId
      }
    });
  } catch (error) {
    console.error('send-image-message error:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Server error'
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