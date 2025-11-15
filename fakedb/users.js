const UserModel = require('../models/user_model')

const users = [
    new UserModel(
       6723481,
         "test@mail.com",
         "ahmet1234",
         null,
         null,
         Date.now(),
         {
            membershipId: "premium",
            startDate: "23.08.2009",
            endDate: "12.09.2025",
            buyedId: "sjhfb8UHIJKNSDF"
        },
         [
            "asdfdsf"
        ]
    ),

    
 
]

module.exports = users;