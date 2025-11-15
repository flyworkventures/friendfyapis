const router = require('express').Router()
const { check, validationResult } = require('express-validator')
const users = require('../fakedb/users');
const UserModel = require('../models/user_model');
const bcrypt = require('bcrypt')
const JWT = require('jsonwebtoken')
const { getQuery , query} = require('../db')


router.post('/signup', [
    check("email").isEmail(),
    check("password").isLength({
        min: 8
    })
], async (req, res) => {
    const { password, email, credential } = req.body;

    if (credential == null) {
      return  res.status(400).json({
            "msg": "Credential is not null"
        })
    }else{

    if (credential == "email") {

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
            res.status(400).json({
                "error": "User exists"
            })

        } else {
            let hashedPassword = await bcrypt.hash(password, 10);
            query("INSERT INTO `users` (`email`, `password`, `token`, `accountCreatedDate`, `memberships`, `ownAgents`, `verificated`, `credential`, `refreshToken`, `phoneNumber`, `lastLogins`) VALUES ( ?,?,?,?,?,?,?,?,?,?,?);",[ email,hashedPassword, null, null, null, null, null, credential, null, null, null])
            

            const token = await JWT.sign({
                email
            },
                "key",
                {
                    expiresIn: 3600000
                }
            );
            return res.json({
                token
            })
        }
    }else if(credential == "google"){
       const { userModel } = req.body;
       const user = userModel;
        try {
            // Ensure userModel is a JSON object (parse if it's a string)
            let parsedUser = userModel;
            if (typeof parsedUser === 'string') {
                parsedUser = JSON.parse(parsedUser);
            }
            console.log("Parsed User: ", parsedUser);

            const userEmail = parsedUser.email || email;
            const birthdate = formatDateForMySQL(parsedUser.birthdate);
            const hashedPassword = null; // Google users won't have a local password
             const token = JWT.sign({ email: userEmail }, "key", { expiresIn: 3600000 });

     

            // Insert the Google user into the DB
            await query(
                "INSERT INTO `users` (`username`, `email`, `password`, `token`, `memberships`, `ownAgents`, `verificated`, `credential`, `refreshToken`, `phoneNumber`, `lastLogins`, `country`, `gender` , `birthdate`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
                [parsedUser.username,userEmail, hashedPassword, token,  null, null, "1", credential, null, null, null,parsedUser.counrty || null,parsedUser.gender  , birthdate ]
            );

            // Sign and return a token
                   return res.json({ token });
           
        } catch (err) {
            console.error(err);
            return res.status(500).json({ msg: "Server error" });
        }
          query("INSERT INTO `users` (`email`, `password`, `token`, `accountCreatedDate`, `memberships`, `ownAgents`, `verificated`, `credential`, `refreshToken`, `phoneNumber`, `lastLogins`) VALUES ( ?,?,?,?,?,?,?,?,?,?,?);",[ email,hashedPassword, null, null, null, null, null, credential, null, null, null])
    }
    }



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
        const token = await JWT.sign({email},"key",{expiresIn: 360000});
        return res.json({
            token
        })   
        }
   
     
  
}
 }

   



}),


router.post('/verify-token', async (req, res) => {
    const { token } = req.body;
    try {
        let user = await JWT.verify(token, "key");
        let userModel = await getUserData(user["email"]);
       
        console.log("Verified User: ", user)
        if (user) {

            return res.status(200).json({
                "msg": "Valid Token",
                "user": userModel
            })
        } else {
            return res.status(400).json({
                "msg": "Invalid Token 400"
            })
        }
    } catch (err) {
        console.log(err)
        return res.status(400).json({
            "msg": "Invalid Token "
        })
    }
})


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