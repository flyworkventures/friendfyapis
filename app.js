require('dotenv').config();
const express = require('express')
const http = require('http')
const router = require('./routes/auth')
const config = require('./server/config')
const agents = require('./routes/agents')
const chat = require('./routes/chat')
const interests = require('./routes/interests')
const agentTraits = require('./routes/agentTraits')
const purchases = require('./routes/purchases')
const panel = require('./routes/panel')
const voices = require('./routes/voices')
const stories = require('./routes/stories')
const notifications = require('./routes/notifications')
const { createVoiceGateway, isVoiceStreamingEnabled } = require('./voice/voiceGateway')
const { createVideoGateway, isVideoCallEnabled } = require('./voice/videoGateway')
const VoiceChatServerV2 = require('./realtime/voiceChatServerV2')
const { createVisemeRouter } = require('./voice/viseme')
const requestLogger = require('./middleware/requestLogger')
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// DB sağlık kontrolü — tarayıcı/curl ile test: GET /health/db
app.get('/health/db', async (req, res) => {
    const { testConnection } = require('./db');
    const result = await testConnection();
    const body = {
        status: result.ok ? 'ok' : 'error',
        host: process.env.DB_HOST || null,
        port: Number(process.env.DB_PORT || 3306),
        database: process.env.DB_NAME || null,
        user: process.env.DB_USER || null,
        ...result,
    };
    res.status(result.ok ? 200 : 503).json(body);
});

app.use('/auth',router)
app.use('/server',config)
app.use('/agent',agents)
app.use('/chat',chat)
app.use('/interests', interests)
app.use('/agent-traits', agentTraits)
app.use('/purchases', purchases)
app.use('/panel/v1', panel)
app.use('/voices', voices)
app.use('/stories', stories)
app.use('/notifications', notifications)
app.use('/', createVisemeRouter())


const server = http.createServer(app);
const PORT = Number(process.env.PORT || 3020);

if (isVoiceStreamingEnabled()) {
    createVoiceGateway(server);
    console.log('Voice streaming gateway active at /ws/voice');
}

if (isVideoCallEnabled()) {
    createVideoGateway(server);
    console.log('Video call gateway active at /ws/video');
}

const realtimeEnabled =
    String(process.env.REALTIME_V2_ENABLED || 'true').toLowerCase() === 'true';
if (realtimeEnabled) {
    const wsPath = process.env.REALTIME_WS_PATH || '/realtime';
    const voiceChatServer = new VoiceChatServerV2();
    voiceChatServer.start({ server, path: wsPath });
    console.log(`Realtime voice chat v2 active at ${wsPath}`);
}

server.listen(PORT,()=>{
    console.log(`Server started on port ${PORT}.`);
    // Önceki süreç bir cevap üretirken kapandıysa (deploy/nodemon/çökme) bazı
    // sohbetler 'bot_typing' durumunda takılı kalmış olabilir; başlangıçta temizle.
    const { query } = require('./db');
    query("UPDATE `coversations` SET `current_chat_state` = 'normal' WHERE `current_chat_state` = 'bot_typing'")
        .then((ok) => {
            if (ok) console.log('[DB] Stale bot_typing states reset on startup.');
            else console.warn('[DB] bot_typing reset atlandı (DB bağlantısı yok).');
        })
        .catch((err) => console.error('[DB] bot_typing reset hatası:', err?.message || err));
});
