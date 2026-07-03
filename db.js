const mysql = require('mysql2/promise');

// 🧠 "conntection" yazım hatası düzeltildi -> "connection"
const connection = mysql.createPool({
    host: "5.39.8.160",
    port: 3306,
    user: "flywork1_friendifyUser",
    password: "vBSBW.bMKkY}$TEo",
    database: "flywork1_friendify"
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

async function insertQuery(sql, values) {
    try {
        const [result] = await connection.query(sql, values);
        return result?.insertId ?? null;
    } catch (error) {
        console.log('SQL insert error ', error);
        return null;
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

module.exports = {getQuery,query,insertQuery};
