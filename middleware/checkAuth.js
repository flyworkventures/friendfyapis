const JWT = require('jsonwebtoken')

module.exports = async (req,res, next) => {
  try {
       const token = req.header('x-auth-token');
       console.log("Token" + token)
    if (!token) {
        return res.status(400).json({
            "msg": "Access Denied"
        });
    }
   let user = await JWT.verify(token,"key");
   console.log("JWT TOKEN ", user["email"])
   if (user) {
    next();
   }else{
    res.status(400).json({
        "msg": "Invalid credential"
    })
   }
  } catch (error) {
    return res.status(500).json({
        "msg": `Error on middleware ${error}`
    })
  }
}