const routes = require('express').Router();
const middleware = require('../middleware/checkAuth')
const { getQuery , query} = require('../db')

function toPhotoUrlArray(rawValue) {
    if (Array.isArray(rawValue)) {
        return rawValue.filter((v) => typeof v === 'string' && v.trim() !== '');
    }
    if (typeof rawValue !== 'string') {
        return [];
    }
    const trimmed = rawValue.trim();
    if (!trimmed) {
        return [];
    }
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.filter((v) => typeof v === 'string' && v.trim() !== '');
            }
        } catch (_) {
            // JSON parse edilemezse tek URL gibi davran
        }
    }
    return [trimmed];
}

function attachPhotoUrls(agent) {
    const photoURLs = toPhotoUrlArray(agent.photoURL);
    return {
        ...agent,
        photoURLs
    };
}

function serializePhotoUrlsFromBody(body) {
    const incomingList = body.photoURLs ?? body.photos ?? body.photoURL;
    const normalized = toPhotoUrlArray(incomingList);
    return JSON.stringify(normalized);
}



routes.post('/get-user-agents',middleware,async (req,res)=>{
    try {
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({
                "msg": "User ID is required",
                "success": false
            });
        }
        
        // Get user's custom agents (system = 0 and creatorId matches)
        const userAgents = await getQuery("SELECT * FROM `bots` WHERE system = ? AND creatorId = ?", [0, userId]);
        
        if (userAgents.length === 0) {
            return res.status(200).json([]);
        }
        
        return res.status(200).json(userAgents.map(attachPhotoUrls));
        
    } catch (error) {
        console.log("Error getting user agents:", error);
        res.status(500).json({
            "msg": "Server error",
            "success": false
        });
    }
})




routes.post('/get-system-agents',middleware,async (req,res)=>{
console.log("middleware working");
const agents = await getQuery("SELECT * FROM `bots` WHERE system = ?",[1]);
console.log(agents)
if (agents.length === 0) {
    res.status(404).json({
        "msg": "Agents is empty",
        "success": false
    })
}else{
return res.json(agents.map(attachPhotoUrls))
}

})


routes.post('/get-agent-data',middleware,async( req ,res )=>{
try {
       const { id }  = req.body;
   const agents = await getQuery("SELECT * FROM `bots` WHERE id = ?",[id]); 
   if (agents.length === 0) {
    res.status(404).json({
        "msg": "Agent not found",
        "success": false
    })
   } else {
        res.status(200).json({
        "success": true,
        "agent": attachPhotoUrls(agents[0])
    })
   }
} catch (error) {
    console.log(error);
       res.status(400).json({
        "msg": "server error",
        "success": false
    })
}

})


routes.post('/create-custom-agent', middleware, async (req, res) => {
    try {
        const {
            name,
            character,
            age,
            gender,
            interests,
            interestsType,
            photoURL,
            photoURLs,
            characterTags,
            speakingStyle,
            voiceId,
            country,
            ownerId
        } = req.body;

        // Validate required fields
        if (!name || !character || !age || !gender || !ownerId) {
            return res.status(400).json({
                "msg": "Missing required fields",
                "success": false
            });
        }

        // Insert the new custom agent into the database
        const insertQuery = `
            INSERT INTO bots 
            (name, \`character\`, age, gender, interests, interestsType, photoURL, 
             characterTags, speakingStyle, voiceId, country, creatorId, system)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            name,
            character,
            age,
            gender,
            interests || '[]',
            interestsType || '[]',
            serializePhotoUrlsFromBody({ photoURL, photoURLs }),
            characterTags || '',
            speakingStyle || '',
            voiceId || '',
            country || '',
            ownerId,
            0  // system = 0 means it's a user-created agent
        ];

        const result = await query(insertQuery, values);

        if (result) {
            res.status(200).json({
                "msg": "Custom agent created successfully",
                "success": true
            });
        } else {
            res.status(500).json({
                "msg": "Failed to create custom agent",
                "success": false
            });
        }

    } catch (error) {
        console.log('Error creating custom agent:', error);
        res.status(500).json({
            "msg": "Server error",
            "success": false,
            "error": error.message
        });
    }
});


// Son 15 gün içerisinde eklenen botları çeker
routes.post('/get-recent-bots', middleware, async (req, res) => {
    try {
        // Son 15 günün tarihini hesapla
        const fifteenDaysAgo = new Date();
        fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
        const dateString = fifteenDaysAgo.toISOString().slice(0, 19).replace('T', ' ');
        
        // Son 15 gün içerisinde eklenen botları çek
        // Not: Eğer created_at kolonu yoksa, created, date_created vb. kolon ismini kullanın
        const recentBots = await getQuery(
            "SELECT * FROM `bots` WHERE created_at >= ? ORDER BY created_at DESC", 
            [dateString]
        );
        
        if (recentBots.length === 0) {
            return res.status(200).json({
                "msg": "Son 15 günde eklenen bot bulunamadı",
                "success": true,
                "data": []
            });
        }
        
        return res.status(200).json({
            "msg": "Son 15 günde eklenen botlar başarıyla getirildi",
            "success": true,
            "count": recentBots.length,
            "data": recentBots.map(attachPhotoUrls)
        });
        
    } catch (error) {
        console.log("Error getting recent bots:", error);
        res.status(500).json({
            "msg": "Server error",
            "success": false,
            "error": error.message
        });
    }
});


module.exports = routes;