require('dotenv').config();
const express = require('express')
const http = require('http')
const router = require('./routes/auth')
const config = require('./server/config')
const agents = require('./routes/agents')
const chat = require('./routes/chat')
const interests = require('./routes/interests')
const purchases = require('./routes/purchases')
const panel = require('./routes/panel')
const voices = require('./routes/voices')
const { createVoiceGateway, isVoiceStreamingEnabled } = require('./voice/voiceGateway')
const { createVideoGateway, isVideoCallEnabled } = require('./voice/videoGateway')
const VoiceChatServerV2 = require('./realtime/voiceChatServerV2')
const { createVisemeRouter } = require('./voice/viseme')
const requestLogger = require('./middleware/requestLogger')
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);


app.use('/auth',router)
app.use('/server',config)
app.use('/agent',agents)
app.use('/chat',chat)
app.use('/interests', interests)
app.use('/purchases', purchases)
app.use('/panel/v1', panel)
app.use('/voices', voices)
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
        .then(() => console.log('Stale bot_typing states reset on startup.'))
        .catch((err) => console.error('Failed to reset stale bot_typing states:', err?.message || err));
});
