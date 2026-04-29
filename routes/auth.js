const router = require('express').Router()
const { check, validationResult } = require('express-validator')
const users = require('../fakedb/users');
const UserModel = require('../models/user_model');
const bcrypt = require('bcrypt')
const JWT = require('jsonwebtoken')
const { getQuery , query} = require('../db')

// Token süreleri: access uzun (uygulama güncellemesine kadar sorunsuz kullanım)
const ACCESS_TOKEN_EXPIRY = '365d';   // 1 yıl
const REFRESH_TOKEN_EXPIRY = '365d';  // 1 yıl

function guidGenerator() {
  const S4 = function() {
    return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
  };
  return (S4() + S4() + "-" + S4() + "-" + S4() + "-" + S4() + "-" + S4() + S4() + S4());
}


router.post('/signup', [
    check("email").isEmail(),
    check("password").isLength({
        min: 8
    })
], async (req, res) => {
    const { password, email, credential } = req.body;

    if (credential == null) {
      return res.status(400).json({
            "msg": "Credential is required"
        })
    }

    if (credential === "email") {

        const errors = validationResult(req)

        if (!errors.isEmpty()) {
            return res.status(400).json({
                errors: errors.array()
            })
        }

        console.log("Email: " + email + " Password: " + password)
        let sqlQuery = await getQuery("SELECT * FROM `users` WHERE email = ?", [email]);

        if (sqlQuery.length > 0) {
            console.log("User var");
            return res.status(400).json({
                "error": "User exists"
            })

        } else {
            let hashedPassword = await bcrypt.hash(password, 10);
            await query("INSERT INTO `users` (`email`, `password`, `token`, `accountCreatedDate`, `memberships`, `ownAgents`, `verificated`, `credential`, `refreshToken`, `phoneNumber`, `lastLogins`) VALUES ( ?,?,?,?,?,?,?,?,?,?,?);",[ email,hashedPassword, null, null, null, null, null, credential, null, null, null])
            

            const token = await JWT.sign({ email }, "key", { expiresIn: ACCESS_TOKEN_EXPIRY });
            const refreshToken = await JWT.sign({ email, type: 'refresh' }, "key", { expiresIn: REFRESH_TOKEN_EXPIRY });
            return res.json({
                token,
                refreshToken
            })
        }
    } else if (credential === "google" || credential === "apple") {
       const { userModel } = req.body;
        try {
            // userModel string gelebilir, parse ediyoruz.
            let parsedUser = userModel;
            if (typeof parsedUser === 'string') {
                parsedUser = JSON.parse(parsedUser);
            }
            console.log("Parsed User: ", parsedUser);

            const userEmail = parsedUser.email || email;
            if (!userEmail) {
                return res.status(400).json({ msg: "Email is required for social signup" });
            }

            const existingUser = await getQuery("SELECT * FROM `users` WHERE email = ?", [userEmail]);
            const token = JWT.sign({ email: userEmail }, "key", { expiresIn: ACCESS_TOKEN_EXPIRY });
            const refreshToken = JWT.sign({ email: userEmail, type: 'refresh' }, "key", { expiresIn: REFRESH_TOKEN_EXPIRY });

            if (existingUser.length > 0) {
                return res.json({ token, refreshToken });
            }

            const birthdate = formatDateForMySQL(parsedUser.birthdate);
            const hashedPassword = null; // Social users local password kullanmaz

            await query(
                "INSERT INTO `users` (`username`, `email`, `password`, `token`, `memberships`, `ownAgents`, `verificated`, `credential`, `refreshToken`, `phoneNumber`, `lastLogins`, `country`, `gender` , `birthdate`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
                [parsedUser.username,userEmail, hashedPassword, token,  null, null, "1", credential, null, null, null,parsedUser.counrty || null,parsedUser.gender  , birthdate ]
            );

            return res.json({ token, refreshToken });
           
        } catch (err) {
            console.error(err);
            return res.status(500).json({ msg: "Server error" });
        }
    }
    
    return res.status(400).json({ msg: "Unsupported credential type" });


})

function formatDateForMySQL(dateString) {
  const date = new Date(dateString);
  const pad = (n) => (n < 10 ? "0" + n : n);

  return (
    date.getFullYear() +
    "-" +
    pad(date.getMonth() + 1) +
    "-" +
    pad(date.getDate()) +
    " " +
    pad(date.getHours()) +
    ":" +
    pad(date.getMinutes()) +
    ":" +
    pad(date.getSeconds())
  );
}




router.post('/login', async (req, res) => {
 const { credential , password, email} = req.body;
 if (credential == null) {
    return   res.status(400).json({
            "msg": "Credential is not null",
        })
 }else{
if (credential == "email") {
        let sqlQuery = await getQuery("SELECT * FROM `users` WHERE email = ?", [email]);
        if (sqlQuery.length === 0) {
                 res.status(404).json({
             "msg": "Invalid "
        })
        }else{

             console.log("User Query: ", sqlQuery)
        let user = sqlQuery[0];
        console.log("User: ", user)
        let isMatch = await bcrypt.compare(password,user["password"]);
        if (!isMatch) {
            res.status(404).json({
                "msg": "Invalid credentials"
            })
        } 
        const token = await JWT.sign({ email }, "key", { expiresIn: ACCESS_TOKEN_EXPIRY });
        const refreshToken = await JWT.sign({ email, type: 'refresh' }, "key", { expiresIn: REFRESH_TOKEN_EXPIRY });
        return res.json({
            token,
            refreshToken
        })   
        }
   
     
  
}
 }

   



}),

router.post('/guest-login', async (req, res) => {
    try {
        const guestId = guidGenerator().replace(/-/g, '').slice(0, 16);
        const email = `guest_${guestId}@guest.local`;
        const username = `Guest${guestId.slice(0, 6)}`;
        const nowIso = new Date().toISOString();
        const defaultBirthdateIso = new Date('1970-01-01T00:00:00.000Z').toISOString();

        const token = JWT.sign({ email }, "key", { expiresIn: ACCESS_TOKEN_EXPIRY });
        const refreshToken = JWT.sign({ email, type: 'refresh' }, "key", { expiresIn: REFRESH_TOKEN_EXPIRY });

        await query(
            "INSERT INTO `users` (`username`, `email`, `password`, `token`, `accountCreatedDate`, `birthdate`, `memberships`, `ownAgents`, `verificated`, `credential`, `refreshToken`, `phoneNumber`, `lastLogins`, `gender`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
            [username, email, null, token, nowIso, defaultBirthdateIso, null, null, 1, "guest", refreshToken, null, null, 'male']
        );

        const createdUserRows = await getQuery("SELECT * FROM `users` WHERE email = ? LIMIT 1", [email]);
        const createdUser = createdUserRows?.[0];

        if (!createdUser) {
            return res.status(500).json({
                msg: "Guest user could not be created",
                success: false
            });
        }

        return res.status(200).json({
            success: true,
            user: {
                id: createdUser.id,
                username: createdUser.username || username,
                email: createdUser.email || email,
                token,
                refreshToken,
                accountCreatedDate: createdUser.accountCreatedDate
                    ? new Date(createdUser.accountCreatedDate).toISOString()
                    : nowIso,
                birthdate: createdUser.birthdate
                    ? new Date(createdUser.birthdate).toISOString()
                    : defaultBirthdateIso,
                memberships: createdUser.memberships ?? null,
                ownAgents: createdUser.ownAgents ? createdUser.ownAgents : [],
                verificated: Number(createdUser.verificated ?? 1),
                credential: createdUser.credential || 'guest',
                lastLogins: createdUser.lastLogins ?? null,
                counrty: createdUser.counrty ?? null,
                gender: createdUser.gender || 'male',
                hobbies: createdUser.hobbies ?? null,
                photoURL: createdUser.photoURL ?? null
            }
        });
    } catch (error) {
        console.error("guest-login error:", error);
        return res.status(500).json({
            msg: "Server error",
            success: false
        });
    }
});


router.post('/verify-token', async (req, res) => {
    const token = req.body?.token || req.header('x-auth-token') || null;
    const refreshToken = req.body?.refreshToken || req.header('x-refresh-token') || req.header('refresh-token') || null;
    if (!token) {
        return res.status(400).json({
            msg: "Token is required",
            code: "TOKEN_MISSING"
        });
    }
    try {
        let user = await JWT.verify(token, "key");
        let userModel = await getUserData(user["email"]);
        if (user) {
            return res.status(200).json({
                msg: "Valid Token",
                user: userModel,
                token
            });
        }
        return res.status(400).json({
            msg: "Invalid Token"
        });
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            // Otomatik yenileme: verify-token isteğinde refresh token varsa yeni access token üret.
            if (refreshToken) {
                try {
                    const refreshPayload = JWT.verify(refreshToken, "key");
                    if (refreshPayload.type !== 'refresh') {
                        return res.status(401).json({
                            msg: "Invalid refresh token.",
                            code: "INVALID_REFRESH_TOKEN"
                        });
                    }

                    const userModel = await getUserData(refreshPayload.email);
                    if (!userModel) {
                        return res.status(401).json({
                            msg: "User not found",
                            code: "USER_NOT_FOUND"
                        });
                    }

                    const renewedToken = JWT.sign({ email: refreshPayload.email }, "key", { expiresIn: ACCESS_TOKEN_EXPIRY });
                    return res.status(200).json({
                        msg: "Token renewed",
                        code: "TOKEN_RENEWED",
                        token: renewedToken,
                        user: userModel
                    });
                } catch (refreshErr) {
                    if (refreshErr.name === 'TokenExpiredError') {
                        return res.status(401).json({
                            msg: "Refresh token expired. Please login again.",
                            code: "REFRESH_TOKEN_EXPIRED"
                        });
                    }
                    return res.status(401).json({
                        msg: "Invalid refresh token.",
                        code: "INVALID_REFRESH_TOKEN"
                    });
                }
            }

            return res.status(401).json({
                msg: "Token expired. Please login again.",
                code: "TOKEN_EXPIRED",
                expiredAt: err.expiredAt
            });
        }
        if (err.name === 'JsonWebTokenError') {
            return res.status(401).json({
                msg: "Invalid token.",
                code: "INVALID_TOKEN"
            });
        }
        return res.status(401).json({
            msg: "Invalid Token"
        });
    }
});

// Refresh token ile yeni access token al (otomatik yenileme için)
router.post('/refresh-token', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(400).json({
                msg: "Refresh token is required",
                success: false,
                code: "REFRESH_TOKEN_MISSING"
            });
        }
        const payload = JWT.verify(refreshToken, "key");
        if (payload.type !== 'refresh') {
            return res.status(401).json({
                msg: "Invalid refresh token",
                success: false,
                code: "INVALID_REFRESH_TOKEN"
            });
        }
        const user = await getUserData(payload.email);
        if (!user) {
            return res.status(401).json({
                msg: "User not found",
                success: false,
                code: "USER_NOT_FOUND"
            });
        }
        const token = JWT.sign({ email: payload.email }, "key", { expiresIn: ACCESS_TOKEN_EXPIRY });
        return res.status(200).json({
            msg: "Token renewed",
            success: true,
            token
        });
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({
                msg: "Refresh token expired. Please login again.",
                code: "REFRESH_TOKEN_EXPIRED",
                success: false
            });
        }
        if (err.name === 'JsonWebTokenError') {
            return res.status(401).json({
                msg: "Invalid refresh token.",
                code: "INVALID_REFRESH_TOKEN",
                success: false
            });
        }
        return res.status(500).json({
            msg: "Server error",
            success: false
        });
    }
});

async function getUserData(email){
let sqlQuery = await getQuery("SELECT * FROM `users` WHERE email = ?", [email]);
console.log("Tetiklendi")
if (sqlQuery.length === 0) {
           return null;
        }else{
            console.log("User: " + sqlQuery[0])
            return sqlQuery[0];
        }
}





router.post('/check-mail', async(req,res)=>{
   const  {email} = req.body;
       let sqlQuery = await getQuery("SELECT * FROM `users` WHERE email = ?", [email]);

        if (sqlQuery.length > 0) {

            res.status(400).json({
                "msg": "User exists",
                "model": sqlQuery
            })

        }else{
          res.status(200).json({
            "msg": "Avaible"
          })
        }
})


const middleware = require('../middleware/checkAuth');

router.post('/update-profile', middleware, async (req, res) => {
    try {
        const { userId, username, photoURL } = req.body;

        if (!userId) {
            return res.status(400).json({
                msg: "User ID is required",
                success: false
            });
        }

        // Kullanıcının var olup olmadığını kontrol et
        const userCheck = await getQuery("SELECT * FROM `users` WHERE id = ?", [userId]);
        
        if (userCheck.length === 0) {
            return res.status(404).json({
                msg: "User not found",
                success: false
            });
        }

        // Güncelleme işlemi
        let updateQuery = "UPDATE `users` SET ";
        let updateValues = [];
        let updateFields = [];

        if (username !== undefined && username !== null) {
            updateFields.push("username = ?");
            updateValues.push(username);
        }

        if (photoURL !== undefined && photoURL !== null) {
            updateFields.push("photoURL = ?");
            updateValues.push(photoURL);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({
                msg: "No fields to update",
                success: false
            });
        }

        updateQuery += updateFields.join(", ");
        updateQuery += " WHERE id = ?";
        updateValues.push(userId);

        await query(updateQuery, updateValues);

        // Güncellenmiş kullanıcı bilgilerini al
        const updatedUser = await getQuery("SELECT * FROM `users` WHERE id = ?", [userId]);

        return res.status(200).json({
            msg: "Profile updated successfully",
            success: true,
            user: updatedUser[0]
        });

    } catch (error) {
        console.error("update-profile error:", error);
        return res.status(500).json({
            msg: "Server error",
            success: false,
            error: error.message
        });
    }
});


router.post('/delete-account', middleware, async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({
                msg: "User ID is required",
                success: false
            });
        }

        // Kullanıcının var olup olmadığını kontrol et
        const userCheck = await getQuery("SELECT * FROM `users` WHERE id = ?", [userId]);
        
        if (userCheck.length === 0) {
            return res.status(404).json({
                msg: "User not found",
                success: false
            });
        }

        // Kullanıcının mesajlarını sil
        await query("DELETE FROM `messages` WHERE conversationId IN (SELECT id FROM `coversations` WHERE userId = ?)", [userId]);
        
        // Kullanıcının konuşmalarını sil
        await query("DELETE FROM `coversations` WHERE userId = ?", [userId]);
        
        // Kullanıcının oluşturduğu botları sil
        await query("DELETE FROM `bots` WHERE creatorId = ?", [userId]);
        
        // Kullanıcıyı sil
        await query("DELETE FROM `users` WHERE id = ?", [userId]);

        return res.status(200).json({
            msg: "Account deleted successfully",
            success: true
        });

    } catch (error) {
        console.error("delete-account error:", error);
        return res.status(500).json({
            msg: "Server error",
            success: false,
            error: error.message
        });
    }
});

module.exports = router