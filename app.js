require('dotenv').config();
const express = require('express')
const http = require('http')
const router = require('./routes/auth')
const config = require('./server/config')
const agents = require('./routes/agents')
const chat = require('./routes/chat')
const interests = require('./routes/interests')
const { createVoiceGateway, isVoiceStreamingEnabled } = require('./voice/voiceGateway')
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


app.use('/auth',router)
app.use('/server',config)
app.use('/agent',agents)
app.use('/chat',chat)
app.use('/interests', interests)


const server = http.createServer(app);
const PORT = Number(process.env.PORT || 3000);

if (isVoiceStreamingEnabled()) {
    createVoiceGateway(server);
    console.log('Voice streaming gateway active at /ws/voice');
}

server.listen(PORT,()=>{
    console.log(`Server started on port ${PORT}.`);
});