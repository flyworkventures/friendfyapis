const mysql = require('mysql2/promise');

// 🧠 "conntection" yazım hatası düzeltildi -> "connection"
const connection = mysql.createPool({
    host: "89.252.187.162",
    port: 3306,
    user: "semengin_ffuser",
    password: "mz*Y_8N!^HTm",
    database: "semengin_fakefriend"
});

async function getQuery(sql,values){
    try {
        const [rows] = await connection.query(sql,values);
     //   console.log("Sonuç:", rows);
        return rows
    } catch (error) {
        console.log("SQL Error ", error)
        throw error; // Hata fırlat, res burada tanımlı değil
    }
}


async function query(sql,values){
    try {
     let query =  await connection.query(sql,values);
     console.log(query)
        return true
    } catch (error) {
        console.log("SQL Error ", error)
        return false;
    }
}



/*
connection.connect((err) => {
    if (err) {
        console.error('❌ MySQL bağlantı hatası:', err.message);
        return;
    }
    console.log('✅ MySQL bağlantısı başarılı!');
});

*/

module.exports = {getQuery,query};
