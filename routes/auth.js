const router = require('express').Router()
const { check, validationResult } = require('express-validator')
const users = require('../fakedb/users');
const UserModel = require('../models/user_model');
const bcrypt = require('bcrypt')
const JWT = require('jsonwebtoken')
const { getQuery , query} = require('../db')
const {
    normalizeMembership,
    mergeMembershipsDbWithClient
} = require('./lib/membershipsSync');
const { assertJwtMatchesUserId } = require('./lib/assertJwtUserId');

// Token süreleri: access uzun (uygulama güncellemesine kadar sorunsuz kullanım)
const ACCESS_TOKEN_EXPIRY = '365d';   // 1 yıl
const REFRESH_TOKEN_EXPIRY = '365d';  // 1 yıl
// checkAuth ile aynı sır: ortamda JWT_SECRET yoksa 'key' (eski davranış)
const JWT_SECRET = process.env.JWT_SECRET || 'key';

/** Access JWT: id + userId (sayı) + email — agent rotaları req.user.id için gerekli. */
function signAccessTokenForUser(userRow) {
    if (!userRow || !userRow.email) return null;
    const idNum = Number(userRow.id);
    const payload = { email: userRow.email };
    if (!Number.isNaN(idNum)) {
        payload.id = idNum;
        payload.userId = idNum;
    }
    return JWT.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

function signRefreshTokenForUser(userRow) {
    if (!userRow || !userRow.email) return null;
    const idNum = Number(userRow.id);
    const payload = { email: userRow.email, type: 'refresh' };
    if (!Number.isNaN(idNum)) {
        payload.id = idNum;
        payload.userId = idNum;
    }
    return JWT.sign(payload, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
}

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
            
            const insertedRows = await getQuery('SELECT id, email FROM `users` WHERE email = ? LIMIT 1', [email]);
            const newUser = insertedRows[0];
            const token = signAccessTokenForUser(newUser);
            const refreshToken = signRefreshTokenForUser(newUser);
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

            // Apple kullanıcısı bazen email yollamayabilir; userIdentifier'ı
            // var → privaterelay pattern'iyle synthesize edip kullanıyoruz.
            const appleUid =
                parsedUser.appleUserIdentifier || parsedUser.userIdentifier || null;
            const appleToken = parsedUser.appleToken || null;
            let userEmail = parsedUser.email || email;
            if (!userEmail && credential === 'apple' && appleUid) {
                userEmail = `${appleUid}@privaterelay.appleid.com`;
            }
            if (!userEmail) {
                return res.status(400).json({ msg: "Email is required for social signup" });
            }

            // Mevcut kullanıcıyı önce appleUserIdentifier (varsa), sonra email
            // ile ara. Apple "Hide my email"den private'a, sonra yine de
            // userIdentifier üzerinden bulunabilsin.
            let existingUser = [];
            if (credential === 'apple' && appleUid) {
                existingUser = await getQuery(
                    "SELECT * FROM `users` WHERE appleUserIdentifier = ? LIMIT 1",
                    [appleUid]
                );
            }
            if (existingUser.length === 0) {
                existingUser = await getQuery(
                    "SELECT * FROM `users` WHERE email = ? LIMIT 1",
                    [userEmail]
                );
            }
            if (existingUser.length > 0) {
                const u = existingUser[0];
                const token = signAccessTokenForUser(u);
                const refreshToken = signRefreshTokenForUser(u);
                // Apple userIdentifier'ı eskiden boştuysa şimdi senkronla.
                if (credential === 'apple' && appleUid && !u.appleUserIdentifier) {
                    try {
                        await query(
                            'UPDATE `users` SET appleUserIdentifier = ?, appleToken = COALESCE(?, appleToken) WHERE id = ?',
                            [appleUid, appleToken, u.id]
                        );
                    } catch (e) {
                        console.warn('[signup] backfill appleUserIdentifier failed:', e.message);
                    }
                }
                return res.json({ token, refreshToken });
            }

            const birthdate = formatDateForMySQL(parsedUser.birthdate);
            const hashedPassword = null; // Social users local password kullanmaz
            const hobbies = serializeHobbiesForDb(parsedUser.hobbies);

            const signupUsername = String(parsedUser.username || '').trim().slice(0, 20);
            await query(
                "INSERT INTO `users` (`username`, `email`, `password`, `token`, `memberships`, `ownAgents`, `verificated`, `credential`, `refreshToken`, `phoneNumber`, `lastLogins`, `country`, `gender` , `birthdate`, `appleUserIdentifier`, `appleToken`, `hobbies`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
                [signupUsername,userEmail, hashedPassword, null,  null, null, "1", credential, null, null, null,parsedUser.counrty || null,parsedUser.gender  , birthdate, appleUid, appleToken, hobbies]
            );

            const insertedRows = await getQuery('SELECT id, email FROM `users` WHERE email = ? LIMIT 1', [userEmail]);
            const newUser = insertedRows[0];
            const token = signAccessTokenForUser(newUser);
            const refreshToken = signRefreshTokenForUser(newUser);
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

function serializeHobbiesForDb(hobbies) {
    if (hobbies == null) return null;
    if (typeof hobbies === 'string') return hobbies;
    return JSON.stringify(hobbies);
}

function mapGuestUserRow(row, fallback = {}) {
    if (!row) return null;
    return {
        id: row.id,
        username: row.username || fallback.username,
        email: row.email || fallback.email,
        token: fallback.token ?? row.token ?? null,
        refreshToken: fallback.refreshToken ?? row.refreshToken ?? null,
        accountCreatedDate: row.accountCreatedDate
            ? new Date(row.accountCreatedDate).toISOString()
            : fallback.accountCreatedDate,
        birthdate: row.birthdate
            ? new Date(row.birthdate).toISOString()
            : fallback.birthdate,
        memberships: row.memberships ?? null,
        ownAgents: row.ownAgents ? row.ownAgents : [],
        verificated: Number(row.verificated ?? 1),
        credential: row.credential || 'guest',
        lastLogins: row.lastLogins ?? null,
        counrty: row.counrty ?? null,
        gender: row.gender || fallback.gender || 'male',
        hobbies: row.hobbies ?? null,
        photoURL: row.photoURL ?? null
    };
}




router.post('/login', async (req, res) => {
    const { credential, password, email } = req.body;
    if (credential == null) {
        return res.status(400).json({
            msg: 'Credential is required'
        });
    }

    try {
        if (credential === 'email') {
            if (!email) {
                return res.status(400).json({ msg: 'Email is required' });
            }
            const sqlQuery = await getQuery('SELECT * FROM `users` WHERE email = ?', [email]);
            if (sqlQuery.length === 0) {
                return res.status(404).json({ msg: 'Invalid credentials' });
            }
            const user = sqlQuery[0];
            if (!user.password) {
                return res.status(404).json({ msg: 'Invalid credentials' });
            }
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(404).json({ msg: 'Invalid credentials' });
            }
            const token = signAccessTokenForUser(user);
            const refreshToken = signRefreshTokenForUser(user);
            return res.json({ token, refreshToken });
        }

        if (credential === 'google' || credential === 'apple') {
            const { userModel } = req.body;
            let parsedUser = userModel;
            if (typeof parsedUser === 'string') {
                parsedUser = JSON.parse(parsedUser);
            }
            const userEmail = parsedUser?.email || email;
            if (!userEmail) {
                return res.status(400).json({ msg: 'Email is required for social login' });
            }
            const rows = await getQuery('SELECT * FROM `users` WHERE email = ?', [userEmail]);
            if (rows.length === 0) {
                return res.status(404).json({
                    msg: 'User not found',
                    code: 'USER_NOT_FOUND'
                });
            }
            const u = rows[0];
            const token = signAccessTokenForUser(u);
            const refreshToken = signRefreshTokenForUser(u);
            return res.json({ token, refreshToken });
        }

        return res.status(400).json({ msg: 'Unsupported credential type' });
    } catch (err) {
        console.error('login error:', err);
        return res.status(500).json({ msg: 'Server error' });
    }
});

router.post('/guest-login', async (req, res) => {
    try {
        const guestId = guidGenerator().replace(/-/g, '').slice(0, 16);
        const nowIso = new Date().toISOString();
        const defaultBirthdateIso = new Date('1970-01-01T00:00:00.000Z').toISOString();
        const onboarding = req.body?.onboarding || {};

        const usernameRaw = String(onboarding.username || '').trim();
        const username = usernameRaw.length > 0
            ? usernameRaw.slice(0, 20)
            : `Guest${guestId.slice(0, 6)}`;

        // Misafir e-postası kullanıcının verdiği isimden türetilir (benzersizlik için kısa id eklenir).
        const emailSlug = usernameRaw
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '')
            .slice(0, 20);
        const emailLocalPart = emailSlug.length > 0
            ? `${emailSlug}_${guestId.slice(0, 8)}`
            : `guest_${guestId}`;
        const email = `${emailLocalPart}@guest.local`;
        const genderRaw = String(onboarding.gender || '').trim().toLowerCase();
        const gender = ['male', 'female'].includes(genderRaw) ? genderRaw : 'male';
        const birthdateForDb = onboarding.birthdate
            ? formatDateForMySQL(onboarding.birthdate)
            : formatDateForMySQL(defaultBirthdateIso);
        const hobbies = serializeHobbiesForDb(onboarding.hobbies);

        await query(
            "INSERT INTO `users` (`username`, `email`, `password`, `token`, `accountCreatedDate`, `birthdate`, `memberships`, `ownAgents`, `verificated`, `credential`, `refreshToken`, `phoneNumber`, `lastLogins`, `gender`, `hobbies`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
            [username, email, null, null, nowIso, birthdateForDb, null, null, 1, "guest", null, null, null, gender, hobbies]
        );

        const createdUserRows = await getQuery("SELECT * FROM `users` WHERE email = ? LIMIT 1", [email]);
        const createdUser = createdUserRows?.[0];

        if (!createdUser) {
            return res.status(500).json({
                msg: "Guest user could not be created",
                success: false
            });
        }

        const token = signAccessTokenForUser(createdUser);
        const refreshToken = signRefreshTokenForUser(createdUser);
        if (token && refreshToken) {
            await query('UPDATE `users` SET `token` = ?, `refreshToken` = ? WHERE id = ? LIMIT 1', [
                token,
                refreshToken,
                createdUser.id
            ]);
        }

        return res.status(200).json({
            success: true,
            user: mapGuestUserRow(createdUser, {
                username,
                email,
                token,
                refreshToken,
                accountCreatedDate: nowIso,
                birthdate: onboarding.birthdate
                    ? new Date(onboarding.birthdate).toISOString()
                    : defaultBirthdateIso,
                gender,
            })
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
        let user = await JWT.verify(token, JWT_SECRET);
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
                    const refreshPayload = JWT.verify(refreshToken, JWT_SECRET);
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

                    const renewedToken = signAccessTokenForUser(userModel);
                    if (!renewedToken) {
                        return res.status(500).json({
                            msg: 'Could not issue access token',
                            code: 'TOKEN_ISSUE_FAILED'
                        });
                    }
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
        const payload = JWT.verify(refreshToken, JWT_SECRET);
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
        const token = signAccessTokenForUser(user);
        if (!token) {
            return res.status(500).json({
                msg: 'Could not issue access token',
                success: false,
                code: 'TOKEN_ISSUE_FAILED'
            });
        }
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





router.post('/check-mail', async (req, res) => {
    const { email, appleUserIdentifier } = req.body;

    // Apple login akışı: subsequent login'lerde Apple email yollamaz,
    // sadece stabil `userIdentifier` döner. Bu yüzden lookup'ı önce
    // appleUserIdentifier üzerinden yapıyoruz, sonra email'e düşüyoruz.
    if (!email && !appleUserIdentifier) {
        return res.status(400).json({ msg: 'Email or appleUserIdentifier is required' });
    }

    let sqlQuery = [];
    if (appleUserIdentifier) {
        sqlQuery = await getQuery(
            'SELECT * FROM `users` WHERE appleUserIdentifier = ? LIMIT 1',
            [appleUserIdentifier]
        );
        // Eski Apple kullanıcısı; userIdentifier ile kayıtlı değilse
        // privaterelay email pattern'inden de bul (geriye dönük uyum).
        if (sqlQuery.length === 0) {
            const fallbackEmail = `${appleUserIdentifier}@privaterelay.appleid.com`;
            sqlQuery = await getQuery(
                'SELECT * FROM `users` WHERE email = ? LIMIT 1',
                [fallbackEmail]
            );
            // Bulunduysa appleUserIdentifier'ı senkronlayalım ki sonraki
            // login'ler direkt eşleşsin.
            if (sqlQuery.length > 0) {
                try {
                    await query(
                        'UPDATE `users` SET appleUserIdentifier = ? WHERE id = ?',
                        [appleUserIdentifier, sqlQuery[0].id]
                    );
                } catch (e) {
                    console.warn('[check-mail] backfill appleUserIdentifier failed:', e.message);
                }
            }
        }
    } else if (email) {
        sqlQuery = await getQuery(
            'SELECT * FROM `users` WHERE email = ? LIMIT 1',
            [email]
        );
    }

    if (sqlQuery.length > 0) {
        const u = sqlQuery[0];
        const token = signAccessTokenForUser(u);
        const refreshToken = signRefreshTokenForUser(u);

        if (token && refreshToken) {
            await query(
                'UPDATE `users` SET token = ?, refreshToken = ? WHERE id = ?',
                [token, refreshToken, u.id]
            );
        }

        const userRow = { ...u, token, refreshToken };

        return res.status(400).json({
            msg: 'User exists',
            model: [userRow],
            token,
            refreshToken,
        });
    }

    return res.status(200).json({
        msg: 'Avaible',
    });
});


const middleware = require('../middleware/checkAuth');

router.post('/update-profile', middleware, async (req, res) => {
    try {
        const { userId, username, photoURL, birthdate, gender, hobbies } = req.body;

        if (!userId) {
            return res.status(400).json({
                msg: "User ID is required",
                success: false
            });
        }

        const authCheck = assertJwtMatchesUserId(req, userId);
        if (!authCheck.ok) {
            return res.status(authCheck.status).json(authCheck.json);
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
            const trimmed = String(username).trim();
            if (trimmed.length > 20) {
                return res.status(400).json({
                    msg: "Username must be at most 20 characters",
                    success: false,
                    code: "USERNAME_TOO_LONG"
                });
            }
            updateFields.push("username = ?");
            updateValues.push(trimmed);
        }

        if (photoURL !== undefined && photoURL !== null) {
            updateFields.push("photoURL = ?");
            updateValues.push(photoURL);
        }

        if (birthdate !== undefined && birthdate !== null) {
            const parsedBirthdate = new Date(birthdate);
            if (Number.isNaN(parsedBirthdate.getTime())) {
                return res.status(400).json({
                    msg: "Invalid birthdate",
                    success: false,
                    code: "INVALID_BIRTHDATE"
                });
            }
            updateFields.push("birthdate = ?");
            updateValues.push(formatDateForMySQL(birthdate));
        }

        if (gender !== undefined) {
            if (gender === null) {
                updateFields.push("gender = ?");
                updateValues.push(null);
            } else {
                const normalizedGender = String(gender).trim().toLowerCase();
                if (!['male', 'female'].includes(normalizedGender)) {
                    return res.status(400).json({
                        msg: "Invalid gender",
                        success: false,
                        code: "INVALID_GENDER"
                    });
                }
                updateFields.push("gender = ?");
                updateValues.push(normalizedGender);
            }
        }

        if (hobbies !== undefined) {
            updateFields.push("hobbies = ?");
            updateValues.push(serializeHobbiesForDb(hobbies));
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
        const row = updatedUser[0];

        return res.status(200).json({
            msg: "Profile updated successfully",
            success: true,
            user: {
                ...row,
                birthdate: row.birthdate
                    ? new Date(row.birthdate).toISOString()
                    : null,
                accountCreatedDate: row.accountCreatedDate
                    ? new Date(row.accountCreatedDate).toISOString()
                    : row.accountCreatedDate,
            }
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


router.post('/update-premium', middleware, async (req, res) => {
    try {
        const { userId, memberships } = req.body || {};

        const gate = assertJwtMatchesUserId(req, userId);
        if (!gate.ok) {
            return res.status(gate.status).json(gate.json);
        }

        let arrRaw = memberships;
        if (typeof memberships === 'string') {
            try {
                arrRaw = JSON.parse(memberships);
            } catch {
                return res.status(400).json({
                    msg: 'memberships must be a valid JSON array',
                    success: false
                });
            }
        }

        if (!Array.isArray(arrRaw)) {
            return res.status(400).json({
                msg: 'memberships must be an array',
                success: false
            });
        }

        const normalizedMemberships = [];
        for (const membership of arrRaw) {
            const normalized = normalizeMembership(membership);
            if (normalized?.error) {
                return res.status(400).json({
                    msg: normalized.error,
                    success: false
                });
            }
            normalizedMemberships.push(normalized);
        }

        const existingUser = await getQuery('SELECT * FROM `users` WHERE id = ? LIMIT 1', [
            userId
        ]);
        if (!existingUser || existingUser.length === 0) {
            return res.status(404).json({
                msg: 'User not found',
                success: false
            });
        }

        const merged = mergeMembershipsDbWithClient(
            existingUser[0].memberships,
            normalizedMemberships
        );

        await query('UPDATE `users` SET `memberships` = ? WHERE id = ? LIMIT 1', [
            JSON.stringify(merged),
            userId
        ]);

        const updatedUser = await getQuery('SELECT * FROM `users` WHERE id = ? LIMIT 1', [
            userId
        ]);

        return res.status(200).json({
            success: true,
            user: updatedUser[0]
        });
    } catch (error) {
        console.error('update-premium error:', error);
        return res.status(500).json({
            success: false,
            msg: 'Server error'
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