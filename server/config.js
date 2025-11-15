const router = require('express').Router();
const {getQuery} = require('../db')


router.post('/config',async (req,res)=>{
 let results = await getQuery("SELECT * FROM `config` WHERE 1",)
    console.log(results)
    return res.status(200).json(results[0])
})

module.exports = router